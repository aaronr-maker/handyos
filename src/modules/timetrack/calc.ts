import type { Id } from '@/core';

export interface CalcTask {
  id: Id;
  name: string;
}
export interface CalcEntry {
  id: Id;
  user_id: Id;
  clock_in: string;
  clock_out: string | null;
}
export interface CalcTimer {
  id: Id;
  task_id: Id;
  user_id: Id;
  started_at: string;
  ended_at: string | null;
}

export interface TaskTime {
  task_id: Id;
  /** Minutes a tech spent with this task's timer running. */
  direct: number;
  /** This task's even share of the job overhead (talking to the customer, cleanup, time between tasks). */
  overhead: number;
  total: number;
}

export interface TechTime {
  user_id: Id;
  job_minutes: number;
  task_minutes: number;
  overhead_minutes: number;
  tasks: TaskTime[];
}

export interface JobTime {
  techs: TechTime[];
  /** All techs together, per task. */
  tasks: TaskTime[];
  job_minutes: number;
  direct_minutes: number;
  overhead_minutes: number;
  /** Overhead that no task could take (the job has no tasks). */
  unassigned_minutes: number;
}

const MIN = 60_000;

/** Splits `total` whole minutes into `n` even parts that add up exactly (the first parts take the extra minutes). */
export function evenSplit(total: number, n: number): number[] {
  if (n <= 0) return [];
  const base = Math.floor(total / n);
  const extra = total - base * n;
  return Array.from({ length: n }, (_, i) => base + (i < extra ? 1 : 0));
}

/** Minutes of overlap between [a1,a2] and [b1,b2] (ms). */
const overlap = (a1: number, a2: number, b1: number, b2: number) => Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));

/**
 * The time on a job, the way the owner reads it. Each tech's time on the job is their direct task time (task timers
 * running) plus overhead (everything else on the job: customer talk, cleanup, time between tasks). The overhead is
 * split evenly across the tasks that tech worked, or across all the job's tasks when they timed none, and then every
 * tech's numbers are added together. Task timers are clipped to the time the tech was on the job.
 */
export function splitJobTime(i: { tasks: CalcTask[]; entries: CalcEntry[]; timers: CalcTimer[]; now?: number }): JobTime {
  const now = i.now ?? Date.now();
  const end = (iso: string | null) => (iso ? Date.parse(iso) : now);
  const order = i.tasks.map((t) => t.id);
  const byUser = new Map<Id, TechTime>();
  const taskTotals = new Map<Id, TaskTime>(i.tasks.map((t) => [t.id, { task_id: t.id, direct: 0, overhead: 0, total: 0 }]));
  let unassigned = 0;

  for (const e of i.entries) {
    const from = Date.parse(e.clock_in);
    const to = end(e.clock_out);
    const jobMs = Math.max(0, to - from);
    const mine = i.timers.filter((t) => t.user_id === e.user_id && order.includes(t.task_id));
    // time each task's timers ran inside this stretch of work
    const direct = new Map<Id, number>();
    for (const t of mine) {
      const ms = overlap(Date.parse(t.started_at), end(t.ended_at), from, to);
      if (ms > 0) direct.set(t.task_id, (direct.get(t.task_id) ?? 0) + ms);
    }
    const directMin = new Map<Id, number>([...direct].map(([id, ms]) => [id, Math.round(ms / MIN)]));
    const jobMin = Math.round(jobMs / MIN);
    const taskMin = Math.min(jobMin, [...directMin.values()].reduce((n, v) => n + v, 0));
    const overhead = jobMin - taskMin;
    // who takes the overhead: the tasks this tech timed, else every task of the job
    const timed = order.filter((id) => (directMin.get(id) ?? 0) > 0);
    const takers = timed.length ? timed : order;
    const shares = evenSplit(overhead, takers.length);

    const tech = byUser.get(e.user_id) ?? { user_id: e.user_id, job_minutes: 0, task_minutes: 0, overhead_minutes: 0, tasks: [] as TaskTime[] };
    tech.job_minutes += jobMin;
    tech.task_minutes += taskMin;
    tech.overhead_minutes += overhead;
    const add = (taskId: Id, d: number, o: number) => {
      let row = tech.tasks.find((t) => t.task_id === taskId);
      if (!row) tech.tasks.push((row = { task_id: taskId, direct: 0, overhead: 0, total: 0 }));
      row.direct += d;
      row.overhead += o;
      row.total += d + o;
      const all = taskTotals.get(taskId)!;
      all.direct += d;
      all.overhead += o;
      all.total += d + o;
    };
    for (const [id, m] of directMin) add(id, m, 0);
    if (takers.length === 0) unassigned += overhead;
    else takers.forEach((id, n) => shares[n] > 0 && add(id, 0, shares[n]));
    byUser.set(e.user_id, tech);
  }

  const techs = [...byUser.values()];
  const tasks = [...taskTotals.values()];
  return {
    techs,
    tasks,
    job_minutes: techs.reduce((n, t) => n + t.job_minutes, 0),
    direct_minutes: techs.reduce((n, t) => n + t.task_minutes, 0),
    overhead_minutes: techs.reduce((n, t) => n + t.overhead_minutes, 0),
    unassigned_minutes: unassigned,
  };
}

export type TimeFlagKind = 'open_entry' | 'no_task_timing' | 'overlapping_entries' | 'long_entry' | 'timer_outside_job' | 'task_timer_open_after_job';
export interface TimeFlag {
  kind: TimeFlagKind;
  user_id: Id | null;
  text: string;
}

/** Cross-checks on a job's time, in plain words, for the office to look at. */
export function checkJobTime(i: { tasks: CalcTask[]; entries: CalcEntry[]; timers: CalcTimer[]; jobDone: boolean; now?: number; nameOf?: (id: Id) => string }): TimeFlag[] {
  const now = i.now ?? Date.now();
  const name = i.nameOf ?? (() => 'A tech');
  const flags: TimeFlag[] = [];
  const end = (iso: string | null) => (iso ? Date.parse(iso) : now);
  for (const e of i.entries) {
    const hours = (end(e.clock_out) - Date.parse(e.clock_in)) / 3_600_000;
    if (e.clock_out === null && (i.jobDone || hours > 12)) flags.push({ kind: 'open_entry', user_id: e.user_id, text: `${name(e.user_id)} is still clocked in on this job (${hours.toFixed(1)} hours so far).` });
    else if (hours > 12) flags.push({ kind: 'long_entry', user_id: e.user_id, text: `${name(e.user_id)} has ${hours.toFixed(1)} hours in one stretch on this job. Check the clock-out time.` });
  }
  const users = [...new Set(i.entries.map((e) => e.user_id))];
  for (const u of users) {
    const mine = i.entries.filter((e) => e.user_id === u).sort((a, b) => a.clock_in.localeCompare(b.clock_in));
    for (let n = 1; n < mine.length; n++) if (Date.parse(mine[n].clock_in) < end(mine[n - 1].clock_out)) flags.push({ kind: 'overlapping_entries', user_id: u, text: `${name(u)} has two overlapping stretches on this job. Fix one of them.` });
  }
  for (const t of i.timers) {
    const entries = i.entries.filter((e) => e.user_id === t.user_id);
    const inside = entries.some((e) => Date.parse(t.started_at) >= Date.parse(e.clock_in) - MIN && end(t.ended_at) <= end(e.clock_out) + MIN);
    if (!inside) flags.push({ kind: 'timer_outside_job', user_id: t.user_id, text: `${name(t.user_id)} has a task timer that runs outside their time on the job. It is trimmed to the job time.` });
    if (t.ended_at === null && i.jobDone) flags.push({ kind: 'task_timer_open_after_job', user_id: t.user_id, text: `${name(t.user_id)} has a task timer still running on a finished job.` });
  }
  if (i.tasks.length >= 2 && i.timers.length === 0 && i.entries.length > 0) flags.push({ kind: 'no_task_timing', user_id: null, text: `This job has ${i.tasks.length} tasks but no task was timed, so all the time is shared evenly. The standard times will trust this job less.` });
  return flags;
}

/** Distance in meters between two points on the earth (for the arrival check). */
export function distanceMeters(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
