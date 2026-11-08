/** Every module in the monolith. Adding a module = add its id here + a folder in src/modules. */
export const MODULE_IDS = [
  'customers',
  'estimates',
  'jobs',
  'scheduling',
  'invoicing',
  'payments',
  'jobcosting',
  'sales',
  'receptionist',
  'cashplan',
  'revenue',
  'qbsync',
  'timetrack',
  'timesheets',
  'desk',
  'handy',
  'dashboard',
  'phone',
  'messaging',
] as const;

export type ModuleId = (typeof MODULE_IDS)[number];

export type Id = string;

/** Mirrors the user_role enum in the database. */
export const USER_ROLES = ['owner', 'admin', 'office', 'tech'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** Money is always stored as integer cents to avoid floating-point drift. */
export type Cents = number;

/**
 * Every persisted record in HandyOS carries a company_id (the tenant).
 * Field names mirror the Postgres columns in supabase/migrations.
 */
export interface BaseRecord {
  id: Id;
  company_id: Id;
  created_at: string;
  updated_at: string;
}
