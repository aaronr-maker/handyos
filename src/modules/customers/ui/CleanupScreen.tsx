import { useState } from 'react';
import { Link } from 'react-router-dom';
import { resultError, useAction, useAsync, useSession } from '@/core';
import { deleteCustomerAction } from '../actions';
import { phoneOnlyCustomers } from '../cleanup';
import { listAllProperties, listCustomers } from '../services/customerService';

/** Finds customers that are only a phone number (no name, no address) and deletes the ones you tick. */
export default function CleanupScreen() {
  const { companyId } = useSession();
  const remove = useAction(deleteCustomerAction);
  const { data, loading, error, reload } = useAsync(async () => ({ customers: await listCustomers(companyId), properties: await listAllProperties(companyId) }), [companyId]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  // anyone tied to an address in the past is also protected when the delete runs
  const withAddress = new Set((data?.properties ?? []).map((p) => p.customer_id).filter((x): x is string => !!x));
  const found = data ? phoneOnlyCustomers(data.customers, (id) => withAddress.has(id)) : [];
  const toggle = (id: string) => setPicked((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));
  const chosen = found.filter((c) => picked.has(c.id));

  const run = async () => {
    if (chosen.length === 0 || !confirm(`Delete ${chosen.length} customer${chosen.length === 1 ? '' : 's'}? This can't be undone.`)) return;
    setBusy(true);
    setNote(null);
    let gone = 0;
    let kept = 0;
    for (const c of chosen) {
      // anyone used by a job, estimate or invoice is protected by the delete itself
      if (resultError(await remove({ customer_id: c.id }))) kept++;
      else gone++;
    }
    setBusy(false);
    setPicked(new Set());
    setNote(`Deleted ${gone}.${kept ? ` Kept ${kept} that are used by jobs, estimates or invoices.` : ''}`);
    reload();
  };

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Customers
      </Link>
      <header className="page-header">
        <div>
          <h1>Clean up</h1>
          <p className="muted">Customers that are just a phone number: no name and no address.</p>
        </div>
      </header>
      {note && <p className="notice">{note}</p>}
      {error && <p className="err">{error}</p>}
      {loading && <p className="muted">Looking…</p>}
      {data && found.length === 0 && (
        <div className="card">
          <p className="muted">Nothing to clean up. Every customer has a name or an address.</p>
        </div>
      )}
      {found.length > 0 && (
        <div className="card">
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <strong>{found.length} found</strong>
            <div className="row">
              <button className="secondary" onClick={() => setPicked(new Set(picked.size === found.length ? [] : found.map((c) => c.id)))}>
                {picked.size === found.length ? 'Select none' : 'Select all'}
              </button>
              <button className="danger-button" disabled={busy || chosen.length === 0} onClick={() => void run()}>
                Delete {chosen.length || ''} selected
              </button>
            </div>
          </div>
          {found.map((c) => (
            <label key={c.id} className="check dup-row">
              <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} />
              <span>
                <strong>{c.phone || c.name || 'No details at all'}</strong>
                <span className="muted small-note" style={{ display: 'block' }}>
                  {[c.email, c.notes ? 'has notes' : '', `added ${new Date(c.created_at).toLocaleDateString('en-US')}`].filter(Boolean).join(' · ')}
                </span>
              </span>
            </label>
          ))}
        </div>
      )}
    </section>
  );
}
