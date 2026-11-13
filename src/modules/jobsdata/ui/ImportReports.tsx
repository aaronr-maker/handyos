import { useState } from 'react';
import { resultError, useAction, useSession } from '@/core';
import { clearHistorySourceAction, importReportAction } from '../actions';
import { readReport, REPORT_LABEL, type Parsed } from '../parse';

interface Picked {
  name: string;
  parsed: Parsed | null;
  state: 'ready' | 'loading' | 'done' | 'failed';
  message?: string;
}

const countOf = (p: Parsed) => (p.kind === 'timesheets' ? p.summary.jobs.length : p.rows.length);
const unit = (p: Parsed) => (p.kind === 'timesheets' ? 'jobs with hours' : p.kind === 'salespeople' || p.kind === 'productivity' ? 'people' : 'rows');

/** Pick the report files from the old system; each is read, shown, and loaded when you say so. */
export function ImportReports() {
  const { companyId } = useSession();
  void companyId;
  const load = useAction(importReportAction);
  const clear = useAction(clearHistorySourceAction);
  const [source, setSource] = useState('jobber');
  const [files, setFiles] = useState<Picked[]>([]);
  const [note, setNote] = useState<string | null>(null);

  const pick = async (list: FileList | null) => {
    if (!list) return;
    setNote(null);
    const next: Picked[] = [];
    for (const f of Array.from(list)) {
      const parsed = readReport(await f.text());
      next.push({
        name: f.name,
        parsed,
        state: parsed ? 'ready' : 'failed',
        message: parsed ? undefined : 'I do not recognise this report. Use the Jobs, Invoices, Payments, Timesheets, Salesperson performance or Team productivity export.',
      });
    }
    setFiles(next);
  };
  const set = (i: number, patch: Partial<Picked>) => setFiles((fs) => fs.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const run = async (i: number) => {
    const f = files[i];
    if (!f.parsed) return;
    set(i, { state: 'loading', message: undefined });
    const input = f.parsed.kind === 'timesheets' ? { source, kind: 'timesheets' as const, summary: f.parsed.summary } : { source, kind: f.parsed.kind, rows: f.parsed.rows };
    const err = resultError(await load(input as never));
    set(i, err ? { state: 'failed', message: err } : { state: 'done', message: 'Loaded.' });
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: 12 }}>
        <h2>Bring in reports from your old system</h2>
        <p className="muted">
          Export these from the old system's Reports and choose the files here (you can pick several at once): <strong>jobs</strong>, <strong>invoices</strong>, <strong>payments</strong>,{' '}
          <strong>timesheets</strong>, <strong>salesperson performance</strong> and <strong>team productivity</strong>. Client emails and phone numbers are not kept. Loading the same kind of report
          again replaces the earlier one.
        </p>
        <label>
          Where are these reports from?
          <input value={source} onChange={(e) => setSource(e.target.value.toLowerCase().replace(/[^a-z0-9 _-]/g, ''))} />
        </label>
        <input type="file" accept=".csv,text/csv" multiple onChange={(e) => void pick(e.target.files)} />
      </div>
      {files.map((f, i) => (
        <div key={f.name} className="card" style={{ marginBottom: 12 }}>
          <div className="row" style={{ alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <strong>{f.parsed ? REPORT_LABEL[f.parsed.kind] : f.name}</strong>{' '}
              {f.parsed && (
                <span className="muted">
                  {countOf(f.parsed)} {unit(f.parsed)} · {f.name}
                </span>
              )}
              {f.message && <div className={f.state === 'failed' ? 'err' : 'muted'}>{f.message}</div>}
            </div>
            {f.parsed && f.state !== 'done' && (
              <button type="button" disabled={f.state === 'loading'} onClick={() => void run(i)}>
                {f.state === 'loading' ? 'Loading…' : `Load into "${source}"`}
              </button>
            )}
          </div>
        </div>
      ))}
      <div className="card">
        <h2>Start over</h2>
        <p className="muted">Removes everything that was loaded from "{source}". Your live jobs and invoices are not touched.</p>
        <button
          type="button"
          className="danger-button"
          onClick={async () => {
            if (!confirm(`Remove everything loaded from "${source}"? This can't be undone.`)) return;
            const err = resultError(await clear({ source }));
            setNote(err ?? `Removed what was loaded from "${source}".`);
          }}
        >
          Remove what was loaded from "{source}"
        </button>
        {note && <p className="notice">{note}</p>}
      </div>
    </div>
  );
}
