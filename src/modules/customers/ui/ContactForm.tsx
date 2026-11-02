import { useState, type FormEvent } from 'react';
import { splitName } from '../display';
import type { CustomerContact } from '../types';

export interface ContactFormValues {
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

interface Props {
  initial?: CustomerContact;
  submitLabel: string;
  onSubmit(values: ContactFormValues): Promise<string | null>;
  onCancel(): void;
}

const blank = (v: string) => (v.trim() === '' ? null : v);

export function ContactForm({ initial, submitLabel, onSubmit, onCancel }: Props) {
  const split = initial ? splitName(initial) : { first: '', last: '' };
  const [first, setFirst] = useState(split.first);
  const [last, setLast] = useState(split.last);
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(await onSubmit({ first_name: blank(first), last_name: blank(last), phone: blank(phone), email: blank(email) }));
  };

  return (
    <form onSubmit={submit} className="subform">
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
        Phone
        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      {error && <p className="err">{error}</p>}
      <div className="row">
        <button>{submitLabel}</button>
        <button type="button" className="secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
