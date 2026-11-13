import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { importRevenueHistoryAction, removeRevenueImportAction } from './actions';

export const revenueModule: ModuleManifest = {
  id: 'revenue',
  label: 'Revenue',
  description: 'Revenue over time.',
  path: '/revenue',
  hiddenFromRoles: ['tech', 'office'],
  hiddenFromNav: true, // lives inside Jobs data now
  icon: 'revenue',
  Screen: lazy(() => import('./ui/RevenueScreen')),
  register({ actions }) {
    actions.register(importRevenueHistoryAction);
    actions.register(removeRevenueImportAction);
  },
};

export { buildEntries, GROUP_LABELS, groupRevenue, LAUNCH_MONTH, paymentRevenue, revenueTimeline, weekStart, yearTotals } from './calc';
export type { GroupBy, RevenueGroup } from './calc';
export { listHistory } from './service';
export { default as RevenueByPeriod } from './ui/RevenueScreen';
export type { RevenueEntry, RevenueHistory } from './types';
export { FIELD_LABELS, parseAmount, parseDate, readEntries, readRevenueFile } from './importParse';
export type { RevenueMonth, RevenueSource } from './calc';
