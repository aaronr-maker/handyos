import { useCallback, useEffect, useState, type FormEvent } from 'react';
import {
  decideJoinRequest,
  getJoinCode,
  inviteMember,
  listInvites,
  listJoinRequests,
  listMembers,
  removeMember,
  revokeInvite,
  rotateJoinCode,
  setMemberHome,
  setMemberProfile,
  setMemberRole,
  AddressInput,
  isSupabaseConfigured,
  useSession,
  type Invite,
  type JoinRequest,
  type Member,
  type UserRole,
} from '@/core';

/** A person's home base address, with suggestions as you type; saved when you pick one or leave the box. */
function HomeBase({ member, onSave }: { member: Member; onSave: (v: string) => void }) {
  const [value, setValue] = useState(member.home_address ?? '');
  return <AddressInput value={value} onChange={setValue} onCommit={(v) => v.trim() !== (member.home_address ?? '') && onSave(v)} placeholder="123 Main St, West Plains, MO 65775" />;
}

const labels: Record<UserRole, string> = { owner: 'Owner', admin: 'Admin', office: 'Office', tech: 'Tech' };

/** Roles the current person may hand out: owner can grant admin/office/tech, admin only office/tech. */
const grantable = (me: UserRole): UserRole[] => (me === 'owner' ? ['admin', 'office', 'tech'] : me === 'admin' ? ['office', 'tech'] : []);

export function TeamScreen() {
  const { role, user } = useSession();
  const canManage = isSupabaseConfigured && (role === 'owner' || role === 'admin');
  const options = grantable(role);
  const [members, setMembers] = useState<Member[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [requests, setRequests] = useState<JoinRequest[]>([]);
  const [code, setCode] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('tech');
  const [approveRole, setApproveRole] = useState<UserRole>('tech');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      setMembers(await listMembers());
      if (canManage) {
        const [i, r, c] = await Promise.all([listInvites(), listJoinRequests(), getJoinCode()]);
        setInvites(i);
        setRequests(r);
        setCode(c);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load the team');
    }
  }, [canManage]);
  // Loads data from the server when the screen opens.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => void load(), [load]);

  const act = async (fn: () => Promise<unknown>) => {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not work');
    }
  };

  const invite = (e: FormEvent) => {
    e.preventDefault();
    void act(async () => {
      await inviteMember(email, inviteRole);
      setEmail('');
    });
  };

  const canEdit = (m: Member) => canManage && m.id !== user.id && m.role !== 'owner' && options.includes(m.role);

  return (
    <section className="page">
      <header className="page-header">
        <div>
          <h1>Team</h1>
          <p className="muted">Everyone with access to your company account.</p>
        </div>
      </header>
      {error && <p className="err">{error}</p>}
      {!isSupabaseConfigured && <p className="notice">Team management turns on once the database is connected.</p>}

      <div className="card">
        <h2>Members</h2>
        {members.map((m) => (
          <div key={m.id} className="approval">
            <div>
              <strong>{m.full_name || m.email}</strong>
              <div className="muted">{m.email}</div>
              {canManage && (
                <div className="member-skills">
                  <label className="check">
                    <input type="checkbox" checked={!!m.is_seller} onChange={(e) => void act(() => setMemberProfile(m.id, e.target.checked, m.languages ?? []))} />
                    Does in-home estimates (seller)
                  </label>
                  <label>
                    Home base address (where their day starts, for drive times)
                    <HomeBase member={m} onSave={(v) => void act(() => setMemberHome(m.id, v))} />
                  </label>
                  <label>
                    Languages spoken, besides English (like Spanish)
                    <input
                      defaultValue={(m.languages ?? []).join(', ')}
                      key={`${m.id}-${(m.languages ?? []).join(',')}`}
                      placeholder="None"
                      onBlur={(e) => {
                        const next = e.target.value
                          .split(/[,]+/)
                          .map((x) => x.trim())
                          .filter(Boolean);
                        if (next.join(',') !== (m.languages ?? []).join(',')) void act(() => setMemberProfile(m.id, !!m.is_seller, next));
                      }}
                    />
                  </label>
                </div>
              )}
            </div>
            {canEdit(m) ? (
              <div className="row">
                <select value={m.role} onChange={(e) => void act(() => setMemberRole(m.id, e.target.value as UserRole))}>
                  {options.map((r) => (
                    <option key={r} value={r}>
                      {labels[r]}
                    </option>
                  ))}
                </select>
                <button className="secondary" onClick={() => confirm(`Remove ${m.full_name || m.email}?`) && void act(() => removeMember(m.id))}>
                  Remove
                </button>
              </div>
            ) : (
              <span className="pill">{labels[m.role]}</span>
            )}
          </div>
        ))}
      </div>

      {canManage ? (
        <>
          {requests.length > 0 && (
            <div className="card">
              <h2>Waiting to join ({requests.length})</h2>
              <label>
                Approve as
                <select value={approveRole} onChange={(e) => setApproveRole(e.target.value as UserRole)}>
                  {options.map((r) => (
                    <option key={r} value={r}>
                      {labels[r]}
                    </option>
                  ))}
                </select>
              </label>
              {requests.map((r) => (
                <div key={r.id} className="approval">
                  <div>
                    <strong>{r.full_name || r.email}</strong>
                    <div className="muted">{r.email}</div>
                  </div>
                  <div className="row">
                    <button onClick={() => void act(() => decideJoinRequest(r.id, true, approveRole))}>Approve</button>
                    <button className="secondary" onClick={() => void act(() => decideJoinRequest(r.id, false, approveRole))}>
                      Decline
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          <form className="card" onSubmit={invite}>
            <h2>Invite someone</h2>
            <p className="muted">They sign up with this email and accept the invite. Nothing is emailed yet; just tell them.</p>
            <label>
              Email
              <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
            <label>
              Role
              <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as UserRole)}>
                {options.map((r) => (
                  <option key={r} value={r}>
                    {labels[r]}
                  </option>
                ))}
              </select>
            </label>
            <button>Send invite</button>
            {invites.map((i) => (
              <div key={i.id} className="approval">
                <span>
                  {i.email} <span className="pill">{labels[i.role]}</span>
                </span>
                <button type="button" className="secondary" onClick={() => void act(() => revokeInvite(i.id))}>
                  Cancel
                </button>
              </div>
            ))}
          </form>

          <div className="card">
            <h2>Join code</h2>
            <p className="muted">Someone who signs up can use this code to ask to join. You approve each request.</p>
            <p>
              <code className="code">{code ?? '…'}</code>
            </p>
            <button className="secondary" onClick={() => confirm('Old code stops working. Continue?') && void act(rotateJoinCode)}>
              Make a new code
            </button>
          </div>
        </>
      ) : (
        <p className="muted">Only the owner and admins can invite people or change roles.</p>
      )}
    </section>
  );
}
