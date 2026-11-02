import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { approveEstimateAction, createEstimateAction, declineEstimateAction, sendEstimateAction, updateEstimateAction } from './actions';
import { addPriceItemAction, setPriceItemActiveAction, updatePriceItemAction } from './priceBookActions';

export const estimatesModule: ModuleManifest = {
  id: 'estimates',
  label: 'Estimates',
  description: 'Price book and estimates.',
  path: '/estimates',
  hiddenFromRoles: ['tech'],
  icon: 'estimates',
  Screen: lazy(() => import('./ui/EstimatesScreen')),
  register({ actions }) {
    actions.register(createEstimateAction);
    actions.register(sendEstimateAction);
    actions.register(updateEstimateAction);
    actions.register(declineEstimateAction);
    actions.register(approveEstimateAction);
    actions.register(addPriceItemAction);
    actions.register(updatePriceItemAction);
    actions.register(setPriceItemActiveAction);
  },
};

export type { Estimate, EstimateLineItem, EstimateStatus, PriceBookItem, PriceKind } from './types';
export { listPriceItems } from './services/priceBookService';
export { getEstimate, listEstimates } from './services/estimateService';
export { computeTotals, lineTotal } from './totals';
export { LineItemsEditor, TotalsSummary } from './ui/LineItemsEditor';
export { blankLine, editorTotals, parseEditorLines, toEditorLines } from './ui/lines';
export type { EditorLine } from './ui/lines';
