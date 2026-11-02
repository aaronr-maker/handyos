import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule, listCustomers } from '../src/modules/customers';
import { parseCsv } from '../src/modules/customers/import/csv';
import { autoMap, detectSource, mapRow } from '../src/modules/customers/import/mapping';

// Made-up data in the shape of a Housecall Pro export (many Address_N column groups).
const HCP_HEADERS = [
  'First Name', 'Last Name', 'Display Name', 'Mobile Number', 'Home Number', 'Email', 'Additional Emails', 'Company', 'Role', 'Work Number',
  'Tags', 'Notes', 'ID', 'Customer Type', 'Customer is Contractor', 'Lead Source', 'Do Not Service',
  'Address_1 Street Line 1', 'Address_1 Street Line 2', 'Address_1 City', 'Address_1 State', 'Address_1 Postal Code', 'Address_1 Billing?', 'Address_1 Notes',
  'Address_2 Street Line 1', 'Address_2 Street Line 2', 'Address_2 City', 'Address_2 State', 'Address_2 Postal Code', 'Address_2 Billing?', 'Address_2 Notes',
];
const row = (o: Record<string, string>) => HCP_HEADERS.map((h) => o[h] ?? '');
const csv = (rows: string[][]) => [HCP_HEADERS, ...rows].map((r) => r.map((c) => `"${c.replace(/"/g, '""')}"`).join(',')).join('\r\n');

const map = (r: string[]) => {
  const headers = HCP_HEADERS;
  return mapRow(Object.fromEntries(headers.map((h, i) => [h, r[i]])), headers, autoMap(headers), detectSource(headers));
};

describe('csv parser', () => {
  it('handles quotes, commas, newlines inside quotes, escaped quotes, BOM and CRLF', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","line1\nline2"\r\n"say ""hi""",z\r\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'line1\nline2'],
      ['say "hi"', 'z'],
    ]);
  });
});

describe('Housecall Pro style mapping', () => {
  it('detects the source and reads a person with two addresses, extra phones and an id', () => {
    expect(detectSource(HCP_HEADERS)).toBe('Housecall Pro');
    const { row: r } = map(row({
      'First Name': 'Pat', 'Last Name': 'Rivera', 'Display Name': 'Pat Rivera', 'Mobile Number': '5550100', 'Home Number': '5550111',
      Email: 'pat@example.com', ID: '42', 'Customer Type': 'homeowner', 'Do Not Service': 'false',
      'Address_1 Street Line 1': '12 Oak St', 'Address_1 City': 'Austin', 'Address_1 State': 'TX', 'Address_1 Postal Code': '78701',
      'Address_2 Street Line 1': '9 Elm St', 'Address_2 Street Line 2': 'Unit B', 'Address_2 City': 'Austin',
    }));
    expect(r).toMatchObject({ external_ref: 'hcp:42', first_name: 'Pat', last_name: 'Rivera', phone: '5550100', is_property_manager: false, display_name_source: 'person' });
    expect(r!.addresses.map((a) => a.address_line1)).toEqual(['12 Oak St', '9 Elm St, Unit B']);
    expect(r!.notes).toContain('Home Number: 5550111');
  });

  it('flags property managers from Role or Tags (typos included) and keeps a "do not service" warning', () => {
    const a = map(row({ 'First Name': 'M', Role: 'Property Managment', ID: '1', 'Display Name': 'M' })).row!;
    const b = map(row({ 'First Name': 'N', Tags: "'Property Manager', 'Commercial'", ID: '2', 'Display Name': 'N' })).row!;
    const c = map(row({ 'First Name': 'O', Role: 'General Contractor', ID: '3', 'Display Name': 'O', 'Do Not Service': 'true' })).row!;
    expect([a.is_property_manager, b.is_property_manager, c.is_property_manager]).toEqual([true, true, false]);
    expect(c.notes).toContain('DO NOT SERVICE');
    expect(c.notes).toContain('Role: General Contractor');
  });

  it('treats a business with only a display name as a company, and picks display-name choices', () => {
    const biz = map(row({ 'Display Name': 'Acme Plumbing', 'Customer Type': 'business', ID: '5' })).row!;
    expect(biz).toMatchObject({ company_name: 'Acme Plumbing', first_name: null, display_name_source: 'company' });
    const custom = map(row({ 'First Name': 'Sam', 'Last Name': 'Lee', 'Display Name': 'The Lees', ID: '6' })).row!;
    expect(custom).toMatchObject({ display_name: 'The Lees', display_name_source: 'custom' });
    expect(map(row({ ID: '7' })).error).toBe('No name or company');
  });

  it('keeps a billing-flagged address as a note when there are other addresses, and as the property when it is the only one', () => {
    const several = map(row({
      'First Name': 'A', ID: '8', 'Display Name': 'A',
      'Address_1 Street Line 1': '1 Mail Box Rd', 'Address_1 Billing?': 'true', 'Address_2 Street Line 1': '2 Service Ln',
    })).row!;
    expect(several.addresses.map((a) => a.address_line1)).toEqual(['2 Service Ln']);
    expect(several.notes).toContain('Billing address: 1 Mail Box Rd');
    const only = map(row({ 'First Name': 'B', ID: '9', 'Display Name': 'B', 'Address_1 Street Line 1': '3 Only St', 'Address_1 Billing?': 'true' })).row!;
    expect(only.addresses.map((a) => a.address_line1)).toEqual(['3 Only St']);
  });
});

describe('import action', () => {
  it('imports customers + properties, makes manager addresses managed rentals, and never duplicates on re-import', async () => {
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const caller = { companyId: 'coImport', actor: { kind: 'user', id: 'u1' } as const };
    const rows = parseCsv(csv([
      row({ 'First Name': 'Pat', 'Last Name': 'Rivera', 'Display Name': 'Pat Rivera', 'Mobile Number': '5550100', ID: '1', 'Address_1 Street Line 1': '12 Oak St' }),
      // same phone as Pat, but a different Housecall Pro id: a different customer
      row({ 'First Name': 'Sam', 'Last Name': 'Rivera', 'Display Name': 'Sam Rivera', 'Mobile Number': '5550100', ID: '2', 'Address_1 Street Line 1': '14 Oak St' }),
      row({ Company: 'Remax', 'Display Name': 'Remax', Role: 'Property Manager', 'Customer Type': 'business', ID: '3', 'Address_1 Street Line 1': '1 Rental Rd', 'Address_2 Street Line 1': '2 Rental Rd' }),
    ]));
    const [headers, ...data] = rows;
    const mapping = autoMap(headers);
    const importRows = data.map((r) => mapRow(Object.fromEntries(headers.map((h, i) => [h, r[i]])), headers, mapping, 'Housecall Pro').row!);

    const first = await rt.actions.executeByName('customers.import', { rows: importRows }, caller);
    expect(first.status, JSON.stringify(first)).toBe('ok');
    expect((first as { output: unknown }).output).toEqual({ created: 3, skipped_duplicates: 0, properties_created: 4 });
    const all = await listCustomers('coImport');
    expect(all.map((c) => c.name).sort()).toEqual(['Pat Rivera', 'Remax', 'Sam Rivera']);
    expect(all.find((c) => c.name === 'Remax')!.is_property_manager).toBe(true);

    const again = await rt.actions.executeByName('customers.import', { rows: importRows }, caller);
    expect((again as { output: unknown }).output).toEqual({ created: 0, skipped_duplicates: 3, properties_created: 0 });
    expect((await listCustomers('coImport')).length).toBe(3);
  });

  it('keeps a company that already exists out of another company\'s import (tenant isolation)', async () => {
    const rt = createRuntime();
    customersModule.register({ actions: rt.actions, events: rt.events });
    const r = { external_ref: 'hcp:1', first_name: 'Same', last_name: 'Id' };
    await rt.actions.executeByName('customers.import', { rows: [r] }, { companyId: 'coX', actor: { kind: 'user', id: 'u' } });
    const other = await rt.actions.executeByName('customers.import', { rows: [r] }, { companyId: 'coY', actor: { kind: 'user', id: 'u' } });
    expect((other as { output: { created: number } }).output.created).toBe(1);
  });
});
