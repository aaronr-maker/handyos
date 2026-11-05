import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, type Deps } from './qb.js';
import { serverEnv, supabaseStore } from './store.js';

/** Says what is wrong with a database setting without showing its value. */
export function databaseSettingProblem(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): string | null {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) return 'The server cannot find the Supabase address: set SUPABASE_URL (or VITE_SUPABASE_URL) in Vercel for Production.';
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(url.trim()) || url !== url.trim()) return 'The Supabase address in Vercel (SUPABASE_URL or VITE_SUPABASE_URL) looks wrong. It should be exactly like https://yourproject.supabase.co with no spaces, quotes, or extra path.';
  if (!key) return 'The server cannot find SUPABASE_SERVICE_ROLE_KEY: add the Supabase secret key in Vercel for Production.';
  if (key !== key.trim() || /\s/.test(key) || /^["']|["']$/.test(key)) return 'SUPABASE_SERVICE_ROLE_KEY in Vercel has a space, line break or quote in it. Paste the secret key again as one line, with nothing around it.';
  if (key.length < 20) return 'SUPABASE_SERVICE_ROLE_KEY in Vercel is too short to be the secret key. Copy the whole key from Supabase (Project Settings, API Keys).';
  return null;
}

export const realDeps = (): Deps => {
  const env = serverEnv();
  const problem = databaseSettingProblem(env);
  if (problem) throw new ApiError(503, problem);
  try {
    return { env, store: supabaseStore(env), fetch, now: () => Date.now() };
  } catch (err) {
    throw new ApiError(503, `The server could not start its database connection: ${err instanceof Error ? err.message.replace(/eyJ[\w.-]+|sb_[\w-]+/g, '[hidden]').slice(0, 200) : 'unknown problem'}`);
  }
};

export const bearer = (req: VercelRequest): string | null => {
  const h = req.headers.authorization;
  return h?.startsWith('Bearer ') ? h.slice(7) : null;
};

/** Runs a handler and turns an ApiError into a clean JSON answer. Details of unexpected errors stay in the server log. */
export async function respond(res: VercelResponse, run: () => Promise<unknown>) {
  try {
    res.status(200).json(await run());
  } catch (err) {
    if (err instanceof ApiError) return res.status(err.status).json({ error: err.message });
    console.error('QuickBooks API error', err instanceof Error ? err.message : err);
    res.status(500).json({ error: 'Something went wrong on the server.' });
  }
}
