import { apiCall } from '@/core';

/** Drive minutes between pairs of addresses, looked up (and remembered) by the server. null means it could not be worked out. */
export async function driveMinutes(pairs: { from: string; to: string }[]): Promise<(number | null)[]> {
  const out: (number | null)[] = [];
  for (let i = 0; i < pairs.length; i += 40) {
    const { minutes } = await apiCall<{ minutes: (number | null)[] }>('/api/travel/times', { pairs: pairs.slice(i, i + 40) });
    out.push(...minutes);
  }
  return out;
}

/** The addresses (as a single line) a property has. */
export const oneLine = (p: { address_line1: string; city: string; state: string; postal_code: string }) =>
  [p.address_line1, p.city, [p.state, p.postal_code].filter(Boolean).join(' ')].filter(Boolean).join(', ');
