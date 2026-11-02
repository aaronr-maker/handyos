import { useState, type FormEvent } from 'react';
import type { Customer } from '../types';

export interface CustomerFormValues {
  name: string;
  display_name: string | null;
  company_name: string | null;
  is_property_manager: boolean;
  email: string | null;
  phone: string | null;
  notes: string | null;
}

interface Props {
  initial?: Customer;
  submitLabel: string;
  onSubmit(values: CustomerFormValues): Promise<string | null>;
  onCancel?(): void;
}

const blank = (v: string) => (v.trim() === '' ? null : v);

export function CustomerForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [displayName, setDisplayName] = useState(initial?.display_name ?? '');
  const [company, setCompany] = useState(initial?.company_name ?? '');
  const [manager, setManager] = useState(initial?.is_property_manager ?? false);
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(
      await onSubmit({
        name,
        display_name: blank(displayName),
        company_name: blank(company),
        is_property_manager: manager,
        email: blank(email),
        phone: blank(phone),
        notes: blank(notes),
      }),
    );
    setBusy(false);
  };

  return (
    <form className="card" onSubmit={submit}>
      <label>
        Customer name
        <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Display name <span className="muted">(optional, shown instead of the name)</span>
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="off" />
      </label>
      <label>
        Company name <span className="muted">(optional)</span>
        <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="off" />
      </label>
      <label className="check">
        <input type="checkbox" checked={manager} onChange={(e) => setManager(e.target.checked)} />
        Property manager <span className="muted">(manages properties for other owners)</span>
      </label>
      <label>
        Phone
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label>
        Notes
        <textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button disabled={busy}>{busy ? 'Saving…' : submitLabel}</button>
        {onCancel && (
          <button type="button" className="secondary" onClick={onCancel}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
