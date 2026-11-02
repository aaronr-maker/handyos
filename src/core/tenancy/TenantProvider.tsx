import type { ReactNode } from 'react';
import { DEMO_SESSION, SessionContext, type Session } from './session';

export function SessionProvider({ session = DEMO_SESSION, children }: { session?: Session; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}
