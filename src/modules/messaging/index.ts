import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { sendMessageAction } from './actions';

export const messagingModule: ModuleManifest = {
  id: 'messaging',
  label: 'Messages',
  description: 'Customer messaging.',
  path: '/messages',
  hiddenFromRoles: ['tech'],
  icon: 'messaging',
  Screen: lazy(() => import('./ui/MessagingScreen')),
  register({ actions }) {
    actions.register(sendMessageAction);
  },
};

export { sendMessageAction } from './actions';
export type { Message, MessageStatus } from './types';
export { listAllMessages, listMessages } from './services/messageService';
