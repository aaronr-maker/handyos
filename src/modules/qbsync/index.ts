import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { saveSyncSettingsAction } from './actions';

/**
 * Sends HandyOS invoices and payments into QuickBooks. A module of its own: take it out of the list in src/modules.ts to
 * remove its page and actions, or leave "Sending is on" unticked (or set QB_PUSH_DISABLED=1 on the server) to stop it.
 */
export const qbsyncModule: ModuleManifest = {
  id: 'qbsync',
  label: 'QuickBooks sync',
  description: 'Send invoices and payments to QuickBooks.',
  path: '/quickbooks-sync',
  hiddenFromRoles: ['tech', 'office'],
  icon: 'qbsync',
  Screen: lazy(() => import('./ui/QuickbooksSyncScreen')),
  register({ actions }) {
    actions.register(saveSyncSettingsAction);
  },
};

export { buildQueue } from './queue';
export type { QueueItem } from './queue';
