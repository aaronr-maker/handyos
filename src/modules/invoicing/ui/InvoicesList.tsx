import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { checkOverdueAction } from '../actions';
import { balanceOf, listInvoices } from '../services/invoiceService';
import type { InvoiceStatus } from '../types';
import { statusClass } from './status';

const FILTERS: ('open' | 'all' | InvoiceStatus)[] = ['open', 'all', 'draft', 'sent', 'overdue', 'paid', 'void'];

export function InvoicesList() {
  const { companyId, role } = useSession();
  const checkOverdue = useAction(checkOverdueAction);
  const { data, loading, error, reload } = useAsync(async () => ({ invoices: await listInvoices(companyId), customers: await listCustomers(companyId) }), [companyId]);
  const [filter, setFilter] = useState<'open' | 'all' | InvoiceStatus>('open');
  const [notice, setNotice] = useState<string | null>(null);

  const name = (id: string) => {
    const c = data?.customers.find((x) => x.id === id);
    return c ? customerLabel(c) : 'Unknown customer';
  };
  const open = (data?.invoices ?? []).filter((i) => i.status === 'sent' || i.status === 'overdue');
  const owed = open.reduce((n, i) => n + balanceOf(i), 0);
  const late = open.filter((i) => i.status === 'overdue').reduce((n, i) => n + balanceOf(i), 0);
  const shown = (data?.invoices ?? []).filter((i) => (filter === 'all' ? true : filter === 'open' ? i.status === 'draft' || i.status === 'sent' || i.status === 'overdue' : i.status === filter));

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Invoices</h1>
          <p className="muted">{data ? `${formatMoney(owed)} owed · ${formatMoney(late)} overdue` : ' '}</p>
        </div>
        {role !== 'tech' && (
          <Link to="new" className="button push-right">
            New invoice
          </Link>
        )}
      </header>

      <div className="row">
        {FILTERS.map((f) => (
          <button key={f} className={filter === f ? '' : 'secondary'} onClick={() => setFilter(f)}>
            {f[0].toUpperCase() + f.slice(1)}
          </button>
        ))}
      </div>
      {role !== 'tech' && (
        <button
          className="link"
          onClick={async () => {
            const res = await checkOverdue({});
            const message = resultError(res);
            setNotice(message ?? (res.status === 'ok' ? `${res.output.flagged} invoice${res.output.flagged === 1 ? '' : 's'} flagged overdue.` : null));
            reload();
          }}
        >
          Check for overdue invoices
        </button>
      )}
      {notice && <p className="notice">{notice}</p>}
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && shown.length === 0 && (
        <div className="card">
          <p className="muted">{data.invoices.length === 0 ? 'No invoices yet. Finish a job and use "Invoice this job", or start with New invoice.' : 'No invoices here.'}</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="card list">
          {shown.map((i) => (
            <Link key={i.id} to={i.id} className="stack">
              <strong>
                #{i.invoice_number} · {i.title} <span className={statusClass[i.status]}>{i.status}</span>
              </strong>
              <span className="muted">
                {name(i.customer_id)}
                {i.owed_by_customer_id && i.owed_by_customer_id !== i.customer_id && ` · owed by ${name(i.owed_by_customer_id)}`} · {formatMoney(i.total_cents)}
                {i.amount_paid_cents > 0 && i.status !== 'paid' && ` (${formatMoney(balanceOf(i))} left)`} · due {i.due_date}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
