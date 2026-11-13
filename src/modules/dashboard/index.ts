import { lazy } from 'react';
import type { ModuleManifest } from '@/core';

/**
 * The business dashboard: the numbers that matter in one place (sales, production, profit, cash, the team's leaderboards) and
 * the one thing holding the business back right now. It only reads; remove it from src/app/modules.ts to switch it off.
 */
export const dashboardModule: ModuleManifest = {
  id: 'dashboard',
  label: 'KPI Dashboard',
  description: 'Your numbers, and your constraint.',
  path: '/kpi-dashboard',
  icon: 'dashboard',
  hiddenFromRoles: ['tech', 'office'],
  Screen: lazy(() => import('./ui/DashboardScreen')),
  register() {
    // A report only: it reads and changes nothing, so it has no actions.
  },
};

export { computeDashboard, TARGETS } from './kpis';
export type { Constraint, Dashboard, Kpi } from './kpis';
export { loadDashboard } from './service';
