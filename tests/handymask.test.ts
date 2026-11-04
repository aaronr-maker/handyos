import { describe, expect, it } from 'vitest';
import { createMasker, maskId } from '../src/modules/handy/mask';
import { findPrivateDetail } from '../api/_lib/handyChat';

const PAT = '4f2a1c3e-1234-4567-8901-abcdef012345';
const MILLER_PM = '9b8c7d6e-1111-4222-8333-aaaabbbbcccc';
const OAK = 'c0ffee00-2222-4333-8444-ddddeeeeffff';
const DANA = 'dada1234-3333-4444-8555-000011112222';
const known = [
  { kind: 'customer' as const, id: PAT, label: 'Pat Miller', aliases: ['Pat Miller', 'Miller, Pat'] },
  { kind: 'customer' as const, id: MILLER_PM, label: 'Miller Property Management', aliases: ['Miller Property Management'] },
  { kind: 'property' as const, id: OAK, label: '123 Oak Street', aliases: ['123 Oak Street'] },
  { kind: 'contact' as const, id: DANA, label: 'Dana', aliases: ['Dana'] },
];

describe('masking private details', () => {
  it('sends each customer, contact and property as its own ID and puts the real name back for the screen', () => {
    expect(maskId('customer', PAT)).toBe('C-4F2A1C3E');
    const m = createMasker(known);
    const masked = m.mask("Pat Miller at 123 Oak Street called. Tell pat miller we'll be there; Miller Property Management pays; Miller, Pat again.");
    expect(masked).toBe("C-4F2A1C3E at P-C0FFEE00 called. Tell C-4F2A1C3E we'll be there; C-9B8C7D6E pays; C-4F2A1C3E again.");
    expect(m.unmask('Move the job for C-4F2A1C3E at P-C0FFEE00, and tell C-9B8C7D6E.')).toBe('Move the job for Pat Miller at 123 Oak Street, and tell Miller Property Management.');
  });

  it('gives the same ID in every conversation, so things can be tied together', () => {
    const one = createMasker(known).mask('Pat Miller');
    const other = createMasker(known, { 'Email 1': 'x@y.com' }).mask('about Pat Miller, again');
    expect(one).toBe('C-4F2A1C3E');
    expect(other).toBe('about C-4F2A1C3E, again');
  });

  it('masks emails, phone numbers and long numbers it finds, and what is left passes the server check', () => {
    const m = createMasker(known);
    const masked = m.mask('Reach Dana at dana@example.com or (512) 555-0147, account 123456789012, job 4f2a1c3e-1234-4567-8901-abcdef012345, 2027-01-05.');
    expect(masked).toBe('Reach K-DADA1234 at Email 1 or Phone 1, account Number 1, job 4f2a1c3e-1234-4567-8901-abcdef012345, 2027-01-05.');
    expect(findPrivateDetail(masked)).toBeNull();
    expect(m.unmask(masked)).toContain('dana@example.com');
    expect(m.unmask(masked)).toContain('Reach Dana at');
  });

  it('does not mangle ordinary words, short names, or IDs it does not know', () => {
    const m = createMasker([{ kind: 'customer', id: 'aaaaaaaa-0000-0000-0000-000000000000', label: 'Al', aliases: ['Al'] }, known[0]]);
    expect(m.mask('The alarm and the pattern are fine')).toBe('The alarm and the pattern are fine');
    expect(m.mask('Patricia Miller')).toBe('Patricia Miller'); // only the exact known names
    expect(m.unmask('C-12345678 is unknown, Customer 9 too')).toBe('C-12345678 is unknown, Customer 9 too');
  });

  it('carries the emails, phones and numbers from one message to the next, so numbering continues', () => {
    const first = createMasker(known);
    first.mask('write to a@b.com');
    const second = createMasker(known, first.map());
    expect(second.mask('and c@d.com, then a@b.com')).toBe('and Email 2, then Email 1');
    expect(second.unmask('Email 1')).toBe('a@b.com');
  });
});
