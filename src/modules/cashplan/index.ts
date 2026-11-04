import { lazy } from 'react';
import type { ModuleManifest } from '@/core';

export const cashplanModule: ModuleManifest = {
  id: 'cashplan',
  label: 'Cash plan',
  description: 'Where each payment should go.',
  path: '/cash-plan',
  hiddenFromRoles: ['tech'],
  icon: 'cashplan',
  Screen: lazy(() => import('./ui/CashPlanScreen')),
  register() {
    // A suggestion screen only: it reads payments, costs and pay-for-performance and moves no money, so it has no actions.
  },
};

export { addPlans, BUCKETS, planPayment } from './calc';
export type { BucketId, PaymentPlan } from './calc';
