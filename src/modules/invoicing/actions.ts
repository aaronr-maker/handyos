import { z } from 'zod';
import { defineAction } from '@/core';
import { resolveBilling } from '@/modules/customers';
import { getEstimate } from '@/modules/estimates';
import { getJob } from '@/modules/jobs';
import { addDays, createInvoice, findNewlyOverdue, getInvoice, markOverdue, sendInvoice, updateDraft, voidInvoice, type InvoiceDraft } from './services/invoiceService';

const today = () => new Date().toISOString().slice(0, 10);

const lineItem = z.object({
  description: z.string().trim().min(1, 'Each line needs a description').max(500),
  quantity: z.number().positive('Quantity must be more than zero'),
  unit: z.string().trim().min(1).max(30).default('each'),
  unit_price_cents: z.number().int().min(0),
  unit_cost_cents: z.number().int().min(0).default(0),
  taxable: z.boolean().default(true),
  price_book_item_id: z.string().nullable().default(null),
});

const body = {
  title: z.string().trim().min(1, 'Give the invoice a title').max(200),
  line_items: z.array(lineItem).min(1, 'Add at least one line').max(200),
  tax_rate_bps: z.number().int().min(0).max(10000).default(0),
  due_date: z.iso.date().default(() => addDays(today(), 14)),
  notes: z.string().trim().max(4000).nullable().default(null),
};

const whoFor = z
  .object({
    customer_id: z.string().min(1).nullable().default(null),
    property_id: z.string().min(1).nullable().default(null),
    job_id: z.string().min(1).nullable().default(null),
  })
  .refine((v) => v.customer_id || v.property_id, { message: 'Choose a customer or a property' });

const example = {
  customer_id: null,
  property_id: 'property-id',
  job_id: null,
  title: 'Fix fence gate',
  line_items: [{ description: 'Labor, 2 hrs', quantity: 2, unit: 'hour', unit_price_cents: 9500, unit_cost_cents: 3500, taxable: false, price_book_item_id: null }],
  tax_rate_bps: 0,
  due_date: '2026-12-15',
  notes: null,
};

export const createInvoiceAction = defineAction({
  name: 'invoicing.create',
  module: 'invoicing',
  description: 'Create a draft invoice for a property (billing is worked out from its owner/manager) or a customer, optionally tied to a job.',
  input: z.intersection(whoFor, z.object(body)),
  roles: ['owner', 'admin', 'office'],
  risk: 'low',
  requiresApproval: false,
  example,
  async handler({ customer_id, property_id, job_id, ...rest }, ctx) {
    if (job_id && !(await getJob(ctx.companyId, job_id))) throw new Error('Job not found');
    const billing = await resolveBilling(ctx.companyId, { customerId: customer_id, propertyId: property_id });
    const invoice = await createInvoice(ctx.companyId, { ...billing, job_id, ...rest } as InvoiceDraft);
    await ctx.events.emit(ctx.companyId, 'invoice.created', { invoiceId: invoice.id, customerId: invoice.customer_id, totalCents: invoice.total_cents });
    return invoice;
  },
});

export const createInvoiceFromJobAction = defineAction({
  name: 'invoicing.create_from_job',
  module: 'invoicing',
  description: "Create a draft invoice for a job, copying its estimate's lines, tax and billing. Jobs with no estimate need lines added by hand.",
  input: z.object({ job_id: z.string().min(1), due_date: z.iso.date().default(() => addDays(today(), 14)) }),
  roles: ['owner', 'admin', 'office'],
  risk: 'low',
  requiresApproval: false,
  example: { job_id: 'job-id', due_date: '2026-12-15' },
  async handler({ job_id, due_date }, ctx) {
    const job = await getJob(ctx.companyId, job_id);
    if (!job) throw new Error('Job not found');
    const estimate = job.estimate_id ? await getEstimate(ctx.companyId, job.estimate_id) : undefined;
    if (!estimate) throw new Error('This job has no estimate to copy. Create the invoice and add its lines by hand.');
    const invoice = await createInvoice(ctx.companyId, {
      customer_id: job.customer_id,
      owed_by_customer_id: job.owed_by_customer_id,
      property_id: job.property_id,
      job_id: job.id,
      title: job.title,
      line_items: estimate.line_items,
      tax_rate_bps: estimate.tax_rate_bps,
      due_date,
      notes: estimate.notes,
    });
    await ctx.events.emit(ctx.companyId, 'invoice.created', { invoiceId: invoice.id, customerId: invoice.customer_id, totalCents: invoice.total_cents });
    return invoice;
  },
});

export const updateInvoiceAction = defineAction({
  name: 'invoicing.update',
  module: 'invoicing',
  description: 'Edit a draft invoice. Sent invoices can no longer be changed.',
  input: z.intersection(z.object({ invoice_id: z.string().min(1) }), z.intersection(whoFor, z.object(body))),
  roles: ['owner', 'admin', 'office'],
  risk: 'low',
  requiresApproval: false,
  example: { invoice_id: 'invoice-id', ...example },
  async handler({ invoice_id, customer_id, property_id, job_id, ...rest }, ctx) {
    const billing = await resolveBilling(ctx.companyId, { customerId: customer_id, propertyId: property_id });
    return updateDraft(ctx.companyId, invoice_id, { ...billing, job_id, ...rest } as InvoiceDraft);
  },
});

export const sendInvoiceAction = defineAction({
  name: 'invoicing.send',
  module: 'invoicing',
  description: 'Mark an invoice as sent to the customer.',
  input: z.object({ invoice_id: z.string().min(1) }),
  roles: ['owner', 'admin', 'office'],
  risk: 'medium',
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { invoice_id: 'invoice-id' },
  async handler({ invoice_id }, ctx) {
    const invoice = await sendInvoice(ctx.companyId, invoice_id);
    await ctx.events.emit(ctx.companyId, 'invoice.sent', { invoiceId: invoice.id, customerId: invoice.customer_id });
    return invoice;
  },
});

export const flagOverdueAction = defineAction({
  name: 'invoicing.flag_overdue',
  module: 'invoicing',
  description: 'Mark a sent, unpaid, past-due invoice overdue and announce it so reminders can follow.',
  input: z.object({ invoice_id: z.string().min(1) }),
  risk: 'low',
  requiresApproval: false,
  example: { invoice_id: 'invoice-id' },
  async handler({ invoice_id }, ctx) {
    const { invoice, daysOverdue } = await markOverdue(ctx.companyId, invoice_id);
    await ctx.events.emit(ctx.companyId, 'invoice.overdue', {
      invoiceId: invoice.id,
      customerId: invoice.customer_id,
      amountDueCents: invoice.total_cents - invoice.amount_paid_cents,
      daysOverdue,
    });
    return invoice;
  },
});

export const checkOverdueAction = defineAction({
  name: 'invoicing.check_overdue',
  module: 'invoicing',
  description: 'Find every sent invoice that is now past due and flag it overdue. Safe to run any time (a daily automation will run it).',
  input: z.object({}),
  risk: 'low',
  requiresApproval: false,
  example: {},
  async handler(_input, ctx) {
    const found = await findNewlyOverdue(ctx.companyId);
    for (const i of found) {
      const { invoice, daysOverdue } = await markOverdue(ctx.companyId, i.id);
      await ctx.events.emit(ctx.companyId, 'invoice.overdue', {
        invoiceId: invoice.id,
        customerId: invoice.customer_id,
        amountDueCents: invoice.total_cents - invoice.amount_paid_cents,
        daysOverdue,
      });
    }
    return { flagged: found.length };
  },
});

export const voidInvoiceAction = defineAction({
  name: 'invoicing.void',
  module: 'invoicing',
  description: 'Void an invoice that has no payments on it. Cannot be undone.',
  input: z.object({ invoice_id: z.string().min(1), reason: z.string().trim().min(1, 'Say why').max(500) }),
  roles: ['owner', 'admin', 'office'],
  risk: 'high',
  // A person confirms in the app; an AI agent always needs sign-off first.
  requiresApproval: (_input, ctx) => ctx.actor.kind === 'agent',
  example: { invoice_id: 'invoice-id', reason: 'Duplicate invoice' },
  async handler({ invoice_id, reason }, ctx) {
    if (!(await getInvoice(ctx.companyId, invoice_id))) throw new Error('Invoice not found');
    const invoice = await voidInvoice(ctx.companyId, invoice_id, reason);
    await ctx.events.emit(ctx.companyId, 'invoice.voided', { invoiceId: invoice.id, reason });
    return invoice;
  },
});
