import { lazy } from 'react';
import type { ModuleManifest } from '@/core';

/**
 * The first screen after sign-in: a greeting, the day at a glance, your own to-do list, a few numbers for your role, and
 * quick call / text buttons. It only reads (everything it shows comes from other modules' public interfaces). Remove it from
 * src/app/modules.ts to switch it off; the app then falls back to the old home page.
 */
export const todayModule: ModuleManifest = {
  id: 'today',
  label: 'Dashboard',
  description: 'Your day, your tasks and your numbers.',
  path: '/dashboard',
  icon: 'home',
  mobileTab: true,
  Screen: lazy(() => import('./ui/TodayScreen')),
  register() {
    // A page only: it reads and changes nothing.
  },
};
