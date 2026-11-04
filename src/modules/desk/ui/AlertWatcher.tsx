import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAction, useSession } from '@/core';
import { refreshAlertsAction } from '../actions';
import { listAlerts } from '../service';
import { setOpenAlerts, unseenAlerts, useOpenAlerts } from '../store';
import type { DeskAlert } from '../types';

const KEY = (companyId: string) => `handyos.alerts.seen.${companyId}`;
const readSeen = (companyId: string): Set<string> => {
  try {
    return new Set(JSON.parse(localStorage.getItem(KEY(companyId)) ?? '[]') as string[]);
  } catch {
    return new Set();
  }
};
const writeSeen = (companyId: string, seen: Set<string>) => {
  try {
    localStorage.setItem(KEY(companyId), JSON.stringify([...seen].slice(-200)));
  } catch {
    // remembering what was shown is only a convenience
  }
};

/** Counts open items in the menu. */
export function OpenCount() {
  const n = useOpenAlerts().length;
  return n > 0 ? <span className="nav-badge" aria-label={`${n} open`}>{n}</span> : null;
}

/**
 * While the app is open, looks at everyone's week every few minutes, keeps the open count current, and pops up each new
 * alert once. A popup is only a nudge: the alert stays on the to-do page until someone ticks it off.
 */
export function AlertWatcher() {
  const { companyId } = useSession();
  const refresh = useAction(refreshAlertsAction);
  const [popups, setPopups] = useState<DeskAlert[]>([]);
  const seen = useRef<Set<string>>(readSeen(companyId));
  const run = useRef<() => Promise<void>>(async () => undefined);

  useEffect(() => {
    run.current = async () => {
      try {
        await refresh({});
        const open = (await listAlerts(companyId)).filter((a) => a.status === 'open');
        setOpenAlerts(open);
        setPopups(unseenAlerts(open, seen.current));
      } catch {
        // a failed check just tries again next time
      }
    };
  });
  useEffect(() => {
    void run.current();
    const t = window.setInterval(() => void run.current(), 3 * 60_000);
    return () => window.clearInterval(t);
  }, [companyId]);

  const dismiss = (ids: string[]) => {
    ids.forEach((id) => seen.current.add(id));
    writeSeen(companyId, seen.current);
    setPopups((cur) => cur.filter((p) => !ids.includes(p.id)));
  };
  if (popups.length === 0) return null;
  const shown = popups.slice(0, 3);
  return (
    <div className="alert-popups" role="alert">
      {shown.map((a) => (
        <div key={a.id} className={`alert-popup ${a.severity}`}>
          <strong>{a.title}</strong>
          <p className="muted">{a.detail}</p>
          <div className="row">
            <Link to="/desk" onClick={() => dismiss([a.id])}>
              Open my to-do list
            </Link>
            <button type="button" className="link" onClick={() => dismiss([a.id])}>
              Got it
            </button>
          </div>
        </div>
      ))}
      {popups.length > shown.length && (
        <div className="alert-popup">
          <p>
            {popups.length - shown.length} more.{' '}
            <Link to="/desk" onClick={() => dismiss(popups.map((p) => p.id))}>
              Open my to-do list
            </Link>
          </p>
        </div>
      )}
    </div>
  );
}
