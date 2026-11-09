import { z } from 'zod';
import { defineAction } from '@/core';
import { saveAvailability, saveEstimateBlocks } from './service';

const time = z.string().regex(/^\d{2}:\d{2}$/);
const day = z.array(z.object({ start: time, end: time })).max(4);

export const saveEstimateTimesAction = defineAction({
  name: 'receptionist.save_estimate_times',
  module: 'receptionist',
  description: 'Save the blocks of time set aside for in-home estimates, how long each takes, the travel buffer and how much notice is needed.',
  input: z.object({
    timezone: z.string().trim().min(3).max(60),
    week: z.object({ mon: day.optional(), tue: day.optional(), wed: day.optional(), thu: day.optional(), fri: day.optional(), sat: day.optional(), sun: day.optional() }),
    slot_minutes: z.number().int().min(15).max(480),
    buffer_minutes: z.number().int().min(0).max(240),
    notice_hours: z.number().int().min(0).max(336),
    horizon_days: z.number().int().min(1).max(90),
  }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  // this decides what customers are offered, so an AI agent can only propose a change
  requiresApproval: (_i, ctx) => ctx.actor.kind === 'agent',
  example: { timezone: 'America/Chicago', week: { tue: [{ start: '16:00', end: '18:00' }] }, slot_minutes: 60, buffer_minutes: 30, notice_hours: 12, horizon_days: 14 },
  async handler(i, ctx) {
    await saveEstimateBlocks(ctx.companyId, {
      timezone: i.timezone,
      week: i.week,
      slotMinutes: i.slot_minutes,
      bufferMinutes: i.buffer_minutes,
      noticeHours: i.notice_hours,
      horizonDays: i.horizon_days,
    });
    return { saved: true };
  },
});

const hours = z.array(z.object({ start: time, end: time })).max(4);
export const saveTeamAvailabilityAction = defineAction({
  name: 'receptionist.save_team_availability',
  module: 'receptionist',
  description: 'Save when one team member works, by weekday (used for offering estimate times and booking jobs).',
  input: z.object({
    user_id: z.string().min(1),
    week: z.object({ mon: hours.optional(), tue: hours.optional(), wed: hours.optional(), thu: hours.optional(), fri: hours.optional(), sat: hours.optional(), sun: hours.optional() }),
  }),
  risk: 'medium',
  roles: ['owner', 'admin'],
  requiresApproval: (_i, ctx) => ctx.actor.kind === 'agent',
  example: { user_id: 'user-id', week: { mon: [{ start: '07:00', end: '16:00' }] } },
  async handler({ user_id, week }, ctx) {
    await saveAvailability(ctx.companyId, user_id, week);
    return { saved: true };
  },
});
