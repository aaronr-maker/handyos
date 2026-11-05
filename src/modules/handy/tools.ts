import type { Id } from '@/core';
import { assignJobAction } from '@/modules/jobs';
import { sendMessageAction } from '@/modules/messaging';
import { customerLabel, getCustomer, listAllProperties, listCustomers } from '@/modules/customers';
import { closeAlertAction, listAlerts } from '@/modules/desk';
import { efficiencyFor, loadTimeFacts, upcomingJobsFor, weekReport } from '@/modules/timesheets';
import type { Refs, WireTool } from './chat';

/** What a tool needs to look things up for the person Handy is working for. */
export interface ToolContext {
  companyId: Id;
  team: { id: Id; full_name: string | null; email: string; role: string }[];
}

const person = { type: 'string', description: 'The first or full name of a team member, as in the team list.' };
const tool = (name: string, description: string, properties: Record<string, unknown> = {}, required: string[] = []): WireTool => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required, additionalProperties: false } } });

export const HANDY_TOOLS: WireTool[] = [
  tool('team', 'List the team members and their roles.'),
  tool('find_customer', "Find a customer by name, company, email address or phone number, and get the customer's ID. Use this whenever you need a customer's ID and do not already have it; never make an ID up.", { query: { type: 'string', description: 'What to search for.' } }, ['query']),
  tool('week_hours', "A team member's week: hours clocked, scheduled time still ahead, efficiency rate and projected total.", { person }, ['person']),
  tool('upcoming_jobs', 'Jobs still to be worked that are assigned to a team member (or to anyone, if no name is given), with times and job ids.', { person }),
  tool('unassigned_jobs', 'Scheduled jobs that nobody is assigned to yet.'),
  tool('open_alerts', 'The open items on the to-do list, with ids.'),
  tool('assign_job', 'Put a team member on a job. With replace_person, that person comes off the job first (a reassignment).', { job_id: { type: 'string' }, person, replace_person: { type: 'string', description: 'Optional: someone currently on the job to take off.' } }, ['job_id', 'person']),
  tool('close_alert', 'Mark a to-do item handled.', { alert_id: { type: 'string' }, note: { type: 'string' } }, ['alert_id']),
  tool(
    'send_message',
    "Draft a text or email to a customer. The person reviews and can edit it, and decides whether to save it. Use {first_name} for the customer's first name; never put an ID in the message.",
    { customer: { type: 'string', description: "The customer's ID (C-...) as written in the conversation." }, channel: { type: 'string', enum: ['sms', 'email'] }, body: { type: 'string' } },
    ['customer', 'channel', 'body'],
  ),
];

const ACTIONS = new Set(['assign_job', 'close_alert', 'send_message']);
export const isActionTool = (name: string) => ACTIONS.has(name);

const nameOf = (m: ToolContext['team'][number]) => m.full_name || m.email || 'Team member';
/** Finds a team member by what was said: the exact name first, then a first name or part of the name (one match only). */
export function findPerson(team: ToolContext['team'], said: unknown): ToolContext['team'][number] {
  const q = String(said ?? '').trim().toLowerCase();
  if (!q) throw new Error('Which team member?');
  const exact = team.filter((m) => nameOf(m).toLowerCase() === q);
  if (exact.length === 1) return exact[0];
  const part = team.filter((m) => nameOf(m).toLowerCase().includes(q) || nameOf(m).toLowerCase().split(/\s+/)[0] === q);
  if (part.length === 1) return part[0];
  throw new Error(part.length > 1 ? `More than one team member matches "${said}": ${part.map(nameOf).join(', ')}.` : `No team member matches "${said}".`);
}

/** Who and where each job is for, so the answer ties the job to its customer, the owner it is labeled as owed by, and the property. (Real names and addresses: they are sent as IDs.) */
async function jobParties(companyId: Id) {
  const [customers, properties] = await Promise.all([listCustomers(companyId), listAllProperties(companyId)]);
  const label = (id: Id | null) => {
    const c = customers.find((x) => x.id === id);
    return c ? customerLabel(c) : null;
  };
  return (j: { customer_id: Id; owed_by_customer_id: Id | null; property_id: Id | null }) => ({
    billed_to: label(j.customer_id),
    owed_by: label(j.owed_by_customer_id),
    property: properties.find((p) => p.id === j.property_id)?.address_line1 ?? null,
  });
}

const mins = (m: number) => `${Math.floor(m / 60)}h ${Math.round(m % 60)}m`;
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

/** Looks things up. Only what is listed here ever goes back to Handy: no phones, emails, pay rates or payment details. */
export async function runReadTool(ctx: ToolContext, name: string, args: Record<string, unknown>): Promise<unknown> {
  const now = Date.now();
  if (name === 'team') return ctx.team.map((m) => ({ name: nameOf(m), role: m.role }));
  if (name === 'open_alerts') return (await listAlerts(ctx.companyId)).filter((a) => a.status === 'open').map((a) => ({ alert_id: a.id, title: a.title, detail: a.detail, severity: a.severity }));
  if (name === 'find_customer') {
    const q = String(args.query ?? '').trim().toLowerCase();
    if (q.length < 2) throw new Error('What should I search for?');
    const digits = q.replace(/\D/g, '');
    const found = (await listCustomers(ctx.companyId)).filter((c) =>
      [c.name, c.display_name, c.company_name, [c.first_name, c.last_name].filter(Boolean).join(' '), c.email].some((v) => (v ?? '').toLowerCase().includes(q)) || (digits.length >= 7 && (c.phone ?? '').replace(/\D/g, '').includes(digits)),
    );
    // only the name (sent as an ID) and whether they can be texted or emailed; never the phone number or address themselves
    return found.slice(0, 8).map((c) => ({ customer: customerLabel(c), can_text: !!c.phone, can_email: !!c.email }));
  }
  const facts = await loadTimeFacts(ctx.companyId);
  if (name === 'week_hours') {
    const p = findPerson(ctx.team, args.person);
    const r = weekReport(facts, p.id, new Date(now), now);
    return { person: nameOf(p), clocked: mins(r.clocked), scheduled_ahead: mins(r.scheduled_remaining), efficiency_rate: r.efficiency.rate, efficiency_note: r.efficiency.defaulted ? 'not enough finished jobs yet, 1.00 assumed' : `from ${r.efficiency.jobs} finished jobs`, projected_week: mins(r.projected), over_40_hours: r.over };
  }
  if (name === 'upcoming_jobs') {
    const who = args.person ? [findPerson(ctx.team, args.person)] : ctx.team;
    const parties = await jobParties(ctx.companyId);
    return who.flatMap((p) => upcomingJobsFor(facts, p.id).map((j) => ({ job_id: j.id, job_number: j.job_number, title: j.title, ...parties(j), person: nameOf(p), starts: when(j.scheduled_start), ends: when(j.scheduled_end), efficiency_rate: efficiencyFor(facts, p.id, now).rate })));
  }
  if (name === 'unassigned_jobs') {
    const parties = await jobParties(ctx.companyId);
    return facts.jobs.filter((j) => j.status === 'scheduled' && j.scheduled_start && j.scheduled_end && Date.parse(j.scheduled_end) > now && !facts.assignments.some((a) => a.job_id === j.id)).map((j) => ({ job_id: j.id, job_number: j.job_number, title: j.title, ...parties(j), starts: when(j.scheduled_start!), ends: when(j.scheduled_end!) }));
  }
  throw new Error(`I don't have a tool called ${name}.`);
}

/** What the confirmation card shows: a sentence, and for a message the words themselves so the person can change them. */
export interface Described {
  text: string;
  edit?: { key: string; label: string; value: string };
}

type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

/** The customer Handy means: by the ID he used, else by an exact name. */
async function customerFor(ctx: ToolContext, args: Record<string, unknown>, refs: Refs): Promise<Customer> {
  const ref = refs('customer');
  if (ref?.kind === 'customer') {
    const c = await getCustomer(ctx.companyId, ref.id);
    if (c) return c;
  }
  const said = String(args.customer ?? '').trim().toLowerCase();
  const all = (await listCustomers(ctx.companyId)).filter((c) => customerLabel(c).toLowerCase() === said || c.name.toLowerCase() === said);
  if (all.length === 1) return all[0];
  throw new Error(all.length > 1 ? 'More than one customer has that name. Use the customer ID.' : 'I could not tell which customer that is.');
}

const firstNameOf = (c: Customer) => c.first_name?.trim() || customerLabel(c).split(/\s+/)[0];
const fill = (body: string, c: Customer) => body.replaceAll('{first_name}', firstNameOf(c));
const where = (c: Customer, channel: string) => (channel === 'email' ? c.email : c.phone);

/** A plain sentence for the confirmation card. */
export async function describeAction(ctx: ToolContext, name: string, args: Record<string, unknown>, refs: Refs): Promise<Described> {
  if (name === 'assign_job') {
    const facts = await loadTimeFacts(ctx.companyId);
    const job = facts.jobs.find((j) => j.id === args.job_id);
    const to = nameOf(findPerson(ctx.team, args.person));
    const from = args.replace_person ? nameOf(findPerson(ctx.team, args.replace_person)) : null;
    return { text: from ? `Move "${job?.title ?? 'this job'}" from ${from} to ${to}.` : `Put ${to} on "${job?.title ?? 'this job'}".` };
  }
  if (name === 'close_alert') return { text: `Mark this to-do item handled${args.note ? `: ${String(args.note)}` : ''}.` };
  if (name === 'send_message') {
    const c = await customerFor(ctx, args, refs);
    const channel = args.channel === 'email' ? 'email' : 'sms';
    const to = where(c, channel);
    if (!to) throw new Error(`There is no ${channel === 'email' ? 'email address' : 'phone number'} on file for ${customerLabel(c)}.`);
    return { text: `Save this ${channel === 'email' ? 'email' : 'text'} to ${customerLabel(c)} (${to}). It will wait to go out until sending is connected.`, edit: { key: 'body', label: 'Message', value: fill(String(args.body ?? ''), c) } };
  }
  return { text: name };
}

/** Does what Handy asked, through the same actions a person uses (so the permission rules and the audit trail apply). */
export async function runActionTool(
  ctx: ToolContext,
  run: (action: string, input: unknown) => Promise<{ status: string; message?: string }>,
  name: string,
  args: Record<string, unknown>,
  extra: { refs: Refs; asPerson: (action: string, input: unknown) => Promise<{ status: string; message?: string }> },
): Promise<string> {
  if (name === 'assign_job') {
    const facts = await loadTimeFacts(ctx.companyId);
    const jobId = String(args.job_id ?? '');
    const job = facts.jobs.find((j) => j.id === jobId);
    if (!job) throw new Error('I could not find that job.');
    const to = findPerson(ctx.team, args.person);
    const from = args.replace_person ? findPerson(ctx.team, args.replace_person) : null;
    const current = facts.assignments.filter((a) => a.job_id === jobId).map((a) => a.user_id);
    const result = await run(assignJobAction.name, { job_id: jobId, user_ids: [...new Set([...current.filter((u) => u !== from?.id), to.id])] });
    return outcome(result, from ? `Moved "${job.title}" from ${nameOf(from)} to ${nameOf(to)}.` : `Put ${nameOf(to)} on "${job.title}".`);
  }
  if (name === 'close_alert') {
    const result = await run(closeAlertAction.name, { alert_id: String(args.alert_id ?? ''), status: 'resolved', resolution: args.note ? String(args.note) : 'Handled with Handy' });
    return outcome(result, 'Marked the to-do item handled.');
  }
  if (name === 'send_message') {
    // customer-facing words are saved by the person who approved them, not by Handy
    const c = await customerFor(ctx, args, extra.refs);
    const channel = args.channel === 'email' ? 'email' : 'sms';
    if (!where(c, channel)) throw new Error(`There is no ${channel === 'email' ? 'email address' : 'phone number'} on file for ${customerLabel(c)}.`);
    const result = await extra.asPerson(sendMessageAction.name, { customer_id: c.id, channel, body: fill(String(args.body ?? ''), c) });
    return outcome(result, `Saved the ${channel === 'email' ? 'email' : 'text'} to ${customerLabel(c)}'s messages. It is waiting to go out: sending is not connected yet, so it has NOT been delivered.`);
  }
  throw new Error(`I can't do ${name}.`);
}

function outcome(r: { status: string; message?: string }, done: string): string {
  if (r.status === 'ok') return done;
  if (r.status === 'pending_approval') return 'That needs an owner or admin to approve it first. It is waiting in the approvals list. Nothing has changed yet.';
  throw new Error(r.message ?? (r.status === 'denied' ? 'That is not allowed for you.' : 'It did not work.'));
}
