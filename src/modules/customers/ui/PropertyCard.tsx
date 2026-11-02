import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resultError, useAction } from '@/core';
import { changeOwnerAction, endTenantAction, setManagerAction, setTenantAction, updatePropertyAction } from '../actions';
import { customerLabel } from '../display';
import { billingFor } from '../services/customerService';
import type { Customer, Property, PropertyParty } from '../types';
import { PropertyForm } from './PropertyForm';
import { TenantForm } from './TenantForm';

interface Props {
  property: Property;
  /** All history rows for this property (owner, manager, tenant; current and past). */
  parties: PropertyParty[];
  customers: Customer[];
  onChanged(): void;
}

const roleLabel = { owner: 'Owner', manager: 'Manager', tenant: 'Tenant' } as const;
const today = () => new Date().toISOString().slice(0, 10);

function CustomerLink({ id, customers }: { id: string | null; customers: Customer[] }) {
  const c = customers.find((x) => x.id === id);
  return c ? <Link to={`/customers/${c.id}`}>{customerLabel(c)}</Link> : <>Unknown customer</>;
}

function Who({ p, customers }: { p: PropertyParty; customers: Customer[] }) {
  if (p.role !== 'tenant') return <CustomerLink id={p.customer_id} customers={customers} />;
  return <>{[p.name, p.company_name, p.phone, p.email].filter(Boolean).join(' · ') || 'Unknown'}</>;
}

export function PropertyCard({ property, parties, customers, onChanged }: Props) {
  const updateProperty = useAction(updatePropertyAction);
  const changeOwner = useAction(changeOwnerAction);
  const setManager = useAction(setManagerAction);
  const setTenant = useAction(setTenantAction);
  const endTenant = useAction(endTenantAction);

  const [panel, setPanel] = useState<null | 'address' | 'owner' | 'manager' | 'tenant' | 'history'>(null);
  const [error, setError] = useState<string | null>(null);
  const [pick, setPick] = useState('');
  const [date, setDate] = useState(today());
  const [endManagement, setEndManagement] = useState(true);

  const current = (role: PropertyParty['role']) => parties.find((p) => p.role === role && p.ended_on === null);
  const owner = current('owner');
  const manager = current('manager');
  const tenant = current('tenant');
  const history = [...parties].sort((a, b) => b.started_on.localeCompare(a.started_on) || a.role.localeCompare(b.role));

  const done = (message: string | null) => {
    setError(message);
    if (!message) {
      setPanel(null);
      onChanged();
    }
    return message;
  };
  const open = (p: NonNullable<typeof panel>) => {
    setPick('');
    setDate(today());
    setEndManagement(true);
    setPanel(panel === p ? null : p);
  };
  const billing = billingFor(property, parties);
  const managers = customers.filter((c) => c.is_property_manager && c.id !== manager?.customer_id);

  return (
    <div className="property">
      <strong>{property.address_line1}</strong>
      {[property.city, property.state, property.postal_code].some(Boolean) && (
        <div className="muted">{[property.city, property.state, property.postal_code].filter(Boolean).join(', ')}</div>
      )}
      <div>
        <span className="muted">Owner: </span>
        {owner ? <Who p={owner} customers={customers} /> : <span className="muted">none listed</span>}{' '}
        <button className="link small-link" onClick={() => open('owner')}>{owner ? 'Sold / new owner' : 'Set owner'}</button>
      </div>
      <div>
        <span className="muted">Manager: </span>
        {manager ? <Who p={manager} customers={customers} /> : <span className="muted">none (not a rental)</span>}{' '}
        <button className="link small-link" onClick={() => open('manager')}>{manager ? 'Change' : 'Add'}</button>
      </div>
      <div>
        <span className="muted">Tenant: </span>
        {tenant ? <Who p={tenant} customers={customers} /> : <span className="muted">none</span>}{' '}
        <button className="link small-link" onClick={() => open('tenant')}>{tenant ? 'Change' : 'Add'}</button>
      </div>
      {billing && (
        <div className="muted">
          Billed to <CustomerLink id={billing.billToId} customers={customers} />
          {billing.owedById !== billing.billToId && (
            <>
              {' '}
              · owed by <CustomerLink id={billing.owedById} customers={customers} />
            </>
          )}
        </div>
      )}
      <div className="row small">
        <button className="link small-link" onClick={() => open('address')}>Edit address</button>
        <button className="link small-link" onClick={() => open('history')}>History</button>
      </div>
      {error && <p className="err">{error}</p>}

      {panel === 'address' && (
        <PropertyForm
          initial={property}
          customers={customers}
          fixed={{ kind: 'owner', id: property.customer_id ?? '' }}
          submitLabel="Save address"
          onCancel={() => setPanel(null)}
          onSubmit={async (v) =>
            done(resultError(await updateProperty({ property_id: property.id, address_line1: v.address_line1, city: v.city, state: v.state, postal_code: v.postal_code })))
          }
        />
      )}

      {panel === 'owner' && (
        <form
          className="subform"
          onSubmit={async (e) => {
            e.preventDefault();
            done(resultError(await changeOwner({ property_id: property.id, new_owner_id: pick, effective_on: date, end_management: endManagement })));
          }}
        >
          <p className="muted">
            The address keeps its history and all its jobs, estimates and invoices. The current owner stays in the history.
          </p>
          <label>
            New owner <span className="muted">(add them as a customer first if they aren't listed)</span>
            <select required value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">Choose…</option>
              {customers.filter((c) => c.id !== property.customer_id).map((c) => (
                <option key={c.id} value={c.id}>{customerLabel(c)}</option>
              ))}
            </select>
          </label>
          <label>
            Effective on
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          {manager && (
            <label className="check">
              <input type="checkbox" checked={endManagement} onChange={(e) => setEndManagement(e.target.checked)} />
              No longer a rental managed by {customerLabel(customers.find((c) => c.id === manager.customer_id) ?? ({ name: 'the manager' } as Customer))}
            </label>
          )}
          <div className="row">
            <button>Change owner</button>
            <button type="button" className="secondary" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      {panel === 'manager' && (
        <form
          className="subform"
          onSubmit={async (e) => {
            e.preventDefault();
            done(resultError(await setManager({ property_id: property.id, manager_id: pick || null, effective_on: date })));
          }}
        >
          <label>
            Property manager
            <select value={pick} onChange={(e) => setPick(e.target.value)}>
              <option value="">{manager ? 'No manager (no longer a rental)' : 'Choose…'}</option>
              {managers.map((c) => (
                <option key={c.id} value={c.id}>{customerLabel(c)}</option>
              ))}
            </select>
          </label>
          {managers.length === 0 && <p className="muted">No other property managers yet. Mark a customer as a property manager first.</p>}
          <label>
            Effective on
            <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <div className="row">
            <button disabled={!pick && !manager}>{pick ? 'Save manager' : 'Remove manager'}</button>
            <button type="button" className="secondary" onClick={() => setPanel(null)}>Cancel</button>
          </div>
        </form>
      )}

      {panel === 'tenant' && (
        <TenantForm
          current={tenant}
          onCancel={() => setPanel(null)}
          onSave={async (v) => done(resultError(await setTenant({ property_id: property.id, ...v })))}
          onEnd={async (d) => done(resultError(await endTenant({ property_id: property.id, ended_on: d })))}
        />
      )}

      {panel === 'history' && (
        <ul className="history">
          {history.map((p) => (
            <li key={p.id}>
              <span className={p.ended_on ? 'pill' : 'pill ok'}>{roleLabel[p.role]}</span> <Who p={p} customers={customers} />
              <div className="muted">{p.started_on} → {p.ended_on ?? 'now'}</div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
