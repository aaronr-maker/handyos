import { useMemo, useState } from 'react';
import { formatMoney, listTeamMembers, parseMoney, resultError, useAction, useAsync, useSession } from '@/core';
import { savePayForPerformanceAction } from '../p4pActions';
import { computeP4P, validateSetup } from '../p4pCalc';
import { BASIS_LABELS, KIND_LABELS, type LevelKind, type P4PBasis } from '../p4pTypes';
import { getSetup } from '../services/p4pService';

interface LevelRow {
  id: string;
  name: string;
  kind: LevelKind;
  /** Typed as text, e.g. "12.5" */
  percent: string;
}
interface PersonRow {
  level_id: string | null;
  reports_to: string | null;
}

const pctToBps = (t: string) => Math.round((Number(t) || 0) * 100);
const bpsToPct = (b: number) => String(b / 100);
let counter = 0;
const tempId = () => `new-${++counter}`;

/** A typical starting point, matching how many companies share it out. Everything can be changed or renamed. */
const TYPICAL: { reserve: string; levels: Omit<LevelRow, 'id'>[] } = {
  reserve: '20',
  levels: [
    { name: 'Sales', kind: 'seller', percent: '10' },
    { name: 'Technician', kind: 'worker', percent: '50' },
    { name: 'General Foreman', kind: 'supervisor', percent: '15' },
    { name: 'Regional Manager', kind: 'supervisor', percent: '5' },
  ],
};

const COLORS = ['#0f766e', '#2563eb', '#9333ea', '#d97706', '#db2777', '#4d7c0f', '#0891b2', '#b45309'];

/** Settings for pay-for-performance: what the pool is, what the company keeps, who gets what, and who reports to whom. */
export default function P4PSettings() {
  const { companyId, role } = useSession();
  const save = useAction(savePayForPerformanceAction);
  const loaded = useAsync(async () => ({ setup: await getSetup(companyId), team: await listTeamMembers() }), [companyId]);
  // kept here, outside the editor, because the editor reloads itself with the saved ids after a save
  const [saved, setSaved] = useState<string | null>(null);

  if (role !== 'owner' && role !== 'admin') return <p className="muted">Only the owner and admins can change pay-for-performance.</p>;
  if (loaded.loading) return <p className="muted">Loading…</p>;
  if (!loaded.data) return <p className="err">{loaded.error ?? 'Could not load the settings.'}</p>;
  return (
    <Editor
      key={loaded.data.setup.levels.map((l) => l.id).join(',')}
      data={loaded.data}
      save={save}
      saved={saved}
      onSaved={(text) => {
        setSaved(text);
        loaded.reload();
      }}
      onEdited={() => setSaved(null)}
    />
  );
}

type Data = NonNullable<ReturnType<typeof useAsync<{ setup: Awaited<ReturnType<typeof getSetup>>; team: Awaited<ReturnType<typeof listTeamMembers>> }>>['data']>;

function Editor({ data, save, saved, onSaved, onEdited }: { data: Data; save: ReturnType<typeof useAction<(typeof savePayForPerformanceAction)['input'], unknown>>; saved: string | null; onSaved(text: string): void; onEdited(): void }) {
  const { setup, team } = data;
  const [basis, setBasis] = useState<P4PBasis>(setup.basis);
  const [reserve, setReserve] = useState(bpsToPct(setup.company_reserve_bps));
  const [levels, setLevels] = useState<LevelRow[]>(setup.levels.map((l) => ({ id: l.id, name: l.name, kind: l.kind, percent: bpsToPct(l.percent_bps) })));
  const [people, setPeople] = useState<Record<string, PersonRow>>(() =>
    Object.fromEntries(setup.structure.map((s) => [s.user_id, { level_id: s.level_id, reports_to: s.reports_to }])),
  );
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sample, setSample] = useState({ revenue: '1000', other: '200', labor: '200', hoursA: '5', hoursB: '5' });

  const reserveBps = pctToBps(reserve);
  const bps = levels.map((l) => pctToBps(l.percent));
  const allocated = bps.reduce((n, x) => n + x, 0);
  const problem = validateSetup(reserveBps, levels.map((l, i) => ({ name: l.name, kind: l.kind, percent_bps: bps[i] })));
  const basisName = BASIS_LABELS[basis].title.toLowerCase();

  const setLevel = (id: string, patch: Partial<LevelRow>) => {
    onEdited();
    setLevels(levels.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  };
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= levels.length) return;
    const next = [...levels];
    [next[i], next[j]] = [next[j], next[i]];
    setLevels(next);
  };
  const hasKind = (k: LevelKind) => levels.some((l) => l.kind === k);
  const levelName = (id: string | null) => levels.find((l) => l.id === id)?.name;

  const preview = useMemo(() => {
    const money = (t: string) => parseMoney(t) ?? 0;
    const supervisors = levels.filter((l) => l.kind === 'supervisor');
    const reports: Record<string, string | null> = { A: supervisors[0] ? 'boss0' : null, B: supervisors[0] ? 'boss0' : null };
    supervisors.forEach((_, i) => (reports[`boss${i}`] = i + 1 < supervisors.length ? `boss${i + 1}` : null));
    const names: Record<string, string> = { seller: 'the seller', A: `${levels.find((l) => l.kind === 'worker')?.name ?? 'worker'} A`, B: `${levels.find((l) => l.kind === 'worker')?.name ?? 'worker'} B` };
    supervisors.forEach((s, i) => (names[`boss${i}`] = `the ${s.name}`));
    const result = computeP4P({
      basis,
      company_reserve_bps: reserveBps,
      levels: levels.map((l, i) => ({ id: l.id, name: l.name || 'Unnamed level', kind: l.kind, percent_bps: bps[i], sort_order: i })),
      reports_to: reports,
      revenue_cents: money(sample.revenue),
      non_labor_cost_cents: money(sample.other),
      total_cost_cents: money(sample.other) + money(sample.labor),
      sold_by: 'seller',
      minutes: { A: Math.round((Number(sample.hoursA) || 0) * 60), B: Math.round((Number(sample.hoursB) || 0) * 60) },
    });
    return { result, names };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed whenever any input changes
  }, [basis, reserve, levels, sample]);

  const submit = async () => {
    setMessage(null);
    if (problem) return setMessage({ ok: false, text: problem });
    setBusy(true);
    const res = await save({
      basis,
      company_reserve_bps: reserveBps,
      levels: levels.map((l, i) => ({ id: l.id, name: l.name.trim(), kind: l.kind, percent_bps: bps[i] })),
      people: team
        .map((m) => ({ user_id: m.id, level_id: people[m.id]?.level_id ?? null, reports_to: people[m.id]?.reports_to ?? null }))
        .filter((p) => p.level_id || p.reports_to),
    });
    setBusy(false);
    const err = resultError(res);
    if (err) setMessage({ ok: false, text: err });
    else onSaved('Saved. New jobs use this setup. Jobs that were already paid out keep what they earned.');
  };

  return (
    <section className="page">
      <div className="card">
        <h2>1. What is the pool based on?</h2>
        <p className="muted">The pool is a share of each job. Pick what it is taken from.</p>
        <div className="choices">
          {(Object.keys(BASIS_LABELS) as P4PBasis[]).map((b) => (
            <label key={b} className={`choice-card ${basis === b ? 'on' : ''}`}>
              <input type="radio" name="basis" checked={basis === b} onChange={() => {
                onEdited();
                setBasis(b);
              }} />
              <strong>{BASIS_LABELS[b].title}</strong>
              <span className="muted">{BASIS_LABELS[b].detail}</span>
            </label>
          ))}
        </div>
      </div>

      <div className="card">
        <h2>2. What does the company keep first?</h2>
        <p className="muted">A protected share comes off the top before anyone else is paid. Whatever is left is the pool.</p>
        <label>
          Company keeps (% of the {basisName})
          <input
            inputMode="decimal"
            value={reserve}
            onChange={(e) => {
              onEdited();
              setReserve(e.target.value);
            }}
          />
        </label>
      </div>

      <div className="card">
        <h2>3. How is the pool shared out?</h2>
        <p className="muted">Each level takes a percent of the pool. Rename them however you like and add as many as you need.</p>

        {levels.length === 0 && (
          <div className="notice">
            <p>No levels yet, so nothing is paid out.</p>
            <button
              type="button"
              onClick={() => {
                setReserve(TYPICAL.reserve);
                setLevels(TYPICAL.levels.map((l) => ({ ...l, id: tempId() })));
              }}
            >
              Start with a typical setup
            </button>
          </div>
        )}

        {levels.map((l, i) => (
          <div key={l.id} className="level">
            <div className="level-head">
              <span className="swatch" style={{ background: COLORS[i % COLORS.length] }} />
              <input aria-label="Level name" className="grow" value={l.name} onChange={(e) => setLevel(l.id, { name: e.target.value })} placeholder="Name this level" />
              <div className="row small">
                <button type="button" className="link" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                  ↑
                </button>
                <button type="button" className="link" disabled={i === levels.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                  ↓
                </button>
                <button
                  type="button"
                  className="link"
                  onClick={() => {
                    if (!confirm(`Remove "${l.name || 'this level'}"?`)) return;
                    setLevels(levels.filter((x) => x.id !== l.id));
                    setPeople(Object.fromEntries(Object.entries(people).map(([u, p]) => [u, p.level_id === l.id ? { ...p, level_id: null } : p])));
                  }}
                >
                  Remove
                </button>
              </div>
            </div>
            <div className="row">
              <label className="grow">
                What this level does
                <select value={l.kind} onChange={(e) => setLevel(l.id, { kind: e.target.value as LevelKind })}>
                  {(Object.keys(KIND_LABELS) as LevelKind[]).map((k) => (
                    <option key={k} value={k}>
                      {KIND_LABELS[k]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Share of the pool (%)
                <input inputMode="decimal" value={l.percent} onChange={(e) => setLevel(l.id, { percent: e.target.value })} />
              </label>
            </div>
            <p className="muted small-note">
              {l.kind === 'seller' && 'Paid to whoever sold the job.'}
              {l.kind === 'worker' && 'Shared by everyone who clocked time on the job, by their share of the hours. Two people at 5 hours each get 50% each; one person gets all of it.'}
              {l.kind === 'supervisor' && (levels[i - 1] ? `Paid to whoever the people on the "${levels[i - 1].name || 'previous'}" level report to (set under "Your team" below).` : 'Paid to the bosses of the level above it. Put this level below the one it oversees.')}
            </p>
          </div>
        ))}

        <div className="row">
          <button type="button" className="secondary" onClick={() => setLevels([...levels, { id: tempId(), name: '', kind: 'supervisor', percent: '5' }])}>
            + Add a level
          </button>
          {!hasKind('worker') && (
            <button type="button" className="secondary" onClick={() => setLevels([...levels, { id: tempId(), name: 'Technician', kind: 'worker', percent: '50' }])}>
              + Add the level that works jobs
            </button>
          )}
          {!hasKind('seller') && (
            <button type="button" className="secondary" onClick={() => setLevels([...levels, { id: tempId(), name: 'Sales', kind: 'seller', percent: '10' }])}>
              + Add a seller level
            </button>
          )}
        </div>

        <div className="bar" aria-hidden="true">
          {levels.map((l, i) => (
            <span key={l.id} style={{ width: `${Math.min(100, bps[i] / 100)}%`, background: COLORS[i % COLORS.length] }} title={`${l.name}: ${bps[i] / 100}%`} />
          ))}
        </div>
        <p className={allocated > 10000 ? 'err' : 'muted'}>
          {levels.length === 0
            ? ''
            : allocated > 10000
              ? `These add up to ${allocated / 100}%, which is more than the whole pool.`
              : `Shared out: ${allocated / 100}% of the pool.${allocated < 10000 ? ` The other ${(10000 - allocated) / 100}% stays with the company.` : ''}`}
        </p>
      </div>

      <div className="card">
        <h2>4. Your team</h2>
        <p className="muted">Say which level each person is on, and who they report to. Supervisor levels are paid to the people others report to.</p>
        {team.map((m) => {
          const p = people[m.id] ?? { level_id: null, reports_to: null };
          const label = m.full_name || m.email || 'Team member';
          return (
            <div key={m.id} className="person">
              <strong>{label}</strong>
              <div className="row">
                <label className="grow">
                  Level
                  <select value={p.level_id ?? ''} onChange={(e) => setPeople({ ...people, [m.id]: { ...p, level_id: e.target.value || null } })}>
                    <option value="">(not on a level)</option>
                    {levels.map((l) => (
                      <option key={l.id} value={l.id}>
                        {l.name || 'Unnamed level'}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="grow">
                  Reports to
                  <select value={p.reports_to ?? ''} onChange={(e) => setPeople({ ...people, [m.id]: { ...p, reports_to: e.target.value || null } })}>
                    <option value="">(nobody)</option>
                    {team
                      .filter((o) => o.id !== m.id)
                      .map((o) => (
                        <option key={o.id} value={o.id}>
                          {(o.full_name || o.email || 'Team member') + (levelName(people[o.id]?.level_id ?? null) ? ` (${levelName(people[o.id]?.level_id ?? null)})` : '')}
                        </option>
                      ))}
                  </select>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      <div className="card">
        <h2>Try it out</h2>
        <p className="muted">See what your setup pays on an example job with two workers.</p>
        <div className="row">
          {(
            [
              ['revenue', 'Invoiced ($)'],
              ['other', 'Materials & other ($)'],
              ['labor', 'Labor cost ($)'],
              ['hoursA', 'Worker A hours'],
              ['hoursB', 'Worker B hours'],
            ] as const
          ).map(([k, label]) => (
            <label key={k} className="grow">
              {label}
              <input inputMode="decimal" value={sample[k]} onChange={(e) => setSample({ ...sample, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <dl className="totals">
          <dt>{BASIS_LABELS[basis].title} for the job</dt>
          <dd>{formatMoney(preview.result.basis_cents)}</dd>
          <dt>Company keeps first ({reserveBps / 100}%)</dt>
          <dd>{formatMoney(preview.result.reserve_cents)}</dd>
          <dt>
            <strong>The pool</strong>
          </dt>
          <dd>
            <strong>{formatMoney(preview.result.pool_cents)}</strong>
          </dd>
          {preview.result.levels.map((l) => (
            <FragmentRow key={l.level_id} level={l} names={preview.names} />
          ))}
          <dt>
            <strong>Company total</strong>
          </dt>
          <dd>
            <strong>{formatMoney(preview.result.company_total_cents)}</strong>
          </dd>
        </dl>
      </div>

      {saved && <p className="notice">{saved}</p>}
      {message && <p className="err">{message.text}</p>}
      {!message && !saved && problem && <p className="err">{problem}</p>}
      <button disabled={busy} onClick={() => void submit()}>
        {busy ? 'Saving…' : 'Save pay-for-performance'}
      </button>
    </section>
  );
}

function FragmentRow({ level, names }: { level: ReturnType<typeof computeP4P>['levels'][number]; names: Record<string, string> }) {
  return (
    <>
      <dt>
        {level.name || 'Unnamed level'} ({level.percent_bps / 100}%)
        <div className="muted small-note">
          {level.allocations.map((a) => `${names[a.user_id] ?? 'someone'} ${formatMoney(a.amount_cents)}`).join(', ') || 'nobody'}
          {level.unallocated_cents > 0 && ` · ${formatMoney(level.unallocated_cents)} stays with the company`}
        </div>
      </dt>
      <dd>{formatMoney(level.amount_cents)}</dd>
    </>
  );
}
