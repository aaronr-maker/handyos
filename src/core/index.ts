/** Public surface of the shared core. Modules may import from '@/core' only (never deep paths). */
export * from './types';
export * from './events';
export * from './actions';
export * from './data';
export * from './tenancy';
export * from './ui';
export * from './supabase';
export * from './auth';
export type { ModuleContext, ModuleManifest } from './module';
export { createRuntime } from './runtime';
export type { Runtime } from './runtime';
