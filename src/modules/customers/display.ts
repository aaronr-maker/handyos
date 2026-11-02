import type { Customer, CustomerContact } from './types';

/** The name shown for a customer: display name, else company name, else customer name. */
export function customerLabel(c: Pick<Customer, 'name' | 'display_name' | 'company_name'>): string {
  return c.display_name?.trim() || c.company_name?.trim() || c.name;
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
