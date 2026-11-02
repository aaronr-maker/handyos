import type { ReactNode } from 'react';
import { DEMO_SESSION, SessionProvider, isSupabaseConfigured, useAuth, type Session } from '@/core';
import { LoginScreen } from './LoginScreen';
import { OnboardingScreen } from './OnboardingScreen';

/** Shows login / onboarding until the person belongs to a company; then renders the app with their session. */
export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (!isSupabaseConfigured) return <SessionProvider session={DEMO_SESSION}>{children}</SessionProvider>;
  if (auth.status === 'loading') return <p className="muted pad">Loading…</p>;
  if (auth.status === 'signed_out') return <LoginScreen />;
  if (auth.status === 'no_company' || !auth.profile) return <OnboardingScreen />;
  const p = auth.profile;
  const session: Session = {
    companyId: p.companyId,
    companyName: p.companyName,
    user: { kind: 'user', id: p.userId },
    role: p.role,
  };
  return <SessionProvider session={session}>{children}</SessionProvider>;
}
