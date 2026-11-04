import { z } from 'zod';
import type { EventBus } from '../events';
import type { Id, UserRole } from '../types';
import type {
  ActionContext,
  ActionDefinition,
  ActionResult,
  Actor,
  AnyAction,
  ApprovalRequest,
  AuditEntry,
  AuditSink,
} from './types';

/** Identity helper that keeps the input/output types of an action inferred. */
export function defineAction<S extends z.ZodType, O>(def: ActionDefinition<S, O>): ActionDefinition<S, O> {
  return def;
}

export interface CallerContext {
  companyId: Id;
  actor: Actor;
  /** The person's role in the company, when the actor is a person. */
  role?: UserRole;
  /**
   * Set when an AI agent (Handy) acts for a person: the agent can do no more than that person's role allows, and the
   * audit trail names both.
   */
  onBehalfOf?: { userId: Id; role: UserRole };
}

/** The id written to the audit trail: for Handy it also names the person he acted for. */
const auditActorId = (c: CallerContext) => (c.onBehalfOf ? `${c.actor.id}/for:${c.onBehalfOf.userId}` : c.actor.id);

export interface ActionRegistry {
  register(action: ActionDefinition<z.ZodType, unknown>): void;
  list(): readonly AnyAction[];
  get(name: string): AnyAction | undefined;
  /** Typed call: UI code uses this. */
  execute<S extends z.ZodType, O>(
    action: ActionDefinition<S, O>,
    rawInput: z.input<S>,
    caller: CallerContext,
  ): Promise<ActionResult<O>>;
  /** Untyped call by name: AI agents / automations use this. Same validation, audit and approvals. */
  executeByName(name: string, rawInput: unknown, caller: CallerContext): Promise<ActionResult>;
  pendingApprovals(companyId: Id): ApprovalRequest[];
  /**
   * Only a human `user` may decide, and (when their role is given) only an owner or admin. Approving runs the
   * stored action as originally requested.
   */
  decide(approvalId: string, approve: boolean, approver: Actor, approverRole?: UserRole): Promise<ActionResult>;
  /** Subscribe to approval-queue changes (UI badge). */
  onApprovalsChanged(listener: () => void): () => void;
}

export function createActionRegistry(deps: { events: EventBus; audit: AuditSink }): ActionRegistry {
  const actions = new Map<string, AnyAction>();
  const approvals = new Map<string, ApprovalRequest>();
  const approvalListeners = new Set<() => void>();
  const notifyApprovals = () => approvalListeners.forEach((l) => l());

  async function audit(entry: Omit<AuditEntry, 'id' | 'created_at'>): Promise<string> {
    const full: AuditEntry = { ...entry, id: crypto.randomUUID(), created_at: new Date().toISOString() };
    await deps.audit.write(full);
    return full.id;
  }

  async function run(
    action: AnyAction,
    input: unknown,
    caller: CallerContext,
    approvalId?: string,
  ): Promise<ActionResult> {
    const base = {
      company_id: caller.companyId,
      actor_kind: caller.actor.kind,
      actor_id: auditActorId(caller),
      action: action.name,
      input,
      approval_id: approvalId,
    };
    const ctx: ActionContext = { companyId: caller.companyId, actor: caller.actor, role: caller.onBehalfOf?.role ?? caller.role, events: deps.events };
    try {
      const output = await action.handler(input, ctx);
      const auditId = await audit({ ...base, outcome: 'ok', output });
      return { status: 'ok', output, auditId };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const auditId = await audit({ ...base, outcome: 'error', error: message });
      return { status: 'error', message, auditId };
    }
  }

  async function executeByName(name: string, rawInput: unknown, caller: CallerContext): Promise<ActionResult> {
    const base = {
      company_id: caller.companyId,
      actor_kind: caller.actor.kind,
      actor_id: auditActorId(caller),
      action: name,
      input: rawInput,
    };
    const action = actions.get(name);
    if (!action) {
      const auditId = await audit({ ...base, outcome: 'denied', error: 'Unknown action' });
      return { status: 'denied', reason: `Unknown action "${name}"`, auditId };
    }
    // a person is held to their own role; Handy is held to the role of the person he is acting for
    const roleToCheck = caller.actor.kind === 'user' ? caller.role : caller.actor.kind === 'agent' ? caller.onBehalfOf?.role : undefined;
    if (action.roles && roleToCheck && !action.roles.includes(roleToCheck)) {
      const reason = caller.actor.kind === 'agent' ? `The person Handy is working for (${roleToCheck}) isn't allowed to do that` : `Your role (${roleToCheck}) isn't allowed to do that`;
      const auditId = await audit({ ...base, outcome: 'denied', error: reason });
      return { status: 'denied', reason, auditId };
    }
    const parsed = action.input.safeParse(rawInput);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(input)'}: ${i.message}`);
      const auditId = await audit({ ...base, outcome: 'invalid', error: issues.join('; ') });
      return { status: 'invalid', issues, auditId };
    }
    const ctx: ActionContext = { companyId: caller.companyId, actor: caller.actor, role: caller.onBehalfOf?.role ?? caller.role, events: deps.events };
    if (caller.actor.kind === 'agent' && action.handy === 'never') {
      const reason = 'Handy is not allowed to do that';
      const auditId = await audit({ ...base, outcome: 'denied', error: reason });
      return { status: 'denied', reason, auditId };
    }
    // Handy asks first unless the action says he may just do it
    const handyAsks = caller.actor.kind === 'agent' && (action.handy ?? 'ask') === 'ask';
    const needsApproval =
      handyAsks ||
      (typeof action.requiresApproval === 'function' ? action.requiresApproval(parsed.data, ctx) : action.requiresApproval);
    if (needsApproval) {
      const request: ApprovalRequest = {
        id: crypto.randomUUID(),
        company_id: caller.companyId,
        action: name,
        input: parsed.data,
        requested_by: caller.actor,
        on_behalf_of: caller.onBehalfOf,
        status: 'pending',
        created_at: new Date().toISOString(),
      };
      approvals.set(request.id, request);
      const auditId = await audit({ ...base, input: parsed.data, outcome: 'pending_approval', approval_id: request.id });
      notifyApprovals();
      return { status: 'pending_approval', approvalId: request.id, auditId };
    }
    return run(action, parsed.data, caller);
  }

  return {
    register(action) {
      if (actions.has(action.name)) throw new Error(`Action "${action.name}" is already registered`);
      actions.set(action.name, action);
    },
    list: () => [...actions.values()],
    get: (name) => actions.get(name),
    execute: <S extends z.ZodType, O>(action: ActionDefinition<S, O>, rawInput: z.input<S>, caller: CallerContext) =>
      executeByName(action.name, rawInput, caller) as Promise<ActionResult<O>>,
    executeByName,
    pendingApprovals: (companyId) =>
      [...approvals.values()].filter((a) => a.company_id === companyId && a.status === 'pending'),
    async decide(approvalId, approve, approver, approverRole) {
      const request = approvals.get(approvalId);
      const base = {
        company_id: request?.company_id ?? '',
        actor_kind: approver.kind,
        actor_id: approver.id,
        action: request?.action ?? 'unknown',
        input: request?.input,
        approval_id: approvalId,
      };
      if (!request || request.status !== 'pending') {
        const auditId = await audit({ ...base, outcome: 'denied', error: 'Approval not found or already decided' });
        return { status: 'denied', reason: 'Approval not found or already decided', auditId };
      }
      if (approver.kind !== 'user') {
        const auditId = await audit({ ...base, outcome: 'denied', error: 'Only a human user can decide approvals' });
        return { status: 'denied', reason: 'Only a human user can decide approvals', auditId };
      }
      if (approverRole && approverRole !== 'owner' && approverRole !== 'admin') {
        const auditId = await audit({ ...base, outcome: 'denied', error: 'Only an owner or admin can decide approvals' });
        return { status: 'denied', reason: 'Only an owner or admin can decide approvals', auditId };
      }
      request.status = approve ? 'approved' : 'rejected';
      request.decided_by = approver;
      notifyApprovals();
      if (!approve) {
        const auditId = await audit({ ...base, outcome: 'rejected' });
        return { status: 'denied', reason: 'Rejected by approver', auditId };
      }
      await audit({ ...base, outcome: 'approved' });
      const action = actions.get(request.action)!;
      // Runs as the original requester so the audit trail shows who asked and who approved.
      return run(action, request.input, { companyId: request.company_id, actor: request.requested_by, onBehalfOf: request.on_behalf_of }, approvalId);
    },
    onApprovalsChanged(listener) {
      approvalListeners.add(listener);
      return () => approvalListeners.delete(listener);
    },
  };
}
