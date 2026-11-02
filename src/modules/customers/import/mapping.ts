import { splitName } from '../display';
import type { DisplayNameSource } from '../types';

export interface ImportAddress {
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
}

/** One customer ready to import, after mapping a CSV row. */
export interface ImportRow {
  /** Id in the system it came from (e.g. "hcp:123"); makes re-imports safe. */
  external_ref: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  display_name: string | null;
  display_name_source: DisplayNameSource;
  is_property_manager: boolean;
  email: string | null;
  phone: string | null;
  notes: string | null;
  addresses: ImportAddress[];
}

export const FIELDS = [
  'external_id', 'first_name', 'last_name', 'display_name', 'company', 'email', 'phone', 'street', 'city', 'state', 'zip', 'notes', 'role', 'tags',
] as const;
export type Field = (typeof FIELDS)[number];
export type Mapping = Record<Field, string | null>;

export const FIELD_LABELS: Record<Field, string> = {
  external_id: 'ID in the old system',
  first_name: 'First name',
  last_name: 'Last name',
  display_name: 'Display / full name',
  company: 'Company',
  email: 'Email',
  phone: 'Phone',
  street: 'Street address (single-address files)',
  city: 'City',
  state: 'State',
  zip: 'ZIP',
  notes: 'Notes',
  role: 'Role',
  tags: 'Tags',
};

/** Header names (lowercased, letters and digits only) each field is recognised by, in priority order. */
const ALIASES: Record<Field, string[]> = {
  external_id: ['id', 'customerid', 'clientid'],
  first_name: ['firstname', 'first', 'givenname'],
  last_name: ['lastname', 'last', 'surname', 'familyname'],
  display_name: ['displayname', 'name', 'fullname', 'customername', 'clientname', 'contactname'],
  company: ['company', 'companyname', 'business', 'businessname', 'organization'],
  email: ['email', 'emailaddress', 'mainemail', 'primaryemail', 'email1'],
  phone: ['mobilenumber', 'mobile', 'mobilephone', 'cell', 'cellphone', 'phone', 'phonenumber', 'mainphone', 'primaryphone', 'homenumber', 'home', 'homephone', 'worknumber', 'work', 'workphone'],
  street: ['street', 'street1', 'streetaddress', 'address', 'address1', 'addressline1', 'servicestreet', 'propertystreet'],
  city: ['city', 'town', 'servicecity'],
  state: ['state', 'province', 'stateprovince', 'region', 'servicestate'],
  zip: ['zip', 'zipcode', 'postalcode', 'postal', 'postcode', 'servicezip'],
  notes: ['notes', 'note', 'customernotes', 'clientnotes', 'comments'],
  role: ['role'],
  tags: ['tags'],
};

/** Other phone columns, so numbers beyond the mapped "Phone" are kept in the notes instead of lost. */
const PHONE_COLUMNS = new Set(['mobilenumber', 'mobile', 'mobilephone', 'cell', 'cellphone', 'phone', 'phonenumber', 'homenumber', 'home', 'homephone', 'worknumber', 'work', 'workphone']);

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Picks the best matching column for each field from the file's header row. */
export function autoMap(headers: string[]): Mapping {
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!byNorm.has(norm(h))) byNorm.set(norm(h), h);
  const mapping = {} as Mapping;
  for (const f of FIELDS) mapping[f] = ALIASES[f].map((a) => byNorm.get(a)).find(Boolean) ?? null;
  return mapping;
}

/** Housecall Pro exports one set of columns per address: "Address_1 Street Line 1", "Address_2 City", ... */
const BLOCK = /^Address_(\d+) Street Line 1$/;
export function addressBlocks(headers: string[]): number[] {
  return headers.flatMap((h) => {
    const m = BLOCK.exec(h);
    return m ? [Number(m[1])] : [];
  });
}

/** Which program the file looks like it came from. */
export function detectSource(headers: string[]): 'Housecall Pro' | 'Other' {
  return addressBlocks(headers).length > 0 && headers.includes('Customer is Contractor') ? 'Housecall Pro' : 'Other';
}

const clean = (v: string | undefined) => {
  const t = (v ?? '').trim();
  return t === '' ? null : t;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PROPERTY_MANAGER = /propert\w*\s*manag/i;
const same = (a: string | null, b: string | null) => !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

export interface MappedRow {
  row: ImportRow | null;
  /** Why the row can't be imported (no name). */
  error: string | null;
  /** Things that were dropped or adjusted but don't block the row. */
  warnings: string[];
}

/** Turns one CSV row (header -> value) into an ImportRow. `source` adds ids/prefixes for known programs. */
export function mapRow(record: Record<string, string>, headers: string[], mapping: Mapping, source: 'Housecall Pro' | 'Other' = 'Other'): MappedRow {
  const get = (f: Field) => (mapping[f] ? clean(record[mapping[f]!]) : null);
  const col = (h: string) => clean(record[h]);
  const warnings: string[] = [];

  let first = get('first_name');
  let last = get('last_name');
  let company = get('company');
  const display = get('display_name');
  const isBusiness = col('Customer Type')?.toLowerCase() === 'business';
  if (!first && !last) {
    if (!company && display) {
      if (isBusiness) company = display;
      else {
        const s = splitName({ name: display, first_name: null, last_name: null });
        first = clean(s.first);
        last = clean(s.last);
      }
    } else if (company && display && !same(display, company)) {
      const s = splitName({ name: display, first_name: null, last_name: null });
      first = clean(s.first);
      last = clean(s.last);
    }
  }
  if (!first && !last && !company) return { row: null, error: 'No name or company', warnings };

  const person = [first, last].filter(Boolean).join(' ');
  let source_: DisplayNameSource = 'person';
  let customDisplay: string | null = null;
  if (!person) source_ = 'company';
  else if (display && !same(display, person) && !same(display, company)) {
    source_ = 'custom';
    customDisplay = display;
  } else if (display && same(display, company) && !same(display, person)) source_ = 'company';

  let email = get('email');
  if (email && !EMAIL.test(email)) {
    warnings.push(`Ignored invalid email "${email}"`);
    email = null;
  }

  const phone = get('phone');
  const notes: (string | null)[] = [];
  if (col('Do Not Service')?.toLowerCase() === 'true') notes.push('DO NOT SERVICE (from old system)');
  notes.push(get('notes'));
  for (const h of headers) {
    if (h !== mapping.phone && PHONE_COLUMNS.has(norm(h))) {
      const extra = clean(record[h]);
      if (extra && extra !== phone) notes.push(`${h}: ${extra}`);
    }
  }
  const extraEmails = col('Additional Emails');
  if (extraEmails) notes.push(`Other emails: ${extraEmails}`);

  const role = get('role');
  const tags = get('tags');
  const isManager = PROPERTY_MANAGER.test(`${role ?? ''} ${tags ?? ''}`);
  if (role && !isManager) notes.push(`Role: ${role}`);
  if (tags) notes.push(`Tags: ${tags}`);
  const lead = col('Lead Source');
  if (lead) notes.push(`Lead source: ${lead}`);

  const addresses: ImportAddress[] = [];
  const seen = new Set<string>();
  const add = (street: string | null, street2: string | null, city: string | null, state: string | null, zip: string | null, billing: boolean, addrNote: string | null) => {
    if (!street) return;
    const line = [street, street2].filter(Boolean).join(', ');
    const key = `${line}|${zip ?? ''}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const a = { address_line1: line, city: city ?? '', state: state ?? '', postal_code: zip ?? '' };
    if (billing) billingOnly.push({ a, addrNote });
    else addresses.push(a);
    if (addrNote) notes.push(`Address note (${line}): ${addrNote}`);
  };
  const billingOnly: { a: ImportAddress; addrNote: string | null }[] = [];

  const blocks = addressBlocks(headers);
  if (blocks.length > 0) {
    for (const n of blocks) {
      const p = `Address_${n} `;
      add(col(p + 'Street Line 1'), col(p + 'Street Line 2'), col(p + 'City'), col(p + 'State'), col(p + 'Postal Code'), col(p + 'Billing?')?.toLowerCase() === 'true', col(p + 'Notes'));
    }
  } else {
    add(get('street'), null, get('city'), get('state'), get('zip'), false, null);
  }
  // A billing-flagged address is usually where bills are mailed. Keep it as a property only when it is the
  // customer's only address; otherwise keep it in the notes so nothing is lost.
  const fmt = (a: ImportAddress) => [a.address_line1, a.city, a.state, a.postal_code].filter(Boolean).join(', ');
  if (addresses.length === 0 && billingOnly.length > 0) addresses.push(...billingOnly.map((b) => b.a));
  else for (const b of billingOnly) notes.push(`Billing address: ${fmt(b.a)}`);

  const id = get('external_id');
  return {
    row: {
      external_ref: id ? `${source === 'Housecall Pro' ? 'hcp' : 'import'}:${id}` : null,
      first_name: first,
      last_name: last,
      company_name: company,
      display_name: customDisplay,
      display_name_source: source_,
      is_property_manager: isManager,
      email,
      phone,
      notes: notes.filter(Boolean).join('\n') || null,
      addresses,
    },
    error: null,
    warnings,
  };
}

const digits = (v: string | null) => (v ?? '').replace(/\D/g, '').slice(-10);

/**
 * Keys that identify "the same customer". A customer with an id from the old system is matched on that id
 * alone (two real customers can share a phone number). Otherwise: email, phone, or name + street.
 */
export function duplicateKeys(r: {
  external_ref?: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  street?: string | null;
}): string[] {
  if (r.external_ref) return [`x:${r.external_ref}`];
  const keys: string[] = [];
  if (r.email) keys.push(`e:${r.email.toLowerCase()}`);
  if (digits(r.phone).length >= 7) keys.push(`p:${digits(r.phone)}`);
  if (keys.length === 0) {
    const name = [r.first_name, r.last_name, r.company_name].filter(Boolean).join(' ').toLowerCase();
    keys.push(`n:${name}|${(r.street ?? '').toLowerCase()}`);
  }
  return keys;
}
