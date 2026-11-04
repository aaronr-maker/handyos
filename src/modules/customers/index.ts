import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import {
  addContactAction,
  addPropertyAction,
  createCustomerAction,
  deleteCustomerAction,
  changeOwnerAction,
  endTenantAction,
  importCustomersAction,
  mergeCustomersAction,
  removeContactAction,
  setDisplayContactAction,
  setManagerAction,
  setTenantAction,
  updateContactAction,
  updateCustomerAction,
  updatePropertyAction,
} from './actions';

/** Public interface of the customers module. Other modules import from here only. */
export const customersModule: ModuleManifest = {
  id: 'customers',
  label: 'Customers',
  description: 'Customers, contacts, properties and imports.',
  path: '/customers',
  icon: 'customers',
  mobileTab: true,
  Screen: lazy(() => import('./ui/CustomersScreen')),
  register({ actions }) {
    [
      createCustomerAction,
      updateCustomerAction,
      addContactAction,
      updateContactAction,
      removeContactAction,
      setDisplayContactAction,
      addPropertyAction,
      updatePropertyAction,
      changeOwnerAction,
      setManagerAction,
      setTenantAction,
      endTenantAction,
      importCustomersAction,
      deleteCustomerAction,
      mergeCustomersAction,
    ].forEach((a) => actions.register(a));
  },
};

export type { Customer, CustomerContact, PartyRole, Property, PropertyParty } from './types';
export { customerLabel, displayContact } from './display';
export { CustomerPropertyPicker } from './ui/CustomerPropertyPicker';
export type { WhoValue } from './ui/CustomerPropertyPicker';
export { billingFor, getCustomer, getPropertyBilling, getProperty, listAllContacts, listAllProperties, listCustomers, listPropertiesFor, resolveBilling } from './services/customerService';
