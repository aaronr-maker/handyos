import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  acceptInvite,
  createCompany,
  declineInvite,
  myPendingInvites,
  requestToJoin,
  signOut,
  useAuth,
  type MyInvite,
} from '@/core';

const roleLabel: Record<string, string> = { owner: 'Owner', admin: 'Admin', office: 'Office', tech: 'Tech' };

/** For a signed-in person who is not in a company yet: accept an invite, join with a code, or start a company. */
export function OnboardingScreen() {
  const { email, refresh } = useAuth();
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [name, setName] = useState('');
  const [company, setCompany] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [waitingFor, setWaitingFor] = useState('');
  const [busy, setBusy] = useState(false);

  const loadInvites = useCallback(async () => {
    try {
      setInvites(await myPendingInvites());
    } catch {
      setInvites([]);
    }
  }, []);
  // Loads data from the server when the screen opens.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => void loadInvites(), [loadInvites]);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const create = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await createCompany(company, name);
      await refresh();
    });
  };
  const join = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => setWaitingFor(await requestToJoin(code, name)));
  };

  return (
    <main className="auth">
      <div className="auth-stack">
        <div className="card">
          <h1>Welcome</h1>
          <p className="muted">Signed in as {email}. Let's get you into a company.</p>
          <label>
            Your name
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="First and last name" />
          </label>
          {error && <p className="err">{error}</p>}
        </div>

        {invites.length > 0 && (
          <div className="card">
            <h2>You've been invited</h2>
            {invites.map((i) => (
              <div key={i.invite_id} className="approval">
                <span>
                  <strong>{i.company_name}</strong> <span className="muted">as {roleLabel[i.role]}</span>
                </span>
                <div className="row">
                  <button
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await acceptInvite(i.invite_id, name);
                        await refresh();
                      })
                    }
                  >
                    Accept
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => void run(async () => (await declineInvite(i.invite_id), loadInvites()))}
                  >
                    Decline
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        <form className="card" onSubmit={join}>
          <h2>Join your company</h2>
          {waitingFor ? (
            <>
              <p>
                Request sent to <strong>{waitingFor}</strong>. An owner or admin needs to approve it.
              </p>
              <button type="button" onClick={() => void refresh()}>
                Check again
              </button>
            </>
          ) : (
            <>
              <p className="muted">Ask your owner or admin for the company join code.</p>
              <label>
                Join code
                <input value={code} onChange={(e) => setCode(e.target.value)} required />
              </label>
              <button disabled={busy}>Request to join</button>
            </>
          )}
        </form>

        <form className="card" onSubmit={create}>
          <h2>Start a new company</h2>
          <p className="muted">You'll be the owner and control who else can join.</p>
          <label>
            Company name
            <input value={company} onChange={(e) => setCompany(e.target.value)} required />
          </label>
          <button disabled={busy}>Create company</button>
        </form>

        <button className="link" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>
    </main>
  );
}
