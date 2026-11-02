import { createContext, useContext } from 'react';
import type { Actor } from '../actions';
import type { Id, UserRole } from '../types';

export interface Session {
  companyId: Id;
  companyName: string;
  user: Actor;
  role: UserRole;
}

/** Demo tenant used until Supabase auth is wired in (then this comes from the signed-in user's profile). */
export const DEMO_SESSION: Session = {
  companyId: '00000000-0000-4000-8000-000000000001',
  companyName: 'That Handyman Van LLC',
  user: { kind: 'user', id: 'demo-owner' },
  role: 'owner',
};

export const SessionContext = createContext<Session>(DEMO_SESSION);

export function useSession(): Session {
  return useContext(SessionContext);
}
