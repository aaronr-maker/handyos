import { createHmac } from 'node:crypto';

/**
 * The pass the phone app gets so it can receive calls through Twilio: a signed token naming who the app is for (their user id),
 * allowing incoming calls and naming the push credential (Firebase) Twilio uses to wake the phone. It lasts an hour; the app asks again.
 */
export interface TokenSettings {
  accountSid: string;
  apiKeySid: string;
  apiKeySecret: string;
  pushCredentialSid: string;
}

const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');

export function voiceAccessToken(s: TokenSettings, identity: string, nowSeconds: number, lifetimeSeconds = 3600): string {
  const header = { typ: 'JWT', alg: 'HS256', cty: 'twilio-fpa;v=1' };
  const payload = {
    jti: `${s.apiKeySid}-${nowSeconds}`,
    iss: s.apiKeySid,
    sub: s.accountSid,
    nbf: nowSeconds,
    exp: nowSeconds + lifetimeSeconds,
    grants: { identity, voice: { incoming: { allow: true }, push_credential_sid: s.pushCredentialSid } },
  };
  const data = `${b64(header)}.${b64(payload)}`;
  return `${data}.${createHmac('sha256', s.apiKeySecret).update(data).digest('base64url')}`;
}

/** Reads the four Twilio settings, or says which one is missing or looks wrong. */
export function tokenSettings(env: { TWILIO_ACCOUNT_SID?: string; TWILIO_API_KEY_SID?: string; TWILIO_API_KEY_SECRET?: string; TWILIO_PUSH_CREDENTIAL_SID?: string }): { settings: TokenSettings } | { problem: string } {
  const t = (v?: string) => (v ?? '').trim();
  if (!/^AC[0-9a-f]{32}$/i.test(t(env.TWILIO_ACCOUNT_SID))) return { problem: 'TWILIO_ACCOUNT_SID is missing or wrong in Vercel.' };
  if (!/^SK[0-9a-f]{32}$/i.test(t(env.TWILIO_API_KEY_SID))) return { problem: 'TWILIO_API_KEY_SID is missing in Vercel. It starts with SK (create an API key in Twilio).' };
  if (t(env.TWILIO_API_KEY_SECRET).length < 20) return { problem: 'TWILIO_API_KEY_SECRET is missing in Vercel (shown only once when the API key is created).' };
  if (!/^CR[0-9a-f]{32}$/i.test(t(env.TWILIO_PUSH_CREDENTIAL_SID))) return { problem: 'TWILIO_PUSH_CREDENTIAL_SID is missing in Vercel. It starts with CR (the Firebase push credential in Twilio).' };
  return { settings: { accountSid: t(env.TWILIO_ACCOUNT_SID), apiKeySid: t(env.TWILIO_API_KEY_SID), apiKeySecret: t(env.TWILIO_API_KEY_SECRET), pushCredentialSid: t(env.TWILIO_PUSH_CREDENTIAL_SID) } };
}
