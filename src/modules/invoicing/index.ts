import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { createInvoiceAction, flagOverdueAction, sendInvoiceAction, voidInvoiceAction } from './actions';
import { applyPayment } from './services/invoiceService';

export const invoicingModule: ModuleManifest = {
  id: 'invoicing',
  label: 'Invoices',
  description: 'Invoices and receivables.',
  path: '/invoices',
  icon: 'invoicing',
  Screen: lazy(() => import('./ui/InvoicingScreen')),
  register({ actions, events }) {
    actions.register(createInvoiceAction);
    actions.register(sendInvoiceAction);
    actions.register(flagOverdueAction);
    actions.register(voidInvoiceAction);
    // The payments module announces money received; invoicing updates the balance.
    events.on('payment.received', (e) => {
      applyPayment(e.company_id, e.payload.invoiceId, e.payload.amountCents);
    });
  },
};

export type { Invoice, InvoiceStatus } from './types';
export { getInvoice, listInvoices } from './services/invoiceService';
