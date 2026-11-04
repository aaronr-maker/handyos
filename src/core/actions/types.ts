import type { z } from 'zod';
import type { EventBus } from '../events';
import type { Id, ModuleId, UserRole } from '../types';

export type ActorKind = 'user' | 'agent' | 'system';

export interface Actor {
  kind: ActorKind;
  id: string;
}

export type Risk = 'low' | 'medium' | 'high';

/** What every action handler receives. Tenant scoping comes from here, never from input. */
export interface ActionContext {
  companyId: Id;
  actor: Actor;
  /** The signed-in person's role in the company (only set when the actor is a person). */
  role?: UserRole;
  events: EventBus;
}

/** How far Handy (the AI assistant) may go with an action: do it, do it once a human approves, or never. */
export type HandyLevel = 'auto' | 'ask' | 'never';

export interface ActionDefinition<S extends z.ZodType = z.ZodType, O = unknown> {
  /** Unique, `module.verb_noun`, e.g. `estimates.create`. */
  name: string;
  module: ModuleId;
  description: string;
  /** zod schema: the single source of truth for both UI forms and AI tool calls. */
  input: S;
  risk: Risk;
  /**
   * Roles allowed to run this action. When set, a person whose role is not listed is refused (AI agents are not
   * limited by role but go through `requiresApproval`). Leave unset for actions everyone may run.
   */
  roles?: readonly UserRole[];
  /**
   * Risky actions must be approved by a human before the handler runs.
   * Can be a function to decide per call (e.g. only when an AI agent is the actor).
   */
  requiresApproval: boolean | ((input: z.output<S>, ctx: ActionContext) => boolean);
  /**
   * What Handy may do with this action. Leave unset for 'ask': every Handy request waits for a human to approve it.
   * Use 'auto' only for low-risk changes inside the company (never anything sent to a customer, or about money or pay),
   * and 'never' for things Handy must not do at all.
   */
  handy?: HandyLevel;
  /** Sample input, used by the System screen and by agent tool descriptions. */
  example?: z.input<S>;
  handler(input: z.output<S>, ctx: ActionContext): Promise<O>;
}

export type AnyAction = ActionDefinition<z.ZodType, unknown>;

export type ActionResult<O = unknown> =
  | { status: 'ok'; output: O; auditId: string }
  | { status: 'pending_approval'; approvalId: string; auditId: string }
  | { status: 'invalid'; issues: string[]; auditId: string }
  | { status: 'denied'; reason: string; auditId: string }
  | { status: 'error'; message: string; auditId: string };

export interface AuditEntry {
  id: string;
  company_id: Id;
  actor_kind: ActorKind;
  actor_id: string;
  action: string;
  outcome: ActionResult['status'] | 'approved' | 'rejected';
  input: unknown;
  output?: unknown;
  error?: string;
  approval_id?: string;
  created_at: string;
}

export interface AuditSink {
  write(entry: AuditEntry): void | Promise<void>;
}

export interface ApprovalRequest {
  id: string;
  company_id: Id;
  action: string;
  input: unknown;
  requested_by: Actor;
  /** The person Handy was acting for (their role limits what Handy may ask for). */
  on_behalf_of?: { userId: Id; role: UserRole };
  status: 'pending' | 'approved' | 'rejected';
  decided_by?: Actor;
  created_at: string;
}
