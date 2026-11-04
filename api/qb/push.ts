import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearer, realDeps, respond } from '../_lib/handler.js';
import { ApiError } from '../_lib/qb.js';
import { pushInvoice, pushPayment, type InvoicePayload, type PaymentPayload } from '../_lib/qbPush.js';

/** POST { kind: "invoice" | "payment", invoice | payment }: sends one invoice or payment into QuickBooks. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Use POST.' });
  const body = (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body) as { kind?: string; invoice?: InvoicePayload; payment?: PaymentPayload };
  await respond(res, async () => {
    if (body.kind === 'invoice' && body.invoice) return pushInvoice(realDeps(), bearer(req), body.invoice);
    if (body.kind === 'payment' && body.payment) return pushPayment(realDeps(), bearer(req), body.payment);
    throw new ApiError(400, 'Nothing to send.');
  });
}
