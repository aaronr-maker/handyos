import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { resultError, useAction, useAsync, useSession } from '@/core';
import { mergeCustomersAction } from '../actions';
import { customerLabel } from '../display';
import { findDuplicateGroups } from '../duplicates';
import { listAllProperties, listAllContacts, listCustomers } from '../services/customerService';
import type { Customer } from '../types';

/** Suggests customers that may be the same person, and merges the ones you pick. */
export default function DuplicatesScreen() {
  const { companyId } = useSession();
  const merge = useAction(mergeCustomersAction);
  const { data, loading, error, reload } = useAsync(
    async () => ({
      customers: await listCustomers(companyId),
      properties: await listAllProperties(companyId),
      contacts: await listAllContacts(companyId),
    }),
    [companyId],
  );
  const [keep, setKeep] = useState<Record<number, string>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  const groups = useMemo(() => findDuplicateGroups(data?.customers ?? []), [data?.customers]);
  const visible = groups.filter((g) => !dismissed.has(g.customers.map((c) => c.id).sort().join()));

  const counts = (c: Customer) => ({
    addresses: data?.properties.filter((p) => p.customer_id === c.id).length ?? 0,
    contacts: data?.contacts.filter((x) => x.customer_id === c.id).length ?? 0,
  });

  const mergeGroup = async (index: number, members: Customer[]) => {
    const keepId = keep[index] ?? members[0].id;
    const keepCustomer = members.find((c) => c.id === keepId)!;
    const others = members.filter((c) => c.id !== keepId);
    if (!confirm(`Merge ${others.map(customerLabel).join(', ')} into ${customerLabel(keepCustomer)}? This can't be undone.`)) return;
    setProblem(null);
    for (const other of others) {
      const err = resultError(await merge({ keep_id: keepId, merge_id: other.id }));
      if (err) {
        setProblem(err);
        reload();
        return;
      }
    }
    setMessage(`Merged into ${customerLabel(keepCustomer)}.`);
    reload();
  };

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Customers
      </Link>
      <header className="page-header">
        <div>
          <h1>Possible duplicates</h1>
          <p className="muted">Customers that share an email, phone number or name. Pick the one to keep.</p>
        </div>
      </header>
      {message && <p className="notice">{message}</p>}
      {(error || problem) && <p className="err">{error ?? problem}</p>}
      {loading && <p className="muted">Looking…</p>}
      {data && visible.length === 0 && (
        <div className="card">
          <p className="muted">No likely duplicates found.</p>
        </div>
      )}
      {visible.map((g, i) => (
        <div key={g.customers.map((c) => c.id).join()} className="card">
          <p className="muted">Looks the same: {g.reasons.join(', ') || 'similar details'}</p>
          {g.customers.map((c) => {
            const n = counts(c);
            return (
              <label key={c.id} className="check dup-row">
                <input type="radio" name={`keep-${i}`} checked={(keep[i] ?? g.customers[0].id) === c.id} onChange={() => setKeep({ ...keep, [i]: c.id })} />
                <span>
                  <strong>{customerLabel(c)}</strong>
                  <span className="muted">
                    {' '}
                    {[c.phone, c.email, `${n.addresses} address${n.addresses === 1 ? '' : 'es'}`, n.contacts ? `${n.contacts} contacts` : null].filter(Boolean).join(' · ')}
                  </span>{' '}
                  <Link to={`/customers/${c.id}`}>Open</Link>
                </span>
              </label>
            );
          })}
          <div className="row">
            <button onClick={() => void mergeGroup(i, g.customers)}>Merge into the selected one</button>
            <button className="secondary" onClick={() => setDismissed(new Set(dismissed).add(g.customers.map((c) => c.id).sort().join()))}>
              Not the same
            </button>
          </div>
        </div>
      ))}
    </section>
  );
}
