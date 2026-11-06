import { lazy } from 'react';
import type { ModuleManifest } from '@/core';

/**
 * Sales: who is selling, how many estimates go out, the average ticket and close rate, and whether enough estimates are being
 * sent to cover the crew and the profit target. It only reads; remove it from src/app/modules.ts to switch it off.
 */
export const salesModule: ModuleManifest = {
  id: 'sales',
  label: 'Sales',
  description: 'Who is selling, and the top performer in each category.',
  path: '/sales',
  icon: 'revenue',
  Screen: lazy(() => import('./ui/SalesScreen')),
  register() {
    // A report only: it reads and changes nothing, so it has no actions.
  },
};

export { computeSales } from './calc';
export type { SalesReport } from './calc';
