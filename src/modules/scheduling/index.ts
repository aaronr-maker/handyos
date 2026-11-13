import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { addCalendarEventAction, removeCalendarEventAction, rescheduleJobAction } from './actions';

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
    actions.register(addCalendarEventAction);
    actions.register(removeCalendarEventAction);
  },
};

export type { CalendarEvent, ScheduleSlot } from './types';
export { listCalendarEvents, KIND_LABEL } from './events';
