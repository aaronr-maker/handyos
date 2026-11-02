import { createRepo, type BaseRecord, type Id } from '@/core';
import { getJob, listTimeEntries } from '@/modules/jobs';
import { computeP4P, validateSetup, type P4PResult } from '../p4pCalc';
import type { LevelKind, P4PBasis, P4PLevel, P4PPayout, P4PRun, P4PSettings, TeamStructure } from '../p4pTypes';
import { costJob, loadCostingData } from './jobCostService';

const settingsRepo = createRepo<P4PSettings>('p4p_settings');
const levelsRepo = createRepo<P4PLevel>('p4p_levels');
const structureRepo = createRepo<TeamStructure>('team_structure');
const runsRepo = createRepo<P4PRun>('p4p_runs');
const payoutsRepo = createRepo<P4PPayout>('p4p_payouts');

export interface SetupInput {
  basis: P4PBasis;
  company_reserve_bps: number;
  /** `id` is an existing level's id, or any temporary id for a new level (it is replaced when saved). */
  levels: { id: string; name: string; kind: LevelKind; percent_bps: number }[];
  /** Who is on which level and who they report to. People with neither are simply left out. */
  people: { user_id: Id; level_id: Id | null; reports_to: Id | null }[];
}

export interface Setup {
  basis: P4PBasis;
  company_reserve_bps: number;
  levels: P4PLevel[];
  structure: TeamStructure[];
}

/** The company's P4P setup. With nothing saved yet, the default is net profit, no reserve and no levels (nothing is paid out). */
export async function getSetup(companyId: Id): Promise<Setup> {
  const [settings, levels, structure] = await Promise.all([settingsRepo.list(companyId), levelsRepo.list(companyId), structureRepo.list(companyId)]);
  return {
    basis: settings[0]?.basis ?? 'net_profit',
    company_reserve_bps: settings[0]?.company_reserve_bps ?? 0,
    levels: levels.sort((a, b) => a.sort_order - b.sort_order),
    structure,
  };
}

/** Saves the whole setup at once (settings, levels in order, and who reports to whom). */
export async function saveSetup(companyId: Id, input: SetupInput): Promise<Setup> {
  const problem = validateSetup(input.company_reserve_bps, input.levels);
  if (problem) throw new Error(problem);
  for (const p of input.people) {
    if (p.reports_to && p.reports_to === p.user_id) throw new Error('Nobody can report to themselves.');
  }

  const current = await getSetup(companyId);
  const settings = (await settingsRepo.list(companyId))[0];
  if (settings) await settingsRepo.update(companyId, settings.id, { basis: input.basis, company_reserve_bps: input.company_reserve_bps });
  else await settingsRepo.insert(companyId, { basis: input.basis, company_reserve_bps: input.company_reserve_bps });

  // levels: keep ids of existing ones, create new ones, delete the ones that were removed
  const idMap = new Map<string, Id>();
  const keep = new Set<string>();
  for (const [order, l] of input.levels.entries()) {
    const found = current.levels.find((x) => x.id === l.id);
    if (found) {
      await levelsRepo.update(companyId, found.id, { name: l.name.trim(), kind: l.kind, percent_bps: l.percent_bps, sort_order: order });
      idMap.set(l.id, found.id);
      keep.add(found.id);
    } else {
      const made = await levelsRepo.insert(companyId, { name: l.name.trim(), kind: l.kind, percent_bps: l.percent_bps, sort_order: order });
      idMap.set(l.id, made.id);
      keep.add(made.id);
    }
  }
  const people = input.people.map((p) => ({ ...p, level_id: p.level_id ? (idMap.get(p.level_id) ?? null) : null }));
  // drop people-to-level links before deleting levels (the database does this itself; demo mode needs it too)
  for (const row of current.structure) {
    if (row.level_id && !keep.has(row.level_id)) await structureRepo.update(companyId, row.id, { level_id: null });
  }
  for (const l of current.levels) if (!keep.has(l.id)) await levelsRepo.remove(companyId, l.id);

  // people: upsert those given, remove those left out
  const wanted = new Set(people.map((p) => p.user_id));
  for (const row of current.structure) if (!wanted.has(row.user_id)) await structureRepo.remove(companyId, row.id);
  for (const p of people) {
    const row = current.structure.find((r) => r.user_id === p.user_id);
    if (row) await structureRepo.update(companyId, row.id, { level_id: p.level_id, reports_to: p.reports_to });
    else await structureRepo.insert(companyId, { user_id: p.user_id, level_id: p.level_id, reports_to: p.reports_to });
  }
  return getSetup(companyId);
}

export type JobP4PStatus =
  | 'not_ready' // job not finished, or invoices not all paid yet: the numbers are a projection
  | 'ready' // finished and fully paid: can be finalized
  | 'finalized';

export interface JobP4P {
  result: P4PResult;
  status: JobP4PStatus;
  /** Why it isn't ready yet, in plain words. */
  reason: string | null;
  run: P4PRun | null;
  payouts: P4PPayout[];
}

const minutesBy = (entries: { user_id: Id; clock_in: string; clock_out: string | null }[]) => {
  const out: Record<Id, number> = {};
  const now = Date.now();
  for (const e of entries) {
    const m = Math.max(0, Math.round(((e.clock_out ? Date.parse(e.clock_out) : now) - Date.parse(e.clock_in)) / 60000));
    out[e.user_id] = (out[e.user_id] ?? 0) + m;
  }
  return out;
};

/** The payout for a job: a projection until the job is finished and paid, then finalizable, then a saved snapshot. */
export async function jobP4P(companyId: Id, jobId: Id): Promise<JobP4P> {
  const job = await getJob(companyId, jobId);
  if (!job) throw new Error('Job not found');
  const [setup, costing, entries, runs, payouts] = await Promise.all([
    getSetup(companyId),
    loadCostingData(companyId),
    listTimeEntries(companyId),
    runsRepo.list(companyId, { where: { job_id: jobId } }),
    payoutsRepo.list(companyId, { where: { job_id: jobId } }),
  ]);
  const cost = costJob(job, costing, null);
  const result = computeP4P({
    basis: setup.basis,
    company_reserve_bps: setup.company_reserve_bps,
    levels: setup.levels,
    reports_to: Object.fromEntries(setup.structure.map((s) => [s.user_id, s.reports_to])),
    revenue_cents: cost.invoiced_cents,
    non_labor_cost_cents: cost.material_cents + cost.other_cents,
    total_cost_cents: cost.total_cost_cents,
    sold_by: job.sold_by,
    minutes: minutesBy(entries.filter((e) => e.job_id === jobId)),
  });

  const run = runs[0] ?? null;
  const live = costing.invoices.filter((i) => i.job_id === jobId && i.status !== 'void' && i.status !== 'draft');
  let reason: string | null = null;
  if (job.status !== 'completed') reason = 'The job is not completed yet.';
  else if (live.length === 0) reason = 'Nothing has been invoiced for this job yet.';
  else if (live.some((i) => i.status !== 'paid')) reason = 'The invoice is not fully paid yet.';
  return { result, status: run ? 'finalized' : reason ? 'not_ready' : 'ready', reason, run, payouts };
}

/** Saves the job's payout as a snapshot (so later settings changes never rewrite it). Only when finished and paid, and only once. */
export async function finalizeJob(companyId: Id, jobId: Id, byUser: Id | null): Promise<{ run: P4PRun; payouts: P4PPayout[] }> {
  const p = await jobP4P(companyId, jobId);
  if (p.status === 'finalized') throw new Error('This job has already been paid out.');
  if (p.reason) throw new Error(`Not ready to finalize: ${p.reason}`);
  const r = p.result;
  const run = await runsRepo.insert(companyId, {
    job_id: jobId,
    basis: r.basis,
    basis_cents: r.basis_cents,
    reserve_bps: r.reserve_bps,
    reserve_cents: r.reserve_cents,
    pool_cents: r.pool_cents,
    company_total_cents: r.company_total_cents,
    snapshot: r,
    finalized_by: byUser,
    finalized_at: new Date().toISOString(),
  });
  const minutes = minutesBy((await listTimeEntries(companyId)).filter((e) => e.job_id === jobId));
  const rows = r.levels.flatMap((l) =>
    l.allocations
      .filter((a) => a.amount_cents > 0)
      .map((a) => ({ run_id: run.id, job_id: jobId, user_id: a.user_id, level_name: l.name, minutes: minutes[a.user_id] ?? 0, amount_cents: a.amount_cents, paid_on: null })),
  );
  const payouts = rows.length ? await payoutsRepo.insertMany(companyId, rows as Omit<P4PPayout, keyof BaseRecord>[]) : [];
  return { run, payouts };
}

export const listPayouts = (companyId: Id) => payoutsRepo.list(companyId);

export async function markPaid(companyId: Id, payoutIds: Id[], paidOn: string): Promise<number> {
  let n = 0;
  for (const id of payoutIds) {
    const row = await payoutsRepo.get(companyId, id);
    if (!row || row.paid_on) continue;
    await payoutsRepo.update(companyId, id, { paid_on: paidOn });
    n++;
  }
  return n;
}
