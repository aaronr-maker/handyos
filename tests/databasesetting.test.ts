import { describe, expect, it } from 'vitest';
import { databaseSettingProblem } from '../api/_lib/handler';

const KEY = 'sb_secret_' + 'a'.repeat(30);

describe('telling what is wrong with the database settings', () => {
  it('accepts a good address and key', () => {
    expect(databaseSettingProblem({ SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY })).toBeNull();
    expect(databaseSettingProblem({ SUPABASE_URL: 'https://abcdefgh.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: 'eyJ' + 'x'.repeat(200) })).toBeNull();
  });

  it('names the problem for a missing or malformed address or key, without showing the values', () => {
    expect(databaseSettingProblem({ SUPABASE_SERVICE_ROLE_KEY: KEY })).toMatch(/cannot find the Supabase address/);
    expect(databaseSettingProblem({ SUPABASE_URL: 'abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY })).toMatch(/address .* looks wrong/);
    expect(databaseSettingProblem({ SUPABASE_URL: 'https://abcdefgh.supabase.co/rest/v1', SUPABASE_SERVICE_ROLE_KEY: KEY })).toMatch(/looks wrong/);
    expect(databaseSettingProblem({ SUPABASE_URL: '"https://abcdefgh.supabase.co"', SUPABASE_SERVICE_ROLE_KEY: KEY })).toMatch(/looks wrong/);
    expect(databaseSettingProblem({ SUPABASE_URL: 'https://abcdefgh.supabase.co' })).toMatch(/cannot find SUPABASE_SERVICE_ROLE_KEY/);
    expect(databaseSettingProblem({ SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY + '\n' })).toMatch(/space, line break or quote/);
    expect(databaseSettingProblem({ SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: '"' + KEY + '"' })).toMatch(/space, line break or quote/);
    expect(databaseSettingProblem({ SUPABASE_URL: 'https://abcdefgh.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'short' })).toMatch(/too short/);
    for (const msg of [databaseSettingProblem({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: KEY + ' ' })]) expect(msg).not.toContain(KEY);
  });
});
