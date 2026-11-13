import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { AddressLink, CustomerName, getCustomer, getProperty } from '@/modules/customers';
import { approveEstimateAction, declineEstimateAction, sendEstimateAction } from '../actions';
import { getEstimate } from '../services/estimateService';
import { lineTotal } from '../totals';
import { statusClass } from './status';

export default function EstimateDetail() {
  const { id = '' } = useParams();
  const { companyId } = useSession();
  const send = useAction(sendEstimateAction);
  const approve = useAction(approveEstimateAction);
  const decline = useAction(declineEstimateAction);
  const { data, loading, error, reload } = useAsync(async () => {
    const estimate = await getEstimate(companyId, id);
    if (!estimate) return null;
    const [billTo, owedBy, property] = await Promise.all([
      getCustomer(companyId, estimate.customer_id),
      estimate.owed_by_customer_id ? getCustomer(companyId, estimate.owed_by_customer_id) : undefined,
      estimate.property_id ? getProperty(companyId, estimate.property_id) : undefined,
    ]);
    return { estimate, billTo, owedBy, property };
  }, [companyId, id]);
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (!data) {
    return (
      <section className="page">
        <Link to="..">← Estimates</Link>
        <p className="err">{error ?? 'Estimate not found.'}</p>
      </section>
    );
  }
  const { estimate: e, billTo, owedBy, property } = data;
  const act = async (run: () => Promise<Parameters<typeof resultError>[0]>) => {
    const message = resultError(await run());
    setProblem(message);
    if (!message) reload();
  };

  return (
    <section className="page">
      <Link to="/estimates" className="muted">
        ← Estimates
      </Link>
      <header className="page-header">
        <div>
          <h1>
            #{e.estimate_number} · {e.title}
          </h1>
          <p>
            <span className={statusClass[e.status]}>{e.status}</span>
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
        {e.valid_until && (
          <p>
            <span className="muted">Good until: </span>
            {e.valid_until}
          </p>
        )}
      </div>

      <div className="card">
        <h2>Line items</h2>
        {e.line_items.map((l, i) => (
          <div key={i} className="contact-row">
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
        <dl className="totals">
          <dt>Subtotal</dt>
          <dd>{formatMoney(e.subtotal_cents)}</dd>
          <dt>Tax ({e.tax_rate_bps / 100}%)</dt>
          <dd>{formatMoney(e.tax_cents)}</dd>
          <dt>
            <strong>Total</strong>
          </dt>
          <dd>
            <strong>{formatMoney(e.total_cents)}</strong>
          </dd>
        </dl>
        {e.notes && <p className="notes">{e.notes}</p>}
      </div>

      <div className="row">
        {e.status === 'draft' && (
          <>
            <Link to="edit" className="button secondary">
              Edit
            </Link>
            <button onClick={() => void act(() => send({ estimate_id: e.id }))}>Mark as sent</button>
          </>
        )}
        {e.status === 'sent' && (
          <>
            <button onClick={() => void act(() => approve({ estimate_id: e.id }))}>Customer approved</button>
            <button className="secondary" onClick={() => void act(() => decline({ estimate_id: e.id }))}>
              Customer declined
            </button>
          </>
        )}
        {e.status === 'declined' && <button onClick={() => void act(() => send({ estimate_id: e.id }))}>Send again</button>}
      </div>
      {e.status === 'approved' && <p className="notice">Approved. A job was created for this work.</p>}
    </section>
  );
}
