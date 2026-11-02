import { z } from 'zod';
import { defineAction } from '@/core';
import { resolveName } from './display';
import { importCustomers } from './services/importService';
import {
  addContact,
  addProperty,
  changeOwner,
  createCustomer,
  deleteCustomer,
  endTenant,
  getContact,
  getCustomer,
  getProperty,
  removeContact,
  setDisplayContact,
  setManager,
  setTenant,
  updateAddress,
  updateContact,
  updateCustomer,
} from './services/customerService';

const optionalText = (max: number) => z.string().trim().max(max).nullable().default(null);
const optionalEmail = z.string().trim().email('Enter a valid email').nullable().default(null);

/** First/last name for a person, or just a (business) name. At least one of them, or a company name, is required. */
const nameFields = {
  name: optionalText(200),
  first_name: optionalText(100),
  last_name: optionalText(100),
};
const needsName = (v: { name?: string | null; first_name: string | null; last_name: string | null; company_name?: string | null }) =>
  Boolean(resolveName(v));

const customerFields = {
  ...nameFields,
  display_name: optionalText(200),
  display_name_source: z.enum(['person', 'company', 'custom']).default('person'),
  company_name: optionalText(200),
  is_property_manager: z.boolean().default(false),
  email: optionalEmail,
  phone: optionalText(40),
  notes: optionalText(2000),
};

const contactFields = {
  ...nameFields,
  phone: optionalText(40),
  email: optionalEmail,
};

/**
 * Changes to existing contact data made by an AI agent (e.g. one watching messages for a new phone number
 * or a tenant move-out) wait for a person to approve; people edit directly. Everything is audit-logged either way.
 */
const agentNeedsApproval = (_input: unknown, ctx: { actor: { kind: string } }) => ctx.actor.kind === 'agent';

/** Announce a property change to its owner's record (if it has one). */
async function emitProperty(ctx: { companyId: string; events: { emit: (c: string, t: 'customer.updated', p: { customerId: string; what: 'property' }) => Promise<unknown> } }, property: { customer_id: string | null }) {
  if (property.customer_id) await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: property.customer_id, what: 'property' });
}

async function requireCustomer(companyId: string, id: string) {
  const customer = await getCustomer(companyId, id);
  if (!customer) throw new Error('Customer not found');
  return customer;
}

export const createCustomerAction = defineAction({
  name: 'customers.create',
  module: 'customers',
  description: 'Create a new customer record.',
  input: z.object(customerFields).refine(needsName, { message: 'Enter a first/last name or a company name' }),
  risk: 'low',
  requiresApproval: false,
  example: { first_name: 'Pat', last_name: 'Rivera', display_name: null, display_name_source: 'person' as const, company_name: 'Rivera Rentals', is_property_manager: true, email: 'pat@example.com', phone: '555-0100', notes: null },
  async handler(input, ctx) {
    const customer = await createCustomer(ctx.companyId, { ...input, name: resolveName(input) });
    await ctx.events.emit(ctx.companyId, 'customer.created', { customerId: customer.id });
    return customer;
  },
});

export const updateCustomerAction = defineAction({
  name: 'customers.update',
  module: 'customers',
  description: "Change a customer's name, display name, company or main contact details.",
  input: z.object({ customer_id: z.string().min(1), ...customerFields }).refine(needsName, { message: 'Enter a first/last name or a company name' }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: { customer_id: 'customer-id', first_name: 'Pat', last_name: 'Rivera', display_name: null, display_name_source: 'company' as const, company_name: 'Rivera Rentals', is_property_manager: true, email: 'pat@example.com', phone: '555-0100', notes: 'Prefers texts' },
  async handler({ customer_id, ...fields }, ctx) {
    await requireCustomer(ctx.companyId, customer_id);
    const customer = await updateCustomer(ctx.companyId, customer_id, { ...fields, name: resolveName(fields) });
    await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: customer_id, what: 'details' });
    return customer;
  },
});

export const addContactAction = defineAction({
  name: 'customers.add_contact',
  module: 'customers',
  description: 'Add an additional contact (name, phone, email) to a customer.',
  input: z.object({ customer_id: z.string().min(1), ...contactFields }).refine(needsName, { message: 'Enter a first/last name' }),
  risk: 'low',
  requiresApproval: false,
  example: { customer_id: 'customer-id', first_name: 'Sam', last_name: 'Rivera', phone: '555-0101', email: 'sam@example.com' },
  async handler({ customer_id, ...fields }, ctx) {
    await requireCustomer(ctx.companyId, customer_id);
    const contact = await addContact(ctx.companyId, customer_id, { ...fields, name: resolveName(fields) });
    await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: customer_id, what: 'contact' });
    return contact;
  },
});

export const updateContactAction = defineAction({
  name: 'customers.update_contact',
  module: 'customers',
  description: 'Change an additional contact.',
  input: z.object({ contact_id: z.string().min(1), ...contactFields }).refine(needsName, { message: 'Enter a first/last name' }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: { contact_id: 'contact-id', first_name: 'Sam', last_name: 'Rivera', phone: '555-0101', email: 'sam@example.com' },
  async handler({ contact_id, ...fields }, ctx) {
    const existing = await getContact(ctx.companyId, contact_id);
    if (!existing) throw new Error('Contact not found');
    const contact = await updateContact(ctx.companyId, contact_id, { ...fields, name: resolveName(fields) });
    await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: existing.customer_id, what: 'contact' });
    return contact;
  },
});

export const removeContactAction = defineAction({
  name: 'customers.remove_contact',
  module: 'customers',
  description: 'Delete an additional contact. If it was the display contact, the main contact becomes the display contact.',
  input: z.object({ contact_id: z.string().min(1) }),
  risk: 'medium',
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { contact_id: 'contact-id' },
  async handler({ contact_id }, ctx) {
    const existing = await getContact(ctx.companyId, contact_id);
    if (!existing) throw new Error('Contact not found');
    await removeContact(ctx.companyId, contact_id);
    await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: existing.customer_id, what: 'contact' });
    return { removed: contact_id };
  },
});

export const setDisplayContactAction = defineAction({
  name: 'customers.set_display_contact',
  module: 'customers',
  description: 'Choose which contact is shown for a customer. Use contact_id null for the main contact.',
  input: z.object({ customer_id: z.string().min(1), contact_id: z.string().min(1).nullable() }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: { customer_id: 'customer-id', contact_id: null },
  async handler({ customer_id, contact_id }, ctx) {
    await requireCustomer(ctx.companyId, customer_id);
    if (contact_id) {
      const contact = await getContact(ctx.companyId, contact_id);
      if (!contact || contact.customer_id !== customer_id) throw new Error('That contact does not belong to this customer');
    }
    const customer = await setDisplayContact(ctx.companyId, customer_id, contact_id);
    await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: customer_id, what: 'contact' });
    return customer;
  },
});

const addressFields = {
  address_line1: z.string().trim().min(1, 'Address is required').max(200),
  city: z.string().trim().max(100).default(''),
  state: z.string().trim().max(50).default(''),
  postal_code: z.string().trim().max(20).default(''),
};

/** A tenant. Needs at least a name or a company name. */
const tenantDetails = z
  .object({ ...nameFields, company_name: optionalText(200), phone: optionalText(40), email: optionalEmail })
  .refine(needsName, { message: 'Enter a name or a company name' })
  .transform((t) => ({ ...t, name: resolveName(t) || null }));

const isoDate = z.iso.date();
const todayIso = () => new Date().toISOString().slice(0, 10);

export const addPropertyAction = defineAction({
  name: 'customers.add_property',
  module: 'customers',
  description:
    'Add a property. It needs an owner (a customer), a property manager, or both: a managed rental can be added before its owner is known. Optionally add the current tenant.',
  input: z
    .object({
      owner_id: z.string().min(1).nullable().default(null),
      manager_id: z.string().min(1).nullable().default(null),
      ...addressFields,
      tenant: tenantDetails.nullable().default(null),
    })
    .refine((v) => v.owner_id || v.manager_id, { message: 'Choose an owner or a property manager' }),
  risk: 'low',
  requiresApproval: false,
  example: {
    owner_id: 'customer-id',
    manager_id: null,
    address_line1: '12 Oak St',
    city: 'Austin',
    state: 'TX',
    postal_code: '78701',
    tenant: { first_name: 'Tom', last_name: 'Tenant', company_name: null, phone: '555-0123', email: null },
  },
  async handler({ owner_id, manager_id, tenant, ...address }, ctx) {
    const property = await addProperty(ctx.companyId, owner_id, address, { managerId: manager_id, tenant });
    if (owner_id) await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: owner_id, what: 'property' });
    if (manager_id) await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: manager_id, what: 'property' });
    return property;
  },
});

export const updatePropertyAction = defineAction({
  name: 'customers.update_property',
  module: 'customers',
  description: "Correct a property's street address.",
  input: z.object({ property_id: z.string().min(1), ...addressFields }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: { property_id: 'property-id', address_line1: '12 Oak St', city: 'Austin', state: 'TX', postal_code: '78701' },
  async handler({ property_id, ...address }, ctx) {
    const existing = await getProperty(ctx.companyId, property_id);
    if (!existing) throw new Error('Property not found');
    const property = await updateAddress(ctx.companyId, property_id, address);
    await emitProperty(ctx, existing);
    return property;
  },
});

export const changeOwnerAction = defineAction({
  name: 'customers.change_owner',
  module: 'customers',
  description:
    'The property has a new owner (for example it was sold). The address keeps its history and all its records; the previous owner stays in the history. By default the property manager is removed too, because a sold property usually stops being a rental.',
  input: z.object({
    property_id: z.string().min(1),
    new_owner_id: z.string().min(1),
    effective_on: isoDate.default(todayIso),
    end_management: z.boolean().default(true),
  }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: { property_id: 'property-id', new_owner_id: 'customer-id', effective_on: '2026-12-01', end_management: true },
  async handler(input, ctx) {
    const before = await getProperty(ctx.companyId, input.property_id);
    if (!before) throw new Error('Property not found');
    const property = await changeOwner(ctx.companyId, input.property_id, input.new_owner_id, input.effective_on, input.end_management);
    await emitProperty(ctx, before);
    await ctx.events.emit(ctx.companyId, 'customer.updated', { customerId: input.new_owner_id, what: 'property' });
    return property;
  },
});

export const setManagerAction = defineAction({
  name: 'customers.set_manager',
  module: 'customers',
  description:
    "Set, change or remove a property's manager. manager_id null means there is no manager (not a rental, or self-managed). Previous managers stay in the history.",
  input: z.object({ property_id: z.string().min(1), manager_id: z.string().min(1).nullable(), effective_on: isoDate.default(todayIso) }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: { property_id: 'property-id', manager_id: null, effective_on: '2026-12-01' },
  async handler(input, ctx) {
    const property = await getProperty(ctx.companyId, input.property_id);
    if (!property) throw new Error('Property not found');
    await setManager(ctx.companyId, input.property_id, input.manager_id, input.effective_on);
    await emitProperty(ctx, property);
    return { property_id: property.id, manager_id: input.manager_id };
  },
});

export const setTenantAction = defineAction({
  name: 'customers.set_tenant',
  module: 'customers',
  description:
    "Set a property's tenant. mode 'correct' fixes the current record in place; 'replace' starts a new tenant on effective_on and keeps the previous one in the history.",
  input: z.object({
    property_id: z.string().min(1),
    mode: z.enum(['correct', 'replace']),
    details: tenantDetails,
    effective_on: isoDate.default(todayIso),
  }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: {
    property_id: 'property-id',
    mode: 'replace',
    details: { first_name: 'Tina', last_name: 'Tenant', company_name: null, phone: '555-0144', email: null },
    effective_on: '2026-12-01',
  },
  async handler(input, ctx) {
    const existing = await getProperty(ctx.companyId, input.property_id);
    if (!existing) throw new Error('Property not found');
    const tenant = await setTenant(ctx.companyId, input.property_id, input.details, input.mode, input.effective_on);
    await emitProperty(ctx, existing);
    return tenant;
  },
});

export const endTenantAction = defineAction({
  name: 'customers.end_tenant',
  module: 'customers',
  description: 'The tenant moved out and nobody has moved in yet.',
  input: z.object({ property_id: z.string().min(1), ended_on: isoDate.default(todayIso) }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: { property_id: 'property-id', ended_on: '2026-12-01' },
  async handler(input, ctx) {
    const existing = await getProperty(ctx.companyId, input.property_id);
    if (!existing) throw new Error('Property not found');
    const tenant = await endTenant(ctx.companyId, input.property_id, input.ended_on);
    await emitProperty(ctx, existing);
    return tenant;
  },
});

const importAddress = z.object({
  address_line1: z.string().trim().min(1).max(300),
  city: z.string().trim().max(100).default(''),
  state: z.string().trim().max(50).default(''),
  postal_code: z.string().trim().max(20).default(''),
});

const importRow = z.object({
  external_ref: optionalText(100),
  first_name: optionalText(100),
  last_name: optionalText(100),
  company_name: optionalText(200),
  display_name: optionalText(200),
  display_name_source: z.enum(['person', 'company', 'custom']).default('person'),
  is_property_manager: z.boolean().default(false),
  email: optionalEmail,
  phone: optionalText(40),
  notes: optionalText(8000),
  addresses: z.array(importAddress).max(200).default([]),
});

export const importCustomersAction = defineAction({
  name: 'customers.import',
  module: 'customers',
  description:
    'Bulk-create customers and their addresses (as properties) from rows exported from another system. Skips customers already imported (same old-system id) or already present (same email or phone).',
  input: z.object({
    rows: z.array(importRow.refine(needsName, { message: 'Each row needs a name or company' })).min(1).max(500),
    skip_duplicates: z.boolean().default(true),
  }),
  risk: 'medium',
  requiresApproval: agentNeedsApproval,
  example: {
    rows: [{ external_ref: 'hcp:123', first_name: 'Pat', last_name: 'Rivera', company_name: null, display_name: null, display_name_source: 'person' as const, is_property_manager: false, email: 'pat@example.com', phone: '555-0100', notes: null, addresses: [{ address_line1: '12 Oak St', city: 'Austin', state: 'TX', postal_code: '78701' }] }],
    skip_duplicates: true,
  },
  async handler({ rows, skip_duplicates }, ctx) {
    const result = await importCustomers(ctx.companyId, rows, skip_duplicates);
    if (result.created > 0) await ctx.events.emit(ctx.companyId, 'customer.created', { customerId: 'bulk-import' });
    return result;
  },
});

export const deleteCustomerAction = defineAction({
  name: 'customers.delete',
  module: 'customers',
  description: 'Permanently delete a customer and their additional contacts. Only allowed when the customer has no addresses (now or in the past).',
  input: z.object({ customer_id: z.string().min(1) }),
  risk: 'high',
  // People confirm in the app; an AI agent always needs a person to approve first.
  requiresApproval: agentNeedsApproval,
  example: { customer_id: 'customer-id' },
  async handler({ customer_id }, ctx) {
    await deleteCustomer(ctx.companyId, customer_id);
    await ctx.events.emit(ctx.companyId, 'customer.deleted', { customerId: customer_id });
    return { deleted: customer_id };
  },
});
