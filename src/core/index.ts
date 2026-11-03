/** Public surface of the shared core. Modules may import from '@/core' only (never deep paths). */
export * from './types';
export * from './format';
export { parseCsv } from './csv';
export { apiCall } from './integrations';
export { fileToCsvText, rowsToCsv } from './xlsx';
export * from './events';
export * from './actions';
export * from './data';
export * from './tenancy';
export * from './ui';
export * from './supabase';
export * from './auth';
export type { ModuleContext, ModuleManifest } from './module';
export { createRuntime } from './runtime';
export { RuntimeProvider } from './RuntimeProvider';
export { useRuntime, useAction, resultError } from './runtimeContext';
export type { Runtime } from './runtime';
