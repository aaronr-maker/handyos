import { describe, expect, it } from 'vitest';
import { createRuntime } from '../src/core';
import { customersModule } from '../src/modules/customers';
import { estimatesModule } from '../src/modules/estimates';
import { getOpenEntry, getJob, jobsModule, listAssignments, listJobs, listTimeEntries } from '../src/modules/jobs';
import { schedulingModule } from '../src/modules/scheduling';

type Caller = { companyId: string; actor: { kind: 'user' | 'agent' | 'system'; id: string } };

const setup = (co: string) => {
  const rt = createRuntime();
  for (const m of [customersModule, estimatesModule, jobsModule, schedulingModule]) m.register({ actions: rt.actions, events: rt.events });
  const tech: Caller = { companyId: co, actor: { kind: 'user', id: 'tech-1' } };
  const tech2: Caller = { companyId: co, actor: { kind: 'user', id: 'tech-2' } };
  const run = (name: string, input: unknown, c: Caller = tech) => rt.actions.executeByName(name, input, c);
  const out = <T>(r: unknown) => (r as { output: T }).output;
  return { rt, run, out, tech, tech2 };
};

describe('jobs', () => {
  it('creates numbered jobs billed through the property rule, and assigns people', async () => {
    const co = 'coJobs1';
    const { run, out } = setup(co);
    const mgr = out<{ id: string }>(await run('customers.create', { company_name: 'Acme PM', is_property_manager: true }));
    const owner = out<{ id: string }>(await run('customers.create', { first_name: 'Olivia', last_name: 'Owner' }));
    const prop = out<{ id: string }>(await run('customers.add_property', { owner_id: owner.id, manager_id: mgr.id, address_line1: '12 Oak St' }));

    const r = await run('jobs.create', { property_id: prop.id, title: 'Fix gate', assignee_ids: ['tech-1', 'tech-2'] });
    expect(r.status, JSON.stringify(r)).toBe('ok');
    const job = out<{ id: string; job_number: number; customer_id: string; owed_by_customer_id: string; status: string }>(r);
    expect(job).toMatchObject({ job_number: 1001, customer_id: mgr.id, owed_by_customer_id: owner.id, status: 'unscheduled' });
    expect((await listAssignments(co)).map((a) => a.user_id).sort()).toEqual(['tech-1', 'tech-2']);

    await run('jobs.assign', { job_id: job.id, user_ids: ['tech-2'] });
    expect((await listAssignments(co)).map((a) => a.user_id)).toEqual(['tech-2']);
    expect((await run('jobs.create', { title: 'No one' })).status).toBe('invalid');
  });

  it('puts a job on the calendar, keeps its length when moved, and refuses to move a finished job', async () => {
    const co = 'coJobs2';
    const { run, out } = setup(co);
    const c = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }));
    const job = out<{ id: string }>(await run('jobs.create', { customer_id: c.id, title: 'Paint', scheduled_start: '2026-12-01T15:00:00.000Z', scheduled_end: '2026-12-01T17:00:00.000Z' }));
    expect((await getJob(co, job.id))!.status).toBe('scheduled');
    const moved = await run('scheduling.reschedule_job', { job_id: job.id, start: '2026-12-03T14:00:00.000Z' });
    expect(moved.status, JSON.stringify(moved)).toBe('ok');
    expect((await getJob(co, job.id))!.scheduled_end).toBe('2026-12-03T16:00:00.000Z'); // still 2 hours
    await run('jobs.complete', { job_id: job.id });
    expect((await run('scheduling.reschedule_job', { job_id: job.id, start: '2026-12-05T14:00:00.000Z' })).status).toBe('error');
  });

  it('clocks techs in and out: one open entry each, only people, completion clocks out, events fire', async () => {
    const co = 'coJobs3';
    const { rt, run, out, tech, tech2 } = setup(co);
    const c = out<{ id: string }>(await run('customers.create', { first_name: 'Pat', last_name: 'R' }));
    const j1 = out<{ id: string }>(await run('jobs.create', { customer_id: c.id, title: 'One' }));
    const j2 = out<{ id: string }>(await run('jobs.create', { customer_id: c.id, title: 'Two' }));
    const seen: string[] = [];
    rt.events.on('timeclock.in', (e) => void seen.push(`in:${e.payload.userId}`));
    rt.events.on('timeclock.out', (e) => void seen.push(`out:${e.payload.userId}`));

    expect((await run('jobs.clock_in', { job_id: j1.id })).status).toBe('ok');
    expect((await getJob(co, j1.id))!.status).toBe('in_progress');
    const twice = await run('jobs.clock_in', { job_id: j2.id });
    expect((twice as { message: string }).message).toContain('already clocked in');
    expect((await run('jobs.clock_in', { job_id: j1.id }, tech2)).status).toBe('ok'); // a second person can join the same job
    expect((await rt.actions.executeByName('jobs.clock_in', { job_id: j2.id }, { companyId: co, actor: { kind: 'agent', id: 'bot' } })).status).toBe('error');

    expect((await run('jobs.clock_out', { note: 'Done with gate' })).status).toBe('ok');
    expect((await getOpenEntry(co, 'tech-1'))).toBeUndefined();
    expect((await run('jobs.clock_out', {})).status).toBe('error'); // not clocked in anymore

    // completing the job clocks out whoever is still on it
    expect((await run('jobs.complete', { job_id: j1.id })).status).toBe('ok');
    expect(await getOpenEntry(co, 'tech-2')).toBeUndefined();
    expect((await listTimeEntries(co)).every((e) => e.clock_out !== null)).toBe(true);
    expect((await run('jobs.clock_in', { job_id: j1.id }, tech)).status).toBe('error'); // finished jobs can't be clocked into
    expect(seen).toEqual(expect.arrayContaining(['in:tech-1', 'in:tech-2', 'out:tech-1']));
  });

  it('an approved estimate becomes a job with the same billing and property', async () => {
    const co = 'coJobs4';
    const { run, out } = setup(co);
    const mgr = out<{ id: string }>(await run('customers.create', { company_name: 'Acme PM', is_property_manager: true }));
    const owner = out<{ id: string }>(await run('customers.create', { first_name: 'Olivia', last_name: 'Owner' }));
    const prop = out<{ id: string }>(await run('customers.add_property', { owner_id: owner.id, manager_id: mgr.id, address_line1: '12 Oak St' }));
    const est = out<{ id: string }>(await run('estimates.create', { property_id: prop.id, title: 'Fix gate', line_items: [{ description: 'Labor', quantity: 1, unit_price_cents: 9500 }] }));
    await run('estimates.send', { estimate_id: est.id });
    await run('estimates.approve', { estimate_id: est.id });
    const jobs = await listJobs(co);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ title: 'Fix gate', property_id: prop.id, customer_id: mgr.id, owed_by_customer_id: owner.id, estimate_id: est.id, job_number: 1001 });
  });
});
