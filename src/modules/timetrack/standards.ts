import type { Id } from '@/core';
import { splitJobTime, type CalcEntry, type CalcTimer } from './calc';

/**
 * Standard times: how long a service takes per unit (minutes per foot, per each, per hour...), learned from the company's own
 * jobs. Two sources, best first:
 *  - measured: a tech timed the task, so that job gives the time directly;
 *  - inferred: a job where no task was timed gives one equation (all the time on the job = quantities x times + visit overhead);
 *    jobs with one service anchor it, and each mixed job sharpens it. Solved with non-negative least squares.
 * Everything comes with how many jobs it rests on and a confidence, and is labeled "learning" until there is enough.
 */
export interface StandardTask {
  id: Id;
  job_id: Id;
  name: string;
  /** The price book item it is; otherwise the name (lowercased) identifies the service. */
  price_book_item_id: string | null;
  quantity: number;
  unit: string;
}

export interface StandardJob {
  id: Id;
  title: string;
  completed: boolean;
}

export interface StandardInput {
  jobs: StandardJob[];
  tasks: StandardTask[];
  entries: (CalcEntry & { job_id: Id })[];
  timers: CalcTimer[];
}

export type Confidence = 'good' | 'some' | 'learning';

export interface ServiceStandard {
  key: string;
  name: string;
  unit: string;
  /** Minutes per unit, or null when nothing is known yet. */
  minutes_per_unit: number | null;
  source: 'measured' | 'inferred' | null;
  measured_tasks: number;
  inferred_jobs: number;
  /** Spread of the measured times (standard deviation over the mean); null with fewer than two. */
  spread: number | null;
  confidence: Confidence;
  /** What the other source says, when both exist and they disagree by more than a third. */
  disagrees: { other: number; source: 'measured' | 'inferred' } | null;
}

export interface JobCheck {
  job_id: Id;
  title: string;
  actual: number;
  predicted: number;
  /** Actual over predicted. */
  ratio: number;
}

export interface Standards {
  services: ServiceStandard[];
  /** Overhead per tech visit (customer, cleanup, between tasks), in minutes. */
  overhead_per_visit: number | null;
  /** Finished jobs that took much longer or shorter than the standards predict. */
  outliers: JobCheck[];
  /** How each tech's timed tasks compare with the standards (1.10 = 10% slower), with at least three timed tasks. */
  tech_speed: { user_id: Id; ratio: number; tasks: number }[];
}

export const serviceKey = (t: Pick<StandardTask, 'price_book_item_id' | 'name' | 'unit'>) => `${t.price_book_item_id ?? t.name.trim().toLowerCase()}|${t.unit.trim().toLowerCase()}`;

const mean = (xs: number[]) => xs.reduce((n, x) => n + x, 0) / xs.length;

/** Non-negative least squares by coordinate descent: small systems, a few hundred jobs at most. */
export function nnls(rows: number[][], y: number[], iterations = 3000): number[] {
  const n = rows[0]?.length ?? 0;
  const x = new Array<number>(n).fill(0);
  const norms = Array.from({ length: n }, (_, j) => rows.reduce((s, r) => s + r[j] * r[j], 0));
  const residual = y.slice();
  for (let it = 0; it < iterations; it++) {
    let moved = 0;
    for (let j = 0; j < n; j++) {
      if (norms[j] === 0) continue;
      let dot = 0;
      for (let i = 0; i < rows.length; i++) dot += rows[i][j] * residual[i];
      const next = Math.max(0, x[j] + dot / norms[j]);
      const step = next - x[j];
      if (step !== 0) {
        for (let i = 0; i < rows.length; i++) residual[i] -= rows[i][j] * step;
        x[j] = next;
        moved += Math.abs(step);
      }
    }
    if (moved < 1e-9) break;
  }
  return x;
}

export function learnStandards(input: StandardInput, minOutlierServices = 1): Standards {
  const byJob = new Map<Id, StandardTask[]>();
  for (const t of input.tasks) byJob.set(t.job_id, [...(byJob.get(t.job_id) ?? []), t]);

  // ---- per job: how the time split, and whether any task was timed ----
  const per = input.jobs.map((job) => ({ job, tasks: byJob.get(job.id) ?? [] })).filter((j) => j.tasks.length > 0);

  const measured = new Map<string, { name: string; unit: string; minutes: number; qty: number; per: number[] }>();
  const tech = new Map<Id, { actual: number; predicted: number; perTask: number[] }>();
  const equations: { y: number; q: Map<string, number>; visits: number }[] = [];
  const jobTotals = new Map<Id, { actual: number; visits: number }>();
  const overheads: number[] = [];
  const names = new Map<string, { name: string; unit: string }>();
  const timedTasks: { key: string; qty: number; user_id: Id; minutes: number }[] = [];

  for (const { job, tasks } of per) {
    const entries = input.entries.filter((e) => e.job_id === job.id && e.clock_out !== null);
    const timers = input.timers.filter((t) => t.ended_at !== null && tasks.some((x) => x.id === t.task_id));
    const split = splitJobTime({ tasks, entries, timers });
    if (split.job_minutes <= 0) continue;
    const visits = split.techs.length;
    jobTotals.set(job.id, { actual: split.job_minutes, visits });
    for (const t of tasks) names.set(serviceKey(t), { name: t.name, unit: t.unit });
    if (split.direct_minutes > 0) {
      overheads.push(split.overhead_minutes / Math.max(1, visits));
      for (const tt of split.tasks) {
        if (tt.direct <= 0) continue;
        const task = tasks.find((x) => x.id === tt.task_id)!;
        if (task.quantity <= 0) continue;
        const key = serviceKey(task);
        const m = measured.get(key) ?? { name: task.name, unit: task.unit, minutes: 0, qty: 0, per: [] };
        m.minutes += tt.direct;
        m.qty += task.quantity;
        m.per.push(tt.direct / task.quantity);
        measured.set(key, m);
      }
      for (const te of split.techs) for (const tt of te.tasks) if (tt.direct > 0) timedTasks.push({ key: serviceKey(tasks.find((x) => x.id === tt.task_id)!), qty: tasks.find((x) => x.id === tt.task_id)!.quantity, user_id: te.user_id, minutes: tt.direct });
    } else {
      const q = new Map<string, number>();
      for (const t of tasks) q.set(serviceKey(t), (q.get(serviceKey(t)) ?? 0) + t.quantity);
      equations.push({ y: split.job_minutes, q, visits });
    }
  }

  // ---- inferred: non-negative least squares over the jobs where nothing was timed ----
  const inferredKeys = [...new Set(equations.flatMap((e) => [...e.q.keys()]))];
  const inferred = new Map<string, number>();
  let inferredOverhead: number | null = null;
  if (equations.length > 0) {
    const rows = equations.map((e) => [...inferredKeys.map((k) => e.q.get(k) ?? 0), e.visits]);
    const x = nnls(rows, equations.map((e) => e.y));
    inferredKeys.forEach((k, i) => inferred.set(k, x[i]));
    inferredOverhead = x[inferredKeys.length];
  }

  // ---- the standards ----
  const keys = [...new Set([...measured.keys(), ...inferred.keys(), ...names.keys()])];
  const services: ServiceStandard[] = keys.map((key) => {
    const m = measured.get(key);
    const inf = inferred.get(key);
    const info = names.get(key) ?? { name: key.split('|')[0], unit: key.split('|')[1] ?? 'each' };
    const mp = m ? m.minutes / m.qty : null;
    const ip = inf !== undefined && inf > 0 ? inf : null;
    const mpu = mp ?? ip;
    const spread = m && m.per.length >= 2 ? Math.sqrt(mean(m.per.map((v) => (v - mean(m.per)) ** 2))) / mean(m.per) : null;
    const jobs = equations.filter((e) => e.q.has(key)).length;
    const confidence: Confidence = m && m.per.length >= 5 && (spread ?? 1) < 0.35 ? 'good' : (m && m.per.length >= 2) || jobs >= 4 ? 'some' : 'learning';
    const other = mp !== null && ip !== null ? ip : null;
    const disagrees = mp !== null && other !== null && Math.abs(other - mp) / mp > 1 / 3 ? { other, source: 'inferred' as const } : null;
    return { key, name: info.name, unit: info.unit, minutes_per_unit: mpu === null ? null : Math.round(mpu * 100) / 100, source: mp !== null ? 'measured' : ip !== null ? 'inferred' : null, measured_tasks: m?.per.length ?? 0, inferred_jobs: jobs, spread: spread === null ? null : Math.round(spread * 100) / 100, confidence, disagrees };
  });
  services.sort((a, b) => b.measured_tasks + b.inferred_jobs - (a.measured_tasks + a.inferred_jobs));

  const overhead = overheads.length ? mean(overheads) : inferredOverhead;
  const std = new Map(services.filter((s) => s.minutes_per_unit !== null).map((s) => [s.key, s.minutes_per_unit as number]));

  // ---- cross-checks: finished jobs far from what the standards predict ----
  const outliers: JobCheck[] = [];
  for (const { job, tasks } of per) {
    const total = jobTotals.get(job.id);
    if (!job.completed || !total || tasks.some((t) => !std.has(serviceKey(t))) || tasks.length < minOutlierServices) continue;
    const predicted = tasks.reduce((n, t) => n + t.quantity * (std.get(serviceKey(t)) ?? 0), 0) + (overhead ?? 0) * total.visits;
    if (predicted <= 0) continue;
    const ratio = total.actual / predicted;
    if (ratio > 1.5 || ratio < 0.6) outliers.push({ job_id: job.id, title: job.title, actual: total.actual, predicted: Math.round(predicted), ratio: Math.round(ratio * 100) / 100 });
  }
  outliers.sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)));

  // ---- how fast each tech works compared with the standards ----
  for (const t of timedTasks) {
    const s = std.get(t.key);
    if (!s || t.qty <= 0) continue;
    const row = tech.get(t.user_id) ?? { actual: 0, predicted: 0, perTask: [] };
    row.actual += t.minutes;
    row.predicted += t.qty * s;
    row.perTask.push(t.minutes / (t.qty * s));
    tech.set(t.user_id, row);
  }
  const tech_speed = [...tech.entries()].filter(([, r]) => r.perTask.length >= 3).map(([user_id, r]) => ({ user_id, ratio: Math.round((r.actual / r.predicted) * 100) / 100, tasks: r.perTask.length }));

  return { services, overhead_per_visit: overhead === null ? null : Math.round(overhead * 10) / 10, outliers, tech_speed };
}
