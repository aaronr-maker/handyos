import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { closeAlertAction, refreshAlertsAction } from './actions';

/**
 * The manager's desk: alerts (a tech heading over the weekly hours, a clock left running), tasks that need a decision,
 * and Handy's suggested fixes, like moving a job to someone with room. A module of its own: remove it from
 * src/app/modules.ts to switch it off.
 */
export const deskModule: ModuleManifest = {
  id: 'desk',
  label: 'Manager desk',
  description: 'Alerts, tasks and suggested fixes.',
  path: '/desk',
  hiddenFromRoles: ['tech', 'office'],
  icon: 'desk',
  Screen: lazy(() => import('./ui/DeskScreen')),
  register({ actions }) {
    actions.register(refreshAlertsAction);
    actions.register(closeAlertAction);
  },
};

export { suggestAssignees, suggestReassignments } from './suggest';
export type { Assignee, Reassignment } from './suggest';
export { listAlerts, refreshAlerts } from './service';
export type { AlertKind, DeskAlert } from './types';
