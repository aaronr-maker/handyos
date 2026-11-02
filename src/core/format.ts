import type { Cents } from './types';

/** 12345 -> "$123.45" */
export function formatMoney(cents: Cents): string {
  return (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

/** "$1,234.5" or "12" -> 123450 / 1200 cents. Returns null for anything that isn't a plain amount. */
export function parseMoney(text: string): Cents | null {
  const t = text.trim().replace(/[$,\s]/g, '');
  if (!/^\d*\.?\d{0,2}$/.test(t) || t === '' || t === '.') return null;
  return Math.round(Number(t) * 100);
}

/** 123450 -> "1234.50" (for putting back into a text box). */
export function centsToInput(cents: Cents): string {
  return (cents / 100).toFixed(2);
}
