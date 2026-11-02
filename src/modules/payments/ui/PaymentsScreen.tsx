import { Link } from 'react-router-dom';
import { formatMoney, useAsync, useSession } from '@/core';
import { listInvoices } from '@/modules/invoicing';
import { listPayments } from '../services/paymentService';

export default function PaymentsScreen() {
  const { companyId } = useSession();
  const { data, loading, error } = useAsync(async () => ({ payments: await listPayments(companyId), invoices: await listInvoices(companyId) }), [companyId]);
  const monthStart = new Date().toISOString().slice(0, 8) + '01';
  const thisMonth = (data?.payments ?? []).filter((p) => p.received_on >= monthStart).reduce((n, p) => n + p.amount_cents, 0);
  const number = (id: string) => data?.invoices.find((i) => i.id === id)?.invoice_number;

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Payments</h1>
          <p className="muted">{data ? `${formatMoney(thisMonth)} received this month` : ' '}</p>
        </div>
      </header>
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && data.payments.length === 0 && (
        <div className="card">
          <p className="muted">No payments yet. Record one from an invoice.</p>
        </div>
      )}
      {data && data.payments.length > 0 && (
        <div className="card list">
          {data.payments.map((p) => (
            <Link key={p.id} to={`/invoices/${p.invoice_id}`} className="stack">
              <strong>
                {formatMoney(p.amount_cents)} · {p.amount_cents < 0 ? 'refund' : p.method.replace('_', ' ')}
              </strong>
              <span className="muted">
                Invoice #{number(p.invoice_id) ?? '?'} · {p.received_on}
                {p.note && ` · ${p.note}`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
