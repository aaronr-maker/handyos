import { createContext, useCallback, useContext } from 'react';
import type { z } from 'zod';
import type { ActionDefinition, ActionResult } from './actions';
import type { Runtime } from './runtime';
import { useSession } from './tenancy';

export const RuntimeContext = createContext<Runtime | null>(null);

export function useRuntime(): Runtime {
  const rt = useContext(RuntimeContext);
  if (!rt) throw new Error('RuntimeProvider is missing');
  return rt;
}

/** Returns a function that runs an action as the signed-in person, in their company. */
export function useAction<S extends z.ZodType, O>(action: ActionDefinition<S, O>) {
  const { actions } = useRuntime();
  const { companyId, user, role } = useSession();
  return useCallback(
    (input: z.input<S>) => actions.execute(action, input, { companyId, actor: user, role }),
    [actions, action, companyId, user, role],
  );
}

/** Turns a non-ok action result into a message a person can read; null when it succeeded. */
export function resultError(result: ActionResult): string | null {
  switch (result.status) {
    case 'ok':
      return null;
    case 'invalid':
      return result.issues.join('; ');
    case 'pending_approval':
      return 'This needs an owner or admin to approve it first.';
    case 'denied':
      return result.reason;
    case 'error':
      return result.message;
  }
}
