import { lazy } from 'react';
import type { ModuleManifest } from '@/core';
import { IncomingCall } from './ui/IncomingCall';
import { markVoicemailHeardAction, saveCallFlowAction, savePhoneSettingsAction, setTeamPhoneAction } from './actions';

/**
 * The company phone system: a drag-and-drop call tree (business hours, greetings, menus, who to ring, what happens when nobody
 * answers, voicemail), the hours and team phone numbers it uses, and the log of calls and voicemails. The call itself is
 * answered by the server (api/voice/...) using the same engine as the test call here. A module of its own: remove it from
 * src/app/modules.ts to switch the screens off.
 */
export const phoneModule: ModuleManifest = {
  id: 'phone',
  label: 'Phone',
  description: 'Call tree, hours and voicemail.',
  path: '/phone',
  icon: 'phone',
  hiddenFromRoles: ['tech'],
  // the phone app's answer screen is for everyone who has the app, techs included
  Overlay: IncomingCall,
  overlayForAll: true,
  Screen: lazy(() => import('./ui/PhoneScreen')),
  register({ actions }) {
    for (const a of [saveCallFlowAction, savePhoneSettingsAction, setTeamPhoneAction, markVoicemailHeardAction]) actions.register(a);
  },
};
