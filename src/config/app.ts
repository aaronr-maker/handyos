/**
 * Single source of truth for branding and app identity.
 * Rename the product by editing this file only; the HTML title, PWA manifest,
 * Capacitor config and UI all read from here.
 */
export const appConfig = {
  /** Product name shown everywhere. */
  name: 'HandyOS',
  shortName: 'HandyOS',
  tagline: 'Run the whole handyman business from your pocket.',
  description: 'Field-service management: quotes, jobs, scheduling, invoicing and job costing.',
  /** Company that owns this deployment (becomes per-tenant data once onboarding exists). */
  ownerCompany: 'That Handyman Van LLC',
  /** Reverse-DNS id used by Capacitor / the App Store / Google Play. */
  bundleId: 'com.thathandymanvan.handyos',
  themeColor: '#0f766e',
  backgroundColor: '#f8fafc',
} as const;
