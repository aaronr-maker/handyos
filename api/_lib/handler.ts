import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiError, type Deps } from './qb';
import { serverEnv, supabaseStore } from './store';

export const realDeps = (): Deps => {
  const env = serverEnv();
  return { env, store: supabaseStore(env), fetch, now: () => Date.now() };
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
