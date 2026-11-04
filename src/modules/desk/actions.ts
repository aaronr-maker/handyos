import { z } from 'zod';
import { defineAction } from '@/core';
import { closeAlert, refreshAlerts } from './service';

export const refreshAlertsAction = defineAction({
  name: 'desk.refresh_alerts',
  module: 'desk',
  description: "Look at everyone's week and raise or clear manager alerts (heading over the weekly hours, a clock left running).",
  input: z.object({}),
  risk: 'low',
  roles: ['owner', 'admin'],
  requiresApproval: false,
  example: {},
  handler: (_input, ctx) => refreshAlerts(ctx.companyId),
});

export const closeAlertAction = defineAction({
  name: 'desk.close_alert',
  module: 'desk',
  description: 'Mark a manager alert resolved or dismissed, with an optional note on what was done.',
  input: z.object({ alert_id: z.string().min(1), status: z.enum(['resolved', 'dismissed']), resolution: z.string().trim().max(300).nullable().default(null) }),
  risk: 'low',
  roles: ['owner', 'admin'],
  requiresApproval: false,
  example: { alert_id: 'alert-id', status: 'resolved', resolution: 'Moved a job to Sam' },
  async handler({ alert_id, status, resolution }, ctx) {
    return closeAlert(ctx.companyId, alert_id, ctx.actor.id, status, resolution);
  },
});
