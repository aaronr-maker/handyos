import { getSupabase } from '../supabase';
import type { Id } from '../types';

const memory = new Map<string, number>();

/** Next number in a per-company sequence (e.g. estimate numbers 1001, 1002, ...). Safe under concurrent use in the database. */
export async function nextCompanyNumber(companyId: Id, name: string): Promise<number> {
  const db = getSupabase();
  if (!db) {
    const key = `${companyId}:${name}`;
    const next = (memory.get(key) ?? 1000) + 1;
    memory.set(key, next);
    return next;
  }
  const { data, error } = await db.rpc('next_company_number', { counter: name });
  if (error) throw new Error(error.message);
  return Number(data);
}
