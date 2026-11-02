import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { addJobCostAction, removeJobCostAction, setPayRateAction } from './actions';

export const jobcostingModule: ModuleManifest = {
  id: 'jobcosting',
  label: 'Job costing',
  description: 'Job profitability and P4P.',
  path: '/job-costing',
  hiddenFromRoles: ['tech'],
  icon: 'jobcosting',
  Screen: lazy(() => import('./ui/JobCostingScreen')),
  register({ actions }) {
    actions.register(addJobCostAction);
    actions.register(removeJobCostAction);
    actions.register(setPayRateAction);
  },
};

export type { CostKind, JobCost, PayRate } from './types';
export { computeJobCost } from './calc';
export type { JobCostResult } from './calc';
export { costJob, expectedCost, loadCostingData } from './services/jobCostService';
