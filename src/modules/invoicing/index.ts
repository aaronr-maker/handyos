import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import {
  checkOverdueAction,
  createInvoiceAction,
  createInvoiceFromJobAction,
  flagOverdueAction,
  sendInvoiceAction,
  updateInvoiceAction,
  voidInvoiceAction,
} from './actions';

export const invoicingModule: ModuleManifest = {
  id: 'invoicing',
  label: 'Invoices',
  description: 'Invoices and receivables.',
  path: '/invoices',
  icon: 'invoicing',
  Screen: lazy(() => import('./ui/InvoicingScreen')),
  register({ actions }) {
    [createInvoiceAction, createInvoiceFromJobAction, updateInvoiceAction, sendInvoiceAction, flagOverdueAction, checkOverdueAction, voidInvoiceAction].forEach((a) =>
      actions.register(a),
    );
  },
};

export type { Invoice, InvoiceStatus } from './types';
export { applyPayment, balanceOf, getInvoice, listInvoices } from './services/invoiceService';
