import { describe, expect, it } from 'vitest';
import { decrypt, encrypt, signState, verifyState } from '../api/_lib/crypto';
import { disconnect, finishConnect, startConnect, syncMonth, type Deps, type Env, type Store } from '../api/_lib/qb';
import { monthRange, reportToLines } from '../api/_lib/report';

const env: Env = {
  INTUIT_CLIENT_ID: 'client-id',
  INTUIT_CLIENT_SECRET: 'client-secret',
  INTUIT_REDIRECT_URI: 'https://app.example.com/api/qb/callback',
  INTUIT_ENV: 'sandbox',
  INTEGRATIONS_SECRET: 'a-long-random-secret-for-tests',
  APP_URL: 'https://app.example.com',
};

// A QuickBooks "ProfitAndLoss" report in the API's JSON shape (made-up numbers).
const REPORT = {
  Rows: {
    Row: [
      { type: 'Section', group: 'Income', Header: { ColData: [{ value: 'Income' }, { value: '' }] }, Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Services' }, { value: '52000.00' }] }] }, Summary: { ColData: [{ value: 'Total Income' }, { value: '52000.00' }] } },
      { type: 'Section', group: 'COGS', Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Job Materials' }, { value: '9500.00' }] }] } },
      { type: 'Section', group: 'GrossProfit', Summary: { ColData: [{ value: 'Gross Profit' }, { value: '42500.00' }] } },
      {
        type: 'Section',
        group: 'Expenses',
        Rows: {
          Row: [
            { type: 'Data', ColData: [{ value: 'Insurance' }, { value: '2,400.00' }] },
            { type: 'Section', Header: { ColData: [{ value: 'Payroll Expenses' }] }, Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Wages' }, { value: '18000.00' }] }, { type: 'Data', ColData: [{ value: 'Payroll Taxes' }, { value: '1980.00' }] }] }, Summary: { ColData: [{ value: 'Total Payroll Expenses' }, { value: '19980.00' }] } },
          ],
        },
      },
      { type: 'Section', group: 'OtherExpenses', Rows: { Row: [{ type: 'Data', ColData: [{ value: 'Interest Expense' }, { value: '310.00' }] }] } },
      { type: 'Section', group: 'NetIncome', Summary: { ColData: [{ value: 'Net Income' }, { value: '1.00' }] } },
    ],
  },
};

interface Call {
  url: string;
  init?: RequestInit;
}

function setup(over: { reportStatuses?: number[]; role?: string } = {}) {
  const calls: Call[] = [];
  let clock = Date.parse('2026-11-02T12:00:00Z');
  const db = { link: null as null | { companyId: string; realmId: string; label: string | null; userId: string }, secret: null as null | { enc: string; expires: string }, synced: [] as (string | null)[], deleted: false };
  const store: Store = {
    userFromToken: async (t) => (t === 'good-token' ? { id: 'user-1' } : null),
    membership: async (u) => (u === 'user-1' ? { companyId: 'co-1', role: over.role ?? 'owner' } : null),
    saveConnection: async (c) => {
      db.link = { companyId: c.companyId, realmId: c.realmId, label: c.label, userId: c.userId };
      db.secret = { enc: c.secretEncrypted, expires: c.accessExpiresAt };
    },
    getSecret: async () => (db.secret && db.link ? { secretEncrypted: db.secret.enc, realmId: db.link.realmId } : null),
    updateSecret: async (_c, enc, expires) => {
      db.secret = { enc, expires };
    },
    deleteConnection: async () => {
      db.link = null;
      db.secret = null;
      db.deleted = true;
    },
    markSync: async (_c, e) => void db.synced.push(e),
  };
  const statuses = [...(over.reportStatuses ?? [200])];
  let refreshCount = 0;
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    if (url.includes('/oauth2/v1/tokens/bearer')) {
      const form = new URLSearchParams(String(init?.body));
      if (form.get('grant_type') === 'authorization_code') return json({ access_token: 'access-1', refresh_token: 'refresh-1', expires_in: 3600, x_refresh_token_expires_in: 8640000 });
      refreshCount++;
      return json({ access_token: `access-${refreshCount + 1}`, refresh_token: `refresh-${refreshCount + 1}`, expires_in: 3600, x_refresh_token_expires_in: 8640000 });
    }
    if (url.includes('/companyinfo/')) return json({ CompanyInfo: { CompanyName: 'Example Handyman LLC' } });
    if (url.includes('/reports/ProfitAndLoss')) {
      const status = statuses.shift() ?? 200;
      return status === 200 ? json(REPORT) : json({}, status);
    }
    if (url.includes('/tokens/revoke')) return json({});
    return json({}, 404);
  }) as unknown as typeof fetch;
  const deps: Deps = { env, store, fetch: fakeFetch, now: () => clock };
  return { deps, db, calls, advance: (ms: number) => (clock += ms), refreshes: () => refreshCount };
}

describe('crypto helpers', () => {
  it('signs state so it cannot be forged, altered or reused after it expires', () => {
    const s = signState('secret', { c: 'co', u: 'user', exp: 2_000 });
    expect(verifyState('secret', s, 1_000)).toMatchObject({ c: 'co', u: 'user' });
    expect(verifyState('secret', s, 3_000)).toBeNull(); // expired
    expect(verifyState('other-secret', s, 1_000)).toBeNull();
    const [body, sig] = s.split('.');
    const forged = Buffer.from(JSON.stringify({ c: 'someone-elses-company', u: 'user', exp: 2_000, n: 'x' })).toString('base64url');
    expect(verifyState('secret', `${forged}.${sig}`, 1_000)).toBeNull();
    expect(verifyState('secret', `${body}.`, 1_000)).toBeNull();
    expect(verifyState('secret', 'garbage', 1_000)).toBeNull();
  });

  it('encrypts tokens so they round-trip but are unreadable and tamper-evident', () => {
    const packed = encrypt('secret', 'refresh-token-value');
    expect(packed).not.toContain('refresh-token-value');
    expect(decrypt('secret', packed)).toBe('refresh-token-value');
    expect(() => decrypt('wrong', packed)).toThrow();
    const [iv, tag] = packed.split('.');
    expect(() => decrypt('secret', `${iv}.${tag}.${Buffer.from('xx').toString('base64url')}`)).toThrow();
    expect(encrypt('secret', 'same')).not.toBe(encrypt('secret', 'same')); // fresh random IV each time
  });
});

describe('QuickBooks report', () => {
  it('flattens cost accounts, skips income and totals, and keeps the section', () => {
    const lines = reportToLines(REPORT);
    expect(lines.map((l) => [l.account, l.amount_cents, l.section])).toEqual([
      ['Job Materials', 950000, 'cogs'],
      ['Insurance', 240000, 'expense'],
      ['Wages', 1800000, 'expense'],
      ['Payroll Taxes', 198000, 'expense'],
      ['Interest Expense', 31000, 'other_expense'],
    ]);
    expect(reportToLines({})).toEqual([]);
  });

  it('works out the first and last day of a month', () => {
    expect(monthRange('2026-10')).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(monthRange('2028-02')).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });
});

describe('connecting QuickBooks', () => {
  it('lets only an owner or admin start, and sends them to Intuit with a signed state', async () => {
    const { deps } = setup();
    await expect(startConnect(deps, null)).rejects.toMatchObject({ status: 401 });
    await expect(startConnect(deps, 'bad-token')).rejects.toMatchObject({ status: 401 });
    const office = setup({ role: 'office' });
    await expect(startConnect(office.deps, 'good-token')).rejects.toMatchObject({ status: 403 });

    const { url } = await startConnect(deps, 'good-token');
    const u = new URL(url);
    expect(u.origin + u.pathname).toBe('https://appcenter.intuit.com/connect/oauth2');
    expect(u.searchParams.get('client_id')).toBe('client-id');
    expect(u.searchParams.get('scope')).toBe('com.intuit.quickbooks.accounting');
    expect(u.searchParams.get('redirect_uri')).toBe(env.INTUIT_REDIRECT_URI);
    expect(verifyState(env.INTEGRATIONS_SECRET!, u.searchParams.get('state')!, deps.now())).toMatchObject({ c: 'co-1', u: 'user-1' });
  });

  it('tells the owner plainly when the server is not set up yet', async () => {
    const { deps } = setup();
    await expect(startConnect({ ...deps, env: { ...env, INTUIT_CLIENT_SECRET: undefined } }, 'good-token')).rejects.toMatchObject({ status: 503, message: expect.stringContaining('INTUIT_CLIENT_SECRET') });
  });

  it('saves the connection with encrypted tokens, and ignores a forged, expired or cancelled return', async () => {
    const { deps, db } = setup();
    const { url } = await startConnect(deps, 'good-token');
    const state = new URL(url).searchParams.get('state')!;

    expect(await finishConnect(deps, { code: 'c', state: 'forged.state', realmId: '123' })).toEqual({ redirect: 'https://app.example.com/job-costing/rate?qb=error' });
    expect(db.link).toBeNull();
    expect(await finishConnect(deps, { error: 'access_denied' })).toEqual({ redirect: 'https://app.example.com/job-costing/rate?qb=cancelled' });

    expect(await finishConnect(deps, { code: 'the-code', state, realmId: '9130' })).toEqual({ redirect: 'https://app.example.com/job-costing/rate?qb=connected' });
    expect(db.link).toEqual({ companyId: 'co-1', realmId: '9130', label: 'Example Handyman LLC', userId: 'user-1' });
    expect(db.secret!.enc).not.toContain('access-1');
    expect(JSON.parse(decrypt(env.INTEGRATIONS_SECRET!, db.secret!.enc))).toMatchObject({ access_token: 'access-1', refresh_token: 'refresh-1' });

    const expired = setup();
    const old = signState(env.INTEGRATIONS_SECRET!, { c: 'co-1', u: 'user-1', exp: expired.deps.now() - 1 });
    expect((await finishConnect(expired.deps, { code: 'c', state: old, realmId: '1' })).redirect).toContain('qb=error');
  });

  it('pulls a month of costs, using the stored token and the right dates', async () => {
    const { deps, calls, db } = setup();
    await finishConnect(deps, { code: 'c', state: new URL((await startConnect(deps, 'good-token')).url).searchParams.get('state')!, realmId: '9130' });
    const r = await syncMonth(deps, 'good-token', '2026-10');
    expect(r.lines.map((l) => l.account)).toContain('Wages');
    const report = calls.find((c) => c.url.includes('/reports/ProfitAndLoss'))!;
    expect(report.url).toContain('sandbox-quickbooks.api.intuit.com/v3/company/9130/');
    expect(report.url).toContain('start_date=2026-10-01&end_date=2026-10-31&accounting_method=Accrual');
    expect((report.init!.headers as Record<string, string>).Authorization).toBe('Bearer access-1');
    expect(db.synced.at(-1)).toBeNull();
    await expect(syncMonth(deps, 'good-token', 'October')).rejects.toMatchObject({ status: 400 });
    await expect(syncMonth(deps, null, '2026-10')).rejects.toMatchObject({ status: 401 });
  });

  it('refreshes an expired access token once, saves the new refresh token, and retries', async () => {
    const { deps, db, refreshes } = setup({ reportStatuses: [401, 200] });
    await finishConnect(deps, { code: 'c', state: new URL((await startConnect(deps, 'good-token')).url).searchParams.get('state')!, realmId: '9130' });
    const r = await syncMonth(deps, 'good-token', '2026-10');
    expect(r.lines.length).toBeGreaterThan(0);
    expect(refreshes()).toBe(1);
    expect(JSON.parse(decrypt(env.INTEGRATIONS_SECRET!, db.secret!.enc))).toMatchObject({ access_token: 'access-2', refresh_token: 'refresh-2' }); // rotated and kept
  });

  it('reports a clear problem when QuickBooks refuses, or the connection has expired or never existed', async () => {
    const failing = setup({ reportStatuses: [500] });
    await finishConnect(failing.deps, { code: 'c', state: new URL((await startConnect(failing.deps, 'good-token')).url).searchParams.get('state')!, realmId: '1' });
    await expect(syncMonth(failing.deps, 'good-token', '2026-10')).rejects.toMatchObject({ status: 502 });
    expect(failing.db.synced.at(-1)).toContain('500');

    const stale = setup();
    await finishConnect(stale.deps, { code: 'c', state: new URL((await startConnect(stale.deps, 'good-token')).url).searchParams.get('state')!, realmId: '1' });
    stale.advance(101 * 86400 * 1000); // past the ~100 day refresh token life
    await expect(syncMonth(stale.deps, 'good-token', '2026-10')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('Connect again') });

    await expect(syncMonth(setup().deps, 'good-token', '2026-10')).rejects.toMatchObject({ status: 409, message: expect.stringContaining('not connected') });
  });

  it('disconnects: revokes the token and deletes the stored connection; only for owners/admins', async () => {
    const { deps, db, calls } = setup();
    await finishConnect(deps, { code: 'c', state: new URL((await startConnect(deps, 'good-token')).url).searchParams.get('state')!, realmId: '1' });
    await expect(disconnect(setup({ role: 'tech' }).deps, 'good-token')).rejects.toMatchObject({ status: 403 });
    expect(await disconnect(deps, 'good-token')).toEqual({ ok: true });
    expect(db.deleted).toBe(true);
    expect(db.secret).toBeNull();
    expect(calls.some((c) => c.url.includes('/tokens/revoke'))).toBe(true);
  });
});
