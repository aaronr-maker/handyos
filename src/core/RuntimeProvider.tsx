import type { ReactNode } from 'react';
import type { Runtime } from './runtime';
import { RuntimeContext } from './runtimeContext';

export function RuntimeProvider({ runtime, children }: { runtime: Runtime; children: ReactNode }) {
  return <RuntimeContext.Provider value={runtime}>{children}</RuntimeContext.Provider>;
}
