import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { getSupabase } from '../supabase';
import { fetchProfile, type Profile } from './api';
import { AuthContext, type AuthState, type AuthStatus } from './context';

/** Tracks the Supabase login and the person's company membership. Only mount when Supabase is configured. */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [email, setEmail] = useState('');
  const [userId, setUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(async (id: string | null) => {
    if (!id) {
      setProfile(null);
      setStatus('signed_out');
      return;
    }
    try {
      const p = await fetchProfile(id);
      setProfile(p);
      setStatus(p ? 'ready' : 'no_company');
    } catch {
      setProfile(null);
      setStatus('no_company');
    }
  }, []);

  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
    const apply = (user: { id: string; email?: string } | null) => {
      setUserId(user?.id ?? null);
      setEmail(user?.email ?? '');
      void load(user?.id ?? null);
    };
    void client.auth.getSession().then(({ data }) => apply(data.session?.user ?? null));
    const { data } = client.auth.onAuthStateChange((_event, session) => apply(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, [load]);

  const value = useMemo<AuthState>(
    () => ({ status, email, profile, refresh: () => load(userId) }),
    [status, email, profile, load, userId],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
