import { useSyncExternalStore } from 'react';
import type { DeskAlert } from './types';

/** The open alerts, kept where the popups, the menu badge and the to-do page can all read them. */
let open: DeskAlert[] = [];
const listeners = new Set<() => void>();

export function setOpenAlerts(next: DeskAlert[]): void {
  open = next;
  listeners.forEach((l) => l());
}
export function useOpenAlerts(): DeskAlert[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => open,
  );
}

/** Open alerts the person has not yet been shown in a popup (newest first). */
export const unseenAlerts = (alerts: DeskAlert[], seen: ReadonlySet<string>): DeskAlert[] => alerts.filter((a) => a.status === 'open' && !seen.has(a.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
