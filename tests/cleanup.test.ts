import { describe, expect, it } from 'vitest';
import { looksLikePhone, phoneOnlyCustomers } from '../src/modules/customers/cleanup';
import type { Customer } from '../src/modules/customers/types';

const c = (id: string, over: Partial<Customer>): Customer => ({ id, company_id: 'co', created_at: '', updated_at: '', name: '', first_name: null, last_name: null, display_name: null, display_name_source: 'person', company_name: null, email: null, phone: null, notes: null, is_property_manager: false, display_contact_id: null, external_ref: null, merged_refs: [], ...over }) as Customer;

describe('phone-only customers', () => {
  it('knows a phone number from a name', () => {
    expect(looksLikePhone('(417) 555-0100')).toBe(true);
    expect(looksLikePhone('+1 417-555-0100')).toBe(true);
    expect(looksLikePhone('')).toBe(true);
    expect(looksLikePhone('Pat Rivera')).toBe(false);
    expect(looksLikePhone('555')).toBe(false);
  });
  it('picks customers with only a number and no address, and never one with a name, company or address', () => {
    const all = [c('a', { name: '4175550100', phone: '4175550100' }), c('b', { name: '4175550101', phone: '4175550101' }), c('c', { name: 'Pat Rivera', first_name: 'Pat', last_name: 'Rivera' }), c('d', { name: '4175550102', company_name: 'Rivera Rentals' }), c('e', { name: '' })];
    expect(phoneOnlyCustomers(all, (id) => id === 'b').map((x) => x.id)).toEqual(['a', 'e']);
  });
  it('catches a customer whose phone number is stored in the first name or the company name too (the way imports often do it)', () => {
    const all = [c('x', { name: '2132890924', first_name: '2132890924', last_name: null }), c('y', { name: '(417) 555-0101', first_name: '4175550101', company_name: '417-555-0101' }), c('z', { name: 'Pat', first_name: 'Pat' })];
    expect(phoneOnlyCustomers(all, () => false).map((v) => v.id)).toEqual(['x', 'y']);
  });
});
