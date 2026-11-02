import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { rescheduleJobAction } from './actions';

export const schedulingModule: ModuleManifest = {
  id: 'scheduling',
  label: 'Schedule',
  description: 'Calendar and dispatch.',
  path: '/schedule',
  icon: 'scheduling',
  mobileTab: true,
  Screen: lazy(() => import('./ui/SchedulingScreen')),
  register({ actions }) {
    actions.register(rescheduleJobAction);
  },
};

export type { ScheduleSlot } from './types';
