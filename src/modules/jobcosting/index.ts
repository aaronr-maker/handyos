import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { addJobCostAction } from './actions';

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
  },
};

export type { JobCost, CostKind } from './types';
export { totalCostForJob } from './services/jobCostService';
