import { useEffect, useState } from 'react';
import type { Id } from '@/core';
import { distanceMeters } from '../calc';
import type { JobSite } from '../types';

/**
 * Tells the screen when the person has arrived at one of their jobs, while the app is open on the phone. It only
 * runs for someone who agreed to location reminders. Reminders that work with the app closed need the native phone
 * app (see the README); this is the same check, running in the web app.
 */
export function useArrival(enabled: boolean, sites: (JobSite & { skip?: boolean })[]): { jobId: Id | null; problem: string | null } {
  const [jobId, setJobId] = useState<Id | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const key = sites.map((s) => `${s.job_id}:${s.lat}:${s.lng}:${s.radius_m}:${s.skip ? 1 : 0}`).join('|');
  useEffect(() => {
    if (!enabled || sites.length === 0 || !('geolocation' in navigator)) return;
    const watch = navigator.geolocation.watchPosition(
      (p) => {
        setProblem(null);
        const here = { lat: p.coords.latitude, lng: p.coords.longitude };
        const near = sites.find((s) => !s.skip && distanceMeters(here, s) <= s.radius_m);
        setJobId(near ? near.job_id : null);
      },
      (err) => setProblem(err.code === err.PERMISSION_DENIED ? 'Location is blocked for this site. Allow it in your phone or browser settings.' : 'Could not read your location.'),
      { enableHighAccuracy: true, maximumAge: 15000, timeout: 30000 },
    );
    return () => navigator.geolocation.clearWatch(watch);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `sites` is keyed by `key`
  }, [enabled, key]);
  return { jobId: enabled ? jobId : null, problem: enabled ? problem : null };
}
