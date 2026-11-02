import { useState, type FormEvent } from 'react';
import { splitName } from '../display';
import type { Customer, DisplayNameSource } from '../types';

export interface CustomerFormValues {
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  display_name: string | null;
  display_name_source: DisplayNameSource;
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
  const split = initial ? splitName(initial) : { first: '', last: '' };
  const [first, setFirst] = useState(split.first);
  const [last, setLast] = useState(split.last);
  const [company, setCompany] = useState(initial?.company_name ?? '');
  const [picked, setPicked] = useState<DisplayNameSource | null>(initial ? initial.display_name_source : null);
  // Until the person chooses, the display name picks itself: only a company -> company; otherwise the person.
  const hasPerson = first.trim() !== '' || last.trim() !== '';
  const source: DisplayNameSource = picked ?? (!hasPerson && company.trim() !== '' ? 'company' : 'person');
  const [custom, setCustom] = useState(initial?.display_name ?? '');
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
        first_name: blank(first),
        last_name: blank(last),
        company_name: blank(company),
        display_name: source === 'custom' ? blank(custom) : null,
        display_name_source: source,
        is_property_manager: manager,
        email: blank(email),
        phone: blank(phone),
        notes: blank(notes),
      }),
    );
    setBusy(false);
  };

  const choice = (value: DisplayNameSource, label: string) => (
    <label className="check">
      <input type="checkbox" checked={source === value} onChange={() => setPicked(value)} />
      {label}
    </label>
  );

  return (
    <form className="card" onSubmit={submit}>
      <div className="row">
        <label className="grow">
          First name
          <input value={first} onChange={(e) => setFirst(e.target.value)} autoComplete="off" />
        </label>
        <label className="grow">
          Last name
          <input value={last} onChange={(e) => setLast(e.target.value)} autoComplete="off" />
        </label>
      </div>
      <label>
        Company name <span className="muted">(for a business, leave first/last blank)</span>
        <input value={company} onChange={(e) => setCompany(e.target.value)} autoComplete="off" />
      </label>
      <fieldset>
        <legend>Display name</legend>
        {choice('person', 'Use the person’s name')}
        {choice('company', 'Use the company name')}
        {choice('custom', 'Use a different name')}
        {source === 'custom' && (
          <input placeholder="Display name" value={custom} onChange={(e) => setCustom(e.target.value)} autoComplete="off" />
        )}
      </fieldset>
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
