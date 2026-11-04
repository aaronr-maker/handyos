import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { assignJobAction, clockInAction, clockOutAction, completeJobAction, createJobAction, setSellerAction, updateJobAction } from './actions';
import { createJob } from './services/jobService';

export const jobsModule: ModuleManifest = {
  id: 'jobs',
  label: 'Jobs',
  description: 'Jobs and tech time tracking.',
  path: '/jobs',
  icon: 'jobs',
  mobileTab: true,
  Screen: lazy(() => import('./ui/JobsScreen')),
  register({ actions, events }) {
    [createJobAction, updateJobAction, setSellerAction, assignJobAction, completeJobAction, clockInAction, clockOutAction].forEach((a) => actions.register(a));
    // React to the estimates module through the event bus (no import of its code): an approved estimate becomes a job.
    events.on('estimate.approved', async (e) => {
      const job = await createJob(e.company_id, {
        customer_id: e.payload.customerId,
        owed_by_customer_id: e.payload.owedById,
        property_id: e.payload.propertyId,
        estimate_id: e.payload.estimateId,
        sold_by: e.payload.soldBy,
        title: e.payload.title,
        notes: null,
      });
      await events.emit(e.company_id, 'job.created', { jobId: job.id, customerId: job.customer_id });
    });
  },
};

export type { Job, JobAssignment, JobStatus, TimeEntry } from './types';
export { getJob, getOpenEntry, getTimeEntry, listAssignments, listJobs, listTimeEntries, setJobSchedule, updateTimeEntry } from './services/jobService';
export { clockInAction, clockOutAction } from './actions';
