import { useState, type FormEvent } from 'react';
import type { PropertyParty } from '../types';

export interface TenantValues {
  name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
}

interface Props {
  current?: PropertyParty;
  onSave(values: { mode: 'correct' | 'replace'; details: TenantValues; effective_on: string }): Promise<string | null>;
  onEnd(date: string): Promise<string | null>;
  onCancel(): void;
}

const blank = (v: string) => (v.trim() === '' ? null : v);
const today = () => new Date().toISOString().slice(0, 10);

/** Set, correct, replace or end the tenant of a property. */
export function TenantForm({ current, onSave, onEnd, onCancel }: Props) {
  const [mode, setMode] = useState<'correct' | 'replace'>(current ? 'correct' : 'replace');
  const [name, setName] = useState(current?.name ?? '');
  const [company, setCompany] = useState(current?.company_name ?? '');
  const [phone, setPhone] = useState(current?.phone ?? '');
  const [email, setEmail] = useState(current?.email ?? '');
  const [date, setDate] = useState(today());
  const [error, setError] = useState<string | null>(null);

  // "New tenant" starts with a blank form; "fix a mistake" restores the current record.
  const choose = (next: 'correct' | 'replace') => {
    setMode(next);
    setName(next === 'correct' ? (current?.name ?? '') : '');
    setCompany(next === 'correct' ? (current?.company_name ?? '') : '');
    setPhone(next === 'correct' ? (current?.phone ?? '') : '');
    setEmail(next === 'correct' ? (current?.email ?? '') : '');
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(
      await onSave({
        mode,
        details: { name: blank(name), company_name: blank(company), phone: blank(phone), email: blank(email) },
        effective_on: date,
      }),
    );
  };

  return (
    <form onSubmit={submit} className="subform">
      {current && (
        <div className="choice">
          <label className="check">
            <input type="radio" checked={mode === 'correct'} onChange={() => choose('correct')} />
            Fix a mistake in the current tenant
          </label>
          <label className="check">
            <input type="radio" checked={mode === 'replace'} onChange={() => choose('replace')} />
            There's a new tenant (the current one is kept in the history)
          </label>
        </div>
      )}
      <label>
        Name
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        Company name
        <input value={company} onChange={(e) => setCompany(e.target.value)} />
      </label>
      <label>
        Phone
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {mode === 'replace' && (
        <label>
          Starting on
          <input type="date" required value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      )}
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button>{mode === 'correct' ? 'Save fix' : 'Save tenant'}</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
        {current && (
          <button
            type="button"
            className="secondary"
            onClick={async () => confirm(`Mark the tenant as moved out on ${date}?`) && setError(await onEnd(date))}
          >
            Moved out
          </button>
        )}
      </div>
    </form>
  );
}
