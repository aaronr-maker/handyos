import { listTeamMembers, type Id } from '@/core';
import { listAssignments, listJobs, listTimeEntries, type Job } from '@/modules/jobs';
import { listEdits, listShifts } from '@/modules/timetrack';
import { clockedWeek, efficiencyRate, projectWeek, scheduledRemaining, weekRange, type EfficiencySample, type ScheduledJob, type WeekProjection } from './calc';

/** Everything the projection needs, read once for the whole company. */
export async function loadTimeFacts(companyId: Id) {
  const [shifts, entries, jobs, assignments, edits] = await Promise.all([listShifts(companyId), listTimeEntries(companyId), listJobs(companyId), listAssignments(companyId), listEdits(companyId)]);
  return { shifts, entries, jobs, assignments, edits };
}
export type TimeFacts = Awaited<ReturnType<typeof loadTimeFacts>>;

const NINETY_DAYS = 90 * 86_400_000;

/** One person's efficiency rate from the jobs they finished in the last 90 days. */
export function efficiencyFor(facts: TimeFacts, userId: Id, now: number) {
  const samples: EfficiencySample[] = [];
  for (const j of facts.jobs) {
    if (j.status !== 'completed' || !j.scheduled_start || !j.scheduled_end || !j.completed_at || now - Date.parse(j.completed_at) > NINETY_DAYS) continue;
    const mine = facts.entries.filter((e) => e.job_id === j.id && e.user_id === userId && e.clock_out);
    if (mine.length === 0) continue;
    const actual = mine.reduce((n, e) => n + Math.round((Date.parse(e.clock_out!) - Date.parse(e.clock_in)) / 60000), 0);
    samples.push({ actual, scheduled: Math.round((Date.parse(j.scheduled_end) - Date.parse(j.scheduled_start)) / 60000) });
  }
  return efficiencyRate(samples);
}

/** Jobs assigned to a person that are still to be worked (scheduled or in progress). */
export function upcomingJobsFor(facts: TimeFacts, userId: Id): (Job & { scheduled_start: string; scheduled_end: string })[] {
  const mine = new Set(facts.assignments.filter((a) => a.user_id === userId).map((a) => a.job_id));
  return facts.jobs.filter((j): j is Job & { scheduled_start: string; scheduled_end: string } => mine.has(j.id) && j.status !== 'completed' && !!j.scheduled_start && !!j.scheduled_end);
}

export interface WeekReport extends WeekProjection {
  userId: Id;
  weekStart: number;
  weekEnd: number;
  byDay: ReturnType<typeof clockedWeek>['byDay'];
  upcoming: ScheduledJob[];
}

/** The week of one person: hours clocked, the time still scheduled, and where it adds up to. */
export function weekReport(facts: TimeFacts, userId: Id, date: Date, now = Date.now()): WeekReport {
  const { start, end } = weekRange(date);
  const clocked = clockedWeek({ shifts: facts.shifts.filter((s) => s.user_id === userId), entries: facts.entries.filter((e) => e.user_id === userId), from: start, to: end, now });
  const upcoming: ScheduledJob[] = upcomingJobsFor(facts, userId).map((j) => ({ id: j.id, start: j.scheduled_start, end: j.scheduled_end }));
  // only the rest of the current week is projected; an earlier or later week is just what was clocked
  const projecting = now >= start && now < end;
  const remaining = projecting ? scheduledRemaining(upcoming, now, end) : 0;
  const projection = projectWeek(clocked.total, remaining, efficiencyFor(facts, userId, now));
  return { ...projection, userId, weekStart: start, weekEnd: end, byDay: clocked.byDay, upcoming };
}

export { listTeamMembers };
