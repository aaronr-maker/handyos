import { getSupabase } from '../supabase';
import type { UserRole } from '../types';

function db() {
  const client = getSupabase();
  if (!client) throw new Error('The database is not connected yet.');
  return client;
}

export interface Profile {
  userId: string;
  email: string;
  fullName: string;
  role: UserRole;
  companyId: string;
  companyName: string;
}

export interface Member {
  id: string;
  full_name: string;
  email: string;
  role: UserRole;
  /** signed off to do in-home estimates */ is_seller?: boolean;
  /** languages spoken, like "Spanish" */ languages?: string[];
  /** where their day starts, for drive times */ home_address?: string | null;
}
export interface Invite {
  id: string;
  email: string;
  role: UserRole;
  created_at: string;
}
export interface JoinRequest {
  id: string;
  email: string;
  full_name: string;
  created_at: string;
}
export interface MyInvite {
  invite_id: string;
  company_name: string;
  role: UserRole;
}

function unwrap<T>(res: { data: T; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data;
}

export async function signIn(email: string, password: string): Promise<void> {
  const { error } = await db().auth.signInWithPassword({ email, password });
  if (error) throw new Error(error.message);
}

/** Returns true when the person must click a confirmation link in their email before signing in. */
export async function signUp(email: string, password: string): Promise<boolean> {
  const { data, error } = await db().auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } });
  if (error) throw new Error(error.message);
  return !data.session;
}

export async function signOut(): Promise<void> {
  await db().auth.signOut();
}

export async function fetchProfile(userId: string): Promise<Profile | null> {
  const row = unwrap(await db().from('users').select('id, email, full_name, role, company_id, companies(name)').eq('id', userId).maybeSingle()) as {
    id: string;
    email: string;
    full_name: string;
    role: UserRole;
    company_id: string;
    companies: { name: string } | null;
  } | null;
  if (!row) return null;
  return {
    userId: row.id,
    email: row.email,
    fullName: row.full_name,
    role: row.role,
    companyId: row.company_id,
    companyName: row.companies?.name ?? '',
  };
}

// --- Onboarding (people without a company yet) ---
export const createCompany = async (companyName: string, ownerName: string) => unwrap(await db().rpc('create_company_for_user', { company_name: companyName, owner_name: ownerName }));
export const myPendingInvites = async () => unwrap(await db().rpc('my_pending_invites')) as MyInvite[];
export const acceptInvite = async (inviteId: string, name: string) => unwrap(await db().rpc('accept_invite', { invite_id: inviteId, member_name: name }));
export const declineInvite = async (inviteId: string) => unwrap(await db().rpc('decline_invite', { invite_id: inviteId }));
export const requestToJoin = async (code: string, name: string) => unwrap(await db().rpc('request_to_join', { join_code: code, member_name: name })) as string;

// --- Team management (owner/admin; the database enforces who may do what) ---
export const listMembers = async () => {
  // newer columns first; before their SQL has been run, fall back to the basics so nothing breaks
  for (const columns of ['id, full_name, email, role, is_seller, languages, home_address', 'id, full_name, email, role, is_seller, languages']) {
    const res = await db().from('users').select(columns).order('created_at');
    if (!res.error) return res.data as unknown as Member[];
  }
  return unwrap(await db().from('users').select('id, full_name, email, role').order('created_at')) as Member[];
};
export const listInvites = async () => unwrap(await db().from('company_invites').select('id, email, role, created_at').eq('status', 'pending').order('created_at')) as Invite[];
export const listJoinRequests = async () => unwrap(await db().from('join_requests').select('id, email, full_name, created_at').eq('status', 'pending').order('created_at')) as JoinRequest[];
export const getJoinCode = async () => (unwrap(await db().from('company_join_codes').select('code').maybeSingle()) as { code: string } | null)?.code ?? null;

export const inviteMember = async (email: string, role: UserRole) => unwrap(await db().rpc('invite_member', { invite_email: email, invite_role: role }));
export const revokeInvite = async (inviteId: string) => unwrap(await db().rpc('revoke_invite', { invite_id: inviteId }));
export const decideJoinRequest = async (requestId: string, approve: boolean, role: UserRole) => unwrap(await db().rpc('decide_join_request', { request_id: requestId, approve, as_role: role }));
export const setMemberRole = async (memberId: string, role: UserRole) => unwrap(await db().rpc('set_member_role', { member_id: memberId, new_role: role }));
export const setMemberProfile = async (memberId: string, isSeller: boolean, languages: string[]) =>
  unwrap(await db().rpc('set_member_profile', { member_id: memberId, seller: isSeller, speaks: languages }));
export const setMemberHome = async (memberId: string, address: string) => unwrap(await db().rpc('set_member_home', { member_id: memberId, address }));
export const removeMember = async (memberId: string) => unwrap(await db().rpc('remove_member', { member_id: memberId }));
export const rotateJoinCode = async () => unwrap(await db().rpc('rotate_join_code')) as string;

/** The company's people for assigning work. In demo mode (no database) there is just one demo person. */
export async function listTeamMembers(): Promise<Member[]> {
  if (!getSupabase()) return [{ id: 'demo-owner', full_name: 'You (demo)', email: '', role: 'owner' }];
  return listMembers();
}
