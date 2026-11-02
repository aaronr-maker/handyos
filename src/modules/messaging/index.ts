import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { sendMessageAction } from './actions';

export const messagingModule: ModuleManifest = {
  id: 'messaging',
  label: 'Messages',
  description: 'Customer messaging.',
  path: '/messages',
  icon: 'messaging',
  Screen: lazy(() => import('./ui/MessagingScreen')),
  register({ actions }) {
    actions.register(sendMessageAction);
  },
};

export type { Message } from './types';
export { listMessages } from './services/messageService';
