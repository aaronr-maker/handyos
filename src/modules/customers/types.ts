import type { BaseRecord, Id } from '@/core';

export type DisplayNameSource = 'person' | 'company' | 'custom';

/**
 * A customer has a main contact (name / phone / email on the record itself) plus any number of
 * additional contacts. `display_contact_id` picks which contact is shown in lists; null = the main contact.
 */
export interface Customer extends BaseRecord {
  /** Full name (first + last), or the business name when there is no first/last. */
  name: string;
  first_name: string | null;
  last_name: string | null;
  /** Custom display name; used when display_name_source is 'custom'. */
  display_name: string | null;
  /** Which name to show: the person's name, the company name, or the custom display name. */
  display_name_source: DisplayNameSource;
  company_name: string | null;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** Property managers have several properties, each with its own owner and tenant. */
  is_property_manager: boolean;
  display_contact_id: Id | null;
}

export interface CustomerContact extends BaseRecord {
  customer_id: Id;
  name: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * A property (address) stands on its own. The work belongs to the property's OWNER, who is a customer:
 * `customer_id` is the current owner. An owner may be represented by a property MANAGER (also a customer)
 * for as long as the property is a rental; when it is sold or stops being a rental there is no manager.
 * Jobs, estimates and invoices reference the property, so they stay with the address when it changes hands.
 */
export interface Property extends BaseRecord {
  /** Current owner (a customer). Null for a managed rental whose owner is not listed yet. */
  customer_id: Id | null;
  address_line1: string;
  city: string;
  state: string;
  postal_code: string;
}

export type PartyRole = 'owner' | 'manager' | 'tenant';

/** One period of someone holding a role at a property. `ended_on` null = current. */
export interface PropertyParty extends BaseRecord {
  property_id: Id;
  role: PartyRole;
  /** Set for owner and manager (they are customers). Null for tenants. */
  customer_id: Id | null;
  /** Tenant details (a name or company name is required). `name` is the full name. */
  name: string | null;
  first_name: string | null;
  last_name: string | null;
  company_name: string | null;
  phone: string | null;
  email: string | null;
  /** ISO dates (YYYY-MM-DD). */
  started_on: string;
  ended_on: string | null;
}
