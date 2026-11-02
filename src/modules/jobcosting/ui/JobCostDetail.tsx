import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { formatDuration, formatMoney, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { getJob } from '@/modules/jobs';
import { addJobCostAction, removeJobCostAction } from '../actions';
import { JobP4PPanel } from './JobP4PPanel';
import { costJob, expectedCost, listCostsForJob, loadCostingData } from '../services/jobCostService';
import type { CostKind } from '../types';

const KINDS: CostKind[] = ['material', 'labor', 'other'];

export default function JobCostDetail() {
  const { id = '' } = useParams();
  const { companyId, role } = useSession();
  const addCost = useAction(addJobCostAction);
  const removeCost = useAction(removeJobCostAction);
  const { data, loading, error, reload } = useAsync(async () => {
    const job = await getJob(companyId, id);
    if (!job) return null;
    const costing = await loadCostingData(companyId);
    return { job, result: costJob(job, costing, await expectedCost(companyId, job)), costs: await listCostsForJob(companyId, id) };
  }, [companyId, id]);

  const [kind, setKind] = useState<CostKind>('material');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [problem, setProblem] = useState<string | null>(null);

  if (loading) return <p className="muted">Loading…</p>;
  if (!data) {
    return (
      <section className="page">
        <Link to="..">← Job costing</Link>
        <p className="err">{error ?? 'Job not found.'}</p>
      </section>
    );
  }
  const { job, result: r, costs } = data;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const cents = parseMoney(amount);
    if (cents === null) return setProblem('Enter an amount like 42 or 42.50');
    const message = resultError(await addCost({ job_id: job.id, kind, description, amount_cents: cents }));
    setProblem(message);
    if (!message) {
      setDescription('');
      setAmount('');
      reload();
    }
  };

  const line = (label: string, cents: number, strong = false) => (
    <>
      <dt>{strong ? <strong>{label}</strong> : label}</dt>
      <dd>{strong ? <strong>{formatMoney(cents)}</strong> : formatMoney(cents)}</dd>
    </>
  );

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Job costing
      </Link>
      <header className="page-header">
        <div>
          <h1>
            #{job.job_number} · {job.title}
          </h1>
          <p>
            <Link to={`/jobs/${job.id}`}>Open the job</Link>
          </p>
        </div>
      </header>

      <div className="card">
        <dl className="totals">
          {line('Invoiced', r.invoiced_cents)}
          {line('Collected so far', r.collected_cents)}
          {line(`Labor (${formatDuration(r.labor_minutes)} on the clock)`, r.labor_cents)}
          {line('Materials', r.material_cents)}
          {line('Other costs', r.other_cents)}
          {line('Total cost', r.total_cost_cents, true)}
          {line(`Profit${r.margin_pct !== null ? ` (${r.margin_pct}%)` : ''}`, r.profit_cents, true)}
        </dl>
        {r.expected_cost_cents !== null && r.expected_cost_cents > 0 && <p className="muted">The estimate expected this job to cost {formatMoney(r.expected_cost_cents)}.</p>}
        {r.invoiced_cents === 0 && <p className="muted">Nothing has been invoiced for this job yet, so profit shows the cost so far.</p>}
        {r.unrated_user_ids.length > 0 && <p className="err">Some time on this job is from people with no hourly rate set, so it's counted as $0 until you add their rate.</p>}
      </div>

      <JobP4PPanel jobId={job.id} onChanged={reload} />

      <div className="card">
        <h2>Costs recorded</h2>
        {costs.length === 0 && <p className="muted">None yet.</p>}
        {costs.map((c) => (
          <div key={c.id} className="contact-row">
            <div>
              <strong>{c.description}</strong>
              <div className="muted">
                {c.kind} · {c.incurred_on}
              </div>
            </div>
            <div>
              {formatMoney(c.amount_cents)}{' '}
              {(role === 'owner' || role === 'admin') && (
                <button
                  className="link"
                  onClick={async () => {
                    if (!confirm('Delete this cost?')) return;
                    const message = resultError(await removeCost({ cost_id: c.id }));
                    setProblem(message);
                    if (!message) reload();
                  }}
                >
                  Delete
                </button>
              )}
            </div>
          </div>
        ))}
        <form onSubmit={submit} className="subform">
          <h2 className="sub-h">Add a cost</h2>
          <div className="row">
            <label className="grow">
              Type
              <select value={kind} onChange={(e) => setKind(e.target.value as CostKind)}>
                {KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k[0].toUpperCase() + k.slice(1)}
                  </option>
                ))}
              </select>
            </label>
            <label className="grow">
              Amount ($)
              <input inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </label>
          </div>
          <label>
            What was it
            <input required value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Hinges and screws" />
          </label>
          {problem && <p className="err">{problem}</p>}
          <button>Add cost</button>
        </form>
      </div>
    </section>
  );
}
