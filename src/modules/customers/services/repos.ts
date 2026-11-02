import { createRepo } from '@/core';
import type { Customer, CustomerContact, Property, PropertyParty } from '../types';

/** The customers module's data stores, shared by all of its services (one store per table). */
export const customers = createRepo<Customer>('customers');
export const contacts = createRepo<CustomerContact>('customer_contacts');
export const properties = createRepo<Property>('properties');
export const parties = createRepo<PropertyParty>('property_parties');
