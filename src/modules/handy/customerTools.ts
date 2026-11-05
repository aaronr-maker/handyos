import type { Id } from '@/core';
import {
  addContactAction,
  createCustomerAction,
  customerLabel,
  getCustomer,
  getProperty,
  listAllContacts,
  listAllProperties,
  listCustomers,
  updateContactAction,
  updateCustomerAction,
  updatePropertyAction,
} from '@/modules/customers';
import type { Refs, WireTool } from './chat';

/**
 * What Handy can do with customer records, as the office assistant: look customers and properties up, create a customer, change
 * any of a customer's details, add or change their contacts, and correct an address. Every change shows a card with what changes
 * (old and new) and is saved by the person who approved it. Contact details Handy relays (emails, phones) go to the app, not
 * the other way: searches tell him only whether someone can be texted or emailed.
 */
export interface CustomerToolContext {
  companyId: Id;
}
type Args = Record<string, unknown>;
type Result = { status: string; message?: string };
type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

const str = (v: unknown) => (v === undefined || v === null ? undefined : String(v).trim());
const tool = (name: string, description: string, properties: Record<string, unknown>, required: string[] = []): WireTool => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });
const text = (description: string) => ({ type: 'string', description });
const customerRef = text("The customer's ID (C-...). Use find_customer if you do not have it.");

const FIELDS = {
  first_name: text('First name of a person.'),
  last_name: text('Last name of a person.'),
  company_name: text('Business name.'),
  display_name: text('A custom display name.'),
  display_name_source: { type: 'string', enum: ['person', 'company', 'custom'], description: 'Which name to show: the person, the company, or the custom display name.' },
  email: text('Email address.'),
  phone: text('Phone number.'),
  notes: text('Notes about the customer.'),
  is_property_manager: { type: 'boolean' },
};

export const CUSTOMER_READ_TOOLS: WireTool[] = [
  tool('find_customer', "Find a customer by name, company, email address or phone number, and get the customer's ID. Use this whenever you need a customer's ID and do not already have it; never make an ID up.", { query: text('What to search for.') }, ['query']),
  tool('customer_details', "A customer's contacts, properties (with their IDs) and whether they can be texted or emailed. Contact details themselves are not shown.", { customer: customerRef }, ['customer']),
  tool('find_property', 'Find a property by street address and get its ID and who owns and manages it.', { query: text('Part of the street address.') }, ['query']),
];

export const CUSTOMER_ACTION_TOOLS: WireTool[] = [
  tool('create_customer', 'Add a new customer (a person, or a business).', { ...FIELDS }),
  tool('update_customer', "Change any of a customer's details. Only the fields you give are changed. Use an empty string to clear email, phone, notes or company.", { customer: customerRef, ...FIELDS }, ['customer']),
  tool('add_customer_contact', 'Add another contact (name, phone, email) to a customer.', { customer: customerRef, first_name: FIELDS.first_name, last_name: FIELDS.last_name, phone: FIELDS.phone, email: FIELDS.email }, ['customer']),
  tool('update_contact', "Change one of a customer's contacts. Give the contact's ID (K-...) from customer_details, or the contact's name. Only the fields you give are changed.", { customer: customerRef, contact: text("The contact's ID (K-...) or name."), first_name: FIELDS.first_name, last_name: FIELDS.last_name, phone: FIELDS.phone, email: FIELDS.email }, ['customer', 'contact']),
  tool('update_address', "Correct a property's street address. Give the property's ID (P-...) from find_property or customer_details.", { property: text("The property's ID (P-...)."), address_line1: text('Street address.'), city: text('City.'), state: text('State.'), postal_code: text('ZIP code.') }, ['property']),
];

export const CUSTOMER_ACTIONS = new Set(['create_customer', 'update_customer', 'add_customer_contact', 'update_contact', 'update_address']);

// ---- looking things up ----
const norm = (v: string | null | undefined) => (v ?? '').toLowerCase();

export async function readCustomerTool(ctx: CustomerToolContext, name: string, args: Args, refs: Refs): Promise<unknown> {
  if (name === 'find_customer') {
    const q = (str(args.query) ?? '').toLowerCase();
    if (q.length < 2) throw new Error('What should I search for?');
    const digits = q.replace(/\D/g, '');
    const found = (await listCustomers(ctx.companyId)).filter((c) => [c.name, c.display_name, c.company_name, [c.first_name, c.last_name].filter(Boolean).join(' '), c.email].some((v) => norm(v).includes(q)) || (digits.length >= 7 && (c.phone ?? '').replace(/\D/g, '').includes(digits)));
    return found.slice(0, 8).map((c) => ({ customer: customerLabel(c), can_text: !!c.phone, can_email: !!c.email }));
  }
  if (name === 'customer_details') {
    const c = await customerFor(ctx, args, refs);
    const [contacts, properties] = await Promise.all([listAllContacts(ctx.companyId), listAllProperties(ctx.companyId)]);
    return {
      customer: customerLabel(c),
      can_text: !!c.phone,
      can_email: !!c.email,
      property_manager: c.is_property_manager,
      has_notes: !!c.notes,
      contacts: contacts.filter((k) => k.customer_id === c.id).map((k) => ({ contact: k.name, can_text: !!k.phone, can_email: !!k.email })),
      properties: properties.filter((p) => p.customer_id === c.id).map((p) => ({ property: p.address_line1, city: p.city })),
    };
  }
  if (name === 'find_property') {
    const q = (str(args.query) ?? '').toLowerCase();
    if (q.length < 3) throw new Error('Part of the street address, please.');
    const [properties, customers] = await Promise.all([listAllProperties(ctx.companyId), listCustomers(ctx.companyId)]);
    const label = (id: Id | null) => {
      const c = customers.find((x) => x.id === id);
      return c ? customerLabel(c) : null;
    };
    return properties.filter((p) => norm(p.address_line1).includes(q)).slice(0, 8).map((p) => ({ property: p.address_line1, city: p.city, owner: label(p.customer_id) }));
  }
  throw new Error(`I don't have a tool called ${name}.`);
}

// ---- resolving what Handy means ----
export async function customerFor(ctx: CustomerToolContext, args: Args, refs: Refs): Promise<Customer> {
  const ref = refs('customer');
  if (ref?.kind === 'customer') {
    const c = await getCustomer(ctx.companyId, ref.id);
    if (c) return c;
  }
  const said = (str(args.customer) ?? '').toLowerCase();
  const all = (await listCustomers(ctx.companyId)).filter((c) => customerLabel(c).toLowerCase() === said || c.name.toLowerCase() === said);
  if (all.length === 1) return all[0];
  throw new Error(all.length > 1 ? 'More than one customer has that name. Use the customer ID.' : 'I could not tell which customer that is. Use find_customer.');
}

async function contactFor(ctx: CustomerToolContext, c: Customer, args: Args, refs: Refs) {
  const contacts = (await listAllContacts(ctx.companyId)).filter((k) => k.customer_id === c.id);
  const ref = refs('contact');
  if (ref?.kind === 'contact') {
    const hit = contacts.find((k) => k.id === ref.id);
    if (hit) return hit;
  }
  const said = (str(args.contact) ?? '').toLowerCase();
  const byName = contacts.filter((k) => k.name.toLowerCase() === said);
  if (byName.length === 1) return byName[0];
  throw new Error(byName.length > 1 ? 'More than one contact has that name.' : `${customerLabel(c)} has no contact like that.`);
}

async function propertyFor(ctx: CustomerToolContext, args: Args, refs: Refs) {
  const ref = refs('property');
  if (ref?.kind === 'property') {
    const p = await getProperty(ctx.companyId, ref.id);
    if (p) return p;
  }
  const said = (str(args.property) ?? '').toLowerCase();
  const all = (await listAllProperties(ctx.companyId)).filter((p) => p.address_line1.toLowerCase() === said);
  if (all.length === 1) return all[0];
  throw new Error('I could not tell which property that is. Use find_property.');
}

// ---- checking what Handy wants to put in ----
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
function cleanEmail(v: string): string | null {
  if (v === '') return null;
  if (!EMAIL.test(v)) throw new Error(`"${v}" does not look like an email address.`);
  return v;
}
function cleanPhone(v: string): string | null {
  if (v === '') return null;
  if (v.replace(/\D/g, '').length < 10) throw new Error(`"${v}" does not look like a full phone number.`);
  return v;
}
const orNull = (v: string) => (v === '' ? null : v);

/** The customer's fields after the changes Handy asked for (and a list of what changes, for the card). */
function mergeCustomer(c: Customer, args: Args) {
  const next = {
    first_name: c.first_name,
    last_name: c.last_name,
    company_name: c.company_name,
    display_name: c.display_name,
    display_name_source: c.display_name_source,
    email: c.email,
    phone: c.phone,
    notes: c.notes,
    is_property_manager: c.is_property_manager,
  };
  const changes: string[] = [];
  const set = <K extends keyof typeof next>(key: K, label: string, value: (typeof next)[K]) => {
    if (next[key] !== value) {
      changes.push(`${label}: ${next[key] ?? '(none)'} → ${value ?? '(cleared)'}`);
      next[key] = value;
    }
  };
  const get = (k: string) => str(args[k]);
  if (get('first_name') !== undefined) set('first_name', 'first name', orNull(get('first_name')!));
  if (get('last_name') !== undefined) set('last_name', 'last name', orNull(get('last_name')!));
  if (get('company_name') !== undefined) set('company_name', 'company', orNull(get('company_name')!));
  if (get('display_name') !== undefined) set('display_name', 'display name', orNull(get('display_name')!));
  const source = get('display_name_source');
  if (source !== undefined) {
    if (!['person', 'company', 'custom'].includes(source)) throw new Error('The display name can show the person, the company or a custom name.');
    set('display_name_source', 'shown as', source as Customer['display_name_source']);
  }
  if (get('email') !== undefined) set('email', 'email', cleanEmail(get('email')!));
  if (get('phone') !== undefined) set('phone', 'phone', cleanPhone(get('phone')!));
  if (get('notes') !== undefined) set('notes', 'notes', orNull(get('notes')!));
  if (typeof args.is_property_manager === 'boolean') set('is_property_manager', 'property manager', args.is_property_manager);
  if (changes.length === 0) throw new Error('Nothing to change: tell me what the new details are.');
  return { next, changes };
}

/** What the confirmation card shows. */
export async function describeCustomerAction(ctx: CustomerToolContext, name: string, args: Args, refs: Refs): Promise<string> {
  if (name === 'create_customer') {
    const who = [str(args.first_name), str(args.last_name)].filter(Boolean).join(' ') || str(args.company_name);
    if (!who) throw new Error('A new customer needs a name or a company name.');
    const bits = [str(args.email) ? `email ${cleanEmail(str(args.email)!)}` : '', str(args.phone) ? `phone ${cleanPhone(str(args.phone)!)}` : ''].filter(Boolean);
    return `Add a new customer: ${who}${bits.length ? ` (${bits.join(', ')})` : ''}.`;
  }
  if (name === 'update_customer') {
    const c = await customerFor(ctx, args, refs);
    return `Change ${customerLabel(c)}: ${mergeCustomer(c, args).changes.join('; ')}.`;
  }
  if (name === 'add_customer_contact') {
    const c = await customerFor(ctx, args, refs);
    const who = [str(args.first_name), str(args.last_name)].filter(Boolean).join(' ');
    if (!who) throw new Error('A contact needs a name.');
    return `Add ${who} as a contact for ${customerLabel(c)}.`;
  }
  if (name === 'update_contact') {
    const c = await customerFor(ctx, args, refs);
    const k = await contactFor(ctx, c, args, refs);
    return `Change ${k.name} (a contact of ${customerLabel(c)}): ${contactPatch(k, args).changes.join('; ')}.`;
  }
  if (name === 'update_address') {
    const p = await propertyFor(ctx, args, refs);
    return `Correct the address ${p.address_line1}, ${p.city}: ${addressPatch(p, args).changes.join('; ')}.`;
  }
  return name;
}

function contactPatch(k: { first_name: string | null; last_name: string | null; phone: string | null; email: string | null; name: string }, args: Args) {
  const next = { first_name: k.first_name, last_name: k.last_name, phone: k.phone, email: k.email };
  const changes: string[] = [];
  const set = <K extends keyof typeof next>(key: K, label: string, value: (typeof next)[K]) => {
    if (next[key] !== value) {
      changes.push(`${label}: ${next[key] ?? '(none)'} → ${value ?? '(cleared)'}`);
      next[key] = value;
    }
  };
  if (str(args.first_name) !== undefined) set('first_name', 'first name', orNull(str(args.first_name)!));
  if (str(args.last_name) !== undefined) set('last_name', 'last name', orNull(str(args.last_name)!));
  if (str(args.phone) !== undefined) set('phone', 'phone', cleanPhone(str(args.phone)!));
  if (str(args.email) !== undefined) set('email', 'email', cleanEmail(str(args.email)!));
  if (changes.length === 0) throw new Error('Nothing to change: tell me what the new details are.');
  return { next, changes };
}

function addressPatch(p: { address_line1: string; city: string; state: string; postal_code: string }, args: Args) {
  const next = { address_line1: p.address_line1, city: p.city, state: p.state, postal_code: p.postal_code };
  const changes: string[] = [];
  for (const [key, label] of [['address_line1', 'street'], ['city', 'city'], ['state', 'state'], ['postal_code', 'ZIP']] as const) {
    const v = str(args[key]);
    if (v !== undefined && v !== '' && v !== next[key]) {
      changes.push(`${label}: ${next[key]} → ${v}`);
      next[key] = v;
    }
  }
  if (changes.length === 0) throw new Error('Nothing to change: tell me the corrected address.');
  return { next, changes };
}

/** Does it, as the person who approved the card. Returns what happened in words. */
export async function runCustomerAction(ctx: CustomerToolContext, name: string, args: Args, refs: Refs, asPerson: (action: string, input: unknown) => Promise<Result>): Promise<string> {
  const ok = (r: Result, done: string) => {
    if (r.status === 'ok') return done;
    throw new Error(r.status === 'pending_approval' ? 'That needs an owner or admin to approve it first.' : (r.message ?? 'It did not work.'));
  };
  if (name === 'create_customer') {
    const input = {
      first_name: orNull(str(args.first_name) ?? ''),
      last_name: orNull(str(args.last_name) ?? ''),
      company_name: orNull(str(args.company_name) ?? ''),
      display_name: orNull(str(args.display_name) ?? ''),
      display_name_source: ['person', 'company', 'custom'].includes(String(args.display_name_source)) ? args.display_name_source : str(args.company_name) && !str(args.first_name) && !str(args.last_name) ? 'company' : 'person',
      email: str(args.email) ? cleanEmail(str(args.email)!) : null,
      phone: str(args.phone) ? cleanPhone(str(args.phone)!) : null,
      notes: orNull(str(args.notes) ?? ''),
      is_property_manager: args.is_property_manager === true,
    };
    if (!input.first_name && !input.last_name && !input.company_name) throw new Error('A new customer needs a name or a company name.');
    return ok(await asPerson(createCustomerAction.name, input), `Added ${[input.first_name, input.last_name].filter(Boolean).join(' ') || input.company_name} as a customer.`);
  }
  if (name === 'update_customer') {
    const c = await customerFor(ctx, args, refs);
    const { next, changes } = mergeCustomer(c, args);
    return ok(await asPerson(updateCustomerAction.name, { customer_id: c.id, ...next }), `Updated ${customerLabel(c)}: ${changes.length} change${changes.length === 1 ? '' : 's'} saved.`);
  }
  if (name === 'add_customer_contact') {
    const c = await customerFor(ctx, args, refs);
    const input = { customer_id: c.id, first_name: orNull(str(args.first_name) ?? ''), last_name: orNull(str(args.last_name) ?? ''), phone: str(args.phone) ? cleanPhone(str(args.phone)!) : null, email: str(args.email) ? cleanEmail(str(args.email)!) : null };
    if (!input.first_name && !input.last_name) throw new Error('A contact needs a name.');
    return ok(await asPerson(addContactAction.name, input), `Added a contact to ${customerLabel(c)}.`);
  }
  if (name === 'update_contact') {
    const c = await customerFor(ctx, args, refs);
    const k = await contactFor(ctx, c, args, refs);
    const { next } = contactPatch(k, args);
    return ok(await asPerson(updateContactAction.name, { contact_id: k.id, ...next }), `Updated the contact on ${customerLabel(c)}.`);
  }
  if (name === 'update_address') {
    const p = await propertyFor(ctx, args, refs);
    const { next } = addressPatch(p, args);
    return ok(await asPerson(updatePropertyAction.name, { property_id: p.id, ...next }), 'Corrected the address.');
  }
  throw new Error(`I can't do ${name}.`);
}
