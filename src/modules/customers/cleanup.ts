import type { Customer } from './types';

/** True when a "name" is really just a phone number (or nothing at all): digits and the usual phone punctuation only. */
export const looksLikePhone = (text: string | null | undefined): boolean => {
  const t = (text ?? '').trim();
  return t === '' || (/^[+()\-.\s\d]+$/.test(t) && t.replace(/\D/g, '').length >= 7);
};

/**
 * Customers that are only a phone number: no real name (the name is blank or just digits, and there is no first/last name and no
 * company) and no address. These are the leftovers worth sweeping up. `hasAddress` says which customers have an address.
 */
export function phoneOnlyCustomers(all: Customer[], hasAddress: (customerId: string) => boolean): Customer[] {
  // a name field that is blank, or only a phone number (imports often put the number in the name), is not a real name
  const noRealName = (v: string | null | undefined) => looksLikePhone(v);
  return all.filter((c) => !hasAddress(c.id) && [c.name, c.first_name, c.last_name, c.company_name, c.display_name].every(noRealName));
}
