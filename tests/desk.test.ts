import { describe, expect, it } from 'vitest';
import { suggestAssignees, suggestReassignments } from '../src/modules/desk';
import type { TimeFacts } from '../src/modules/timesheets';

// Wednesday January 6, 2027, noon. The week runs Monday the 4th to Sunday the 10th.
const NOW = new Date(2027, 0, 6, 12).getTime();
const at = (day: number, h: number) => new Date(2027, 0, day, h).toISOString();
const job = (id: string, d: number, from: number, to: number, status = 'scheduled') => ({ id, title: `Job ${id}`, status, scheduled_start: at(d, from), scheduled_end: at(d, to), completed_at: null }) as never;
const facts = (jobs: unknown[], assigned: Record<string, string[]>, entries: unknown[] = [], shifts: unknown[] = []): TimeFacts => ({
  shifts: shifts as never,
  entries: entries as never,
  jobs: jobs as never,
  assignments: Object.entries(assigned).flatMap(([user, ids]) => ids.map((job_id) => ({ job_id, user_id: user }))) as never,
  edits: [],
});
const shift = (user: string, d: number, from: number, to: number) => ({ user_id: user, clock_in: at(d, from), clock_out: at(d, to) });

describe('Handy\'s suggestions for a week that is too full', () => {
  // Alex: 30 hours clocked Mon-Wed (10h days) and three 4-hour jobs left (Thu, Fri, Sat) = 42h projected at 1.0.
  // Sam: 12 hours clocked, nothing scheduled. Pat: 12 hours clocked, a job on Friday morning.
  const base = (extra: unknown[] = [], assigned: Record<string, string[]> = {}) =>
    facts(
      [job('t', 7, 8, 12), job('f', 8, 8, 12), job('s', 9, 8, 12), ...extra],
      { alex: ['t', 'f', 's'], ...assigned },
      [],
      [shift('alex', 4, 7, 17), shift('alex', 5, 7, 17), shift('alex', 6, 7, 17), shift('sam', 4, 8, 12), shift('sam', 5, 8, 12), shift('sam', 6, 8, 12), shift('pat', 4, 8, 12), shift('pat', 5, 8, 12), shift('pat', 6, 8, 12)],
    );

  it('moves the latest jobs to people who stay under 40 hours and are free at that time', () => {
    const f = base([job('p', 8, 8, 12)], { pat: ['p'] });
    const fixes = suggestReassignments({ facts: f, overUser: 'alex', candidates: ['sam', 'pat'], now: NOW, limit: 40 * 60 });
    // 42h projected, so one 4-hour job is enough; the latest one (Saturday) goes to the person with the most room
    expect(fixes.map((x) => [x.jobId, x.toUserId])).toEqual([['s', 'sam']]);
    expect(fixes[0].savedMinutes).toBe(4 * 60);
  });

  it('does not double-book someone who already has a job at that time', () => {
    const f = base([job('p1', 7, 9, 11), job('p2', 8, 8, 12), job('p3', 9, 9, 11)], { pat: ['p1', 'p2', 'p3'] });
    const onlyPat = suggestReassignments({ facts: f, overUser: 'alex', candidates: ['pat'], now: NOW, limit: 40 * 60 });
    expect(onlyPat).toEqual([]); // Pat is busy at the time of each of Alex's jobs: nothing fits
  });

  it('suggests nothing when everyone would go over, or the jobs have already started', () => {
    const f = base();
    expect(suggestReassignments({ facts: f, overUser: 'alex', candidates: [], now: NOW, limit: 40 * 60 })).toEqual([]);
    expect(suggestReassignments({ facts: f, overUser: 'alex', candidates: ['sam'], now: NOW, limit: 10 * 60 })[0]?.toUserId).toBeUndefined(); // Sam would be over 10h
  });

  it('names who could take a job nobody has, free at that time and under the limit', () => {
    const f = base([job('p', 8, 8, 12)], { pat: ['p'] });
    const who = suggestAssignees({ facts: f, job: { id: 'new', scheduled_start: at(8, 9), scheduled_end: at(8, 11) }, candidates: ['alex', 'sam', 'pat'], now: NOW, limit: 40 * 60 });
    expect(who.map((w) => w.userId)).toEqual(['sam']); // Pat is busy then; Alex would go over
  });
});
