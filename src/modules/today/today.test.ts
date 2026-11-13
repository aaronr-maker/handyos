import { describe, expect, it } from 'vitest';
import { daySummary, dayBounds, greeting, hoursText, isToday, matchContacts } from './calc';

describe('dashboard helpers', () => {
  it('knows what today is', () => {
    const now = new Date(2026, 10, 13, 15, 0).getTime();
    expect(isToday(new Date(2026, 10, 13, 8, 0).toISOString(), now)).toBe(true);
    expect(isToday(new Date(2026, 10, 14, 0, 30).toISOString(), now)).toBe(false);
    expect(isToday(null, now)).toBe(false);
    expect(dayBounds(now).to - dayBounds(now).from).toBe(86_400_000);
  });
  it('greets by time of day', () => {
    expect([greeting(8), greeting(13), greeting(20)]).toEqual(['Good morning', 'Good afternoon', 'Good evening']);
  });
  it('formats hours', () => {
    expect(hoursText(150)).toBe('2h 30m');
    expect(hoursText(120)).toBe('2h');
  });
  it('summarises the day', () => {
    expect(daySummary([], [])).toBe('Nothing is scheduled for today.');
    expect(daySummary([{ start: new Date(2026, 10, 13, 9, 0).toISOString() }], ['1 overdue invoice.'])).toMatch(/^1 job today, first at 9:00.*1 overdue invoice\.$/);
  });
  it('finds people by name or number', () => {
    const all = [{ id: '1', label: 'Pat Lee', phone: '(713) 555-0101' }, { id: '2', label: 'Sam', phone: null }];
    expect(matchContacts(all, 'pat').map((c) => c.id)).toEqual(['1']);
    expect(matchContacts(all, '555-0101').map((c) => c.id)).toEqual(['1']);
    expect(matchContacts(all, '  ')).toEqual([]);
  });
});
