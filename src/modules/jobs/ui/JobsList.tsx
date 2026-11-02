import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatDateTime, useAsync, useSession } from '@/core';
import { customerLabel, listCustomers } from '@/modules/customers';
import { listAssignments, listJobs } from '../services/jobService';
import type { JobStatus } from '../types';
import { statusClass, statusLabel } from './status';
import { useTeam } from './useTeam';

const FILTERS: ('all' | JobStatus)[] = ['all', 'unscheduled', 'scheduled', 'in_progress', 'completed'];

export function JobsList() {
  const { companyId, user } = useSession();
  const { nameOf } = useTeam();
  const { data, loading, error } = useAsync(
    async () => ({ jobs: await listJobs(companyId), customers: await listCustomers(companyId), assignments: await listAssignments(companyId) }),
    [companyId],
  );
  const [status, setStatus] = useState<'all' | JobStatus>('all');
  const [mine, setMine] = useState(false);

  const customer = (id: string) => {
    const c = data?.customers.find((x) => x.id === id);
    return c ? customerLabel(c) : 'Unknown customer';
  };
  const people = (jobId: string) => (data?.assignments ?? []).filter((a) => a.job_id === jobId).map((a) => a.user_id);
  const shown = (data?.jobs ?? []).filter((j) => (status === 'all' || j.status === status) && (!mine || people(j.id).includes(user.id)));

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Jobs</h1>
          <p className="muted">{data ? `${data.jobs.length} total` : ' '}</p>
        </div>
        <Link to="new" className="button push-right">
          New job
        </Link>
      </header>

      <div className="row">
        {FILTERS.map((f) => (
          <button key={f} className={status === f ? '' : 'secondary'} onClick={() => setStatus(f)}>
            {f === 'all' ? 'All' : statusLabel[f][0].toUpperCase() + statusLabel[f].slice(1)}
          </button>
        ))}
      </div>
      <label className="check">
        <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
        Only my jobs
      </label>

      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && shown.length === 0 && (
        <div className="card">
          <p className="muted">{data.jobs.length === 0 ? 'No jobs yet. Approve an estimate or start with New job.' : 'No jobs match.'}</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="card list">
          {shown.map((j) => (
            <Link key={j.id} to={j.id} className="stack">
              <strong>
                #{j.job_number} · {j.title} <span className={statusClass[j.status]}>{statusLabel[j.status]}</span>
              </strong>
              <span className="muted">
                {customer(j.customer_id)}
                {j.scheduled_start && ` · ${formatDateTime(j.scheduled_start)}`}
                {people(j.id).length > 0 && ` · ${people(j.id).map(nameOf).join(', ')}`}
              </span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
