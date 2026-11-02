import { createClient } from '@supabase/supabase-js';
import type { Env, Store } from './qb';

/** The real Store: talks to Supabase with the server-only service key (never sent to the browser). */
export function supabaseStore(env: { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string }): Store {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are not set on the server.');
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
  const fail = (what: string, error: { message: string } | null) => {
    if (error) throw new Error(`${what}: ${error.message}`);
  };
  return {
    async userFromToken(token) {
      const { data, error } = await db.auth.getUser(token);
      return error || !data.user ? null : { id: data.user.id };
    },
    async membership(userId) {
      const { data } = await db.from('users').select('company_id, role').eq('id', userId).maybeSingle();
      return data ? { companyId: data.company_id as string, role: data.role as string } : null;
    },
    async saveConnection(c) {
      const link = await db.from('integration_links').upsert(
        { company_id: c.companyId, provider: 'quickbooks', status: 'connected', external_id: c.realmId, label: c.label, connected_by: c.userId, connected_at: new Date().toISOString(), last_error: null },
        { onConflict: 'company_id,provider' },
      );
      fail('Saving the connection', link.error);
      const secret = await db
        .from('integration_secrets')
        .upsert({ company_id: c.companyId, provider: 'quickbooks', secret_encrypted: c.secretEncrypted, access_expires_at: c.accessExpiresAt, updated_at: new Date().toISOString() }, { onConflict: 'company_id,provider' });
      fail('Saving the connection', secret.error);
    },
    async getSecret(companyId) {
      const [{ data: s }, { data: l }] = await Promise.all([
        db.from('integration_secrets').select('secret_encrypted').eq('company_id', companyId).eq('provider', 'quickbooks').maybeSingle(),
        db.from('integration_links').select('external_id').eq('company_id', companyId).eq('provider', 'quickbooks').maybeSingle(),
      ]);
      return s && l?.external_id ? { secretEncrypted: s.secret_encrypted as string, realmId: l.external_id as string } : null;
    },
    async updateSecret(companyId, secretEncrypted, accessExpiresAt) {
      const r = await db.from('integration_secrets').update({ secret_encrypted: secretEncrypted, access_expires_at: accessExpiresAt, updated_at: new Date().toISOString() }).eq('company_id', companyId).eq('provider', 'quickbooks');
      fail('Saving the new QuickBooks token', r.error);
    },
    async deleteConnection(companyId) {
      await db.from('integration_secrets').delete().eq('company_id', companyId).eq('provider', 'quickbooks');
      await db.from('integration_links').delete().eq('company_id', companyId).eq('provider', 'quickbooks');
    },
    async markSync(companyId, error) {
      await db.from('integration_links').update({ last_sync_at: new Date().toISOString(), last_error: error }).eq('company_id', companyId).eq('provider', 'quickbooks');
    },
  };
}

export const serverEnv = (): Env & { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string } => ({
  INTUIT_CLIENT_ID: process.env.INTUIT_CLIENT_ID,
  INTUIT_CLIENT_SECRET: process.env.INTUIT_CLIENT_SECRET,
  INTUIT_REDIRECT_URI: process.env.INTUIT_REDIRECT_URI,
  INTUIT_ENV: process.env.INTUIT_ENV,
  INTEGRATIONS_SECRET: process.env.INTEGRATIONS_SECRET,
  APP_URL: process.env.APP_URL,
  // the same Supabase project the app uses; the service key is server-only
  SUPABASE_URL: process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
});
