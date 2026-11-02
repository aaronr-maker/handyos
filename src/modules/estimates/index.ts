import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { approveEstimateAction, createEstimateAction, sendEstimateAction } from './actions';
import { addPriceItemAction, setPriceItemActiveAction, updatePriceItemAction } from './priceBookActions';

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
    actions.register(addPriceItemAction);
    actions.register(updatePriceItemAction);
    actions.register(setPriceItemActiveAction);
  },
};

export type { Estimate, EstimateLineItem, EstimateStatus, PriceBookItem, PriceKind } from './types';
export { listPriceItems } from './services/priceBookService';
export { getEstimate, listEstimates } from './services/estimateService';
