import { ApiError, openSession, type Deps, type PushSettings, type Session } from './qb.js';

/**
 * Sending HandyOS invoices and payments into the company's QuickBooks. Kept apart from the connection and the report
 * pull so it can be switched off or changed on its own: set QB_PUSH_DISABLED=1 on the server to stop every push, or
 * turn "enabled" off in the company's sync settings.
 */
export interface SetupLists {
  income: { id: string; name: string }[];
  deposit: { id: string; name: string }[];
  taxCodes: { id: string; name: string }[];
}

export interface InvoicePayload {
  local_id: string;
  number: number;
  title: string;
  date: string;
  due_date: string;
  customer: { name: string; email: string | null };
  lines: { description: string; quantity: number; unit_cents: number; taxable: boolean }[];
  tax_cents: number;
  notes: string | null;
}

export interface PaymentPayload {
  local_id: string;
  date: string;
  amount_cents: number;
  method: string;
  /** The local invoice this payment is on (it must have been sent first). */
  invoice_local_id: string;
  reference: string | null;
}

const money = (cents: number) => Math.round(cents) / 100;
const esc = (v: string) => v.replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function guard(deps: Deps, companyId: string, date: string): Promise<PushSettings & { income_account_id: string }> {
  if (deps.env.QB_PUSH_DISABLED === '1' || deps.env.QB_PUSH_DISABLED === 'true') throw new ApiError(423, 'Sending to QuickBooks is switched off on the server.');
  const settings = await deps.store.getPushSettings(companyId);
  if (!settings?.enabled) throw new ApiError(423, 'Sending to QuickBooks is switched off in the sync settings.');
  if (!settings.income_account_id) throw new ApiError(400, 'Choose the QuickBooks income account in the sync settings first.');
  if (date < settings.start_date) throw new ApiError(400, `This is dated before ${settings.start_date}, the day sending starts, so it is not sent.`);
  return settings as PushSettings & { income_account_id: string };
}

async function problem(res: Response, what: string): Promise<never> {
  const body = (await res.json().catch(() => ({}))) as { Fault?: { Error?: { Message?: string; Detail?: string; code?: string }[] } };
  const e = body.Fault?.Error?.[0];
  // QuickBooks' own message is plain English ("Duplicate Document Number Error"), and holds no secrets
  throw new ApiError(502, `QuickBooks would not ${what}: ${e?.Message ?? `answered ${res.status}`}${e?.Detail ? ` (${e.Detail})` : ''}`);
}

async function query<T>(session: Session, sql: string): Promise<T[]> {
  const res = await session.call('GET', `/query?query=${encodeURIComponent(sql)}&minorversion=75`);
  if (!res.ok) return problem(res, 'answer a lookup');
  const json = (await res.json()) as { QueryResponse?: Record<string, T[]> };
  return Object.values(json.QueryResponse ?? {}).find(Array.isArray) ?? [];
}

/** The QuickBooks accounts and tax codes the owner picks from when setting up. */
export async function listSetup(deps: Deps, token: string | null): Promise<SetupLists> {
  const session = await openSession(deps, token);
  const pick = (r: { Id: string; Name?: string; FullyQualifiedName?: string }) => ({ id: r.Id, name: r.FullyQualifiedName ?? r.Name ?? r.Id });
  const [income, banks, other, taxCodes] = await Promise.all([
    query<{ Id: string; Name?: string; FullyQualifiedName?: string }>(session, "select Id, Name, FullyQualifiedName from Account where AccountType = 'Income' and Active = true maxresults 200"),
    query<{ Id: string; Name?: string; FullyQualifiedName?: string }>(session, "select Id, Name, FullyQualifiedName from Account where AccountType = 'Bank' and Active = true maxresults 200"),
    query<{ Id: string; Name?: string; FullyQualifiedName?: string }>(session, "select Id, Name, FullyQualifiedName from Account where AccountSubType = 'UndepositedFunds' and Active = true maxresults 20"),
    query<{ Id: string; Name?: string }>(session, 'select Id, Name from TaxCode where Active = true maxresults 200'),
  ]);
  return { income: income.map(pick), deposit: [...other, ...banks].map(pick), taxCodes: taxCodes.filter((t) => t.Name !== 'NON' && t.Name !== 'TAX').map((t) => ({ id: t.Id, name: t.Name ?? t.Id })) };
}

/** Finds the customer by name or creates it. A name already used by a vendor or employee gets the invoice number added. */
async function customerId(session: Session, c: InvoicePayload['customer'], number: number): Promise<string> {
  const found = await query<{ Id: string }>(session, `select Id from Customer where DisplayName = '${esc(c.name)}'`);
  if (found[0]) return found[0].Id;
  const create = (displayName: string) =>
    session.call('POST', '/customer?minorversion=75', { DisplayName: displayName, ...(c.email ? { PrimaryEmailAddr: { Address: c.email } } : {}) });
  let res = await create(c.name);
  if (!res.ok && res.status === 400) res = await create(`${c.name} (HandyOS ${number})`); // the name was taken by a vendor or employee
  if (!res.ok) return problem(res, 'add the customer');
  return ((await res.json()) as { Customer: { Id: string } }).Customer.Id;
}

/** One service item ("HandyOS services") that every invoice line uses, posting to the income account the owner chose. */
async function itemId(session: Session, incomeAccountId: string): Promise<string> {
  const name = 'HandyOS services';
  const found = await query<{ Id: string }>(session, `select Id from Item where Name = '${name}'`);
  if (found[0]) return found[0].Id;
  const res = await session.call('POST', '/item?minorversion=75', { Name: name, Type: 'Service', IncomeAccountRef: { value: incomeAccountId } });
  if (!res.ok) return problem(res, 'add the services item');
  return ((await res.json()) as { Item: { Id: string } }).Item.Id;
}

/** Creates the invoice in QuickBooks, once: sending it again returns what was sent before. */
export async function pushInvoice(deps: Deps, token: string | null, inv: InvoicePayload): Promise<{ qb_invoice_id: string; already: boolean }> {
  const session = await openSession(deps, token);
  const settings = await guard(deps, session.companyId, inv.date);
  const done = await deps.store.getSyncRecord(session.companyId, 'invoice', inv.local_id);
  if (done?.qb_id) return { qb_invoice_id: done.qb_id, already: true };
  const fail = async (err: unknown): Promise<never> => {
    const message = err instanceof ApiError ? err.message : 'Something went wrong sending this invoice.';
    await deps.store.saveSyncRecord(session.companyId, { entity: 'invoice', local_id: inv.local_id, qb_id: null, qb_customer_id: null, error: message });
    throw err;
  };
  try {
    if (inv.tax_cents > 0 && !settings.tax_code_id) throw new ApiError(400, 'This invoice has sales tax. Choose the QuickBooks sales tax code in the sync settings first.');
    if (inv.lines.length === 0) throw new ApiError(400, 'This invoice has no lines.');
    const customer = await customerId(session, inv.customer, inv.number);
    const item = await itemId(session, settings.income_account_id);
    const taxed = inv.tax_cents > 0;
    const body = {
      DocNumber: String(inv.number),
      TxnDate: inv.date,
      DueDate: inv.due_date,
      CustomerRef: { value: customer },
      PrivateNote: `From HandyOS: ${inv.title}`.slice(0, 4000),
      ...(inv.notes ? { CustomerMemo: { value: inv.notes.slice(0, 1000) } } : {}),
      Line: inv.lines.map((l) => ({
        DetailType: 'SalesItemLineDetail',
        Amount: money(l.quantity * l.unit_cents),
        Description: l.description.slice(0, 4000),
        SalesItemLineDetail: { ItemRef: { value: item }, Qty: l.quantity, UnitPrice: money(l.unit_cents), TaxCodeRef: { value: taxed && l.taxable ? 'TAX' : 'NON' } },
      })),
      ...(taxed ? { TxnTaxDetail: { TxnTaxCodeRef: { value: settings.tax_code_id }, TotalTax: money(inv.tax_cents) } } : {}),
    };
    const res = await session.call('POST', '/invoice?minorversion=75', body);
    if (!res.ok) return await problem(res, 'create the invoice');
    const made = (await res.json()) as { Invoice: { Id: string } };
    await deps.store.saveSyncRecord(session.companyId, { entity: 'invoice', local_id: inv.local_id, qb_id: made.Invoice.Id, qb_customer_id: customer, error: null });
    return { qb_invoice_id: made.Invoice.Id, already: false };
  } catch (err) {
    return fail(err);
  }
}

/** Records the payment against the invoice that was sent earlier, once. */
export async function pushPayment(deps: Deps, token: string | null, p: PaymentPayload): Promise<{ qb_payment_id: string; already: boolean }> {
  const session = await openSession(deps, token);
  const settings = await guard(deps, session.companyId, p.date);
  const done = await deps.store.getSyncRecord(session.companyId, 'payment', p.local_id);
  if (done?.qb_id) return { qb_payment_id: done.qb_id, already: true };
  if (p.amount_cents <= 0) throw new ApiError(400, 'Refunds are not sent automatically. Enter the refund in QuickBooks.');
  const invoice = await deps.store.getSyncRecord(session.companyId, 'invoice', p.invoice_local_id);
  if (!invoice?.qb_id || !invoice.qb_customer_id) throw new ApiError(409, 'Send the invoice to QuickBooks first, then its payments.');
  try {
    const body = {
      CustomerRef: { value: invoice.qb_customer_id },
      TotalAmt: money(p.amount_cents),
      TxnDate: p.date,
      ...(p.reference ? { PaymentRefNum: p.reference.slice(0, 21) } : {}),
      PrivateNote: `From HandyOS (${p.method})`,
      ...(settings.deposit_account_id ? { DepositToAccountRef: { value: settings.deposit_account_id } } : {}),
      Line: [{ Amount: money(p.amount_cents), LinkedTxn: [{ TxnId: invoice.qb_id, TxnType: 'Invoice' }] }],
    };
    const res = await session.call('POST', '/payment?minorversion=75', body);
    if (!res.ok) return await problem(res, 'record the payment');
    const id = ((await res.json()) as { Payment: { Id: string } }).Payment.Id;
    await deps.store.saveSyncRecord(session.companyId, { entity: 'payment', local_id: p.local_id, qb_id: id, qb_customer_id: invoice.qb_customer_id, error: null });
    return { qb_payment_id: id, already: false };
  } catch (err) {
    await deps.store.saveSyncRecord(session.companyId, { entity: 'payment', local_id: p.local_id, qb_id: null, qb_customer_id: invoice.qb_customer_id, error: err instanceof ApiError ? err.message : 'Something went wrong sending this payment.' });
    throw err;
  }
}
