import type { Property } from './types';

export const addressText = (p: Pick<Property, 'address_line1' | 'city' | 'state' | 'postal_code'>) =>
  [p.address_line1, [p.city, p.state].filter(Boolean).join(', '), p.postal_code].filter(Boolean).join(' ').replace(/\s+/g, ' ');
