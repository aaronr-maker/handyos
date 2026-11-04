import { describe, expect, it } from 'vitest';
import { encrypt } from '../api/_lib/crypto';
import type { Deps, Env, PushSettings, Store, SyncRecord } from '../api/_lib/qb';
import { pushInvoice, pushPayment, type InvoicePayload } from '../api/_lib/qbPush';
import { buildQueue } from '../src/modules/qbsync';

const env: Env = { INTUIT_CLIENT_ID: 'id', INTUIT_CLIENT_SECRET: 'secret', INTUIT_REDIRECT_URI: 'https://app.example.com/api/qb/callback', INTUIT_ENV: 'sandbox', INTEGRATIONS_SECRET: 'a-long-random-secret-for-tests', APP_URL: 'https://app.example.com' };
type Body = { IncomeAccountRef?: unknown; Line: { Amount: number; SalesItemLineDetail: { TaxCodeRef: { value: string } }; LinkedTxn?: unknown }[] } & Record<string, unknown>;
const NOW = Date.parse('2027-01-10T12:00:00Z');
const ON: PushSettings = { enabled: true, income_account_id: '79', deposit_account_id: '35', tax_code_id: '5', start_date: '2027-01-01' };

function world(settings: PushSettings | null = ON, over: { envOver?: Partial<Env>; existingCustomer?: boolean; failInvoice?: boolean } = {}) {
  const records = new Map<string, SyncRecord>();
  const posts: { path: string; body: Body }[] = [];
  const store: Store = {
    userFromToken: async (t) => (t === 'tok' ? { id: 'u1' } : null),
    membership: async () => ({ companyId: 'co1', role: 'owner' }),
    saveConnection: async () => undefined,
    getSecret: async () => ({ secretEncrypted: encrypt(env.INTEGRATIONS_SECRET!, JSON.stringify({ access_token: 'a', refresh_token: 'r', refresh_expires_at: NOW + 1e9 })), realmId: 'realm9' }),
    updateSecret: async () => undefined,
    deleteConnection: async () => undefined,
    markSync: async () => undefined,
    getPushSettings: async () => settings,
    getSyncRecord: async (_c, entity, id) => records.get(`${entity}:${id}`) ?? null,
    saveSyncRecord: async (_c, r) => void records.set(`${r.entity}:${r.local_id}`, r),
  };
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'Content-Type': 'application/json' } });
  const fakeFetch = (async (url: string, init?: RequestInit) => {
    const u = new URL(url);
    if (init?.method === 'POST') {
      const body = JSON.parse(String(init.body));
      posts.push({ path: u.pathname.split('/').pop()!, body });
      if (u.pathname.endsWith('/customer')) return json({ Customer: { Id: 'C1' } });
      if (u.pathname.endsWith('/item')) return json({ Item: { Id: 'I1' } });
      if (u.pathname.endsWith('/invoice')) return over.failInvoice ? json({ Fault: { Error: [{ Message: 'Duplicate Document Number Error', Detail: 'DocNumber=1001' }] } }, 400) : json({ Invoice: { Id: 'INV1' } });
      if (u.pathname.endsWith('/payment')) return json({ Payment: { Id: 'PAY1' } });
    }
    const q = u.searchParams.get('query') ?? '';
    if (q.includes('from Customer')) return json({ QueryResponse: over.existingCustomer ? { Customer: [{ Id: 'C0' }] } : {} });
    return json({ QueryResponse: {} });
  }) as unknown as typeof fetch;
  const deps: Deps = { env: { ...env, ...over.envOver }, store, fetch: fakeFetch, now: () => NOW };
  return { deps, records, posts };
}

const invoice: InvoicePayload = {
  local_id: 'inv-1',
  number: 1001,
  title: 'Fence repair',
  date: '2027-01-05',
  due_date: '2027-01-19',
  customer: { name: "O'Brien Rentals", email: 'a@b.com' },
  lines: [
    { description: 'Fence boards', quantity: 2, unit_cents: 5_000, taxable: true },
    { description: 'Labor', quantity: 1, unit_cents: 20_000, taxable: false },
  ],
  tax_cents: 825,
  notes: null,
};

describe('sending to QuickBooks', () => {
  it('creates the customer, the services item and the invoice with sales tax only on taxable lines, and remembers it', async () => {
    const w = world();
    const r = await pushInvoice(w.deps, 'tok', invoice);
    expect(r).toEqual({ qb_invoice_id: 'INV1', already: false });
    expect(w.posts.map((p) => p.path)).toEqual(['customer', 'item', 'invoice']);
    const inv = w.posts[2].body;
    expect(inv).toMatchObject({ DocNumber: '1001', TxnDate: '2027-01-05', CustomerRef: { value: 'C1' }, TxnTaxDetail: { TxnTaxCodeRef: { value: '5' }, TotalTax: 8.25 } });
    expect(inv.Line.map((l) => [l.Amount, l.SalesItemLineDetail.TaxCodeRef.value])).toEqual([[100, 'TAX'], [200, 'NON']]);
    expect(w.posts[1].body.IncomeAccountRef).toEqual({ value: '79' });
    expect(w.records.get('invoice:inv-1')).toMatchObject({ qb_id: 'INV1', qb_customer_id: 'C1', error: null });
  });

  it('never sends the same invoice twice', async () => {
    const w = world();
    await pushInvoice(w.deps, 'tok', invoice);
    const again = await pushInvoice(w.deps, 'tok', invoice);
    expect(again).toEqual({ qb_invoice_id: 'INV1', already: true });
    expect(w.posts.filter((p) => p.path === 'invoice')).toHaveLength(1);
  });

  it('uses an existing QuickBooks customer instead of adding a new one', async () => {
    const w = world(ON, { existingCustomer: true });
    await pushInvoice(w.deps, 'tok', invoice);
    expect(w.posts.map((p) => p.path)).toEqual(['item', 'invoice']);
    expect((w.posts[1].body.CustomerRef as { value: string }).value).toBe('C0');
  });

  it('links a payment to its invoice, and asks for the invoice first', async () => {
    const w = world();
    const pay = { local_id: 'pay-1', invoice_local_id: 'inv-1', date: '2027-01-08', amount_cents: 20_825, method: 'check', reference: '1234' };
    await expect(pushPayment(w.deps, 'tok', pay)).rejects.toThrow(/invoice to QuickBooks first/);
    await pushInvoice(w.deps, 'tok', invoice);
    expect(await pushPayment(w.deps, 'tok', pay)).toEqual({ qb_payment_id: 'PAY1', already: false });
    const body = w.posts.find((p) => p.path === 'payment')!.body;
    expect(body).toMatchObject({ CustomerRef: { value: 'C1' }, TotalAmt: 208.25, DepositToAccountRef: { value: '35' }, PaymentRefNum: '1234' });
    expect(body.Line[0].LinkedTxn).toEqual([{ TxnId: 'INV1', TxnType: 'Invoice' }]);
    await expect(pushPayment(w.deps, 'tok', { ...pay, local_id: 'pay-2', amount_cents: -500 })).rejects.toThrow(/Refunds/);
  });

  it('is stopped by the off switches and the start date, and sends nothing', async () => {
    for (const w of [world({ ...ON, enabled: false }), world(null), world(ON, { envOver: { QB_PUSH_DISABLED: '1' } })]) {
      await expect(pushInvoice(w.deps, 'tok', invoice)).rejects.toThrow(/switched off/);
      expect(w.posts).toHaveLength(0);
    }
    const early = world();
    await expect(pushInvoice(early.deps, 'tok', { ...invoice, date: '2026-12-31' })).rejects.toThrow(/before 2027-01-01/);
    expect(early.posts).toHaveLength(0);
  });

  it('needs a sales tax code when there is tax, and keeps QuickBooks\' own message when it refuses', async () => {
    const noTax = world({ ...ON, tax_code_id: null });
    await expect(pushInvoice(noTax.deps, 'tok', invoice)).rejects.toThrow(/sales tax code/);
    const failing = world(ON, { failInvoice: true });
    await expect(pushInvoice(failing.deps, 'tok', invoice)).rejects.toThrow(/Duplicate Document Number/);
    expect(failing.records.get('invoice:inv-1')).toMatchObject({ qb_id: null });
    expect(failing.records.get('invoice:inv-1')!.error).toMatch(/Duplicate Document Number/);
  });

  it('only sends people who are signed in', async () => {
    await expect(pushInvoice(world().deps, null, invoice)).rejects.toThrow(/Sign in/);
  });
});

describe('what is waiting to be sent', () => {
  const customer = { name: 'Pat', email: null };
  const inv = (id: string, n: number, issued: string, status = 'sent') => ({ id, invoice_number: n, title: 't', status, issued_on: issued, due_date: issued, total_cents: 10_000, tax_cents: 0, notes: null, customer, line_items: [{ description: 'x', quantity: 1, unit_price_cents: 10_000, taxable: false }] });
  it('skips drafts, voids and anything before the start day; holds payments until their invoice is sent; leaves refunds alone', () => {
    const q = buildQueue(
      [inv('a', 1, '2027-01-03'), inv('b', 2, '2026-12-30'), inv('c', 3, '2027-01-04', 'draft'), inv('d', 4, '2027-01-05', 'void'), inv('e', 5, '2027-01-06')],
      [
        { id: 'p1', invoice_id: 'a', amount_cents: 10_000, method: 'cash', received_on: '2027-01-04', provider_ref: null },
        { id: 'p2', invoice_id: 'b', amount_cents: 500, method: 'cash', received_on: '2027-01-04', provider_ref: null },
        { id: 'p3', invoice_id: 'e', amount_cents: -100, method: 'cash', received_on: '2027-01-07', provider_ref: null },
      ],
      [{ entity: 'invoice', local_id: 'e', qb_id: 'Q5', error: null }],
      '2027-01-01',
    );
    expect(q.map((x) => [x.kind, x.id, x.state])).toEqual([
      ['invoice', 'a', 'waiting'],
      ['invoice', 'e', 'sent'],
      ['payment', 'p1', 'needs_invoice'], // invoice a has not been sent yet
      ['payment', 'p3', 'refund'],
    ]);
  });
});
