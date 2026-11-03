import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Server-only helpers. One secret (INTEGRATIONS_SECRET, set in Vercel) is used for two separate keys:
 * one signs the "state" passed through the QuickBooks sign-in, the other encrypts tokens stored in the database.
 */
const key = (secret: string, purpose: string) => createHash('sha256').update(`${purpose}:${secret}`).digest();

const b64url = (b: Buffer) => b.toString('base64url');

export interface StatePayload {
  /** company id */
  c: string;
  /** user id */
  u: string;
  /** expiry, ms since epoch */
  exp: number;
  /** random, so each link is unique */
  n: string;
}

export function signState(secret: string, data: Omit<StatePayload, 'n'>): string {
  const body = b64url(Buffer.from(JSON.stringify({ ...data, n: randomBytes(8).toString('hex') })));
  const sig = b64url(createHmac('sha256', key(secret, 'state')).update(body).digest());
  return `${body}.${sig}`;
}

/** Returns the payload only if the signature is genuine and it has not expired. */
export function verifyState(secret: string, state: string, now = Date.now()): StatePayload | null {
  const [body, sig] = state.split('.');
  if (!body || !sig) return null;
  const expected = createHmac('sha256', key(secret, 'state')).update(body).digest();
  const given = Buffer.from(sig, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  try {
    const data = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as StatePayload;
    return typeof data.exp === 'number' && data.exp > now && data.c && data.u ? data : null;
  } catch {
    return null;
  }
}

/** AES-256-GCM. Output is "iv.tag.ciphertext" (base64url), so tampering is detected when decrypting. */
export function encrypt(secret: string, plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(secret, 'tokens'), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return `${b64url(iv)}.${b64url(cipher.getAuthTag())}.${b64url(data)}`;
}

export function decrypt(secret: string, packed: string): string {
  const [iv, tag, data] = packed.split('.');
  if (!iv || !tag || !data) throw new Error('Bad encrypted value');
  const decipher = createDecipheriv('aes-256-gcm', key(secret, 'tokens'), Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
}
