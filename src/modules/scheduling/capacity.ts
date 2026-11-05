/** How full one person's day is, using how long their jobs really take compared with the time booked (their efficiency rate). */
export interface DayCapacity {
  /** Minutes booked on the calendar. */
  bookedMin: number;
  /** What those jobs will probably take in real work: booked × rate. */
  expectedMin: number;
  /** Real work minutes still free in the day (0 when over). */
  freeMin: number;
  /** How many calendar minutes of new jobs fit, since each booked minute takes `rate` minutes of work. */
  roomMin: number;
  over: boolean;
}

export const WORKDAY_MINUTES = 8 * 60;

export function dayCapacity(jobs: { start: string; end: string | null }[], rate: number, workday = WORKDAY_MINUTES): DayCapacity {
  const bookedMin = jobs.reduce((n, j) => n + (j.end ? Math.max(0, Math.round((Date.parse(j.end) - Date.parse(j.start)) / 60000)) : 60), 0);
  const r = rate > 0 ? rate : 1;
  const expectedMin = Math.round(bookedMin * r);
  const freeMin = Math.max(0, workday - expectedMin);
  return { bookedMin, expectedMin, freeMin, roomMin: Math.floor(freeMin / r / 15) * 15, over: expectedMin > workday };
}

export const hoursText = (min: number): string => {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h && m ? `${h}h ${m}m` : h ? `${h}h` : `${m}m`;
};
