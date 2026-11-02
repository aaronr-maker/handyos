import { createRepo, nextCompanyNumber, type BaseRecord, type Id } from '@/core';
import type { Job, JobAssignment, TimeEntry } from '../types';

const jobs = createRepo<Job>('jobs');
const assignments = createRepo<JobAssignment>('job_assignments');
const timeEntries = createRepo<TimeEntry>('time_entries');

export interface JobDraft {
  customer_id: Id;
  owed_by_customer_id: Id | null;
  property_id: Id | null;
  estimate_id: Id | null;
  title: string;
  notes: string | null;
}

export async function createJob(companyId: Id, draft: JobDraft, schedule?: { start: string; end: string | null }): Promise<Job> {
  return jobs.insert(companyId, {
    ...draft,
    job_number: await nextCompanyNumber(companyId, 'job'),
    status: schedule ? 'scheduled' : 'unscheduled',
    scheduled_start: schedule?.start ?? null,
    scheduled_end: schedule?.end ?? null,
    completed_at: null,
  });
}

export const getJob = (companyId: Id, id: Id) => jobs.get(companyId, id);
export const listJobs = async (companyId: Id) => (await jobs.list(companyId)).sort((a, b) => b.job_number - a.job_number);

export async function updateJob(companyId: Id, id: Id, data: Pick<Job, 'title' | 'notes'>): Promise<Job> {
  if (!(await jobs.get(companyId, id))) throw new Error('Job not found');
  return jobs.update(companyId, id, data);
}

/** Used by the scheduling module (through the jobs public index) to put a job on the calendar or move it. */
export async function setJobSchedule(companyId: Id, id: Id, start: string, end?: string | null): Promise<{ job: Job; previousStart: string | null }> {
  const existing = await jobs.get(companyId, id);
  if (!existing) throw new Error('Job not found');
  if (existing.status === 'completed') throw new Error('Completed jobs cannot be rescheduled');
  if (end && end < start) throw new Error('The end time cannot be before the start time');
  // moving a job keeps its length unless a new end is given
  let newEnd = end ?? null;
  if (end === undefined && existing.scheduled_start && existing.scheduled_end) {
    newEnd = new Date(Date.parse(start) + (Date.parse(existing.scheduled_end) - Date.parse(existing.scheduled_start))).toISOString();
  }
  const job = await jobs.update(companyId, id, {
    scheduled_start: start,
    scheduled_end: newEnd,
    status: existing.status === 'unscheduled' ? 'scheduled' : existing.status,
  });
  return { job, previousStart: existing.scheduled_start };
}

export async function completeJob(companyId: Id, id: Id): Promise<Job> {
  const existing = await jobs.get(companyId, id);
  if (!existing) throw new Error('Job not found');
  if (existing.status === 'completed') throw new Error('This job is already completed');
  const now = new Date().toISOString();
  // anyone still clocked in on this job is clocked out
  for (const e of await timeEntries.list(companyId, { where: { job_id: id } })) {
    if (e.clock_out === null) await timeEntries.update(companyId, e.id, { clock_out: now });
  }
  return jobs.update(companyId, id, { status: 'completed', completed_at: now });
}

// --- assignments ---
export const listAssignments = (companyId: Id) => assignments.list(companyId);

/** Replaces the set of people assigned to a job. */
export async function setAssignees(companyId: Id, jobId: Id, userIds: Id[]): Promise<Id[]> {
  if (!(await jobs.get(companyId, jobId))) throw new Error('Job not found');
  const wanted = [...new Set(userIds)];
  const current = (await assignments.list(companyId)).filter((a) => a.job_id === jobId);
  for (const a of current) if (!wanted.includes(a.user_id)) await assignments.remove(companyId, a.id);
  const have = new Set(current.map((a) => a.user_id));
  const fresh = wanted.filter((u) => !have.has(u));
  if (fresh.length) await assignments.insertMany(companyId, fresh.map((user_id) => ({ job_id: jobId, user_id })) as Omit<JobAssignment, keyof BaseRecord>[]);
  return wanted;
}

// --- time clock ---
export const listTimeEntries = async (companyId: Id) => (await timeEntries.list(companyId)).sort((a, b) => b.clock_in.localeCompare(a.clock_in));

const openEntry = async (companyId: Id, userId: Id) => (await timeEntries.list(companyId, { where: { user_id: userId } })).find((e) => e.clock_out === null);
export const getOpenEntry = openEntry;

/** Clocks a person in to a job. Being clocked in somewhere else is an error (clock out first). */
export async function clockIn(companyId: Id, userId: Id, jobId: Id): Promise<TimeEntry> {
  const job = await jobs.get(companyId, jobId);
  if (!job) throw new Error('Job not found');
  if (job.status === 'completed') throw new Error('This job is already completed');
  const open = await openEntry(companyId, userId);
  if (open) {
    const where = open.job_id === jobId ? 'this job' : 'another job';
    throw new Error(`You're already clocked in to ${where}. Clock out first.`);
  }
  const entry = await timeEntries.insert(companyId, { job_id: jobId, user_id: userId, clock_in: new Date().toISOString(), clock_out: null, note: null });
  if (job.status !== 'in_progress') await jobs.update(companyId, jobId, { status: 'in_progress' });
  return entry;
}

export async function clockOut(companyId: Id, userId: Id, note: string | null): Promise<{ entry: TimeEntry; minutes: number }> {
  const open = await openEntry(companyId, userId);
  if (!open) throw new Error("You aren't clocked in.");
  const now = new Date();
  const entry = await timeEntries.update(companyId, open.id, { clock_out: now.toISOString(), note });
  return { entry, minutes: Math.max(0, Math.round((now.getTime() - Date.parse(open.clock_in)) / 60000)) };
}
