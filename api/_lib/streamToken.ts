import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * The transcription server only accepts a call's audio when it carries this token, which only HandyOS can make (it shares a secret
 * with the server). The same few lines live in voice-server/src/logic.ts, because that server is deployed on its own.
 */
export const streamToken = (secret: string, callSid: string, companyId: string): string => createHmac('sha256', secret).update(`${callSid}:${companyId}`).digest('hex');

export function validStreamToken(secret: string, callSid: string, companyId: string, token: string): boolean {
  const a = Buffer.from(streamToken(secret, callSid, companyId));
  const b = Buffer.from(token);
  return a.length === b.length && timingSafeEqual(a, b);
}
