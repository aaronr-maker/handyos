import type { EstimateStatus } from '../types';

export const statusClass: Record<EstimateStatus, string> = { draft: 'pill', sent: 'pill medium', approved: 'pill ok', declined: 'pill high' };
