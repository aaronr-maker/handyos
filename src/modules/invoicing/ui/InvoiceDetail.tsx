import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { AddressLink, CustomerName, getCustomer, getProperty } from '@/modules/customers';
import { TotalsSummary, lineTotal } from '@/modules/estimates';
import { InvoicePaymentsPanel } from '@/modules/payments';
import { sendInvoiceAction, voidInvoiceAction } from '../actions';
import { balanceOf, getInvoice } from '../services/invoiceService';
import { statusClass } from './status';

export default function InvoiceDetail() {
  const { id = '' } = useParams();
  const { companyId, role } = useSession();
  const send = useAction(sendInvoiceAction);
  const voidInvoice = useAction(voidInvoiceAction);
  const { data, loading, error, reload } = useAsync(async () => {
    const invoice = await getInvoice(companyId, id);
    if (!invoice) return null;
    const [billTo, owedBy, property] = await Promise.all([
      getCustomer(companyId, invoice.customer_id),
      invoice.owed_by_customer_id ? getCustomer(companyId, invoice.owed_by_customer_id) : undefined,
      invoice.property_id ? getProperty(companyId, invoice.property_id) : undefined,
    ]);
    return { invoice, billTo, owedBy, property };
  }, [companyId, id]);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (!data) {
    return (
      <section className="page">
        <Link to="/invoices">← Invoices</Link>
        <p className="err">{error ?? 'Invoice not found.'}</p>
      </section>
    );
  }
  const { invoice: i, billTo, owedBy, property } = data;
  const canManage = role !== 'tech';
  const act = async (run: () => Promise<Parameters<typeof resultError>[0]>) => {
    const message = resultError(await run());
    setProblem(message);
    if (!message) reload();
  };

  return (
    <section className="page">
      <Link to="/invoices" className="muted">
        ← Invoices
      </Link>
      <header className="page-header">
        <div>
          <h1>
            #{i.invoice_number} · {i.title}
          </h1>
          <p>
            <span className={statusClass[i.status]}>{i.status}</span> <span className="muted">due {i.due_date}</span>
          </p>
        </div>
      </header>
      {problem && <p className="err">{problem}</p>}

      <div className="card">
        <p>
          <span className="muted">Billed to: </span>
          {billTo ? <CustomerName customer={billTo} /> : 'Unknown'}
          {owedBy && owedBy.id !== billTo?.id && (
            <>
              <br />
              <span className="muted">Owed by: </span>
              <CustomerName customer={owedBy} />
            </>
          )}
        </p>
        {property && (
          <p>
            <span className="muted">Property: </span>
            <AddressLink property={property} />
          </p>
        )}
        {i.job_id && (
          <p>
            <Link to={`/jobs/${i.job_id}`}>See the job</Link>
          </p>
        )}
        {i.status === 'void' && <p className="err">Void: {i.void_reason}</p>}
      </div>

      <div className="card">
        <h2>Line items</h2>
        {i.line_items.map((l, n) => (
          <div key={n} className="contact-row">
            <div>
              <strong>{l.description}</strong>
              <div className="muted">
                {l.quantity} {l.unit} × {formatMoney(l.unit_price_cents)}
                {!l.taxable && ' · not taxable'}
              </div>
            </div>
            <div>{formatMoney(lineTotal(l))}</div>
          </div>
        ))}
        <TotalsSummary subtotal={i.subtotal_cents} tax={i.tax_cents} total={i.total_cents} />
        {i.amount_paid_cents > 0 && (
          <dl className="totals">
            <dt>Paid</dt>
            <dd>{formatMoney(i.amount_paid_cents)}</dd>
            <dt>
              <strong>Balance</strong>
            </dt>
            <dd>
              <strong>{formatMoney(balanceOf(i))}</strong>
            </dd>
          </dl>
        )}
        {i.notes && <p className="notes">{i.notes}</p>}
      </div>

      {i.status !== 'draft' && i.status !== 'void' && <InvoicePaymentsPanel invoice={i} onChanged={reload} />}

      {canManage && (
        <div className="row">
          {i.status === 'draft' && (
            <>
              <Link to="edit" className="button secondary">
                Edit
              </Link>
              <button onClick={() => void act(() => send({ invoice_id: i.id }))}>Mark as sent</button>
            </>
          )}
          {(i.status === 'sent' || i.status === 'overdue' || i.status === 'draft') && i.amount_paid_cents === 0 && (
            <button
              className="secondary"
              onClick={() => {
                const reason = prompt('Why are you voiding this invoice?');
                if (reason?.trim()) void act(() => voidInvoice({ invoice_id: i.id, reason: reason.trim() }));
              }}
            >
              Void invoice
            </button>
          )}
        </div>
      )}
    </section>
  );
}
