import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { resultError, useAction, useAsync, useSession } from '@/core';
import {
  addContactAction,
  addPropertyAction,
  removeContactAction,
  setDisplayContactAction,
  updateContactAction,
  updateCustomerAction,
} from '../actions';
import { customerLabel } from '../display';
import { getCustomer, listAllParties, listAllProperties, listContacts, listCustomers, listProperties } from '../services/customerService';
import { ContactForm } from './ContactForm';
import { CustomerForm } from './CustomerForm';
import { PropertyCard } from './PropertyCard';
import { PropertyForm } from './PropertyForm';

function Phone({ phone }: { phone: string | null }) {
  return phone ? <a href={`tel:${phone}`}>{phone}</a> : <span className="muted">No phone</span>;
}
function Email({ email }: { email: string | null }) {
  return email ? <a href={`mailto:${email}`}>{email}</a> : <span className="muted">No email</span>;
}

export function CustomerDetail() {
  const { id = '' } = useParams();
  const { companyId } = useSession();
  const updateCustomer = useAction(updateCustomerAction);
  const addContact = useAction(addContactAction);
  const updateContact = useAction(updateContactAction);
  const removeContact = useAction(removeContactAction);
  const setDisplay = useAction(setDisplayContactAction);
  const addProperty = useAction(addPropertyAction);

  const customer = useAsync(() => getCustomer(companyId, id), [companyId, id]);
  const contacts = useAsync(() => listContacts(companyId, id), [companyId, id]);
  const props = useAsync(
    async () => {
      const [owned, all, parties, customers] = await Promise.all([
        listProperties(companyId, id),
        listAllProperties(companyId),
        listAllParties(companyId),
        listCustomers(companyId),
      ]);
      const managedIds = new Set(
        parties.filter((p) => p.role === 'manager' && p.ended_on === null && p.customer_id === id).map((p) => p.property_id),
      );
      const ownedIds = new Set(owned.map((p) => p.id));
      const former = parties
        .filter((p) => (p.role === 'owner' || p.role === 'manager') && p.customer_id === id && p.ended_on)
        .flatMap((p) => {
          const property = all.find((x) => x.id === p.property_id);
          const stillHeld = p.role === 'owner' ? ownedIds.has(p.property_id) : managedIds.has(p.property_id);
          return property && !stillHeld ? [{ id: p.id, address: property.address_line1, role: p.role, endedOn: p.ended_on! }] : [];
        });
      return { owned, managed: all.filter((p) => managedIds.has(p.id)), former, parties, customers };
    },
    [companyId, id],
  );
  const data = props.data;
  const partiesOf = (propertyId: string) => data?.parties.filter((x) => x.property_id === propertyId) ?? [];

  const [editing, setEditing] = useState(false);
  const [addingContact, setAddingContact] = useState(false);
  const [editingContact, setEditingContact] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (customer.loading) return <p className="muted">Loading…</p>;
  const c = customer.data;
  if (!c) {
    return (
      <section className="page">
        <Link to="..">← Customers</Link>
        <p className="err">{customer.error ?? 'Customer not found.'}</p>
      </section>
    );
  }

  const run = async (fn: () => Promise<Parameters<typeof resultError>[0]>) => {
    const message = resultError(await fn());
    setError(message);
    if (!message) {
      customer.reload();
      contacts.reload();
    }
    return message;
  };

  const isDisplay = (contactId: string | null) => (c.display_contact_id ?? null) === contactId;

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Customers
      </Link>
      <header className="page-header">
        <div>
          <h1>{customerLabel(c)}</h1>
          {c.company_name && customerLabel(c) !== c.company_name && <p className="muted">{c.company_name}</p>}
        </div>
        {!editing && (
          <button className="secondary push-right" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </header>
      {error && <p className="err">{error}</p>}

      {editing ? (
        <CustomerForm
          initial={c}
          submitLabel="Save changes"
          onCancel={() => setEditing(false)}
          onSubmit={async (values) => {
            const message = await run(() => updateCustomer({ customer_id: id, ...values }));
            if (!message) setEditing(false);
            return message;
          }}
        />
      ) : (
        <div className="card">
          <div className="contact-row">
            <div>
              <strong>{c.name}</strong> <span className="muted">(customer)</span>
              <div><Phone phone={c.phone} /></div>
              <div><Email email={c.email} /></div>
            </div>
            <label className="check main-check">
              <input
                type="checkbox"
                checked={isDisplay(null)}
                disabled={isDisplay(null)}
                onChange={() => void run(() => setDisplay({ customer_id: id, contact_id: null }))}
              />
              Main contact
            </label>
          </div>
          {c.notes && <p className="notes">{c.notes}</p>}
        </div>
      )}

      <div className="card">
        <h2>Additional contacts</h2>
        {contacts.data?.length === 0 && !addingContact && <p className="muted">No other contacts yet.</p>}
        {contacts.data?.map((k) =>
          editingContact === k.id ? (
            <ContactForm
              key={k.id}
              initial={k}
              submitLabel="Save"
              onCancel={() => setEditingContact(null)}
              onSubmit={async (values) => {
                const message = await run(() => updateContact({ contact_id: k.id, ...values }));
                if (!message) setEditingContact(null);
                return message;
              }}
            />
          ) : (
            <div key={k.id} className="contact-row">
              <div>
                <strong>{k.name}</strong>
                <div><Phone phone={k.phone} /></div>
                <div><Email email={k.email} /></div>
                <div className="row small">
                  <button className="link" onClick={() => setEditingContact(k.id)}>Edit</button>
                  <button
                    className="link"
                    onClick={() => confirm(`Delete ${k.name}?`) && void run(() => removeContact({ contact_id: k.id }))}
                  >
                    Delete
                  </button>
                </div>
              </div>
              <label className="check main-check">
                <input
                  type="checkbox"
                  checked={isDisplay(k.id)}
                  disabled={isDisplay(k.id)}
                  onChange={() => void run(() => setDisplay({ customer_id: id, contact_id: k.id }))}
                />
                Main contact
              </label>
            </div>
          ),
        )}
        {addingContact ? (
          <ContactForm
            submitLabel="Add contact"
            onCancel={() => setAddingContact(false)}
            onSubmit={async (values) => {
              const message = await run(() => addContact({ customer_id: id, ...values }));
              if (!message) setAddingContact(false);
              return message;
            }}
          />
        ) : (
          <button className="secondary" onClick={() => setAddingContact(true)}>
            Add contact
          </button>
        )}
      </div>

      <div className="card">
        <h2>Properties</h2>
        <p className="muted">Work on these addresses belongs to {customerLabel(c)}.</p>
        {data && data.owned.length === 0 && <p className="muted">No addresses yet.</p>}
        {data?.owned.map((p) => (
          <PropertyCard key={p.id} property={p} parties={partiesOf(p.id)} customers={data.customers} onChanged={props.reload} />
        ))}
        {data && (
          <>
            <h2 className="sub-h">Add a property</h2>
            <PropertyForm
              customers={data.customers}
              fixed={{ kind: 'owner', id }}
              submitLabel="Add property"
              onSubmit={async (v) => {
                const message = resultError(await addProperty(v));
                if (!message) props.reload();
                return message;
              }}
            />
          </>
        )}
      </div>

      {c.is_property_manager && data && (
        <div className="card">
          <h2>Properties we manage</h2>
          <p className="muted">Rentals managed for their owners. The work belongs to each owner.</p>
          {data.managed.length === 0 && <p className="muted">None yet.</p>}
          {data.managed.map((p) => (
            <PropertyCard key={p.id} property={p} parties={partiesOf(p.id)} customers={data.customers} onChanged={props.reload} />
          ))}
          <h2 className="sub-h">Add a managed property</h2>
          <PropertyForm
            customers={data.customers}
            fixed={{ kind: 'manager', id }}
            submitLabel="Add property"
            onSubmit={async (v) => {
              const message = resultError(await addProperty(v));
              if (!message) props.reload();
              return message;
            }}
          />
        </div>
      )}

      {data && data.former.length > 0 && (
        <div className="card">
          <h2>Former properties</h2>
          <p className="muted">Addresses that used to be with this customer. Their history and records stayed with the address.</p>
          {data.former.map((f) => (
            <p key={f.id}>
              {f.address} <span className="muted">· was {f.role} until {f.endedOn}</span>
            </p>
          ))}
        </div>
      )}
    </section>
  );
}
