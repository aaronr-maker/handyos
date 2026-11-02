import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { approveEstimateAction, createEstimateAction, sendEstimateAction } from './actions';

export const estimatesModule: ModuleManifest = {
  id: 'estimates',
  label: 'Estimates',
  description: 'Price book and estimates.',
  path: '/estimates',
  icon: 'estimates',
  Screen: lazy(() => import('./ui/EstimatesScreen')),
  register({ actions }) {
    actions.register(createEstimateAction);
    actions.register(sendEstimateAction);
    actions.register(approveEstimateAction);
  },
};

export type { Estimate, EstimateLineItem, EstimateStatus } from './types';
export { getEstimate, listEstimates } from './services/estimateService';
