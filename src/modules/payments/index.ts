import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { recordPaymentAction, refundPaymentAction } from './actions';

export const paymentsModule: ModuleManifest = {
  id: 'payments',
  label: 'Payments',
  description: 'Payments and Stripe.',
  path: '/payments',
  hiddenFromRoles: ['tech'],
  icon: 'payments',
  Screen: lazy(() => import('./ui/PaymentsScreen')),
  register({ actions }) {
    actions.register(recordPaymentAction);
    actions.register(refundPaymentAction);
  },
};

export type { Payment, PaymentMethod } from './types';
export { listPayments, listPaymentsFor } from './services/paymentService';
export { InvoicePaymentsPanel } from './ui/InvoicePaymentsPanel';
