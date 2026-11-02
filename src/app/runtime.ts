import { createRuntime } from '@/core';
import { modules } from './modules';

/** One runtime per browser tab: event bus + action registry + audit log, with every module registered. */
export const runtime = createRuntime();
for (const m of modules) m.register({ actions: runtime.actions, events: runtime.events });
