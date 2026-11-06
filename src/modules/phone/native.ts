import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/** What the phone is doing with a call right now. */
export interface CallState {
  state: 'idle' | 'ringing' | 'connected';
  from?: string;
  /** The id of the call as it came in (to find its transcript) */
  parent?: string;
  muted?: boolean;
}

interface HandyCallPlugin {
  requestPermissions(): Promise<{ microphone: string; notifications: string }>;
  register(o: { token: string }): Promise<void>;
  getState(): Promise<CallState>;
  answer(): Promise<void>;
  decline(): Promise<void>;
  hangUp(): Promise<void>;
  mute(o: { muted: boolean }): Promise<void>;
  addListener(event: 'state', fn: (s: CallState) => void): Promise<PluginListenerHandle>;
}

/** The phone's calling, only in the installed Android app; in a browser there is none. */
export const isPhoneApp = (): boolean => Capacitor.isNativePlatform();
export const handyCall = registerPlugin<HandyCallPlugin>('HandyCall');
