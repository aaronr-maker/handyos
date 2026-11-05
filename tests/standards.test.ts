import { describe, expect, it } from 'vitest';
import { learnStandards, nnls, serviceKey, type StandardInput } from '../src/modules/timetrack/standards';

let n = 0;
const id = (p: string) => `${p}${++n}`;

/** One finished job with one tech who clocked `minutes` on it (no task timers unless `timers` is given). */
function job(spec: { title: string; day: number; minutes: number; tasks: { name: string; qty: number; unit: string; timed?: number }[]; tech?: string }) {
  const jobId = id('job');
  const tech = spec.tech ?? 'alex';
  const start = new Date(2027, 0, spec.day, 8).getTime();
  const entry = { id: id('e'), job_id: jobId, user_id: tech, clock_in: new Date(start).toISOString(), clock_out: new Date(start + spec.minutes * 60_000).toISOString() };
  const tasks = spec.tasks.map((t) => ({ id: id('t'), job_id: jobId, name: t.name, price_book_item_id: null, quantity: t.qty, unit: t.unit, timed: t.timed }));
  // timed tasks run back to back from the start of the job
  let cursor = start;
  const timers = tasks
    .filter((t) => t.timed)
    .map((t) => {
      const from = cursor;
      cursor += (t.timed as number) * 60_000;
      return { id: id('tm'), task_id: t.id, user_id: tech, started_at: new Date(from).toISOString(), ended_at: new Date(cursor).toISOString() };
    });
  return { job: { id: jobId, title: spec.title, completed: true }, tasks: tasks.map(({ timed, ...t }) => (void timed, t)), entries: [entry], timers };
}
const merge = (...js: ReturnType<typeof job>[]): StandardInput => ({ jobs: js.map((j) => j.job), tasks: js.flatMap((j) => j.tasks), entries: js.flatMap((j) => j.entries), timers: js.flatMap((j) => j.timers) });
const standard = (s: ReturnType<typeof learnStandards>, name: string) => s.services.find((x) => x.name === name)!;

describe('non-negative least squares', () => {
  it('solves a small exact system and never goes negative', () => {
    const x = nnls([[1, 0], [0, 1], [1, 1]], [2, 3, 5]);
    expect(x[0]).toBeCloseTo(2, 4);
    expect(x[1]).toBeCloseTo(3, 4);
    expect(nnls([[1], [1]], [-5, -3])[0]).toBe(0);
  });
});

describe('learning standard times', () => {
  it('works out the gutters from a door-only job and a gutters-and-door job, as in the example', () => {
    // door alone: 1 visit = door + overhead = 120. gutters 50 ft alone = 50g + overhead = 90. both = 100g + door + overhead = 240.
    const s = learnStandards(
      merge(
        job({ title: 'Door only', day: 4, minutes: 120, tasks: [{ name: 'Storm door', qty: 1, unit: 'each' }] }),
        job({ title: 'Gutters 50', day: 5, minutes: 90, tasks: [{ name: 'Gutter clean out', qty: 50, unit: 'ft' }] }),
        job({ title: 'Both', day: 6, minutes: 240, tasks: [{ name: 'Gutter clean out', qty: 100, unit: 'ft' }, { name: 'Storm door', qty: 1, unit: 'each' }] }),
      ),
    );
    expect(standard(s, 'Gutter clean out').minutes_per_unit).toBeCloseTo(1.2, 1);
    expect(standard(s, 'Gutter clean out').source).toBe('inferred');
    expect(standard(s, 'Storm door').minutes_per_unit).toBeCloseTo(90, 0);
    expect(s.overhead_per_visit).toBeCloseTo(30, 0);
    expect(standard(s, 'Gutter clean out').confidence).toBe('learning'); // only a couple of jobs
  });

  it('prefers what techs timed, counts them, and says when the two sources disagree', () => {
    const timedJobs = [1, 2, 3, 4, 5].map((i) => job({ title: 'Timed ' + i, day: i, minutes: 130, tasks: [{ name: 'Hang door', qty: 1, unit: 'each', timed: 90 + i }, { name: 'Caulk', qty: 10, unit: 'ft', timed: 20 }] }));
    // untimed jobs say a door takes about 60 minutes (and a visit has no overhead), which is far from the timed ~92
    const untimed = [1, 2, 3].map((i) => job({ title: 'Untimed ' + i, day: 10 + i, minutes: 60, tasks: [{ name: 'Hang door', qty: 1, unit: 'each' }] }));
    const s = learnStandards(merge(...timedJobs, ...untimed));
    const door = standard(s, 'Hang door');
    expect(door.source).toBe('measured');
    expect(door.measured_tasks).toBe(5);
    expect(door.minutes_per_unit).toBeCloseTo(93, 0);
    expect(door.confidence).toBe('good'); // five timed, tight spread
    expect(door.disagrees?.source).toBe('inferred');
    expect(standard(s, 'Caulk').minutes_per_unit).toBeCloseTo(2, 5); // 20 minutes for 10 ft
  });

  it('flags a finished job that took far longer than the standards predict, and gives each tech a speed', () => {
    const base = [1, 2, 3, 4, 5, 6].map((i) => job({ title: 'Normal ' + i, day: i, minutes: 100, tasks: [{ name: 'Paint wall', qty: 10, unit: 'each', timed: 80 }], tech: i % 2 ? 'alex' : 'sam' }));
    const slow = job({ title: 'Trouble job', day: 20, minutes: 300, tasks: [{ name: 'Paint wall', qty: 10, unit: 'each', timed: 280 }], tech: 'sam' });
    const s = learnStandards(merge(...base, slow));
    expect(s.outliers.map((o) => o.title)).toEqual(['Trouble job']);
    expect(s.outliers[0].ratio).toBeGreaterThan(2);
    expect(s.tech_speed.map((t) => t.user_id).sort()).toEqual(['alex', 'sam']);
    expect(s.tech_speed.find((t) => t.user_id === 'sam')!.ratio).toBeGreaterThan(s.tech_speed.find((t) => t.user_id === 'alex')!.ratio);
  });

  it('shows services with nothing known yet as learning, and tells the same service in different units apart', () => {
    const s = learnStandards(merge(job({ title: 'Only job', day: 4, minutes: 0, tasks: [{ name: 'Fence', qty: 1, unit: 'ft' }] })));
    expect(s.services.every((x) => x.minutes_per_unit === null && x.confidence === 'learning')).toBe(true);
    expect(serviceKey({ price_book_item_id: null, name: 'Fence ', unit: 'FT' })).toBe('fence|ft');
    expect(serviceKey({ price_book_item_id: null, name: 'Fence', unit: 'each' })).not.toBe('fence|ft');
  });
});
