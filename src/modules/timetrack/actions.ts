import { z } from 'zod';
import { defineAction } from '@/core';
import { addTask, closeTimers, editTime, loadTasksFromEstimate, removeTask, setConsent, setSite, shiftIn, shiftOut, startTask, stopTask } from './service';

/** Time belongs to the signed-in person: an AI agent or automation can't start or stop anyone's clock. */
function requirePerson(actor: { kind: string; id: string }): string {
  if (actor.kind !== 'user') throw new Error('Only a person can start or stop their own time.');
  return actor.id;
}

export const shiftInAction = defineAction({
  name: 'timetrack.shift_in',
  module: 'timetrack',
  description: 'Clock the signed-in person in for the day.',
  input: z.object({}),
  risk: 'low',
  requiresApproval: false,
  example: {},
  async handler(_input, ctx) {
    const userId = requirePerson(ctx.actor);
    const shift = await shiftIn(ctx.companyId, userId);
    await ctx.events.emit(ctx.companyId, 'shift.in', { userId });
    return shift;
  },
});

export const shiftOutAction = defineAction({
  name: 'timetrack.shift_out',
  module: 'timetrack',
  description: 'Clock the signed-in person out for the day (their job time must be stopped first).',
  input: z.object({}),
  risk: 'low',
  requiresApproval: false,
  example: {},
  async handler(_input, ctx) {
    const userId = requirePerson(ctx.actor);
    const { shift, minutes } = await shiftOut(ctx.companyId, userId);
    await ctx.events.emit(ctx.companyId, 'shift.out', { userId, minutes });
    return shift;
  },
});

export const startTaskAction = defineAction({
  name: 'timetrack.start_task',
  module: 'timetrack',
  description: "Start the signed-in person's timer on a task of the job they are on. A timer already running stops first.",
  input: z.object({ task_id: z.string().min(1) }),
  risk: 'low',
  requiresApproval: false,
  example: { task_id: 'task-id' },
  async handler({ task_id }, ctx) {
    const userId = requirePerson(ctx.actor);
    const timer = await startTask(ctx.companyId, userId, task_id);
    await ctx.events.emit(ctx.companyId, 'task.started', { jobId: timer.job_id, taskId: task_id, userId });
    return timer;
  },
});

export const stopTaskAction = defineAction({
  name: 'timetrack.stop_task',
  module: 'timetrack',
  description: "Stop the signed-in person's running task timer (their job time keeps running as job overhead).",
  input: z.object({}),
  risk: 'low',
  requiresApproval: false,
  example: {},
  async handler(_input, ctx) {
    const userId = requirePerson(ctx.actor);
    const timer = await stopTask(ctx.companyId, userId);
    if (timer) await ctx.events.emit(ctx.companyId, 'task.stopped', { jobId: timer.job_id, taskId: timer.task_id, userId });
    return { stopped: !!timer };
  },
});

export const addTaskAction = defineAction({
  name: 'timetrack.add_task',
  module: 'timetrack',
  description: 'Add a task to a job (a service to be timed), with its quantity and unit.',
  input: z.object({ job_id: z.string().min(1), name: z.string().trim().min(1).max(200), price_book_item_id: z.string().min(1).nullable().default(null), quantity: z.number().positive().max(1_000_000).default(1), unit: z.string().trim().min(1).max(30).default('each') }),
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id', name: 'Gutter clean out', price_book_item_id: null, quantity: 100, unit: 'ft' },
  handler: ({ job_id, ...t }, ctx) => addTask(ctx.companyId, job_id, t),
});

export const loadTasksAction = defineAction({
  name: 'timetrack.load_tasks',
  module: 'timetrack',
  description: "Make the job's tasks from the service lines of its estimate (does nothing if it already has tasks).",
  input: z.object({ job_id: z.string().min(1) }),
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id' },
  handler: ({ job_id }, ctx) => loadTasksFromEstimate(ctx.companyId, job_id),
});

export const removeTaskAction = defineAction({
  name: 'timetrack.remove_task',
  module: 'timetrack',
  description: 'Remove a task that has no time tracked on it.',
  input: z.object({ task_id: z.string().min(1) }),
  risk: 'low',
  roles: ['owner', 'admin', 'office'],
  requiresApproval: false,
  example: { task_id: 'task-id' },
  async handler({ task_id }, ctx) {
    await removeTask(ctx.companyId, task_id);
    return { removed: true };
  },
});

export const editTimeAction = defineAction({
  name: 'timetrack.edit_time',
  module: 'timetrack',
  description: 'Change the start and/or end time of a job time entry, a task timer or a day shift. The old time, the new time, who changed it and why are kept. Anyone can change their own; only admins and owners can change another person\'s.',
  input: z.object({
    entity: z.enum(['job', 'task', 'shift']),
    id: z.string().min(1),
    start: z.iso.datetime().optional(),
    end: z.iso.datetime().nullable().optional(),
    reason: z.string().trim().max(300).nullable().default(null),
  }),
  risk: 'medium',
  // an AI agent can only propose a change to anyone's pay-affecting hours
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { entity: 'job', id: 'entry-id', end: '2027-01-05T21:30:00.000Z', reason: 'Forgot to stop the clock' },
  async handler({ entity, id, start, end, reason }, ctx) {
    const editedBy = requirePerson(ctx.actor);
    await editTime(ctx.companyId, { id: editedBy, role: ctx.role }, entity, id, { start, end }, reason);
    await ctx.events.emit(ctx.companyId, 'time.edited', { entity, entityId: id, userId: editedBy, editedBy });
    return { edited: true };
  },
});

export const setGeofenceConsentAction = defineAction({
  name: 'timetrack.set_geofence_consent',
  module: 'timetrack',
  description: 'The signed-in person agrees (or stops agreeing) to location-based reminders to start job time when they arrive at a job.',
  input: z.object({ consent: z.boolean() }),
  risk: 'medium',
  requiresApproval: false,
  example: { consent: true },
  async handler({ consent }, ctx) {
    return setConsent(ctx.companyId, requirePerson(ctx.actor), consent);
  },
});

export const setJobSiteAction = defineAction({
  name: 'timetrack.set_job_site',
  module: 'timetrack',
  description: "Set where a job is (latitude and longitude, and how close counts as arrived) for arrival reminders.",
  input: z.object({ job_id: z.string().min(1), lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), radius_m: z.number().int().min(30).max(2000).default(150) }),
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id', lat: 30.2672, lng: -97.7431, radius_m: 150 },
  handler: ({ job_id, lat, lng, radius_m }, ctx) => setSite(ctx.companyId, job_id, lat, lng, radius_m),
});

export { closeTimers };
