import { createRepo, type Id } from '@/core';
import { getEstimate, listPriceItems } from '@/modules/estimates';
import { getJob, getOpenEntry, getTimeEntry, listJobs, listTimeEntries, updateTimeEntry } from '@/modules/jobs';
import { learnStandards, type Standards } from './standards';
import type { GeofenceConsent, JobSite, JobTask, Shift, TaskTimer, TimeEdit, TimeEntity } from './types';

const shifts = createRepo<Shift>('shifts');
const tasks = createRepo<JobTask>('job_tasks');
const timers = createRepo<TaskTimer>('task_timers');
const edits = createRepo<TimeEdit>('time_edits');
const consents = createRepo<GeofenceConsent>('geofence_consent');
const sites = createRepo<JobSite>('job_sites');

const iso = (ms = Date.now()) => new Date(ms).toISOString();

// ---- the day clock ----
export const listShifts = async (companyId: Id) => (await shifts.list(companyId)).sort((a, b) => b.clock_in.localeCompare(a.clock_in));
export const openShift = async (companyId: Id, userId: Id) => (await shifts.list(companyId, { where: { user_id: userId } })).find((s) => s.clock_out === null) ?? null;

export async function shiftIn(companyId: Id, userId: Id): Promise<Shift> {
  if (await openShift(companyId, userId)) throw new Error("You're already clocked in for the day.");
  return shifts.insert(companyId, { user_id: userId, clock_in: iso(), clock_out: null });
}

export async function shiftOut(companyId: Id, userId: Id): Promise<{ shift: Shift; minutes: number }> {
  const open = await openShift(companyId, userId);
  if (!open) throw new Error("You aren't clocked in for the day.");
  if (await getOpenEntry(companyId, userId)) throw new Error('Stop your job time before clocking out for the day.');
  const now = Date.now();
  const shift = await shifts.update(companyId, open.id, { clock_out: iso(now) });
  return { shift, minutes: Math.max(0, Math.round((now - Date.parse(open.clock_in)) / 60000)) };
}

// ---- tasks of a job ----
export const listTasks = async (companyId: Id, jobId: Id) => (await tasks.list(companyId, { where: { job_id: jobId } })).sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at));

export async function addTask(companyId: Id, jobId: Id, t: { name: string; price_book_item_id: string | null; quantity: number; unit: string }): Promise<JobTask> {
  if (!(await getJob(companyId, jobId))) throw new Error('Job not found');
  const existing = await listTasks(companyId, jobId);
  return tasks.insert(companyId, { job_id: jobId, name: t.name, price_book_item_id: t.price_book_item_id, quantity: t.quantity, unit: t.unit, sort_order: existing.length });
}

/** Makes a task of each service line of the job's estimate (materials and fees are not tasks). Does nothing if the job already has tasks. */
export async function loadTasksFromEstimate(companyId: Id, jobId: Id): Promise<JobTask[]> {
  const job = await getJob(companyId, jobId);
  if (!job) throw new Error('Job not found');
  const have = await listTasks(companyId, jobId);
  if (have.length) return have;
  if (!job.estimate_id) throw new Error('This job has no estimate to take tasks from. Add the tasks by hand.');
  const estimate = await getEstimate(companyId, job.estimate_id);
  if (!estimate) throw new Error('The job’s estimate was not found.');
  const kinds = new Map((await listPriceItems(companyId)).map((p) => [p.id, p.kind]));
  const lines = estimate.line_items.filter((l) => l.description.trim() && (l.price_book_item_id === null || (kinds.get(l.price_book_item_id) ?? 'service') === 'service'));
  const made: JobTask[] = [];
  for (const [n, l] of lines.entries()) made.push(await tasks.insert(companyId, { job_id: jobId, name: l.description.trim(), price_book_item_id: l.price_book_item_id, quantity: l.quantity, unit: l.unit, sort_order: n }));
  return made;
}

export async function removeTask(companyId: Id, taskId: Id): Promise<void> {
  const t = await tasks.get(companyId, taskId);
  if (!t) return;
  if ((await timers.list(companyId, { where: { task_id: taskId } })).length) throw new Error('Time has been tracked on this task, so it cannot be removed.');
  await tasks.remove(companyId, taskId);
}

// ---- task timers ----
export const listTimers = (companyId: Id, jobId: Id) => timers.list(companyId, { where: { job_id: jobId } });
export const openTimer = async (companyId: Id, userId: Id) => (await timers.list(companyId, { where: { user_id: userId } })).find((t) => t.ended_at === null) ?? null;

/** Starts the person's timer on a task. They must be on the clock for that job; any timer they had running stops first. */
export async function startTask(companyId: Id, userId: Id, taskId: Id): Promise<TaskTimer> {
  const task = await tasks.get(companyId, taskId);
  if (!task) throw new Error('Task not found');
  const on = await getOpenEntry(companyId, userId);
  if (!on || on.job_id !== task.job_id) throw new Error('Start your time on this job first, then start the task.');
  const now = iso();
  const running = await openTimer(companyId, userId);
  if (running) {
    if (running.task_id === taskId) throw new Error('This task is already being timed.');
    await timers.update(companyId, running.id, { ended_at: now });
  }
  return timers.insert(companyId, { job_id: task.job_id, task_id: taskId, user_id: userId, started_at: now, ended_at: null });
}

export async function stopTask(companyId: Id, userId: Id): Promise<TaskTimer | null> {
  const running = await openTimer(companyId, userId);
  return running ? timers.update(companyId, running.id, { ended_at: iso() }) : null;
}

/** Stops running task timers (when a tech stops their job time, or a job is completed). */
export async function closeTimers(companyId: Id, where: { userId?: Id; jobId?: Id }): Promise<number> {
  const now = iso();
  let n = 0;
  for (const t of await timers.list(companyId)) {
    if (t.ended_at !== null) continue;
    if (where.userId && t.user_id !== where.userId) continue;
    if (where.jobId && t.job_id !== where.jobId) continue;
    await timers.update(companyId, t.id, { ended_at: now });
    n++;
  }
  return n;
}

// ---- editing time stamps, with the history kept ----
export const listEdits = (companyId: Id) => edits.list(companyId);
export const listAllTimers = (companyId: Id) => timers.list(companyId);

interface Editable {
  user_id: Id;
  start: string;
  end: string | null;
  fields: [string, string];
  save: (patch: { start?: string; end?: string | null }) => Promise<void>;
}

async function editable(companyId: Id, entity: TimeEntity, id: Id): Promise<Editable> {
  if (entity === 'job') {
    const e = await getTimeEntry(companyId, id);
    if (!e) throw new Error('That time entry was not found');
    return { user_id: e.user_id, start: e.clock_in, end: e.clock_out, fields: ['clock_in', 'clock_out'], save: async (p) => void (await updateTimeEntry(companyId, id, { ...(p.start ? { clock_in: p.start } : {}), ...(p.end !== undefined ? { clock_out: p.end } : {}) })) };
  }
  if (entity === 'task') {
    const t = await timers.get(companyId, id);
    if (!t) throw new Error('That task time was not found');
    return { user_id: t.user_id, start: t.started_at, end: t.ended_at, fields: ['started_at', 'ended_at'], save: async (p) => void (await timers.update(companyId, id, { ...(p.start ? { started_at: p.start } : {}), ...(p.end !== undefined ? { ended_at: p.end } : {}) })) };
  }
  const s = await shifts.get(companyId, id);
  if (!s) throw new Error('That shift was not found');
  return { user_id: s.user_id, start: s.clock_in, end: s.clock_out, fields: ['clock_in', 'clock_out'], save: async (p) => void (await shifts.update(companyId, id, { ...(p.start ? { clock_in: p.start } : {}), ...(p.end !== undefined ? { clock_out: p.end } : {}) })) };
}

/**
 * Changes a start and/or end time. Anyone may change their own; only admins and owners may change someone else's. Each changed
 * field is written to the edit history (old value, new value, who, why) before the time changes.
 */
export async function editTime(
  companyId: Id,
  actor: { id: Id; role: string | undefined },
  entity: TimeEntity,
  id: Id,
  patch: { start?: string; end?: string | null },
  reason: string | null,
): Promise<void> {
  const rec = await editable(companyId, entity, id);
  if (rec.user_id !== actor.id && actor.role !== 'owner' && actor.role !== 'admin') throw new Error('You can only change your own time. An admin can change anyone\'s.');
  const start = patch.start ?? rec.start;
  const end = patch.end === undefined ? rec.end : patch.end;
  if (Number.isNaN(Date.parse(start)) || (end !== null && Number.isNaN(Date.parse(end)))) throw new Error('That is not a valid time.');
  if (end !== null && Date.parse(end) <= Date.parse(start)) throw new Error('The end time must be after the start time.');
  const changes: { field: string; from: string | null; to: string | null }[] = [];
  if (patch.start !== undefined && Date.parse(patch.start) !== Date.parse(rec.start)) changes.push({ field: rec.fields[0], from: rec.start, to: patch.start });
  if (patch.end !== undefined && (patch.end === null ? rec.end !== null : rec.end === null || Date.parse(patch.end) !== Date.parse(rec.end))) changes.push({ field: rec.fields[1], from: rec.end, to: patch.end });
  if (changes.length === 0) return;
  for (const c of changes) await edits.insert(companyId, { entity, entity_id: id, user_id: rec.user_id, edited_by: actor.id, field: c.field, old_value: c.from, new_value: c.to, reason });
  await rec.save({ start: patch.start, end: patch.end });
}

// ---- location reminders ----
export const getConsent = async (companyId: Id, userId: Id) => (await consents.list(companyId, { where: { user_id: userId } }))[0] ?? null;

export async function setConsent(companyId: Id, userId: Id, consent: boolean): Promise<GeofenceConsent> {
  const row = await getConsent(companyId, userId);
  const now = iso();
  const patch = consent ? { consented_at: now, revoked_at: null } : { revoked_at: now };
  return row ? consents.update(companyId, row.id, patch) : consents.insert(companyId, { user_id: userId, consented_at: consent ? now : null, revoked_at: consent ? null : now });
}
export const hasConsented = (c: GeofenceConsent | null) => !!c && !!c.consented_at && !c.revoked_at;

export const listSites = (companyId: Id) => sites.list(companyId);
export async function setSite(companyId: Id, jobId: Id, lat: number, lng: number, radius: number): Promise<JobSite> {
  const row = (await sites.list(companyId, { where: { job_id: jobId } }))[0];
  return row ? sites.update(companyId, row.id, { lat, lng, radius_m: radius }) : sites.insert(companyId, { job_id: jobId, lat, lng, radius_m: radius });
}

/** Everything the job time screen shows. */
export async function jobTimeData(companyId: Id, jobId: Id) {
  const [t, tm, entries, ed] = await Promise.all([listTasks(companyId, jobId), listTimers(companyId, jobId), listTimeEntries(companyId), edits.list(companyId)]);
  const mine = entries.filter((e) => e.job_id === jobId);
  const ids = new Set([...mine.map((e) => e.id), ...tm.map((x) => x.id)]);
  return { tasks: t, timers: tm, entries: mine, edits: ed.filter((e) => ids.has(e.entity_id)) };
}

/** Standard times learned from every finished and running job's tasks and timers. */
export async function loadStandards(companyId: Id): Promise<Standards> {
  const [jobs, allTasks, entries, allTimers] = await Promise.all([listJobs(companyId), tasks.list(companyId), listTimeEntries(companyId), timers.list(companyId)]);
  return learnStandards({
    jobs: jobs.map((j) => ({ id: j.id, title: j.title, completed: j.status === 'completed' })),
    tasks: allTasks.map((t) => ({ id: t.id, job_id: t.job_id, name: t.name, price_book_item_id: t.price_book_item_id, quantity: t.quantity, unit: t.unit })),
    entries: entries.map((e) => ({ id: e.id, job_id: e.job_id, user_id: e.user_id, clock_in: e.clock_in, clock_out: e.clock_out })),
    timers: allTimers.map((t) => ({ id: t.id, task_id: t.task_id, user_id: t.user_id, started_at: t.started_at, ended_at: t.ended_at })),
  });
}
