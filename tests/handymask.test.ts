import { describe, expect, it } from 'vitest';
import { createMasker } from '../src/modules/handy/mask';
import { findPrivateDetail } from '../api/_lib/handyChat';

const known = [
  { kind: 'Customer' as const, value: 'Pat Miller' },
  { kind: 'Customer' as const, value: 'Miller Property Management' },
  { kind: 'Address' as const, value: '123 Oak Street' },
  { kind: 'Contact' as const, value: 'Dana' },
];

describe('masking private details', () => {
  it('swaps known names and addresses for placeholders and back, keeping the same placeholder for the same thing', () => {
    const m = createMasker(known);
    const masked = m.mask("Pat Miller at 123 Oak Street called. Tell pat miller we'll be there; Miller Property Management pays.");
    expect(masked).toBe("Customer 1 at Address 1 called. Tell Customer 1 we'll be there; Customer 2 pays.");
    expect(m.unmask('Move the job for Customer 1 at Address 1, and tell Customer 2.')).toBe('Move the job for Pat Miller at 123 Oak Street, and tell Miller Property Management.');
    expect(m.mask('Pat Miller again')).toBe('Customer 1 again');
  });

  it('masks emails, phone numbers and long numbers it finds, and what is left passes the server check', () => {
    const m = createMasker(known);
    const masked = m.mask('Reach Dana at dana@example.com or (512) 555-0147, account 123456789012, job 4f2a1c3e-1234-4567-8901-abcdef012345, 2027-01-05.');
    expect(masked).toBe('Reach Contact 1 at Email 1 or Phone 1, account Number 1, job 4f2a1c3e-1234-4567-8901-abcdef012345, 2027-01-05.');
    expect(findPrivateDetail(masked)).toBeNull();
    expect(m.unmask(masked)).toContain('dana@example.com');
  });

  it('does not mangle ordinary words, short names, or placeholders that were never issued', () => {
    const m = createMasker([{ kind: 'Customer', value: 'Al' }, { kind: 'Customer', value: 'Pat Miller' }]);
    expect(m.mask('The alarm and the pattern are fine')).toBe('The alarm and the pattern are fine');
    expect(m.mask('Patricia Miller')).toBe('Patricia Miller'); // only the exact known name
    expect(m.unmask('Customer 9 is unknown')).toBe('Customer 9 is unknown');
  });

  it('carries the map from one message to the next, so numbering continues', () => {
    const first = createMasker(known);
    first.mask('Pat Miller');
    const second = createMasker(known, first.map());
    expect(second.mask('123 Oak Street and Pat Miller')).toBe('Address 1 and Customer 1');
    expect(second.unmask('Customer 1')).toBe('Pat Miller');
  });
});
