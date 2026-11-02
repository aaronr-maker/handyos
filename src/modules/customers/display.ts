import type { Customer, CustomerContact } from './types';

/** The name shown for a customer, following the customer's "show as" choice (person, company or custom). */
export function customerLabel(c: Pick<Customer, 'name' | 'display_name' | 'company_name' | 'display_name_source'>): string {
  switch (c.display_name_source) {
    case 'company':
      return c.company_name?.trim() || c.name;
    case 'custom':
      return c.display_name?.trim() || c.name;
    default:
      return c.name;
  }
}

export interface ContactInfo {
  name: string;
  phone: string | null;
  email: string | null;
}

/** The contact shown for a customer: the chosen additional contact, or the main contact. */
export function displayContact(c: Customer, contacts: CustomerContact[]): ContactInfo {
  const chosen = c.display_contact_id ? contacts.find((x) => x.id === c.display_contact_id) : undefined;
  return chosen ?? { name: c.name, phone: c.phone, email: c.email };
}

/** "First Last" from whichever parts are present. */
export function fullName(first: string | null | undefined, last: string | null | undefined): string {
  return [first, last].map((x) => x?.trim()).filter(Boolean).join(' ');
}

/**
 * Decides what to store in `name`: first + last when given, else the name as typed, else the company name.
 * Returns '' when nothing usable was given.
 */
export function resolveName(v: {
  name?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  company_name?: string | null;
}): string {
  return fullName(v.first_name, v.last_name) || v.name?.trim() || v.company_name?.trim() || '';
}

/** For older records saved with a single name: guess first and last so the edit form is pre-filled sensibly. */
export function splitName(v: { name: string | null; first_name: string | null; last_name: string | null; company_name?: string | null }) {
  if (v.first_name || v.last_name) return { first: v.first_name ?? '', last: v.last_name ?? '' };
  if (!v.name || v.name === v.company_name) return { first: '', last: '' };
  const [first, ...rest] = v.name.trim().split(/\s+/);
  return { first: first ?? '', last: rest.join(' ') };
}
