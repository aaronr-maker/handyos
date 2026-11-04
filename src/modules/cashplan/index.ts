import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { setCashMovedAction } from './actions';

export const cashplanModule: ModuleManifest = {
  id: 'cashplan',
  label: 'Cash plan',
  description: 'Where each payment should go.',
  path: '/cash-plan',
  hiddenFromRoles: ['tech'],
  icon: 'cashplan',
  Screen: lazy(() => import('./ui/CashPlanScreen')),
  register({ actions }) {
    // It only suggests and keeps a tick-list of what was moved; it never moves money itself.
    actions.register(setCashMovedAction);
  },
};

export { addPlans, BUCKETS, planPayment } from './calc';
export type { BucketId, PaymentPlan } from './calc';
export { listMoves, moveStatus, setMoved } from './moves';
export type { CashMove, MoveStatus } from './moves';
