import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { addJobCostAction, removeJobCostAction, setPayRateAction } from './actions';
import { finalizePayoutAction, markPayoutsPaidAction, savePayForPerformanceAction } from './p4pActions';
import { saveOverheadMonthAction, saveRateSettingsAction } from './rateActions';

export const jobcostingModule: ModuleManifest = {
  id: 'jobcosting',
  label: 'Job costing',
  description: 'Job profitability and P4P.',
  path: '/job-costing',
  hiddenFromRoles: ['tech'],
  icon: 'jobcosting',
  Screen: lazy(() => import('./ui/JobCostingScreen')),
  register({ actions }) {
    actions.register(addJobCostAction);
    actions.register(removeJobCostAction);
    actions.register(setPayRateAction);
    actions.register(savePayForPerformanceAction);
    actions.register(finalizePayoutAction);
    actions.register(markPayoutsPaidAction);
    actions.register(saveOverheadMonthAction);
    actions.register(saveRateSettingsAction);
  },
};

/** A person's own pay-for-performance earnings (every role can see their own). */
export const MyEarnings = lazy(() => import('./ui/MyEarnings'));

/** The pay-for-performance settings editor (rendered by the app's Settings screen). */
export const P4PSettings = lazy(() => import('./ui/P4PSettings'));
export type { CostKind, JobCost, PayRate } from './types';
export * from './p4pTypes';
export * from './rateTypes';
export { computeRate, computeWindowRate, crewMinutes, crewMinutesPerYear, minutesByMonth, monthKey } from './rateCalc';
export type { RateResult } from './rateCalc';
export { defaultCategory, parseAmount, parsePnl } from './qbPnl';
export type { PnlIncomeLine, PnlLine, PnlResult } from './qbPnl';
export { monthlyIncome } from './services/rateService';
export type { MonthlyIncome } from './services/rateService';
export { computeP4P, validateSetup, splitCents } from './p4pCalc';
export type { P4PResult, LevelResult } from './p4pCalc';
export { finalizeJob, getSetup, jobP4P, listPayouts, saveSetup } from './services/p4pService';
export type { JobP4P, JobP4PStatus, Setup, SetupInput } from './services/p4pService';
export { computeJobCost } from './calc';
export type { JobCostResult } from './calc';
export { costJob, expectedCost, loadCostingData } from './services/jobCostService';
export { jobEconomics } from './services/economicsService';
export type { JobEconomics } from './services/economicsService';
export { quickbooksLink } from './services/integrationService';
export type { IntegrationLink } from './services/integrationService';
