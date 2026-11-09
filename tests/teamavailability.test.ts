import { describe, expect, it } from 'vitest';
import { getAvailability, saveAvailability } from '../src/modules/receptionist/service';

describe('team availability', () => {
  it('saves a person\'s weekly hours, replaces them on a second save, and keeps companies and people apart', async () => {
    expect(await getAvailability('ta-co-1')).toEqual({});
    await saveAvailability('ta-co-1', 'u1', { mon: [{ start: '07:00', end: '16:00' }], tue: [] });
    await saveAvailability('ta-co-1', 'u2', { sat: [{ start: '08:00', end: '12:00' }] });
    await saveAvailability('ta-co-1', 'u1', { mon: [{ start: '08:00', end: '17:00' }] });
    const got = await getAvailability('ta-co-1');
    expect(got.u1).toEqual({ mon: [{ start: '08:00', end: '17:00' }] });
    expect(got.u2).toEqual({ sat: [{ start: '08:00', end: '12:00' }] });
    expect(await getAvailability('ta-co-2')).toEqual({});
  });
});
