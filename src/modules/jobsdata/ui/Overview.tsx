import { useState } from 'react';
import { formatMoney, useAsync, useSession } from '@/core';
import { computeJobsData, type GroupRow, type JobsDataReport } from '../kpis';
import { loadJobsData } from '../service';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);
const money = (c: number | null) => (c === null ? '—' : formatMoney(c));
const monthLabel = (m: string) => new Date(`${m}-01T12:00:00`).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="card kpi-tile">
      <div className="small-note muted">{label}</div>
      <div style={{ fontSize: '1.6rem', fontWeight: 800, lineHeight: 1.1 }}>{value}</div>
      {note && <div className="small-note muted">{note}</div>}
    </div>
  );
}

/** Revenue and profit for each month: the green bar is revenue, the darker part is what was left as profit. */
function MonthChart({ rows }: { rows: JobsDataReport['byMonth'] }) {
  const top = Math.max(1, ...rows.map((r) => r.revenueCents));
  return (
    <div className="card">
      <h2>Revenue and profit by month</h2>
      <div className="jd-chart" role="img" aria-label="Revenue and profit for each month">
        {rows.map((r) => (
          <div key={r.month} className="jd-col" title={`${monthLabel(r.month)}: ${money(r.revenueCents)} revenue, ${money(r.profitCents)} profit (${pct(r.margin)}), ${r.jobs} jobs`}>
            <div className="jd-bar" style={{ height: `${Math.max(2, (r.revenueCents / top) * 100)}%` }}>
              <div className="jd-profit" style={{ height: `${Math.max(0, Math.min(100, (r.profitCents / Math.max(1, r.revenueCents)) * 100))}%` }} />
            </div>
            <span className="jd-label">{monthLabel(r.month)}</span>
          </div>
        ))}
      </div>
      <p className="muted small-note">Light green is revenue; the darker part is profit. Hover a bar for the numbers.</p>
    </div>
  );
}

function GroupTable({ title, rows, first }: { title: string; rows: GroupRow[]; first: string }) {
  const top = Math.max(1, ...rows.map((r) => r.revenueCents));
  return (
    <div className="card">
      <h2>{title}</h2>
      {rows.length === 0 ? (
        <p className="muted">Nothing yet.</p>
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table className="by-month">
            <thead>
              <tr>
                <th>{first}</th>
                <th>Jobs</th>
                <th>Revenue</th>
                <th>Profit</th>
                <th>Margin</th>
                <th>Average job</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.name}>
                  <td>{r.name}</td>
                  <td>{r.jobs}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ flex: 1, minWidth: 50, background: '#f1f5f9', borderRadius: 4, height: 8 }}>
                        <div style={{ width: `${Math.max(2, (r.revenueCents / top) * 100)}%`, height: '100%', background: '#15803d', borderRadius: 4 }} />
                      </div>
                      <span>{money(r.revenueCents)}</span>
                    </div>
                  </td>
                  <td>{money(r.profitCents)}</td>
                  <td>{pct(r.margin)}</td>
                  <td>{money(r.avgTicketCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** The KPIs for the period you pick, from the history that has been brought in. */
export function Overview({ onImport }: { onImport: () => void }) {
  const { companyId } = useSession();
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const { data, loading, error } = useAsync(() => loadJobsData(companyId), [companyId]);
  if (loading) return <p className="muted">Working out your numbers…</p>;
  if (error || !data) return <p className="err">{error ?? 'Could not load jobs data.'}</p>;
  if (data.jobs.length === 0) {
    return (
      <div className="card">
        <h2>No jobs loaded yet</h2>
        <p className="muted">Bring in your jobs report (and invoices, payments, timesheets and the per-person reports) and this page fills in with revenue, profit, margin and more.</p>
        <button type="button" onClick={onImport}>
          Import reports
        </button>
      </div>
    );
  }
  const r = computeJobsData({ jobs: data.jobs, invoices: data.invoices, payments: data.payments, people: data.people, from, to });
  const t = r.totals;
  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <div className="row">
        <label className="grow">
          From
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label className="grow">
          To
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </label>
      </div>
      <div className="kpi-grid">
        <Tile label="Revenue" value={money(t.revenueCents)} note={`${t.jobs} jobs`} />
        <Tile label="Profit" value={money(t.profitCents)} note={`after ${money(t.costCents)} of costs`} />
        <Tile label="Profit margin" value={pct(t.margin)} />
        <Tile label="Average job" value={money(t.avgTicketCents)} />
        <Tile label="Revenue per hour" value={money(t.revenuePerHourCents)} note={`${t.hours} hours tracked on jobs`} />
        <Tile label="Profit per hour" value={money(t.profitPerHourCents)} />
        <Tile
          label="Days to get paid"
          value={r.invoices.avgDaysToPay === null ? '—' : `${r.invoices.avgDaysToPay} days`}
          note={`${r.invoices.paid} of ${r.invoices.invoices} invoices paid${r.invoices.badDebt ? `, ${r.invoices.badDebt} bad debt` : ''}`}
        />
        <Tile
          label="Card fees"
          value={money(r.payments.feeCents)}
          note={r.payments.feeShare === null ? undefined : `${(r.payments.feeShare * 100).toFixed(1)}% of ${money(r.payments.totalCents)} paid`}
        />
      </div>
      <MonthChart rows={r.byMonth} />
      <GroupTable title="Where the work comes from (lead source)" rows={r.byLead} first="Lead source" />
      <GroupTable title="By salesperson" rows={r.bySalesperson} first="Salesperson" />
      {r.salespeople.length > 0 && (
        <div className="card">
          <h2>Quotes sent and won</h2>
          <table className="by-month">
            <thead>
              <tr>
                <th>Salesperson</th>
                <th>Quotes sent</th>
                <th>Won</th>
                <th>Win rate</th>
                <th>Average won</th>
              </tr>
            </thead>
            <tbody>
              {r.salespeople.map((s) => (
                <tr key={s.person}>
                  <td>{s.person}</td>
                  <td>{s.sentQuotes}</td>
                  <td>{s.convertedQuotes}</td>
                  <td>{pct(s.conversion)}</td>
                  <td>{money(s.avgConvertedCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="muted small-note">From the salesperson report, for the whole period it covers.</p>
        </div>
      )}
      {r.people.length > 0 && (
        <div className="card">
          <h2>Productivity by person</h2>
          <div style={{ overflowX: 'auto' }}>
            <table className="by-month">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Visits</th>
                  <th>Job revenue</th>
                  <th>Hours on jobs</th>
                  <th>All hours tracked</th>
                  <th>On jobs</th>
                  <th>Revenue per job hour</th>
                  <th>Revenue per tracked hour</th>
                </tr>
              </thead>
              <tbody>
                {r.people.map((p) => (
                  <tr key={p.person}>
                    <td>{p.person}</td>
                    <td>{p.visits}</td>
                    <td>{money(p.jobRevenueCents)}</td>
                    <td>{p.jobHours}</td>
                    <td>{p.totalHours}</td>
                    <td>{pct(p.onJobShare)}</td>
                    <td>{money(p.jobPerHourCents)}</td>
                    <td>{money(p.overallPerHourCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted small-note">
            From the team productivity report, for the whole period it covers.{r.reportedHours !== null ? ` The timesheet report totals ${r.reportedHours} hours.` : ''}
          </p>
        </div>
      )}
      <GroupTable title="Biggest customers" rows={r.topClients} first="Customer" />
    </div>
  );
}
