import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { clearHistorySourceAction, importReportAction } from './actions';

/**
 * Jobs data: the numbers from your jobs over time (revenue, profit, margin, average ticket, revenue per hour, by month, lead
 * source, salesperson and person), built from reports brought in from the old system, plus the revenue-by-period view. Owner and
 * admin only. A module of its own: remove it from src/app/modules.ts to switch it off.
 */
export const jobsdataModule: ModuleManifest = {
  id: 'jobsdata',
  label: 'Jobs data',
  description: 'Revenue, profit and the numbers behind your jobs.',
  path: '/jobs-data',
  icon: 'revenue',
  hiddenFromRoles: ['tech', 'office'],
  Screen: lazy(() => import('./ui/JobsDataScreen')),
  register({ actions }) {
    actions.register(importReportAction);
    actions.register(clearHistorySourceAction);
  },
};

export { computeJobsData } from './kpis';
export type { JobsDataReport } from './kpis';
