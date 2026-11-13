import { Link, Route, Routes, useParams } from 'react-router-dom';
import { Popup, digits, mapsUrl, useAsync, useSession } from '@/core';
import { addressText, customerLabel, getProperty, listAllParties, listCustomers, CustomerName } from '@/modules/customers';
import { listEstimates } from '@/modules/estimates';
import { listInvoices } from '@/modules/invoicing';
import { listJobs } from '@/modules/jobs';

const money = (c: number) => (c / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function Address() {
  const { propertyId = '' } = useParams();
  const { companyId } = useSession();
  const { data, error, loading } = useAsync(async () => {
    const [property, parties, customers, jobs, estimates, invoices] = await Promise.all([
      getProperty(companyId, propertyId),
      listAllParties(companyId),
      listCustomers(companyId),
      listJobs(companyId),
      listEstimates(companyId),
      listInvoices(companyId),
    ]);
    return { property, parties: parties.filter((p) => p.property_id === propertyId), customers, jobs: jobs.filter((j) => j.property_id === propertyId), estimates: estimates.filter((e) => e.property_id === propertyId), invoices: invoices.filter((i) => i.property_id === propertyId) };
  }, [companyId, propertyId]);

  if (loading) return <p className="muted">Loading…</p>;
  if (error || !data?.property) return <p className="err">{error ?? 'That address was not found.'}</p>;
  const { property, parties, customers, jobs, estimates, invoices } = data;
  const byId = new Map(customers.map((c) => [c.id, c]));
  const text = addressText(property);
  const owner = property.customer_id ? byId.get(property.customer_id) : undefined;
  const current = parties.filter((p) => !p.ended_on);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>{property.address_line1}</h1>
          <p className="muted">{[property.city, property.state, property.postal_code].filter(Boolean).join(' ')}</p>
        </div>
        <a className="button" href={mapsUrl(text)}>
          Navigate
        </a>
      </header>

      <div className="card">
        <h2>People</h2>
        {!owner && current.length === 0 && <p className="muted">No one is listed at this address yet.</p>}
        {owner && (
          <p>
            <span className="muted">Owner: </span>
            <CustomerName customer={owner} />
          </p>
        )}
        {current
          .filter((p) => p.role !== 'owner')
          .map((p) => {
            const c = p.customer_id ? byId.get(p.customer_id) : undefined;
            const phone = p.phone ? digits(p.phone) : '';
            return (
              <p key={p.id}>
                <span className="muted">{p.role === 'manager' ? 'Property manager: ' : 'Tenant: '}</span>
                {c ? <CustomerName customer={c} /> : (
                  <Popup items={phone ? [{ label: `Call ${p.phone}`, href: `tel:${phone}` }, { label: 'Text', href: `sms:${phone}` }] : []}>{p.name || p.company_name || 'Unnamed'}</Popup>
                )}
              </p>
            );
          })}
      </div>

      <div className="card">
        <h2>Jobs ({jobs.length})</h2>
        {jobs.length === 0 && <p className="muted">No jobs here yet.</p>}
        <div className="list">
          {jobs.map((j) => (
            <Link key={j.id} to={`/jobs/${j.id}`} className="stack">
              <strong>
                #{j.job_number} {j.title}
              </strong>
              <span className="muted">
                {j.status.replace('_', ' ')} · {day(j.scheduled_start ?? j.completed_at) || 'not scheduled'} · {customerLabel(byId.get(j.customer_id) ?? { name: '', display_name: null, company_name: null, display_name_source: 'person' }) || 'Unknown'}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Estimates ({estimates.length})</h2>
        {estimates.length === 0 && <p className="muted">No estimates here yet.</p>}
        <div className="list">
          {estimates.map((e) => (
            <Link key={e.id} to={`/estimates/${e.id}`} className="stack">
              <strong>
                #{e.estimate_number} {e.title}
              </strong>
              <span className="muted">
                {e.status} · {money(e.total_cents)} · {day(e.created_at)}
              </span>
            </Link>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>Invoices ({invoices.length})</h2>
        {invoices.length === 0 && <p className="muted">No invoices here yet.</p>}
        <div className="list">
          {invoices.map((i) => (
            <Link key={i.id} to={`/invoices/${i.id}`} className="stack">
              <strong>
                #{i.invoice_number} {i.title}
              </strong>
              <span className="muted">
                {i.status} · {money(i.total_cents)} · due {day(i.due_date)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}

export default function AddressScreen() {
  return (
    <Routes>
      <Route path=":propertyId" element={<Address />} />
      <Route path="*" element={<p className="muted">Open an address from a customer, job or estimate.</p>} />
    </Routes>
  );
}
