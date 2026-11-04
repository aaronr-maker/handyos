import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { listInvoices } from '@/modules/invoicing';
import { quickbooksLink } from '@/modules/jobcosting';
import { listPayments } from '@/modules/payments';
import { saveSyncSettingsAction } from '../actions';
import { buildQueue, type QueueItem } from '../queue';
import { getSettings, listRecords, loadSetup, NO_SETTINGS, sendInvoice, sendPayment, type SetupLists } from '../service';

const STATE_TEXT: Record<QueueItem['state'], string> = {
  sent: 'Sent',
  failed: 'Failed',
  waiting: 'Ready to send',
  needs_invoice: 'Waiting for its invoice',
  refund: 'Refund: enter it in QuickBooks by hand',
};

/** Choose where things post in QuickBooks, then send HandyOS invoices and payments there. Nothing is sent until sending is turned on. */
export default function QuickbooksSyncScreen() {
  const { companyId, role } = useSession();
  const saveAction = useAction(saveSyncSettingsAction);
  const [form, setForm] = useState<typeof NO_SETTINGS | null>(null);
  const [lists, setLists] = useState<SetupLists | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Record<string, string>>({});

  const { data, loading, error, reload } = useAsync(async () => {
    const [link, settings, invoices, payments, customers, records] = await Promise.all([quickbooksLink(companyId), getSettings(companyId), listInvoices(companyId), listPayments(companyId), listCustomers(companyId), listRecords(companyId)]);
    return { link, settings, invoices, payments, customers, records };
  }, [companyId]);

  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can use the QuickBooks sync.</p>;

  const saved = data?.settings ?? NO_SETTINGS;
  const current = form ?? { ...NO_SETTINGS, ...(data?.settings ?? {}) };
  const set = (patch: Partial<typeof NO_SETTINGS>) => setForm({ ...current, ...patch });
  const connected = data?.link?.status === 'connected';

  const queue = data
    ? buildQueue(
        data.invoices.map((i) => {
          const c = data.customers.find((x) => x.id === i.customer_id);
          return { ...i, customer: { name: c ? customerLabel(c) : 'Customer', email: c?.email ?? null } };
        }),
        data.payments,
        data.records,
        saved.start_date,
      )
    : [];
  const waiting = queue.filter((q) => q.state === 'waiting' || q.state === 'failed');

  const getLists = async () => {
    setNote(null);
    try {
      setLists(await loadSetup());
    } catch (err) {
      setNote({ ok: false, text: err instanceof Error ? err.message : 'Could not reach QuickBooks.' });
    }
  };

  const save = async () => {
    setNote(null);
    const err = resultError(await saveAction(current));
    if (err) return setNote({ ok: false, text: err });
    setNote({ ok: true, text: current.enabled ? 'Saved. Sending is ON: invoices and payments can now be sent.' : 'Saved. Sending is off.' });
    setForm(null);
    reload();
  };

  const sendAll = async () => {
    setBusy(true);
    setNote(null);
    const out: Record<string, string> = {};
    let ok = 0;
    // invoices go first so their payments can follow in the same run
    for (const item of queue.filter((q) => q.state === 'waiting' || q.state === 'failed')) {
      try {
        if (item.kind === 'invoice') await sendInvoice(item.payload);
        else await sendPayment(item.payload);
        out[`${item.kind}:${item.id}`] = 'Sent';
        ok++;
      } catch (err) {
        out[`${item.kind}:${item.id}`] = err instanceof Error ? err.message : 'Could not send.';
      }
    }
    setResults(out);
    setBusy(false);
    setNote({ ok: ok > 0 || Object.keys(out).length === 0, text: `Sent ${ok} of ${Object.keys(out).length}.` });
    reload();
  };

  const labelOf = (list: { id: string; name: string }[] | undefined, id: string | null, fallback: string | null) => list?.find((x) => x.id === id)?.name ?? fallback ?? '';
  const pick = (kind: 'income' | 'deposit' | 'tax', id: string) => {
    const l = kind === 'income' ? lists?.income : kind === 'deposit' ? lists?.deposit : lists?.taxCodes;
    const name = l?.find((x) => x.id === id)?.name ?? null;
    if (kind === 'income') set({ income_account_id: id || null, income_account_name: id ? name : null });
    else if (kind === 'deposit') set({ deposit_account_id: id || null, deposit_account_name: id ? name : null });
    else set({ tax_code_id: id || null, tax_code_name: id ? name : null });
  };

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>QuickBooks sync</h1>
          <p className="muted">Sends the invoices and payments made in HandyOS into QuickBooks, so your books stay current. Nothing is sent until you turn sending on below.</p>
        </div>
      </header>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && !connected && (
        <div className="card">
          <p>
            QuickBooks is not connected yet. Connect it on <Link to="/job-costing/rate">Company hourly rate</Link>, then come back here.
          </p>
        </div>
      )}
      {data && connected && (
        <>
          <div className="card">
            <h2>1. Where things post in QuickBooks</h2>
            <p className="muted">
              Connected to <strong>{data.link?.label ?? 'your QuickBooks'}</strong>. Load your accounts, then choose where invoices and payments go. Your accountant can tell you which.
            </p>
            <button type="button" className="secondary" onClick={() => void getLists()}>
              {lists ? 'Reload my QuickBooks accounts' : 'Load my QuickBooks accounts'}
            </button>
            <label>
              Income account (sales post here)
              <select value={current.income_account_id ?? ''} onChange={(e) => pick('income', e.target.value)}>
                <option value="">Choose…</option>
                {current.income_account_id && !lists?.income.some((a) => a.id === current.income_account_id) && <option value={current.income_account_id}>{current.income_account_name ?? current.income_account_id}</option>}
                {lists?.income.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Deposit account for payments (optional: without one QuickBooks uses Undeposited Funds)
              <select value={current.deposit_account_id ?? ''} onChange={(e) => pick('deposit', e.target.value)}>
                <option value="">Undeposited Funds (default)</option>
                {current.deposit_account_id && !lists?.deposit.some((a) => a.id === current.deposit_account_id) && <option value={current.deposit_account_id}>{current.deposit_account_name ?? current.deposit_account_id}</option>}
                {lists?.deposit.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sales tax code (needed only if you charge sales tax)
              <select value={current.tax_code_id ?? ''} onChange={(e) => pick('tax', e.target.value)}>
                <option value="">No sales tax</option>
                {current.tax_code_id && !lists?.taxCodes.some((a) => a.id === current.tax_code_id) && <option value={current.tax_code_id}>{current.tax_code_name ?? current.tax_code_id}</option>}
                {lists?.taxCodes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Start sending from
              <input type="date" value={current.start_date} onChange={(e) => set({ start_date: e.target.value })} />
              <span className="muted small-note">Invoices and payments dated before this day are never sent, so your old history is left alone. Your launch day is January 1, 2027.</span>
            </label>
            <label className="row" style={{ alignItems: 'center', gap: 8 }}>
              <input type="checkbox" checked={current.enabled} onChange={(e) => set({ enabled: e.target.checked })} />
              <span>
                <strong>Sending is on</strong> <span className="muted small-note">(untick to pause everything)</span>
              </span>
            </label>
            <button type="button" onClick={() => void save()} disabled={current.enabled && !current.income_account_id}>
              Save
            </button>
            {current.enabled && !current.income_account_id && <p className="muted small-note">Choose the income account before turning sending on.</p>}
            <p className="muted small-note">
              Currently: {labelOf(lists?.income, saved.income_account_id, saved.income_account_name) || 'no income account'} · sending {saved.enabled ? 'ON' : 'off'} · from {saved.start_date}
            </p>
          </div>

          <div className="card">
            <h2>2. What will be sent</h2>
            {queue.length === 0 ? (
              <p className="muted">Nothing yet. Invoices that are sent out (not drafts) and dated on or after {saved.start_date}, and their payments, show up here.</p>
            ) : (
              <>
                <p className="muted">
                  {waiting.length} ready to send. Each invoice is sent once; a failed one can be tried again. QuickBooks gets the customer, the lines, the sales tax and, for payments, the amount linked to its invoice.
                </p>
                <button type="button" onClick={() => void sendAll()} disabled={busy || !saved.enabled || waiting.length === 0}>
                  {busy ? 'Sending…' : `Send ${waiting.length} to QuickBooks`}
                </button>
                {!saved.enabled && <p className="muted small-note">Sending is off. Turn it on and save above first.</p>}
                <div className="list">
                  {queue.map((q) => (
                    <div key={`${q.kind}:${q.id}`} className="stack">
                      <strong>
                        {q.label} · {formatMoney(q.cents)}
                      </strong>
                      <span className="muted">
                        {q.date} · {STATE_TEXT[q.state]}
                      </span>
                      {(results[`${q.kind}:${q.id}`] ?? q.error) && q.state !== 'sent' && <span className="err">{results[`${q.kind}:${q.id}`] ?? q.error}</span>}
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </>
      )}
      {note && <p className={note.ok ? 'notice' : 'err'}>{note.text}</p>}
    </section>
  );
}
