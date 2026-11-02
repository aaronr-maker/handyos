import type { JobStatus } from '../types';

export const statusClass: Record<JobStatus, string> = { unscheduled: 'pill', scheduled: 'pill medium', in_progress: 'pill ok', completed: 'pill' };
export const statusLabel: Record<JobStatus, string> = { unscheduled: 'unscheduled', scheduled: 'scheduled', in_progress: 'in progress', completed: 'completed' };
