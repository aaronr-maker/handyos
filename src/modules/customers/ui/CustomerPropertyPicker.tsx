import { useMemo, useState } from 'react';
import { useAsync, useSession } from '@/core';
import { customerLabel } from '../display';
import { getPropertyBilling, listCustomers, listPropertiesFor } from '../services/customerService';

export interface WhoValue {
  customerId: string;
  propertyId: string;
}

interface Props {
  value: WhoValue;
  onChange(v: WhoValue): void;
  /** Shown when nothing is chosen yet. */
  placeholder?: string;
}

/**
 * Pick a customer and (optionally) one of their properties. When a property is chosen the billing rule is shown:
 * rentals are billed to the property manager and labeled as owed by the owner. Shared by estimates, jobs and invoices.
 */
export function CustomerPropertyPicker({ value, onChange, placeholder = 'Choose a customer…' }: Props) {
  const { companyId } = useSession();
  const [search, setSearch] = useState('');
  const customers = useAsync(() => listCustomers(companyId), [companyId]);
  const props = useAsync(async () => (value.customerId ? listPropertiesFor(companyId, value.customerId) : []), [companyId, value.customerId]);
  const billing = useAsync(async () => (value.propertyId ? getPropertyBilling(companyId, value.propertyId) : null), [companyId, value.propertyId]);

  const all = useMemo(() => customers.data ?? [], [customers.data]);
  const name = (id: string) => {
    const c = all.find((x) => x.id === id);
    return c ? customerLabel(c) : '';
  };
  const matches = useMemo(() => {
    const q = search.trim().toLowerCase();
    const found = all.filter((c) => !q || `${customerLabel(c)} ${c.name} ${c.phone ?? ''} ${c.email ?? ''}`.toLowerCase().includes(q)).slice(0, 50);
    // keep the chosen customer visible even when the search no longer matches them
    const chosen = all.find((c) => c.id === value.customerId);
    return chosen && !found.includes(chosen) ? [chosen, ...found] : found;
  }, [all, search, value.customerId]);

  return (
    <div>
      <label>
        Customer
        <input type="search" placeholder="Search customers" value={search} onChange={(e) => setSearch(e.target.value)} />
      </label>
      <select value={value.customerId} onChange={(e) => onChange({ customerId: e.target.value, propertyId: '' })}>
        <option value="">{placeholder}</option>
        {matches.map((c) => (
          <option key={c.id} value={c.id}>
            {customerLabel(c)}
            {c.phone ? ` · ${c.phone}` : ''}
          </option>
        ))}
      </select>
      {value.customerId && (
        <label>
          Property <span className="muted">(optional; billing follows the property's owner and manager)</span>
          <select value={value.propertyId} onChange={(e) => onChange({ ...value, propertyId: e.target.value })}>
            <option value="">No specific property</option>
            {(props.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.address_line1}
                {p.city ? `, ${p.city}` : ''}
              </option>
            ))}
          </select>
        </label>
      )}
      {value.propertyId && billing.data && (
        <p className="notice">
          Billed to <strong>{name(billing.data.billToId)}</strong>
          {billing.data.owedById !== billing.data.billToId && (
            <>
              {' '}
              · owed by <strong>{name(billing.data.owedById)}</strong>
            </>
          )}
        </p>
      )}
      {value.propertyId && !billing.loading && !billing.data && <p className="err">This property has no owner or property manager to bill.</p>}
    </div>
  );
}
