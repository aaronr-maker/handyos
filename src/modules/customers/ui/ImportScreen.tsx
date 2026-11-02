import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { parseCsv, resultError, useAction, useSession, useAsync } from '@/core';
import { importCustomersAction } from '../actions';
import { FIELDS, FIELD_LABELS, autoMap, detectSource, duplicateKeys, mapRow, type Field, type ImportRow, type Mapping } from '../import/mapping';
import { listCustomers } from '../services/customerService';

const CHUNK = 100;

/** Upload a CSV exported from another system, review what will happen, then import. */
export default function ImportScreen() {
  const { companyId } = useSession();
  const runImport = useAction(importCustomersAction);
  const existing = useAsync(() => listCustomers(companyId), [companyId]);

  const [fileName, setFileName] = useState('');
  const [table, setTable] = useState<{ headers: string[]; data: string[][] } | null>(null);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<{ created: number; skipped: number; properties: number } | null>(null);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    setResult(null);
    if (!/\.csv$/i.test(file.name)) {
      setError('Please choose a .csv file. If you have a .zip, unzip it first.');
      return;
    }
    const rows = parseCsv(await file.text());
    if (rows.length < 2) {
      setError('That file has no customers in it.');
      return;
    }
    const [headers, ...data] = rows;
    setFileName(file.name);
    setTable({ headers, data });
    setMapping(autoMap(headers));
  };

  const source = table ? detectSource(table.headers) : 'Other';
  const mapped = useMemo(() => {
    if (!table || !mapping) return null;
    const rows: ImportRow[] = [];
    const problems: number[] = [];
    let warnings = 0;
    table.data.forEach((r, i) => {
      const record = Object.fromEntries(table.headers.map((h, j) => [h, r[j] ?? '']));
      const m = mapRow(record, table.headers, mapping, source);
      warnings += m.warnings.length;
      if (m.row) rows.push(m.row);
      else problems.push(i + 2);
    });
    return { rows, problems, warnings };
  }, [table, mapping, source]);

  const have = useMemo(() => {
    const keys = new Set<string>();
    for (const c of existing.data ?? []) {
      if (c.external_ref) keys.add(`x:${c.external_ref}`);
      duplicateKeys({ ...c, external_ref: null }).forEach((k) => keys.add(k));
    }
    return keys;
  }, [existing.data]);

  const summary = useMemo(() => {
    if (!mapped) return null;
    const isNew = (r: ImportRow) =>
      !(r.external_ref ? [`x:${r.external_ref}`] : duplicateKeys({ ...r, external_ref: null, street: r.addresses[0]?.address_line1 })).some((k) => have.has(k));
    const fresh = mapped.rows.filter(isNew);
    return {
      fresh,
      already: mapped.rows.length - fresh.length,
      managers: fresh.filter((r) => r.is_property_manager).length,
      properties: fresh.reduce((n, r) => n + r.addresses.length, 0),
    };
  }, [mapped, have]);

  const start = async () => {
    if (!summary) return;
    setBusy(true);
    setError(null);
    let created = 0;
    let skipped = 0;
    let properties = 0;
    try {
      const rows = mapped!.rows;
      for (let i = 0; i < rows.length; i += CHUNK) {
        const res = await runImport({ rows: rows.slice(i, i + CHUNK), skip_duplicates: true });
        const message = resultError(res);
        if (message) throw new Error(message);
        if (res.status === 'ok') {
          created += res.output.created;
          skipped += res.output.skipped_duplicates;
          properties += res.output.properties_created;
        }
        setProgress(Math.min(rows.length, i + CHUNK));
      }
      setResult({ created, skipped, properties });
      existing.reload();
    } catch (err) {
      setError(
        `${err instanceof Error ? err.message : 'Import failed'}. ${created} customers were saved before this stopped; running the import again is safe and will skip them.`,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page">
      <Link to=".." relative="path" className="muted">
        ← Customers
      </Link>
      <header className="page-header">
        <div>
          <h1>Import customers</h1>
          <p className="muted">From Housecall Pro, Jobber or any customer list saved as CSV.</p>
        </div>
      </header>

      <div className="card">
        <label>
          Choose your customer export (.csv)
          <input type="file" accept=".csv,text/csv" onChange={(e) => void onFile(e.target.files?.[0])} />
        </label>
        {error && <p className="err">{error}</p>}
        {result && (
          <p className="notice">
            Done. Added {result.created} customers and {result.properties} properties.
            {result.skipped > 0 && ` Skipped ${result.skipped} that were already here.`}{' '}
            <Link to=".." relative="path">
              See your customers
            </Link>
          </p>
        )}
      </div>

      {table && mapped && summary && !result && (
        <>
          <div className="card">
            <h2>Ready to import</h2>
            <p className="muted">
              {fileName} · looks like a <strong>{source}</strong> export
            </p>
            <ul className="checklist">
              <li>
                <strong>{summary.fresh.length}</strong> new customers
                {summary.already > 0 && ` (${summary.already} already here and will be skipped)`}
              </li>
              <li>
                <strong>{summary.properties}</strong> properties from their addresses
              </li>
              {summary.managers > 0 && (
                <li>
                  <strong>{summary.managers}</strong> property managers (their addresses become managed rentals with no owner listed yet)
                </li>
              )}
              {mapped.problems.length > 0 && (
                <li className="err">
                  {mapped.problems.length} rows can't be imported (no name), on rows {mapped.problems.slice(0, 8).join(', ')}
                  {mapped.problems.length > 8 ? '…' : ''}
                </li>
              )}
              {mapped.warnings > 0 && <li>{mapped.warnings} small things were adjusted (for example an invalid email was left out).</li>}
            </ul>
            <button disabled={busy || summary.fresh.length === 0} onClick={() => void start()}>
              {busy ? `Importing… ${progress} of ${mapped.rows.length}` : `Import ${summary.fresh.length} customers`}
            </button>
          </div>

          <div className="card">
            <h2>A few of them</h2>
            <div className="list">
              {summary.fresh.slice(0, 6).map((r, i) => (
                <div key={i} className="stack">
                  <strong>{[r.first_name, r.last_name].filter(Boolean).join(' ') || r.company_name}</strong>
                  <span className="muted">
                    {[r.company_name && (r.first_name || r.last_name) ? r.company_name : null, r.phone, r.email, `${r.addresses.length} address${r.addresses.length === 1 ? '' : 'es'}`]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <details className="card">
            <summary>Columns look wrong? Adjust them</summary>
            <p className="muted">Each item below is matched to a column in your file. Change any that are off.</p>
            {FIELDS.map((f: Field) => (
              <label key={f}>
                {FIELD_LABELS[f]}
                <select value={mapping![f] ?? ''} onChange={(e) => setMapping({ ...mapping!, [f]: e.target.value || null })}>
                  <option value="">(none)</option>
                  {table.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </details>
        </>
      )}
    </section>
  );
}
