import { useState, type FormEvent } from 'react';
import type { CustomerContact } from '../types';

export interface ContactFormValues {
  name: string;
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
  const [name, setName] = useState(initial?.name ?? '');
  const [phone, setPhone] = useState(initial?.phone ?? '');
  const [email, setEmail] = useState(initial?.email ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(await onSubmit({ name, phone: blank(phone), email: blank(email) }));
  };

  return (
    <form onSubmit={submit} className="subform">
      <label>
        Contact name
        <input required value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
      </label>
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
