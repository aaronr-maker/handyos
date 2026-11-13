import { Link } from 'react-router-dom';
import { listTeamMembers, useAsync, useSession, type Id } from '@/core';
import { AddressLink, CustomerName, customerLabel, listAllProperties, listCustomers } from '@/modules/customers';
import { listAlerts } from '@/modules/desk';
import { listEstimates } from '@/modules/estimates';
import { listInvoices } from '@/modules/invoicing';
import { loadDashboard } from '@/modules/dashboard';
import { listAiRequests, listVoicemails } from '@/modules/phone';
import { efficiencyFor, loadTimeFacts, weekReport, WEEK_LIMIT_MINUTES } from '@/modules/timesheets';
import { daySummary, greeting, hoursText, isToday } from '../calc';
import { QuickContact } from './QuickContact';

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const safe = async <T,>(p: Promise<T>, fallback: T): Promise<T> => p.catch(() => fallback);

export default function TodayScreen() {
  const { companyId, role, user } = useSession();
  const manager = role === 'owner' || role === 'admin';
  const office = role === 'office';
  const { data, error, loading } = useAsync(async () => {
    const now = Date.now();
    const [team, customers, properties, facts] = await Promise.all([safe(listTeamMembers(), []), listCustomers(companyId), listAllProperties(companyId), loadTimeFacts(companyId)]);
    const [alerts, voicemails, requests, estimates, invoices, kpi] = await Promise.all([
      manager ? safe(listAlerts(companyId), []) : [],
      manager || office ? safe(listVoicemails(companyId), []) : [],
      manager || office ? safe(listAiRequests(companyId), []) : [],
      manager || office ? safe(listEstimates(companyId), []) : [],
      manager || office ? safe(listInvoices(companyId), []) : [],
      manager ? safe(loadDashboard(companyId, now), null) : null,
    ]);
    return { now, team, customers, properties, facts, alerts, voicemails, requests, estimates, invoices, kpi };
  }, [companyId, role]);

  if (loading) return <section className="page"><p className="muted">Loading…</p></section>;
  if (error || !data) return <section className="page"><p className="err">{error ?? 'Could not load your day.'}</p></section>;

  const { now, team, customers, properties, facts, alerts, voicemails, requests, estimates, invoices, kpi } = data;
  const me = team.find((m) => m.id === user.id);
  const first = (me?.full_name || '').trim().split(' ')[0];
  const cust = new Map(customers.map((c) => [c.id, c]));
  const prop = new Map(properties.map((p) => [p.id, p]));
  const names = new Map(team.map((m) => [m.id, m.full_name || m.email]));

  const assignedTo = (jobId: Id) => facts.assignments.filter((a) => a.job_id === jobId).map((a) => a.user_id);
  const todays = facts.jobs
    .filter((j) => j.status !== 'completed' && isToday(j.scheduled_start, now))
    .filter((j) => manager || office || assignedTo(j.id).includes(user.id))
    .sort((a, b) => (a.scheduled_start as string).localeCompare(b.scheduled_start as string));

  const overdue = invoices.filter((i) => i.status === 'overdue');
  const sentEstimates = estimates.filter((e) => e.status === 'sent');
  const newMail = voicemails.filter((v) => v.status === 'new');
  const newRequests = requests.filter((r) => r.status === 'new');
  const openAlerts = alerts.filter((a) => a.status === 'open');

  const extras: string[] = [];
  if (manager || office) {
    if (newMail.length) extras.push(`${newMail.length} new ${newMail.length === 1 ? 'voicemail' : 'voicemails'}.`);
    if (newRequests.length) extras.push(`${newRequests.length} from the AI receptionist.`);
    if (overdue.length) extras.push(`${overdue.length} overdue ${overdue.length === 1 ? 'invoice' : 'invoices'}.`);
  }

  const week = weekReport(facts, user.id, new Date(now), now);
  const eff = efficiencyFor(facts, user.id, now);
  const tiles: { label: string; value: string; note?: string }[] = [];
  if (manager && kpi) {
    const seen = new Set<string>();
    for (const k of kpi.kpis) if (!seen.has(k.area) && k.value) { seen.add(k.area); tiles.push({ label: k.label, value: k.value, note: k.area }); }
    if (kpi.backlogWeeks !== null) tiles.push({ label: 'Work booked ahead', value: `${kpi.backlogWeeks} wk` });
  } else if (office) {
    tiles.push({ label: 'Jobs today', value: String(todays.length) }, { label: 'Estimates out', value: String(sentEstimates.length) }, { label: 'Overdue invoices', value: String(overdue.length) });
  } else {
    tiles.push({ label: 'Hours this week', value: hoursText(week.clocked), note: `of ${hoursText(WEEK_LIMIT_MINUTES)} limit` }, { label: 'Jobs today', value: String(todays.length) }, { label: 'Pace', value: eff.defaulted ? '—' : `${Math.round(eff.rate * 100)}%`, note: eff.defaulted ? 'not enough history yet' : 'actual vs scheduled' });
  }

  const people = customers.map((c) => ({ id: c.id, label: customerLabel(c), phone: c.phone }));

  return (
    <section className="page">
      <header className="today-top">
        <QuickContact people={people} />
        <div className="hello">
          <h1>
            {greeting(new Date(now).getHours())}
            {first ? `, ${first}` : ''}!
          </h1>
          <p className="muted">{new Date(now).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </header>

      <div className="card">
        <h2>Your day</h2>
        <p>{daySummary(todays.map((j) => ({ start: j.scheduled_start as string })), extras)}</p>
      </div>

      {tiles.length > 0 && (
        <div className="kpi-row">
          {tiles.map((t) => (
            <div className="kpi-tile" key={t.label}>
              <span className="muted">{t.label}</span>
              <strong>{t.value}</strong>
              {t.note && <small className="muted">{t.note}</small>}
            </div>
          ))}
        </div>
      )}

      <div className="card">
        <h2>{manager || office ? "Today's jobs" : 'Your jobs today'}</h2>
        {todays.length === 0 && <p className="muted">Nothing scheduled for today.</p>}
        <div className="task-list">
          {todays.map((j) => {
            const c = cust.get(j.customer_id);
            const p = j.property_id ? prop.get(j.property_id) : undefined;
            const crew = assignedTo(j.id).map((id) => names.get(id)).filter(Boolean).join(', ');
            return (
              <div key={j.id}>
                <strong>
                  {time(j.scheduled_start as string)} · <Link to={`/jobs/${j.id}`}>{j.title}</Link>
                </strong>
                <span>
                  {c && <CustomerName customer={c} />}
                  {c && p && ' · '}
                  {p && <AddressLink property={p} />}
                </span>
                {(manager || office) && crew && <span className="muted">{crew}</span>}
              </div>
            );
          })}
        </div>
      </div>

      {(manager || office) && (newMail.length > 0 || newRequests.length > 0 || openAlerts.length > 0 || overdue.length > 0) && (
        <div className="card">
          <h2>Needs you</h2>
          <div className="task-list">
            {newMail.length > 0 && <Link to="/phone">{newMail.length} new {newMail.length === 1 ? 'voicemail' : 'voicemails'} to listen to</Link>}
            {newRequests.length > 0 && <Link to="/phone">{newRequests.length} {newRequests.length === 1 ? 'request' : 'requests'} from the AI receptionist</Link>}
            {overdue.length > 0 && <Link to="/invoices">{overdue.length} overdue {overdue.length === 1 ? 'invoice' : 'invoices'}</Link>}
            {openAlerts.map((a) => (
              <Link key={a.id} to="/desk">
                {a.title}
              </Link>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}
