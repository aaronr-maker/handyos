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

/** ISO timestamp -> value for a datetime-local input, in the viewer's time zone. */
export function toDateTimeLocal(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** datetime-local value (viewer's time zone) -> ISO timestamp, or null when empty/invalid. */
export function fromDateTimeLocal(local: string): string | null {
  if (!local) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** "Mon, Dec 1, 3:00 PM" */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** 125 -> "2h 05m" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`;
}
