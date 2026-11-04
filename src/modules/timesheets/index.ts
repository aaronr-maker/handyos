import { lazy } from 'react';
import type { ModuleManifest } from '@/core';

/**
 * Timesheets: each person's clocked time by week, the hours the week is heading for, and (for admins and owners) everyone's.
 * A module of its own: remove it from src/app/modules.ts to switch it off (the clocks keep working).
 */
export const timesheetsModule: ModuleManifest = {
  id: 'timesheets',
  label: 'Timesheets',
  description: 'Weekly timesheets and projected hours.',
  path: '/timesheets',
  icon: 'timetrack',
  Screen: lazy(() => import('./ui/TimesheetsScreen')),
  register() {
    // It reads time and the schedule and edits through the time tracking actions, so it has no actions of its own.
  },
};

export { clockedWeek, dayKey, efficiencyRate, projectWeek, scheduledRemaining, weekRange, WEEK_LIMIT_MINUTES } from './calc';
export type { Efficiency, WeekProjection } from './calc';
export { efficiencyFor, loadTimeFacts, upcomingJobsFor, weekReport } from './service';
export type { TimeFacts, WeekReport } from './service';
