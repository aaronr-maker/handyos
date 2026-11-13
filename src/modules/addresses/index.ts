import { lazy } from 'react';
import type { ModuleManifest } from '@/core';

/**
 * One page per address: who is connected to it (owner, manager, tenant) and every job, estimate and invoice there.
 * It only reads. Remove it from src/app/modules.ts to switch it off (the "Open address" links then have nowhere to go).
 */
export const addressesModule: ModuleManifest = {
  id: 'addresses',
  label: 'Addresses',
  description: 'Everything we have done at one address.',
  path: '/addresses',
  icon: 'customers',
  hiddenFromNav: true,
  hiddenFromRoles: ['tech'],
  Screen: lazy(() => import('./ui/AddressScreen')),
  register() {
    // A page only: it reads and changes nothing.
  },
};
