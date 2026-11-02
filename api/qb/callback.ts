import type { VercelRequest, VercelResponse } from '@vercel/node';
import { realDeps } from '../_lib/handler';
import { finishConnect } from '../_lib/qb';

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** GET: where QuickBooks sends the person back after they approve. Saves the connection, then returns them to the app. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const { redirect } = await finishConnect(realDeps(), {
      code: one(req.query.code),
      state: one(req.query.state),
      realmId: one(req.query.realmId),
      error: one(req.query.error),
    });
    res.redirect(302, redirect);
  } catch (err) {
    console.error('QuickBooks callback error', err instanceof Error ? err.message : err);
    res.status(503).send('QuickBooks is not set up on the server yet.');
  }
}
