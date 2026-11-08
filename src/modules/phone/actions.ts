import { z } from 'zod';
import { defineAction } from '@/core';
import { markHeard, saveFlow, saveSettings } from './service';

const digit = z.string().regex(/^[0-9]$/);
const node = z.object({
  id: z.string().min(1).max(60),
  kind: z.enum(['start', 'hours', 'job', 'clock', 'direct', 'area', 'say', 'menu', 'ring', 'voicemail', 'ai', 'forward', 'hangup']),
  x: z.number(),
  y: z.number(),
  data: z.object({
    text: z.string().max(1000).optional(),
    prompt: z.string().max(1000).optional(),
    options: z.array(z.object({ digit, label: z.string().max(80) })).max(10).optional(),
    people: z.array(z.string().max(60)).max(30).optional(),
    numbers: z.array(z.string().max(30)).max(10).optional(),
    customers: z.array(z.string().max(60)).max(500).optional(),
    areas: z.array(z.object({ label: z.string().max(60), codes: z.array(z.string().max(5)).max(30) })).max(12).optional(),
    app: z.boolean().optional(),
    reach: z.enum(['app', 'cell', 'both']).optional(),
    assigned: z.boolean().optional(),
    onlyClockedIn: z.boolean().optional(),
    mode: z.enum(['all', 'in_order']).optional(),
    seconds: z.number().int().min(5).max(120).optional(),
    notify: z.array(z.string().max(60)).max(30).optional(),
    number: z.string().max(30).optional(),
    label: z.string().max(60).optional(),
  }),
});

export const saveCallFlowAction = defineAction({
  name: 'phone.save_flow',
  module: 'phone',
  description: 'Save the call tree that answers the company phone. It takes effect for the next call.',
  input: z.object({ nodes: z.array(node).max(80), edges: z.array(z.object({ id: z.string().max(80), source: z.string().max(60), handle: z.string().max(10), target: z.string().max(60), from: z.enum(['r', 'b', 't']).optional(), to: z.enum(['l', 't', 'b']).optional() })).max(300) }),
  risk: 'high',
  roles: ['owner', 'admin'],
  // this decides what every caller hears, so an AI agent can only propose a change
  requiresApproval: (_i, ctx) => ctx.actor.kind === 'agent',
  example: { nodes: [{ id: 'start', kind: 'start' as const, x: 0, y: 0, data: {} }], edges: [] },
  async handler(input, ctx) {
    await saveFlow(ctx.companyId, input);
    return { saved: true };
  },
});

const hoursDay = z.array(z.object({ open: z.string().regex(/^\d{2}:\d{2}$/), close: z.string().regex(/^\d{2}:\d{2}$/) })).max(3);
export const savePhoneSettingsAction = defineAction({
  name: 'phone.save_settings',
  module: 'phone',
  description: 'Save the business phone number, time zone, opening hours and the voice that reads greetings.',
  input: z.object({ number: z.string().trim().max(30), timezone: z.string().trim().min(3).max(60), voice: z.string().trim().min(3).max(40), notice: z.string().trim().max(400), script: z.string().trim().max(3000), week: z.object({ mon: hoursDay, tue: hoursDay, wed: hoursDay, thu: hoursDay, fri: hoursDay, sat: hoursDay, sun: hoursDay }) }),
  risk: 'high',
  roles: ['owner', 'admin'],
  requiresApproval: (_i, ctx) => ctx.actor.kind === 'agent',
  example: { number: '+15125550000', timezone: 'America/Chicago', voice: 'Polly.Joanna', notice: 'This call may be recorded.', script: 'Get their name and address.', week: { mon: [{ open: '08:00', close: '17:00' }], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [] } },
  async handler({ number, timezone, voice, notice, script, week }, ctx) {
    await saveSettings(ctx.companyId, { number, hours: { timezone, week }, voice, notice, script });
    return { saved: true };
  },
});

export const markVoicemailHeardAction = defineAction({
  name: 'phone.mark_voicemail_heard',
  module: 'phone',
  description: 'Mark a voicemail as listened to.',
  input: z.object({ voicemail_id: z.string().min(1) }),
  risk: 'low',
  roles: ['owner', 'admin', 'office'],
  requiresApproval: false,
  example: { voicemail_id: 'voicemail-id' },
  async handler({ voicemail_id }, ctx) {
    await markHeard(ctx.companyId, voicemail_id);
    return { ok: true };
  },
});
