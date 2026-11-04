import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { addTaskAction, closeTimers, editTimeAction, loadTasksAction, removeTaskAction, setGeofenceConsentAction, setJobSiteAction, shiftInAction, shiftOutAction, startTaskAction, stopTaskAction } from './actions';

/**
 * Time in three levels: the day (shift), the job (the existing job clock), and the task (task timers). The job's time is
 * split into direct task time and overhead. A module of its own: take it out of src/app/modules.ts to remove its screens
 * and actions (the job clock in the jobs module keeps working).
 */
export const timetrackModule: ModuleManifest = {
  id: 'timetrack',
  label: 'My time',
  description: 'Day clock, job time and task timers.',
  path: '/time',
  icon: 'timetrack',
  Screen: lazy(() => import('./ui/TimeScreen')),
  register({ actions, events }) {
    for (const a of [shiftInAction, shiftOutAction, startTaskAction, stopTaskAction, addTaskAction, loadTasksAction, removeTaskAction, editTimeAction, setGeofenceConsentAction, setJobSiteAction]) actions.register(a);
    // a task timer stops with the job time: when the tech clocks out of the job, or the job is completed
    events.on('timeclock.out', (e) => void closeTimers(e.company_id, { userId: e.payload.userId, jobId: e.payload.jobId }));
    events.on('job.completed', (e) => void closeTimers(e.company_id, { jobId: e.payload.jobId }));
  },
};

export { checkJobTime, distanceMeters, evenSplit, splitJobTime } from './calc';
export type { JobTime, TaskTime, TechTime, TimeFlag } from './calc';
export { jobTimeData, listAllTimers, listEdits, listShifts, loadStandards } from './service';
export { learnStandards, serviceKey } from './standards';
export type { Standards, ServiceStandard } from './standards';
export type { GeofenceConsent, JobSite, JobTask, Shift, TaskTimer, TimeEdit } from './types';
export { Punch } from './ui/Punch';
export { clock as clockText, hm as hoursMinutes, initials } from './ui/fmt';
export { editTimeAction } from './actions';
