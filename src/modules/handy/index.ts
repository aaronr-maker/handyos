import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { HandyOverlay } from './ui/HandyPanel';

/**
 * Handy, the office assistant: a floating button with a chat. He looks things up and, with the person's OK, does things
 * through the same actions people use, acting with that person's permissions. The conversation is masked before it leaves
 * the app and kept in the company's own database. A module of its own: remove it from src/app/modules.ts to switch it off.
 */
export const handyModule: ModuleManifest = {
  id: 'handy',
  label: 'Handy',
  description: 'The office assistant.',
  path: '/handy',
  icon: 'handy',
  hiddenFromRoles: ['tech'],
  hiddenFromNav: true, // reached from the floating button, and from Settings for usage and options
  Overlay: HandyOverlay,
  Screen: lazy(() => import('./ui/HandyScreen')),
  register() {
    // Handy has no actions of his own: he uses the other modules' actions, as the person he works for.
  },
};

export { createMasker } from './mask';
export { runTurn } from './chat';
