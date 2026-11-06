import { getSupabase } from './supabase';

/** Calls one of the app's own server endpoints (/api/...) as the signed-in person. */
export async function apiCall<T>(path: string, body?: unknown): Promise<T> {
  const db = getSupabase();
  if (!db) throw new Error('The database is not connected yet.');
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new Error(json.error ?? 'The server could not do that.');
  return json;
}

/** Fetches sound or a file from one of the app's own endpoints as the signed-in person. */
export async function apiBlob(path: string): Promise<Blob> {
  const db = getSupabase();
  if (!db) throw new Error('The database is not connected yet.');
  const { data } = await db.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('Sign in first.');
  const res = await fetch(path, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(json.error ?? 'The server could not do that.');
  }
  return res.blob();
}
