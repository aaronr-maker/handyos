import { createRepo, type Id } from '@/core';
import { DAYS, DEFAULT_HOURS, starterFlow, type Flow, type Hours } from '../../../api/_lib/callEngine';
import type { CallFlow, CallLogRow, CallSettings, TeamPhone, Voicemail } from './types';

const settingsRepo = createRepo<CallSettings>('call_settings');
const phonesRepo = createRepo<TeamPhone>('team_phones');
const flowsRepo = createRepo<CallFlow>('call_flows');
const logRepo = createRepo<CallLogRow>('call_log');
const mailRepo = createRepo<Voicemail>('voicemails');

export interface PhoneSettings {
  number: string;
  hours: Hours;
  voice: string;
}

/** The company's phone settings, with the usual hours when none are saved yet. */
export async function getSettings(companyId: Id): Promise<PhoneSettings> {
  const row = (await settingsRepo.list(companyId))[0];
  const week = { ...DEFAULT_HOURS.week };
  for (const d of DAYS) if (row?.hours && Array.isArray(row.hours[d])) week[d] = row.hours[d] as Hours['week'][typeof d];
  return { number: row?.number ?? '', hours: { timezone: row?.timezone ?? DEFAULT_HOURS.timezone, week }, voice: row?.voice ?? 'Polly.Joanna' };
}

export async function saveSettings(companyId: Id, s: PhoneSettings): Promise<void> {
  const data = { number: s.number.trim() || null, timezone: s.hours.timezone, hours: s.hours.week, voice: s.voice };
  const row = (await settingsRepo.list(companyId))[0];
  if (row) await settingsRepo.update(companyId, row.id, data);
  else await settingsRepo.insert(companyId, data);
}

export const listTeamPhones = async (companyId: Id): Promise<Record<Id, string>> => Object.fromEntries((await phonesRepo.list(companyId)).map((p) => [p.user_id, p.phone]));

export async function setTeamPhone(companyId: Id, userId: Id, phone: string): Promise<void> {
  const row = (await phonesRepo.list(companyId, { where: { user_id: userId } }))[0];
  const clean = phone.trim();
  if (!clean) {
    if (row) await phonesRepo.remove(companyId, row.id);
    return;
  }
  if (row) await phonesRepo.update(companyId, row.id, { phone: clean });
  else await phonesRepo.insert(companyId, { user_id: userId, phone: clean });
}

/** The tree that answers the phone, or the starter tree when none is saved yet. */
export async function getFlow(companyId: Id): Promise<{ graph: Flow; saved: boolean }> {
  const row = (await flowsRepo.list(companyId, { where: { active: true } }))[0];
  return row ? { graph: row.graph, saved: true } : { graph: starterFlow(), saved: false };
}

export async function saveFlow(companyId: Id, graph: Flow): Promise<void> {
  const row = (await flowsRepo.list(companyId, { where: { active: true } }))[0];
  if (row) await flowsRepo.update(companyId, row.id, { graph });
  else await flowsRepo.insert(companyId, { name: 'Main line', active: true, graph });
}

export const listCalls = async (companyId: Id) => (await logRepo.list(companyId)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
export const listVoicemails = async (companyId: Id) => (await mailRepo.list(companyId)).sort((a, b) => b.created_at.localeCompare(a.created_at)).slice(0, 100);
export const markHeard = (companyId: Id, id: Id) => mailRepo.update(companyId, id, { status: 'heard' });
