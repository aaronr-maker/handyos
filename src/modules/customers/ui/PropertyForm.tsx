import { useState, type FormEvent } from 'react';
import { customerLabel } from '../display';
import type { Customer, Property } from '../types';
import type { TenantValues } from './TenantForm';

export interface PropertyFormValues {
  owner_id: string | null;
  manager_id: string | null;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
  tenant: TenantValues | null;
}

interface Props {
  /** When editing, only the address is shown (owner, manager and tenant are changed from the property card). */
  initial?: Property;
  customers: Customer[];
  /** Adding from an owner's page (owner is fixed, manager optional) or from a manager's page (manager fixed, pick the owner). */
  fixed: { kind: 'owner' | 'manager'; id: string };
  submitLabel: string;
  onSubmit(values: PropertyFormValues): Promise<string | null>;
  onCancel?(): void;
}

const blank = (v: string) => (v.trim() === '' ? null : v);

export function PropertyForm({ initial, customers, fixed, submitLabel, onSubmit, onCancel }: Props) {
  const [a, setA] = useState({
    address_line1: initial?.address_line1 ?? '',
    city: initial?.city ?? '',
    state: initial?.state ?? '',
    postal_code: initial?.postal_code ?? '',
  });
  const [other, setOther] = useState('');
  const [tenant, setTenant] = useState({ name: '', company: '', phone: '', email: '' });
  const [error, setError] = useState<string | null>(null);
  const setAddr = (k: keyof typeof a) => (e: { target: { value: string } }) => setA({ ...a, [k]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = { name: blank(tenant.name), company_name: blank(tenant.company), phone: blank(tenant.phone), email: blank(tenant.email) };
    const hasTenant = t.name || t.company_name || t.phone || t.email;
    const res = await onSubmit({
      owner_id: fixed.kind === 'owner' ? fixed.id || null : blank(other),
      manager_id: fixed.kind === 'manager' ? fixed.id : blank(other),
      ...a,
      tenant: initial || !hasTenant ? null : t,
    });
    setError(res);
    if (!res && !initial) {
      setA({ address_line1: '', city: '', state: '', postal_code: '' });
      setOther('');
      setTenant({ name: '', company: '', phone: '', email: '' });
    }
  };

  const choices = customers.filter((c) => (fixed.kind === 'owner' ? c.is_property_manager : c.id !== fixed.id));

  return (
    <form onSubmit={submit} className="subform">
      {!initial && fixed.kind === 'manager' && (
        <label>
          Property owner <span className="muted">(add them as a customer first if they aren't listed)</span>
          <select value={other} onChange={(e) => setOther(e.target.value)}>
            <option value="">Owner not listed yet (we bill the manager)</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {customerLabel(c)}
              </option>
            ))}
          </select>
        </label>
      )}
      {!initial && fixed.kind === 'owner' && choices.length > 0 && (
        <label>
          Property manager <span className="muted">(only if it's a rental someone manages for this owner)</span>
          <select value={other} onChange={(e) => setOther(e.target.value)}>
            <option value="">No manager</option>
            {choices.map((c) => (
              <option key={c.id} value={c.id}>
                {customerLabel(c)}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Street address
        <input required value={a.address_line1} onChange={setAddr('address_line1')} />
      </label>
      <div className="row">
        <input placeholder="City" value={a.city} onChange={setAddr('city')} />
        <input placeholder="State" size={4} value={a.state} onChange={setAddr('state')} />
        <input placeholder="ZIP" size={8} value={a.postal_code} onChange={setAddr('postal_code')} />
      </div>
      {!initial && (
        <fieldset>
          <legend>Tenant (optional)</legend>
          <label>
            Name
            <input value={tenant.name} onChange={(e) => setTenant({ ...tenant, name: e.target.value })} />
          </label>
          <label>
            Company name
            <input value={tenant.company} onChange={(e) => setTenant({ ...tenant, company: e.target.value })} />
          </label>
          <label>
            Phone
            <input type="tel" value={tenant.phone} onChange={(e) => setTenant({ ...tenant, phone: e.target.value })} />
          </label>
          <label>
            Email
            <input type="email" value={tenant.email} onChange={(e) => setTenant({ ...tenant, email: e.target.value })} />
          </label>
        </fieldset>
      )}
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button>{submitLabel}</button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
