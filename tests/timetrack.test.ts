import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule } from '../src/modules/customers';
import { jobsModule } from '../src/modules/jobs';
import { checkJobTime, distanceMeters, evenSplit, jobTimeData, splitJobTime, timetrackModule } from '../src/modules/timetrack';

const at = (h: number, m = 0) => `2027-01-05T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00.000Z`;
const tasks = [{ id: 'gutters', name: 'Gutter clean out' }, { id: 'door', name: 'Storm door' }];

describe('splitting a job\'s time', () => {
  it('splits even minutes exactly', () => {
    expect(evenSplit(10, 3)).toEqual([4, 3, 3]);
    expect(evenSplit(0, 2)).toEqual([0, 0]);
    expect(evenSplit(5, 0)).toEqual([]);
  });

  it('shares the time off the tasks evenly across the tasks the tech timed', () => {
    // 8:00-12:00 on the job (240 min). Gutters timed 8:30-10:00 (90), door 10:00-11:30 (90): 60 minutes of overhead, 30 each.
    const t = splitJobTime({
      tasks,
      entries: [{ id: 'e1', user_id: 'alex', clock_in: at(8), clock_out: at(12) }],
      timers: [
        { id: 't1', task_id: 'gutters', user_id: 'alex', started_at: at(8, 30), ended_at: at(10) },
        { id: 't2', task_id: 'door', user_id: 'alex', started_at: at(10), ended_at: at(11, 30) },
      ],
    });
    expect(t.job_minutes).toBe(240);
    expect(t.direct_minutes).toBe(180);
    expect(t.overhead_minutes).toBe(60);
    expect(t.tasks.map((x) => [x.task_id, x.direct, x.overhead, x.total])).toEqual([['gutters', 90, 30, 120], ['door', 90, 30, 120]]);
    expect(t.tasks.reduce((n, x) => n + x.total, 0)).toBe(240); // everything on the job is accounted for
  });

  it('shares all of a tech\'s time across every task when they timed none, keeping the job total', () => {
    const t = splitJobTime({ tasks, entries: [{ id: 'e1', user_id: 'alex', clock_in: at(8), clock_out: at(12) }], timers: [] });
    expect(t.tasks.map((x) => x.total)).toEqual([120, 120]);
    expect(t.direct_minutes).toBe(0);
  });

  it('works out each tech on their own and adds them up, on the same task or different ones', () => {
    const t = splitJobTime({
      tasks,
      entries: [
        { id: 'e1', user_id: 'alex', clock_in: at(8), clock_out: at(10) },
        { id: 'e2', user_id: 'sam', clock_in: at(8), clock_out: at(9) },
      ],
      timers: [
        { id: 't1', task_id: 'gutters', user_id: 'alex', started_at: at(8), ended_at: at(9, 30) }, // 90 direct, 30 overhead -> all to gutters
        { id: 't2', task_id: 'gutters', user_id: 'sam', started_at: at(8), ended_at: at(9) }, // 60 direct on the same task
      ],
    });
    expect(t.techs.map((x) => [x.user_id, x.job_minutes, x.task_minutes, x.overhead_minutes])).toEqual([['alex', 120, 90, 30], ['sam', 60, 60, 0]]);
    expect(t.tasks.find((x) => x.task_id === 'gutters')).toMatchObject({ direct: 150, overhead: 30, total: 180 });
    expect(t.tasks.find((x) => x.task_id === 'door')!.total).toBe(0);
    expect(t.job_minutes).toBe(180);
  });

  it('trims a task timer to the time on the job, and keeps overhead when the job has no tasks', () => {
    const trimmed = splitJobTime({
      tasks,
      entries: [{ id: 'e1', user_id: 'alex', clock_in: at(9), clock_out: at(10) }],
      timers: [{ id: 't1', task_id: 'door', user_id: 'alex', started_at: at(8), ended_at: at(11) }],
    });
    expect(trimmed.tasks.find((x) => x.task_id === 'door')!.direct).toBe(60);
    const none = splitJobTime({ tasks: [], entries: [{ id: 'e1', user_id: 'alex', clock_in: at(9), clock_out: at(10) }], timers: [] });
    expect(none.unassigned_minutes).toBe(60);
    expect(none.job_minutes).toBe(60);
  });
});

describe('cross-checks on job time', () => {
  const base = { tasks, jobDone: false, now: Date.parse(at(22)) };
  it('flags a forgotten clock, overlaps, untimed multi-task jobs and timers outside the job', () => {
    const kinds = (i: Parameters<typeof checkJobTime>[0]) => checkJobTime(i).map((f) => f.kind);
    expect(kinds({ ...base, entries: [{ id: 'e', user_id: 'a', clock_in: at(8), clock_out: null }], timers: [] })).toEqual(['open_entry', 'no_task_timing']);
    expect(kinds({ ...base, entries: [{ id: 'e', user_id: 'a', clock_in: at(8), clock_out: at(10) }, { id: 'f', user_id: 'a', clock_in: at(9), clock_out: at(11) }], timers: [] })).toContain('overlapping_entries');
    expect(kinds({ ...base, entries: [{ id: 'e', user_id: 'a', clock_in: at(8), clock_out: at(10) }], timers: [{ id: 't', task_id: 'door', user_id: 'a', started_at: at(7), ended_at: at(9) }] })).toContain('timer_outside_job');
    expect(kinds({ ...base, entries: [{ id: 'e', user_id: 'a', clock_in: at(8), clock_out: at(10) }], timers: [{ id: 't', task_id: 'door', user_id: 'a', started_at: at(8), ended_at: at(10) }] })).toEqual([]);
    expect(kinds({ ...base, entries: [{ id: 'e', user_id: 'a', clock_in: at(1), clock_out: at(15) }], timers: [] })).toContain('long_entry');
  });

  it('measures distance for the arrival check', () => {
    expect(Math.round(distanceMeters({ lat: 30, lng: -97 }, { lat: 30, lng: -97 }))).toBe(0);
    const d = distanceMeters({ lat: 30.2672, lng: -97.7431 }, { lat: 30.2681, lng: -97.7431 });
    expect(d).toBeGreaterThan(90);
    expect(d).toBeLessThan(110);
  });
});

describe('the day clock, job time and task timers together', () => {
  it('keeps one task timer at a time, stops it with the job time, and records edits with the original kept', async () => {
    const rt = createRuntime();
    for (const m of [customersModule, jobsModule]) m.register({ actions: rt.actions, events: rt.events });
    timetrackModule.register({ actions: rt.actions, events: rt.events });
    const co = 'coTime';
    const as = (id: string, role: 'owner' | 'tech' | 'office') => ({ companyId: co, actor: { kind: 'user' as const, id }, role });
    const run = (name: string, input: unknown, c = as('alex', 'tech')) => rt.actions.executeByName(name, input, c);

    const cust = await run('customers.create', { first_name: 'Pat', last_name: 'R' }, as('owner1', 'owner'));
    const job = await run('jobs.create', { customer_id: (cust as { output: { id: string } }).output.id, title: 'Gutters and door', assignee_ids: ['alex', 'sam'] }, as('owner1', 'owner'));
    const jobId = (job as { output: { id: string } }).output.id;
    const a = await run('timetrack.add_task', { job_id: jobId, name: 'Gutter clean out', quantity: 100, unit: 'ft' });
    const b = await run('timetrack.add_task', { job_id: jobId, name: 'Storm door', quantity: 1, unit: 'each' });
    const [gutters, door] = [(a as { output: { id: string } }).output.id, (b as { output: { id: string } }).output.id];

    expect((await run('timetrack.shift_in', {})).status).toBe('ok');
    expect((await run('timetrack.shift_in', {})).status).toBe('error'); // already in for the day
    expect((await run('timetrack.start_task', { task_id: gutters })).status).toBe('error'); // not on the job yet
    expect((await run('jobs.clock_in', { job_id: jobId })).status).toBe('ok');
    expect((await run('timetrack.start_task', { task_id: gutters })).status).toBe('ok');
    expect((await run('timetrack.start_task', { task_id: door })).status).toBe('ok'); // closes the gutters timer
    let data = await jobTimeData(co, jobId);
    expect(data.timers.filter((t) => t.ended_at === null).map((t) => t.task_id)).toEqual([door]);
    expect(data.timers.find((t) => t.task_id === gutters)!.ended_at).not.toBeNull();

    await run('jobs.clock_out', { note: null }); // the task timer stops with the job time
    data = await jobTimeData(co, jobId);
    expect(data.timers.every((t) => t.ended_at !== null)).toBe(true);
    expect((await run('timetrack.shift_out', {})).status).toBe('ok');

    // editing: a tech can change their own time; the old value is kept with who and why
    const entryId = data.entries[0].id;
    const newEnd = new Date(Date.parse(data.entries[0].clock_in) + 3 * 3_600_000).toISOString();
    expect((await run('timetrack.edit_time', { entity: 'job', id: entryId, end: newEnd, reason: 'Forgot to stop' })).status).toBe('ok');
    data = await jobTimeData(co, jobId);
    expect(data.entries[0].clock_out).toBe(newEnd);
    expect(data.edits).toMatchObject([{ entity: 'job', entity_id: entryId, user_id: 'alex', edited_by: 'alex', field: 'clock_out', new_value: newEnd, reason: 'Forgot to stop' }]);
    expect(data.edits[0].old_value).not.toBeNull();
    // another tech (or the office) cannot change it; an admin or owner can; an end before the start is refused
    expect((await run('timetrack.edit_time', { entity: 'job', id: entryId, end: newEnd }, as('sam', 'tech'))).status).toBe('error');
    expect((await run('timetrack.edit_time', { entity: 'job', id: entryId, end: newEnd }, as('off1', 'office'))).status).toBe('error');
    expect((await run('timetrack.edit_time', { entity: 'job', id: entryId, end: new Date(Date.parse(data.entries[0].clock_in) - 1000).toISOString() }, as('owner1', 'owner'))).status).toBe('error');
    expect((await run('timetrack.edit_time', { entity: 'job', id: entryId, end: new Date(Date.parse(newEnd) + 60_000).toISOString() }, as('owner1', 'owner'))).status).toBe('ok');
    expect((await jobTimeData(co, jobId)).edits.map((e) => e.edited_by)).toEqual(['alex', 'owner1']);
  });
});
