import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { completeJobAction, createJobAction } from './actions';
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
    actions.register(createJobAction);
    actions.register(completeJobAction);
    // React to the estimates module through the event bus (no import of its code).
    events.on('estimate.approved', async (e) => {
      const job = createJob(e.company_id, {
        customer_id: e.payload.customerId,
        title: 'Job from approved estimate',
        estimate_id: e.payload.estimateId,
      });
      await events.emit(e.company_id, 'job.created', { jobId: job.id, customerId: job.customer_id });
    });
  },
};

export type { Job, JobStatus } from './types';
export { getJob, listJobs, setJobSchedule } from './services/jobService';
