import type { Constraint, Kpi } from '../kpis';
import { COLORS, WORDS } from './palette';

const ICON = { good: '✔', watch: '!', bad: '✖', unknown: '?' } as const;

/** How to draw each number as a dial: the scale it lives on and where the target notch sits (a share of the dial; -1 for none). */
const DIALS: Record<string, { max: number; tick: number; low?: boolean; band?: [number, number] }> = {
  close_rate: { max: 0.6, tick: 0.4 / 0.6 },
  utilization: { max: 1, tick: 0.65 },
  backlog: { max: 8, tick: -1, band: [1.5, 6] },
  overdue: { max: 0.3, tick: 0.1 / 0.3, low: true },
  days_to_collect: { max: 30, tick: 14 / 30, low: true },
};

/** A half-circle dial: the filled part is the number, the notch is the target. */
function Gauge({ k, fill, tick, band }: { k: Kpi; fill: number; tick: number; band?: [number, number] }) {
  const R = 50;
  const pt = (f: number, r = R): [number, number] => [60 + r * Math.cos(Math.PI * (1 - f)), 60 - r * Math.sin(Math.PI * (1 - f))];
  const [fx, fy] = pt(Math.min(1, Math.max(0, fill)));
  const [t1x, t1y] = pt(tick, R - 9);
  const [t2x, t2y] = pt(tick, R + 7);
  const color = COLORS[k.status];
  return (
    <svg viewBox="0 0 120 72" width="100%" style={{ maxWidth: 190 }} role="img" aria-label={`${k.label}: ${k.value}. ${WORDS[k.status]}. Target ${k.target}.`}>
      <path d="M10 60 A50 50 0 0 1 110 60" fill="none" stroke="#e2e8f0" strokeWidth="9" strokeLinecap="round" />
      {band && (() => {
        const [ax, ay] = pt(band[0] / 8);
        const [bx, by] = pt(band[1] / 8);
        return <path d={`M${ax} ${ay} A50 50 0 0 1 ${bx} ${by}`} fill="none" stroke="#bbf7d0" strokeWidth="9" />;
      })()}
      {fill > 0.005 && <path d={`M10 60 A50 50 0 0 1 ${fx} ${fy}`} fill="none" stroke={color} strokeWidth="9" strokeLinecap="round" />}
      {tick >= 0 && <line x1={t1x} y1={t1y} x2={t2x} y2={t2y} stroke="#0f172a" strokeWidth="2" />}
    </svg>
  );
}

/** Last period against this period, as two bars, for numbers that have no fixed target. */
function Compare({ k }: { k: Kpi }) {
  if (k.raw === null) return <p className="muted small-note">Nothing to compare yet.</p>;
  if (k.previous === null) return null;
  const top = Math.max(Math.abs(k.raw), Math.abs(k.previous), 1e-9);
  const bar = (label: string, v: number, color: string) => (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '3px 0' }}>
      <span className="small-note muted" style={{ width: 64 }}>{label}</span>
      <div style={{ flex: 1, background: '#f1f5f9', borderRadius: 4, height: 10 }}>
        <div style={{ width: `${Math.max(2, (Math.abs(v) / top) * 100)}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
    </div>
  );
  return (
    <div style={{ width: '100%' }} role="img" aria-label={`Compared with the month before: ${k.previous} then ${k.raw}`}>
      {bar('Month before', k.previous, '#cbd5e1')}
      {bar('Now', k.raw, COLORS[k.status])}
    </div>
  );
}

const change = (k: Kpi) => {
  if (k.raw === null || k.previous === null || k.previous === 0) return null;
  const c = (k.raw - k.previous) / Math.abs(k.previous);
  return Math.abs(c) < 0.02 ? '→ same as the month before' : `${c > 0 ? '▲' : '▼'} ${Math.round(Math.abs(c) * 100)}% vs the month before`;
};

export function KpiTile({ k }: { k: Kpi }) {
  const dial = DIALS[k.id];
  const color = COLORS[k.status];
  const raw = k.raw;
  return (
    <div className="card kpi-tile" style={{ borderTop: `4px solid ${color}` }}>
      <div className="small-note muted">{k.label}</div>
      {dial && raw !== null ? <Gauge k={k} fill={raw / dial.max} tick={dial.tick} band={dial.band} /> : null}
      <div style={{ fontSize: '1.6rem', fontWeight: 700, lineHeight: 1.1 }}>{k.value ?? '—'}</div>
      <div style={{ color, fontWeight: 600, fontSize: '0.8rem' }}>
        {ICON[k.status]} {WORDS[k.status]}
      </div>
      {!dial && <Compare k={k} />}
      {change(k) && <div className="small-note muted">{change(k)}</div>}
      <div className="small-note muted">Target: {k.target}</div>
      {k.note && <div className="small-note muted">{k.note}</div>}
    </div>
  );
}

const STAGES: { id: Constraint['id']; label: string }[] = [
  { id: 'leads', label: 'Leads' },
  { id: 'sales', label: 'Sales' },
  { id: 'capacity', label: 'Work booked' },
  { id: 'profit', label: 'Profit' },
  { id: 'cash', label: 'Cash' },
];

/** The path from a call coming in to money coming back, with the stage holding things back lit up. */
export function Pipeline({ constraint }: { constraint: Constraint }) {
  const none = constraint.id === 'none' || constraint.id === 'unknown';
  return (
    <div className="pipeline" role="img" aria-label={`Business flow: ${STAGES.map((s) => s.label).join(', then ')}. ${none ? 'No stage stands out.' : `Held back at: ${STAGES.find((s) => s.id === constraint.id)?.label}.`}`}>
      {STAGES.map((s, i) => {
        const hit = s.id === constraint.id;
        return (
          <div key={s.id} className="pipe-wrap">
            <div className={hit ? 'pipe-stage pipe-hit' : 'pipe-stage'} style={{ opacity: none && constraint.id === 'unknown' ? 0.6 : 1 }}>
              {hit ? '⚠ ' : none && constraint.id === 'none' ? '✔ ' : ''}
              {s.label}
            </div>
            {i < STAGES.length - 1 && <span className="pipe-arrow">→</span>}
          </div>
        );
      })}
    </div>
  );
}

/** A horizontal bar inside a table cell. */
export function Bar({ value, max, color = '#0f766e', label }: { value: number; max: number; color?: string; label: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ flex: 1, minWidth: 60, background: '#f1f5f9', borderRadius: 4, height: 10 }} role="img" aria-label={label}>
        <div style={{ width: `${Math.min(100, Math.max(2, (value / (max || 1)) * 100))}%`, height: '100%', background: color, borderRadius: 4 }} />
      </div>
      <span>{label}</span>
    </div>
  );
}
