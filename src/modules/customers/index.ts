import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { createCustomerAction } from './actions';

/** Public interface of the customers module. Other modules import from here only. */
export const customersModule: ModuleManifest = {
  id: 'customers',
  label: 'Customers',
  description: 'Customers, properties and imports.',
  path: '/customers',
  icon: 'customers',
  mobileTab: true,
  Screen: lazy(() => import('./ui/CustomersScreen')),
  register({ actions }) {
    actions.register(createCustomerAction);
  },
};

export type { Customer, Property } from './types';
export { getCustomer, listCustomers } from './services/customerService';
