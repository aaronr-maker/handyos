import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resultError, useAction, useAsync, useSession } from '@/core';
import { createCustomerAction } from '../actions';
import { customerLabel, displayContact } from '../display';
import { listAllContacts, listCustomers } from '../services/customerService';
import { CustomerForm } from './CustomerForm';

export function CustomerList() {
  const { companyId } = useSession();
  const createCustomer = useAction(createCustomerAction);
  const { data, error, loading, reload } = useAsync(
    async () => ({ customers: await listCustomers(companyId), contacts: await listAllContacts(companyId) }),
    [companyId],
  );
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);

  const rows = (data?.customers ?? []).map((c) => {
    const contact = displayContact(c, data?.contacts.filter((x) => x.customer_id === c.id) ?? []);
    const secondary = [contact.name !== c.name || c.display_name ? contact.name : null, contact.phone, contact.email].filter(Boolean);
    return { c, label: customerLabel(c), secondary: secondary.join(' · ') || 'No contact info', contact };
  });
  const q = query.trim().toLowerCase();
  const shown = rows.filter(
    ({ c, label, contact }) =>
      !q || [label, c.name, c.company_name, c.phone, c.email, contact.name, contact.phone, contact.email].some((v) => v?.toLowerCase().includes(q)),
  );

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Customers</h1>
          <p className="muted">{data ? `${data.customers.length} total` : ' '}</p>
        </div>
        <div className="row push-right">
          <Link to="cleanup" className="button secondary">
            Clean up
          </Link>
          <Link to="duplicates" className="button secondary">
            Duplicates
          </Link>
          <Link to="import" className="button secondary">
            Import
          </Link>
          <button onClick={() => setAdding(true)}>Add customer</button>
        </div>
      </header>

      {adding && (
        <CustomerForm
          submitLabel="Save customer"
          onCancel={() => setAdding(false)}
          onSubmit={async (values) => {
            const message = resultError(await createCustomer(values));
            if (!message) {
              setAdding(false);
              reload();
            }
            return message;
          }}
        />
      )}

      <input type="search" placeholder="Search name, company, phone or email" value={query} onChange={(e) => setQuery(e.target.value)} />

      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Loading…</p>}
      {data && shown.length === 0 && (
        <div className="card">
          <p className="muted">{rows.length === 0 ? 'No customers yet. Add your first one.' : 'No customers match that search.'}</p>
        </div>
      )}
      {shown.length > 0 && (
        <div className="card list">
          {shown.map(({ c, label, secondary }) => (
            <Link key={c.id} to={c.id} className="stack">
              <strong>
                {label} {c.is_property_manager && <span className="pill">Property manager</span>}
              </strong>
              <span className="muted">{secondary}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
