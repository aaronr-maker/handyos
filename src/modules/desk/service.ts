import { createRepo, listTeamMembers, type Id } from '@/core';
import { listAssignments } from '@/modules/jobs';
import { loadTimeFacts, weekReport, WEEK_LIMIT_MINUTES } from '@/modules/timesheets';
import type { AlertKind, DeskAlert } from './types';

const repo = createRepo<DeskAlert>('desk_alerts');

export const listAlerts = async (companyId: Id) => (await repo.list(companyId)).sort((a, b) => b.created_at.localeCompare(a.created_at));

const dayKey = (ms: number) => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const hm = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, '0')}m`;

/**
 * Looks at everyone's week and raises (or clears) alerts: someone projected over the weekly limit, or a clock left running.
 * An alert is raised once per person and week; one that was resolved or dismissed is not raised again.
 */
export async function refreshAlerts(companyId: Id, now = Date.now()): Promise<{ raised: number; cleared: number }> {
  const [facts, team, existing] = await Promise.all([loadTimeFacts(companyId), listTeamMembers(), repo.list(companyId)]);
  const nameOf = (id: string) => team.find((m) => m.id === id)?.full_name || team.find((m) => m.id === id)?.email || 'A team member';
  let raised = 0;
  let cleared = 0;

  const raise = async (kind: AlertKind, userId: Id, week: string, severity: DeskAlert['severity'], title: string, detail: string) => {
    const have = existing.find((a) => a.kind === kind && a.subject_user_id === userId && a.week_start === week);
    if (!have) {
      await repo.insert(companyId, { kind, subject_user_id: userId, week_start: week, severity, title, detail, status: 'open', resolved_by: null, resolved_at: null, resolution: null });
      raised++;
    } else if (have.status === 'open' && (have.detail !== detail || have.severity !== severity)) await repo.update(companyId, have.id, { title, detail, severity });
  };
  const clear = async (kind: AlertKind, userId: Id, week: string, why: string) => {
    const have = existing.find((a) => a.kind === kind && a.subject_user_id === userId && a.week_start === week && a.status === 'open');
    if (have) {
      await repo.update(companyId, have.id, { status: 'resolved', resolved_at: new Date(now).toISOString(), resolution: why });
      cleared++;
    }
  };

  const assigned = new Set((await listAssignments(companyId)).map((a) => a.user_id));
  for (const m of team) {
    if (!assigned.has(m.id) && !facts.shifts.some((s) => s.user_id === m.id) && !facts.entries.some((e) => e.user_id === m.id)) continue;
    const r = weekReport(facts, m.id, new Date(now), now);
    const week = dayKey(r.weekStart);
    if (r.over) {
      await raise('overtime_risk', m.id, week, r.projected > r.limit + 4 * 60 ? 'critical' : 'warning', `${nameOf(m.id)} is heading for ${hm(r.projected)} this week`, `${hm(r.clocked)} clocked + ${hm(r.scheduled_remaining)} scheduled ahead × ${r.efficiency.rate.toFixed(2)} efficiency = ${hm(r.projected)}, over the ${r.limit / 60}-hour limit.`);
    } else await clear('overtime_risk', m.id, week, `Back under the limit (${hm(r.projected)} projected).`);

    const openShift = facts.shifts.find((s) => s.user_id === m.id && s.clock_out === null);
    const openJob = facts.entries.find((e) => e.user_id === m.id && e.clock_out === null);
    const stale = (iso: string, hours: number) => now - Date.parse(iso) > hours * 3_600_000;
    if ((openShift && stale(openShift.clock_in, 14)) || (openJob && stale(openJob.clock_in, 12))) await raise('forgotten_clock', m.id, week, 'warning', `${nameOf(m.id)} may have left a clock running`, 'Their day clock or job time has been running for a very long time. Check their timesheet and fix the end time.');
    else await clear('forgotten_clock', m.id, week, 'The clock was stopped.');
  }
  return { raised, cleared };
}

export async function closeAlert(companyId: Id, id: Id, by: Id, status: 'resolved' | 'dismissed', resolution: string | null): Promise<DeskAlert> {
  const a = await repo.get(companyId, id);
  if (!a) throw new Error('Alert not found');
  return repo.update(companyId, id, { status, resolved_by: by, resolved_at: new Date().toISOString(), resolution });
}

export { WEEK_LIMIT_MINUTES };
