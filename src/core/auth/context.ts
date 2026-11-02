import { createContext, useContext } from 'react';
import type { Profile } from './api';

export type AuthStatus = 'loading' | 'signed_out' | 'no_company' | 'ready';

export interface AuthState {
  status: AuthStatus;
  /** Email of the signed-in person (also set while they have no company yet). */
  email: string;
  profile: Profile | null;
  /** Re-check membership, e.g. after a join request was approved. */
  refresh(): Promise<void>;
}

export const AuthContext = createContext<AuthState>({
  status: 'loading',
  email: '',
  profile: null,
  refresh: async () => {},
});

export const useAuth = () => useContext(AuthContext);
