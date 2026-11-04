import { decrypt, encrypt, signState, verifyState } from './crypto.js';
import { monthRange, reportedTotals, reportToIncome, reportToLines, type IncomeReportLine, type Reported, type ReportLine } from './report.js';

/**
 * The QuickBooks connection logic, written against small interfaces (Store, fetch, env) so it can be tested without
 * the network or a database. The files in api/qb/ only wire these to the real things.
 */
export interface Env {
  INTUIT_CLIENT_ID?: string;
  INTUIT_CLIENT_SECRET?: string;
  /** Where Intuit sends people back: https://YOUR-SITE/api/qb/callback */
  INTUIT_REDIRECT_URI?: string;
  /** "sandbox" or "production" */
  INTUIT_ENV?: string;
  INTEGRATIONS_SECRET?: string;
  /** The site's address, e.g. https://handyos-eight.vercel.app */
  APP_URL?: string;
  /** "1" stops every push of invoices and payments into QuickBooks (a master off switch). */
  QB_PUSH_DISABLED?: string;
  /** Handy: the company's OpenAI key (server only) and the model to use. */
  OPENAI_API_KEY?: string;
  HANDY_MODEL?: string;
}

export interface Store {
  userFromToken(token: string): Promise<{ id: string } | null>;
  membership(userId: string): Promise<{ companyId: string; role: string } | null>;
  saveConnection(c: { companyId: string; userId: string; realmId: string; label: string | null; secretEncrypted: string; accessExpiresAt: string }): Promise<void>;
  getSecret(companyId: string): Promise<{ secretEncrypted: string; realmId: string } | null>;
  updateSecret(companyId: string, secretEncrypted: string, accessExpiresAt: string): Promise<void>;
  deleteConnection(companyId: string): Promise<void>;
  markSync(companyId: string, error: string | null): Promise<void>;
  /** The company's sync settings (what to send, where it posts, whether sending is on). */
  getPushSettings(companyId: string): Promise<PushSettings | null>;
  /** What has already been sent to QuickBooks for one local invoice or payment. */
  getSyncRecord(companyId: string, entity: 'invoice' | 'payment', localId: string): Promise<SyncRecord | null>;
  saveSyncRecord(companyId: string, record: SyncRecord): Promise<void>;
}

export interface PushSettings {
  enabled: boolean;
  income_account_id: string | null;
  deposit_account_id: string | null;
  tax_code_id: string | null;
  /** Only invoices and payments dated on or after this day are sent (YYYY-MM-DD), so old history is never pushed. */
  start_date: string;
}

export interface SyncRecord {
  entity: 'invoice' | 'payment';
  local_id: string;
  /** QuickBooks' id once it was sent; null when the last try failed. */
  qb_id: string | null;
  qb_customer_id: string | null;
  error: string | null;
}

export interface Deps {
  env: Env;
  store: Store;
  fetch: typeof fetch;
  now: () => number;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Intuit refused a token request. `code` is Intuit's short reason (like invalid_client), never a secret. */
export class TokenError extends ApiError {
  constructor(public code: string) {
    super(502, 'QuickBooks did not accept the request. Try connecting again.');
  }
}

interface Tokens {
  access_token: string;
  refresh_token: string;
  /** when the refresh token stops working, ms since epoch */
  refresh_expires_at: number;
}

const AUTHORIZE = 'https://appcenter.intuit.com/connect/oauth2';
const TOKEN = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';
const REVOKE = 'https://developer.api.intuit.com/v2/oauth2/tokens/revoke';
const apiBase = (env: Env) => (env.INTUIT_ENV === 'production' ? 'https://quickbooks.api.intuit.com' : 'https://sandbox-quickbooks.api.intuit.com');

function need(env: Env): Required<Pick<Env, 'INTUIT_CLIENT_ID' | 'INTUIT_CLIENT_SECRET' | 'INTUIT_REDIRECT_URI' | 'INTEGRATIONS_SECRET' | 'APP_URL'>> {
  const missing = ['INTUIT_CLIENT_ID', 'INTUIT_CLIENT_SECRET', 'INTUIT_REDIRECT_URI', 'INTEGRATIONS_SECRET', 'APP_URL'].filter((k) => !env[k as keyof Env]);
  if (missing.length) throw new ApiError(503, `QuickBooks is not set up on the server yet (missing ${missing.join(', ')}).`);
  return env as never;
}

/** The signed-in person, who must be an owner or admin. */
async function requireManager(deps: Deps, token: string | null) {
  if (!token) throw new ApiError(401, 'Sign in first.');
  const user = await deps.store.userFromToken(token);
  if (!user) throw new ApiError(401, 'Sign in first.');
  const m = await deps.store.membership(user.id);
  if (!m) throw new ApiError(403, 'You are not part of a company.');
  if (m.role !== 'owner' && m.role !== 'admin') throw new ApiError(403, 'Only the owner and admins can connect QuickBooks.');
  return { userId: user.id, companyId: m.companyId };
}

const basic = (env: ReturnType<typeof need>) => 'Basic ' + Buffer.from(`${env.INTUIT_CLIENT_ID}:${env.INTUIT_CLIENT_SECRET}`).toString('base64');

interface Granted {
  tokens: Tokens;
  /** when the short-lived access token stops working, ISO time */
  accessExpiresAt: string;
}

async function tokenRequest(deps: Deps, env: ReturnType<typeof need>, form: Record<string, string>): Promise<Granted> {
  const res = await deps.fetch(TOKEN, {
    method: 'POST',
    headers: { Authorization: basic(env), 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(form).toString(),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    const code = typeof body.error === 'string' && /^[a-z_]{1,40}$/.test(body.error) ? body.error : `http_${res.status}`;
    console.error('QuickBooks token request refused:', code);
    throw new TokenError(code);
  }
  const j = (await res.json()) as { access_token: string; refresh_token: string; expires_in?: number; x_refresh_token_expires_in?: number };
  return {
    tokens: { access_token: j.access_token, refresh_token: j.refresh_token, refresh_expires_at: deps.now() + (j.x_refresh_token_expires_in ?? 100 * 86400) * 1000 },
    accessExpiresAt: new Date(deps.now() + (j.expires_in ?? 3600) * 1000).toISOString(),
  };
}

const pack = (env: { INTEGRATIONS_SECRET: string }, t: Tokens) =>
  encrypt(env.INTEGRATIONS_SECRET, JSON.stringify({ access_token: t.access_token, refresh_token: t.refresh_token, refresh_expires_at: t.refresh_expires_at }));

/** Step 1: the signed-in owner/admin asks where to go to link QuickBooks. */
export async function startConnect(deps: Deps, token: string | null): Promise<{ url: string }> {
  const env = need(deps.env);
  const { userId, companyId } = await requireManager(deps, token);
  const state = signState(env.INTEGRATIONS_SECRET, { c: companyId, u: userId, exp: deps.now() + 10 * 60_000 });
  const q = new URLSearchParams({
    client_id: env.INTUIT_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: env.INTUIT_REDIRECT_URI,
    state,
  });
  return { url: `${AUTHORIZE}?${q.toString()}` };
}

/** Step 2: Intuit sends the person back with a one-time code. Returns where to send the browser next. */
export async function finishConnect(deps: Deps, query: { code?: string; state?: string; realmId?: string; error?: string }): Promise<{ redirect: string }> {
  const env = need(deps.env);
  // `reason` and `detail` are short, harmless codes the app turns into plain-language help
  const back = (result: string, reason?: string, detail?: string) => ({
    redirect: `${env.APP_URL}/job-costing/rate?qb=${result}${reason ? `&reason=${reason}` : ''}${detail ? `&detail=${encodeURIComponent(detail)}` : ''}`,
  });
  if (query.error) return back('cancelled');
  const state = query.state ? verifyState(env.INTEGRATIONS_SECRET, query.state, deps.now()) : null;
  if (!state) return back('error', 'state');
  if (!query.code || !query.realmId) return back('error', 'missing');
  try {
    const { tokens, accessExpiresAt } = await tokenRequest(deps, env, { grant_type: 'authorization_code', code: query.code, redirect_uri: env.INTUIT_REDIRECT_URI });
    let label: string | null = null;
    try {
      const info = await deps.fetch(`${apiBase(deps.env)}/v3/company/${query.realmId}/companyinfo/${query.realmId}?minorversion=75`, {
        headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' },
      });
      if (info.ok) label = ((await info.json()) as { CompanyInfo?: { CompanyName?: string } }).CompanyInfo?.CompanyName ?? null;
    } catch {
      // the name is only a label
    }
    await deps.store.saveConnection({
      companyId: state.c,
      userId: state.u,
      realmId: query.realmId,
      label,
      secretEncrypted: pack(env, tokens),
      accessExpiresAt,
    });
    return back('connected');
  } catch (err) {
    if (err instanceof TokenError) return back('error', 'token', err.code);
    console.error('QuickBooks connection could not be saved:', err instanceof Error ? err.message : err);
    return back('error', 'save');
  }
}


export interface Session {
  companyId: string;
  realmId: string;
  /** Calls the company's QuickBooks (path starts with "/", after /v3/company/{id}); renews the access token once if it ran out. */
  call(method: 'GET' | 'POST', path: string, body?: unknown): Promise<Response>;
}

/** The signed-in owner/admin's QuickBooks connection, ready to call. Tokens stay on the server. */
export async function openSession(deps: Deps, token: string | null): Promise<Session> {
  const env = need(deps.env);
  const { companyId } = await requireManager(deps, token);
  const stored = await deps.store.getSecret(companyId);
  if (!stored) throw new ApiError(409, 'QuickBooks is not connected.');
  let tokens = JSON.parse(decrypt(env.INTEGRATIONS_SECRET, stored.secretEncrypted)) as Tokens;
  if (tokens.refresh_expires_at <= deps.now()) {
    await deps.store.markSync(companyId, 'The QuickBooks connection expired. Connect again.');
    throw new ApiError(409, 'The QuickBooks connection expired. Connect again.');
  }
  const refresh = async () => {
    // QuickBooks hands back a new refresh token each time; the old one stops working, so it is saved straight away
    const fresh = await tokenRequest(deps, env, { grant_type: 'refresh_token', refresh_token: tokens.refresh_token });
    tokens = fresh.tokens;
    await deps.store.updateSecret(companyId, pack(env, tokens), fresh.accessExpiresAt);
  };
  const base = `${apiBase(deps.env)}/v3/company/${stored.realmId}`;
  const send = (method: 'GET' | 'POST', path: string, body?: unknown) =>
    deps.fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  return {
    companyId,
    realmId: stored.realmId,
    async call(method, path, body) {
      let res = await send(method, path, body);
      if (res.status === 401) {
        await refresh(); // the one-hour access token ran out
        res = await send(method, path, body);
      }
      return res;
    },
  };
}

export interface SyncResult {
  month: string;
  lines: ReportLine[];
  /** The income accounts (sales, services, ...), for revenue comparisons. */
  income: IncomeReportLine[];
  /** QuickBooks' own totals for the report, to check the lines against. */
  reported: Reported;
}

/** Pulls one month's Profit and Loss from the company's QuickBooks. Nothing is saved here; the app shows it for review. */
export async function syncMonth(deps: Deps, token: string | null, month: string, method: 'Accrual' | 'Cash' = 'Cash'): Promise<SyncResult> {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError(400, 'Choose a month like 2026-10.');
  const session = await openSession(deps, token);
  const { start, end } = monthRange(month);
  const res = await session.call('GET', `/reports/ProfitAndLoss?start_date=${start}&end_date=${end}&accounting_method=${method}&minorversion=75`);
  if (!res.ok) {
    await deps.store.markSync(session.companyId, `QuickBooks answered ${res.status}`);
    throw new ApiError(502, 'QuickBooks did not return the report. Try again, or connect again.');
  }
  const json = await res.json();
  await deps.store.markSync(session.companyId, null);
  return { month, lines: reportToLines(json), income: reportToIncome(json), reported: reportedTotals(json) };
}

export async function disconnect(deps: Deps, token: string | null): Promise<{ ok: true }> {
  const env = need(deps.env);
  const { companyId } = await requireManager(deps, token);
  const stored = await deps.store.getSecret(companyId);
  if (stored) {
    try {
      const t = JSON.parse(decrypt(env.INTEGRATIONS_SECRET, stored.secretEncrypted)) as Tokens;
      await deps.fetch(REVOKE, { method: 'POST', headers: { Authorization: basic(env), 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ token: t.refresh_token }) });
    } catch {
      // revoking is a courtesy; the connection is removed either way
    }
  }
  await deps.store.deleteConnection(companyId);
  return { ok: true };
}
