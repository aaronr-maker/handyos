import { z } from 'zod';
import { defineAction } from '@/core';
import { setJobSchedule } from '@/modules/jobs';
import { addCalendarEvent, listCalendarEvents, removeCalendarEvent } from './events';

export const rescheduleJobAction = defineAction({
  name: 'scheduling.reschedule_job',
  module: 'scheduling',
  description: 'Move a job to a new start time.',
  input: z.object({ job_id: z.string().min(1), start: z.iso.datetime(), end: z.iso.datetime().nullable().optional() }),
  risk: 'medium',
  // Customers get notified of schedule changes, so AI-initiated moves need a human OK.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { job_id: 'job-id', start: '2026-12-01T15:00:00Z' },
  async handler(input, ctx) {
    const { job, previousStart } = await setJobSchedule(ctx.companyId, input.job_id, input.start, input.end);
    await ctx.events.emit(ctx.companyId, 'job.rescheduled', { jobId: job.id, from: previousStart, to: input.start });
    return job;
  },
});

const owns = (ctx: { actor: { kind: string; id: string }; role?: string }, userId: string) => {
  if (ctx.actor.kind !== 'user') throw new Error('Only a person can change the calendar.');
  if (ctx.role === 'tech' && userId !== ctx.actor.id) throw new Error('You can only change your own calendar.');
};

export const addCalendarEventAction = defineAction({
  name: 'scheduling.add_event',
  module: 'scheduling',
  description: "Put time off, a personal appointment or other busy time on someone's calendar so nothing else is scheduled over it.",
  input: z.object({
    user_id: z.string().min(1),
    kind: z.enum(['time_off', 'appointment', 'other']),
    title: z.string().trim().max(120).nullable().optional(),
    starts_at: z.iso.datetime(),
    ends_at: z.iso.datetime(),
    all_day: z.boolean().default(false),
  }),
  risk: 'low',
  requiresApproval: false,
  example: { user_id: 'user-id', kind: 'time_off' as const, title: 'Dentist', starts_at: '2027-01-05T15:00:00Z', ends_at: '2027-01-05T16:00:00Z', all_day: false },
  async handler(i, ctx) {
    owns(ctx, i.user_id);
    const created = await addCalendarEvent(ctx.companyId, {
      user_id: i.user_id,
      kind: i.kind,
      title: i.title?.trim() || null,
      starts_at: i.starts_at,
      ends_at: i.ends_at,
      all_day: i.all_day,
      created_by: ctx.actor.id,
    });
    await ctx.events.emit(ctx.companyId, 'calendar.event_added', { eventId: created.id, userId: i.user_id });
    return created;
  },
});

export const removeCalendarEventAction = defineAction({
  name: 'scheduling.remove_event',
  module: 'scheduling',
  description: 'Take time off, a personal appointment or other busy time off a calendar.',
  input: z.object({ event_id: z.string().min(1) }),
  risk: 'low',
  requiresApproval: false,
  example: { event_id: 'event-id' },
  async handler({ event_id }, ctx) {
    const found = (await listCalendarEvents(ctx.companyId)).find((e) => e.id === event_id);
    if (!found) throw new Error('That calendar entry was not found.');
    owns(ctx, found.user_id);
    await removeCalendarEvent(ctx.companyId, event_id);
    return { removed: event_id };
  },
});
