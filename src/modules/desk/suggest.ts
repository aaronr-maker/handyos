import type { Id } from '@/core';
import { efficiencyFor, upcomingJobsFor, weekReport, type TimeFacts } from '@/modules/timesheets';

export interface Reassignment {
  jobId: Id;
  jobTitle: string;
  start: string;
  toUserId: Id;
  /** The new person's projected week after taking the job, in minutes. */
  toProjected: number;
  /** How much less the over-booked person has to work, in minutes (the job's scheduled time x their efficiency rate). */
  savedMinutes: number;
}

const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => Date.parse(a.start) < Date.parse(b.end) && Date.parse(b.start) < Date.parse(a.end);

/**
 * Handy's suggestion for someone heading over the weekly limit: move upcoming jobs (the latest ones first, none that have
 * started) to people who would stay under the limit and are free at that time, until the week fits. People with the
 * most room are tried first. Returns nothing when no one can take a job.
 */
export function suggestReassignments(i: { facts: TimeFacts; overUser: Id; candidates: Id[]; now: number; limit: number }): Reassignment[] {
  const { facts, now, limit } = i;
  const mine = weekReport(facts, i.overUser, new Date(now), now);
  let projected = mine.projected;
  const eff = efficiencyFor(facts, i.overUser, now).rate;
  const jobs = upcomingJobsFor(facts, i.overUser)
    .filter((j) => Date.parse(j.scheduled_start) > now && Date.parse(j.scheduled_start) < mine.weekEnd)
    .sort((a, b) => b.scheduled_start.localeCompare(a.scheduled_start));
  // what each candidate already has, updated as jobs are given to them
  const load = new Map(i.candidates.map((id) => [id, { report: weekReport(facts, id, new Date(now), now), extra: [] as { start: string; end: string }[], added: 0 }]));
  const out: Reassignment[] = [];
  for (const j of jobs) {
    if (projected <= limit) break;
    const minutes = Math.round((Date.parse(j.scheduled_end) - Date.parse(j.scheduled_start)) / 60000);
    const ranked = [...load.entries()]
      .filter(([id]) => !facts.assignments.some((a) => a.job_id === j.id && a.user_id === id))
      .map(([id, l]) => ({ id, l, after: l.report.projected + l.added + Math.round(minutes * efficiencyFor(facts, id, now).rate) }))
      .filter((c) => c.after <= limit)
      .filter((c) => !upcomingJobsFor(facts, c.id).some((u) => overlaps({ start: u.scheduled_start, end: u.scheduled_end }, { start: j.scheduled_start, end: j.scheduled_end })) && !c.l.extra.some((x) => overlaps(x, { start: j.scheduled_start, end: j.scheduled_end })))
      .sort((a, b) => a.after - b.after);
    const pick = ranked[0];
    if (!pick) continue;
    const saved = Math.round(minutes * eff);
    pick.l.added += Math.round(minutes * efficiencyFor(facts, pick.id, now).rate);
    pick.l.extra.push({ start: j.scheduled_start, end: j.scheduled_end });
    projected -= saved;
    out.push({ jobId: j.id, jobTitle: j.title, start: j.scheduled_start, toUserId: pick.id, toProjected: pick.after, savedMinutes: saved });
  }
  return out;
}

export interface Assignee {
  userId: Id;
  /** Their projected week after taking the job, in minutes. */
  projected: number;
}

/** Who could take a job nobody is assigned to: people free at that time who stay under the limit, the one with the most room first. */
export function suggestAssignees(i: { facts: TimeFacts; job: { id: Id; scheduled_start: string; scheduled_end: string }; candidates: Id[]; now: number; limit: number }): Assignee[] {
  const minutes = Math.round((Date.parse(i.job.scheduled_end) - Date.parse(i.job.scheduled_start)) / 60000);
  return i.candidates
    .filter((id) => !upcomingJobsFor(i.facts, id).some((u) => overlaps({ start: u.scheduled_start, end: u.scheduled_end }, { start: i.job.scheduled_start, end: i.job.scheduled_end })))
    .map((id) => ({ userId: id, projected: weekReport(i.facts, id, new Date(i.now), i.now).projected + Math.round(minutes * efficiencyFor(i.facts, id, i.now).rate) }))
    .filter((c) => c.projected <= i.limit)
    .sort((a, b) => a.projected - b.projected);
}
