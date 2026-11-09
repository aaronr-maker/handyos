import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { saveEstimateTimesAction, saveTeamAvailabilityAction } from './actions';

/**
 * The AI receptionist's settings and logic: the times set aside for in-home estimates (with who is signed off to do them), and
 * the open-slot logic it offers callers. The live conversation itself runs on the voice server. A module of its own: remove it
 * from src/app/modules.ts to switch the screen off.
 */
export const receptionistModule: ModuleManifest = {
  id: 'receptionist',
  label: 'Estimate times',
  description: 'Times set aside for in-home estimates.',
  path: '/estimate-times',
  icon: 'scheduling',
  hiddenFromRoles: ['tech', 'office'],
  hiddenFromNav: true, // it lives in Settings
  Screen: lazy(() => import('./ui/EstimateTimesScreen')),
  register({ actions }) {
    actions.register(saveEstimateTimesAction);
    actions.register(saveTeamAvailabilityAction);
  },
};

export { default as EstimateTimesSettings } from './ui/EstimateTimesScreen';
export { default as TeamAvailabilitySettings } from './ui/TeamAvailability';
export { offerSentence, openSlots, pickOffers } from './availability';
export type { EstimateBlocks, Offer } from './availability';
