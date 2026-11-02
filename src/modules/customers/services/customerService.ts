import { createMemoryRepo, type Id } from '@/core';
import type { Customer } from '../types';

const customers = createMemoryRepo<Customer>();

export function createCustomer(companyId: Id, data: Pick<Customer, 'name' | 'email' | 'phone' | 'notes'>): Customer {
  return customers.insert(companyId, data);
}

export function getCustomer(companyId: Id, id: Id): Customer | undefined {
  return customers.get(companyId, id);
}

export function listCustomers(companyId: Id): Customer[] {
  return customers.list(companyId);
}
