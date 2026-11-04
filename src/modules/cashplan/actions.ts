import { z } from 'zod';
import { defineAction } from '@/core';
import { setMoved } from './moves';

export const setCashMovedAction = defineAction({
  name: 'cashplan.set_moved',
  module: 'cashplan',
  description: 'Tick off (or untick) one transfer of a week\'s cash plan, such as "Wages for the week of Jan 4 moved". Only a note for the owner: it moves no money.',
  input: z.object({
    week_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    bucket: z.enum(['sales_tax', 'materials', 'wages', 'payroll_tax', 'overhead', 'p4p', 'reserve', 'profit']),
    amount_cents: z.number().int(),
    moved: z.boolean(),
  }),
  risk: 'low',
  roles: ['owner', 'admin'],
  requiresApproval: false,
  example: { week_start: '2027-01-04', bucket: 'wages', amount_cents: 120_000, moved: true },
  async handler({ week_start, bucket, amount_cents, moved }, ctx) {
    await setMoved(ctx.companyId, week_start, bucket, amount_cents, moved, new Date().toISOString().slice(0, 10));
    return { moved };
  },
});
