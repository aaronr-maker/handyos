import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatMoney, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { listEstimates } from '../services/estimateService';
import { statusClass } from './status';
import type { EstimateStatus } from '../types';

const STATUSES: ('all' | EstimateStatus)[] = ['all', 'draft', 'sent', 'approved', 'declined'];

export function EstimatesList() {
  const { companyId } = useSession();
  const { data, loading, error } = useAsync(
    async () => ({ estimates: await listEstimates(companyId), customers: await listCustomers(companyId) }),
    [companyId],
  );
  const [status, setStatus] = useState<'all' | EstimateStatus>('all');
  const name = (id: string) => {
    const c = data?.customers.find((x) => x.id === id);
    return c ? customerLabel(c) : 'Unknown customer';
  };
  const shown = (data?.estimates ?? []).filter((e) => status === 'all' || e.status === status);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Estimates</h1>
          <p className="muted">{data ? `${data.estimates.length} total` : ' '}</p>
        </div>
        <div className="row push-right">
          <Link to="pricebook" className="button secondary">
            Price book
          </Link>
          <Link to="new" className="button">
            New estimate
          </Link>
        </div>
      </header>

      <div className="row">
        {STATUSES.map((s) => (
          <button key={s} className={status === s ? '' : 'secondary'} onClick={() => setStatus(s)}>
            {s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && shown.length === 0 && (
        <div className="card">
          <p className="muted">{data.estimates.length === 0 ? 'No estimates yet. Start with New estimate.' : 'No estimates with that status.'}</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="card list">
          {shown.map((e) => (
            <Link key={e.id} to={e.id} className="stack">
              <strong>
                #{e.estimate_number} · {e.title} <span className={statusClass[e.status]}>{e.status}</span>
              </strong>
              <span className="muted">
                {name(e.customer_id)}
                {e.owed_by_customer_id && e.owed_by_customer_id !== e.customer_id && ` · owed by ${name(e.owed_by_customer_id)}`} · {formatMoney(e.total_cents)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
