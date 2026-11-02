import { createRepo, type Id } from '@/core';
import type { Customer, CustomerContact, PartyRole, Property, PropertyParty } from '../types';

const customers = createRepo<Customer>('customers');
const contacts = createRepo<CustomerContact>('customer_contacts');
const properties = createRepo<Property>('properties');
const parties = createRepo<PropertyParty>('property_parties');

export type CustomerFields = Pick<Customer, 'name' | 'first_name' | 'last_name' | 'display_name' | 'display_name_source' | 'company_name' | 'is_property_manager' | 'email' | 'phone' | 'notes'>;
export type ContactFields = Pick<CustomerContact, 'name' | 'first_name' | 'last_name' | 'phone' | 'email'>;
export type Address = Pick<Property, 'address_line1' | 'city' | 'state' | 'postal_code'>;
/** Who an owner or tenant is. At least a name or company name. */
export type PartyDetails = Pick<PropertyParty, 'name' | 'first_name' | 'last_name' | 'company_name' | 'phone' | 'email'>;

const today = () => new Date().toISOString().slice(0, 10);

export const createCustomer = (companyId: Id, data: CustomerFields) =>
  customers.insert(companyId, { ...data, display_contact_id: null });
export const updateCustomer = (companyId: Id, id: Id, data: CustomerFields) => customers.update(companyId, id, data);
export const getCustomer = (companyId: Id, id: Id) => customers.get(companyId, id);
export const listCustomers = (companyId: Id) => customers.list(companyId, { orderBy: 'name' });
/** Pass null to make the main contact the display contact. */
export const setDisplayContact = (companyId: Id, customerId: Id, contactId: Id | null) =>
  customers.update(companyId, customerId, { display_contact_id: contactId });

/**
 * A business customer with no person of its own (company name only) has no one to show as the main contact.
 * When it has exactly one additional contact, that contact becomes the main contact automatically.
 */
async function autoSelectOnlyContact(companyId: Id, customerId: Id): Promise<void> {
  const customer = await customers.get(companyId, customerId);
  if (!customer || customer.first_name || customer.last_name || !customer.company_name) return;
  const all = await contacts.list(companyId, { where: { customer_id: customerId } });
  if (all.length === 1 && customer.display_contact_id !== all[0].id) {
    await customers.update(companyId, customerId, { display_contact_id: all[0].id });
  }
}

export async function addContact(companyId: Id, customerId: Id, data: ContactFields) {
  const contact = await contacts.insert(companyId, { ...data, customer_id: customerId });
  await autoSelectOnlyContact(companyId, customerId);
  return contact;
}
export const getContact = (companyId: Id, id: Id) => contacts.get(companyId, id);
export const updateContact = (companyId: Id, id: Id, data: ContactFields) => contacts.update(companyId, id, data);
export const listContacts = (companyId: Id, customerId: Id) =>
  contacts.list(companyId, { where: { customer_id: customerId }, orderBy: 'name' });
export const listAllContacts = (companyId: Id) => contacts.list(companyId);
export async function removeContact(companyId: Id, id: Id): Promise<void> {
  const contact = await contacts.get(companyId, id);
  if (!contact) return;
  const customer = await customers.get(companyId, contact.customer_id);
  // The database does this itself; doing it here keeps demo mode consistent.
  if (customer?.display_contact_id === id) await customers.update(companyId, customer.id, { display_contact_id: null });
  await contacts.remove(companyId, id);
  await autoSelectOnlyContact(companyId, contact.customer_id);
}

export const getProperty = (companyId: Id, id: Id) => properties.get(companyId, id);
export const updateAddress = (companyId: Id, id: Id, data: Address) => properties.update(companyId, id, data);
/** Properties currently owned by this customer. */
export const listProperties = (companyId: Id, customerId: Id) =>
  properties.list(companyId, { where: { customer_id: customerId }, orderBy: 'address_line1' });
export const listAllProperties = (companyId: Id) => properties.list(companyId);
export const listAllParties = (companyId: Id) => parties.list(companyId);

const noDetails: PartyDetails = { name: null, first_name: null, last_name: null, company_name: null, phone: null, email: null };

async function currentParty(companyId: Id, propertyId: Id, role: PartyRole) {
  const rows = await parties.list(companyId, { where: { property_id: propertyId, role } });
  return rows.find((r) => r.ended_on === null);
}

/**
 * Ends whoever currently holds an owner/manager role and (optionally) starts a new holder.
 * If starting the new holder fails, the old one is put back.
 */
async function switchHolder(companyId: Id, propertyId: Id, role: 'owner' | 'manager', newCustomerId: Id | null, effectiveOn: string) {
  const current = await currentParty(companyId, propertyId, role);
  if (current) {
    if (effectiveOn < current.started_on) throw new Error(`The date cannot be before the previous ${role} started`);
    await parties.update(companyId, current.id, { ended_on: effectiveOn });
  }
  if (newCustomerId === null) return;
  try {
    await parties.insert(companyId, { property_id: propertyId, role, customer_id: newCustomerId, ...noDetails, started_on: effectiveOn, ended_on: null });
  } catch (err) {
    if (current) await parties.update(companyId, current.id, { ended_on: null });
    throw err;
  }
}

async function requireManager(companyId: Id, managerId: Id) {
  const manager = await customers.get(companyId, managerId);
  if (!manager) throw new Error('Property manager not found');
  if (!manager.is_property_manager) throw new Error(`${manager.name} is not marked as a property manager`);
}

/** Creates a property (owner and/or manager required), with an optional tenant, and starts the history. */
export async function addProperty(
  companyId: Id,
  ownerId: Id | null,
  address: Address,
  extras: { managerId?: Id | null; tenant?: PartyDetails | null } = {},
): Promise<Property> {
  if (!ownerId && !extras.managerId) throw new Error('A property needs an owner or a property manager');
  if (ownerId && !(await customers.get(companyId, ownerId))) throw new Error('Owner not found');
  if (extras.managerId) await requireManager(companyId, extras.managerId);
  const property = await properties.insert(companyId, { ...address, customer_id: ownerId });
  const startedOn = today();
  if (ownerId) {
    await parties.insert(companyId, { property_id: property.id, role: 'owner', customer_id: ownerId, ...noDetails, started_on: startedOn, ended_on: null });
  }
  if (extras.managerId) {
    await parties.insert(companyId, { property_id: property.id, role: 'manager', customer_id: extras.managerId, ...noDetails, started_on: startedOn, ended_on: null });
  }
  if (extras.tenant) {
    await parties.insert(companyId, { property_id: property.id, role: 'tenant', customer_id: null, ...extras.tenant, started_on: startedOn, ended_on: null });
  }
  return property;
}

/**
 * The property changes hands (e.g. it was sold). The previous owner stays in the history.
 * By default management ends too, since a sold property usually stops being a rental.
 */
export async function changeOwner(companyId: Id, propertyId: Id, newOwnerId: Id, effectiveOn: string, endManagement: boolean): Promise<Property> {
  const property = await properties.get(companyId, propertyId);
  if (!property) throw new Error('Property not found');
  if (property.customer_id === newOwnerId) throw new Error('That customer already owns this property');
  if (!(await customers.get(companyId, newOwnerId))) throw new Error('New owner not found');
  await switchHolder(companyId, propertyId, 'owner', newOwnerId, effectiveOn);
  try {
    const updated = await properties.update(companyId, propertyId, { customer_id: newOwnerId });
    if (endManagement && (await currentParty(companyId, propertyId, 'manager'))) await switchHolder(companyId, propertyId, 'manager', null, effectiveOn);
    return updated;
  } catch (err) {
    // Best effort to keep the pointer and the history in agreement.
    await properties.update(companyId, propertyId, { customer_id: property.customer_id });
    throw err;
  }
}

/** Starts, changes or (with null) ends the property manager. No manager = not a rental. */
export async function setManager(companyId: Id, propertyId: Id, managerId: Id | null, effectiveOn: string): Promise<void> {
  if (!(await properties.get(companyId, propertyId))) throw new Error('Property not found');
  if (managerId) {
    await requireManager(companyId, managerId);
    const current = await currentParty(companyId, propertyId, 'manager');
    if (current?.customer_id === managerId) throw new Error('That manager already manages this property');
  } else if (!(await currentParty(companyId, propertyId, 'manager'))) {
    throw new Error('This property has no manager');
  }
  await switchHolder(companyId, propertyId, 'manager', managerId, effectiveOn);
}

/**
 * Sets the tenant. 'correct' fixes the current record in place (typo, new phone). 'replace' ends the
 * current tenant on `effectiveOn` and starts a new one, so the previous tenant stays in the history.
 */
export async function setTenant(
  companyId: Id,
  propertyId: Id,
  details: PartyDetails,
  mode: 'correct' | 'replace',
  effectiveOn: string,
): Promise<PropertyParty> {
  if (!(await properties.get(companyId, propertyId))) throw new Error('Property not found');
  const current = await currentParty(companyId, propertyId, 'tenant');
  if (current && mode === 'correct') return parties.update(companyId, current.id, details);
  if (current) {
    if (effectiveOn < current.started_on) throw new Error('The date cannot be before the previous tenant started');
    await parties.update(companyId, current.id, { ended_on: effectiveOn });
  }
  try {
    return await parties.insert(companyId, { property_id: propertyId, role: 'tenant', customer_id: null, ...details, started_on: effectiveOn, ended_on: null });
  } catch (err) {
    if (current) await parties.update(companyId, current.id, { ended_on: null });
    throw err;
  }
}

/** The tenant moved out and nobody has moved in yet. */
export async function endTenant(companyId: Id, propertyId: Id, endedOn: string): Promise<PropertyParty> {
  const current = await currentParty(companyId, propertyId, 'tenant');
  if (!current) throw new Error('This property has no current tenant');
  if (endedOn < current.started_on) throw new Error('The date cannot be before the tenant started');
  return parties.update(companyId, current.id, { ended_on: endedOn });
}

/**
 * Who is billed for work at a property, and who it is labeled as owed by.
 * Rentals are billed to the property manager but labeled as owed by the owner; with no owner listed the
 * manager owes it. A property with no manager is billed to (and owed by) its owner.
 * Returns null when neither an owner nor a manager is known.
 */
export function billingFor(property: Pick<Property, 'customer_id'>, parties: Pick<PropertyParty, 'role' | 'customer_id' | 'ended_on'>[]) {
  const manager = parties.find((p) => p.role === 'manager' && p.ended_on === null)?.customer_id ?? null;
  const owner = property.customer_id;
  if (manager) return { billToId: manager, owedById: owner ?? manager };
  if (owner) return { billToId: owner, owedById: owner };
  return null;
}

/** Billing for a property by id (used by invoicing through the customers public index). */
export async function getPropertyBilling(companyId: Id, propertyId: Id) {
  const property = await properties.get(companyId, propertyId);
  if (!property) throw new Error('Property not found');
  return billingFor(property, await parties.list(companyId, { where: { property_id: propertyId } }));
}
