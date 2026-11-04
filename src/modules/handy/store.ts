import { useSyncExternalStore } from 'react';

/** Whether the Handy panel is open (the floating button and the Handy page both use it). */
let open = false;
const listeners = new Set<() => void>();
export const setHandyOpen = (v: boolean) => {
  open = v;
  listeners.forEach((l) => l());
};
export const useHandyOpen = () =>
  useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
