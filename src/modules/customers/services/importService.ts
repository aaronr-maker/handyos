import type { Id } from '@/core';
import { resolveName } from '../display';
import { duplicateKeys, type ImportRow } from '../import/mapping';
import type { Customer } from '../types';
import { customers, parties, properties } from './repos';

export interface ImportResult {
  created: number;
  skipped_duplicates: number;
  properties_created: number;
}

const noParty = { name: null, first_name: null, last_name: null, company_name: null, phone: null, email: null };

/** Keys an existing customer would have had if it had been imported (or entered by hand). */
const existingKeys = (c: Customer) => duplicateKeys({ ...c, external_ref: c.external_ref });

/**
 * Bulk-creates customers and their addresses from mapped rows.
 *  - Duplicates are skipped: same old-system id, or (for rows without one) same email/phone/name+street.
 *  - A property manager's addresses become managed rentals with no owner listed yet (the manager is billed);
 *    everyone else's addresses become properties they own.
 */
export async function importCustomers(companyId: Id, rows: ImportRow[], skipDuplicates: boolean): Promise<ImportResult> {
  const seen = new Set<string>();
  if (skipDuplicates) {
    for (const c of await customers.list(companyId)) {
      existingKeys(c).forEach((k) => seen.add(k));
      // a hand-entered customer has no id; its email/phone still protect against importing it again
      for (const k of duplicateKeys({ ...c, external_ref: null })) seen.add(k);
    }
  }

  const fresh: ImportRow[] = [];
  let skipped = 0;
  for (const r of rows) {
    const byId = r.external_ref ? [`x:${r.external_ref}`] : [];
    const loose = duplicateKeys({ ...r, external_ref: null, street: r.addresses[0]?.address_line1 });
    // with an id, only the id decides (customers can legitimately share a phone number)
    const keys = r.external_ref ? byId : loose;
    if (skipDuplicates && keys.some((k) => seen.has(k))) {
      skipped++;
      continue;
    }
    keys.forEach((k) => seen.add(k));
    fresh.push(r);
  }

  const created = await customers.insertMany(
    companyId,
    fresh.map((r) => ({
      name: resolveName(r),
      first_name: r.first_name,
      last_name: r.last_name,
      display_name: r.display_name,
      display_name_source: r.display_name_source,
      company_name: r.company_name,
      is_property_manager: r.is_property_manager,
      email: r.email,
      phone: r.phone,
      notes: r.notes,
      display_contact_id: null,
      external_ref: r.external_ref,
    })),
  );

  const wanted = created.flatMap((c, i) => fresh[i].addresses.map((address) => ({ customer: c, address })));
  const props = await properties.insertMany(
    companyId,
    wanted.map(({ customer, address }) => ({ ...address, customer_id: customer.is_property_manager ? null : customer.id })),
  );
  const today = new Date().toISOString().slice(0, 10);
  await parties.insertMany(
    companyId,
    props.map((p, i) => ({
      property_id: p.id,
      role: wanted[i].customer.is_property_manager ? ('manager' as const) : ('owner' as const),
      customer_id: wanted[i].customer.id,
      ...noParty,
      started_on: today,
      ended_on: null,
    })),
  );

  return { created: created.length, skipped_duplicates: skipped, properties_created: props.length };
}
