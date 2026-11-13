import { createRepo, type Id } from '@/core';
import type { CalendarEvent } from './types';

const repo = createRepo<CalendarEvent>('calendar_events');

export const listCalendarEvents = async (companyId: Id) => (await repo.list(companyId)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));

export async function addCalendarEvent(
  companyId: Id,
  e: { user_id: Id; kind: CalendarEvent['kind']; title: string | null; starts_at: string; ends_at: string; all_day: boolean; created_by: Id | null },
): Promise<CalendarEvent> {
  if (Date.parse(e.ends_at) <= Date.parse(e.starts_at)) throw new Error('The end has to be after the start.');
  return repo.insert(companyId, e);
}

export const removeCalendarEvent = (companyId: Id, id: Id) => repo.remove(companyId, id);

export const KIND_LABEL: Record<CalendarEvent['kind'], string> = { time_off: 'Time off', appointment: 'Appointment', other: 'Busy' };
