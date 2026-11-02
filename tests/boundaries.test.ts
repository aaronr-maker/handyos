import { describe, expect, it } from 'vitest';
// @ts-expect-error plain JS module without types
import { checkSource } from '../scripts/boundaries.mjs';

const check = (file: string, source: string): string[] => checkSource(file, source);

describe('module boundaries', () => {
  it('allows a module to import another module via its index', () => {
    expect(check('src/modules/scheduling/actions.ts', "import { x } from '@/modules/jobs';")).toEqual([]);
  });
  it('blocks deep alias imports into another module', () => {
    expect(check('src/modules/scheduling/actions.ts', "import { x } from '@/modules/jobs/services/jobService';")).toHaveLength(1);
  });
  it('blocks relative imports into another module', () => {
    expect(check('src/modules/scheduling/actions.ts', "import { x } from '../jobs/services/jobService';")).toHaveLength(1);
    expect(check('src/modules/scheduling/actions.ts', "import('../jobs/types');")).toHaveLength(1);
  });
  it('allows relative imports within the same module', () => {
    expect(check('src/modules/jobs/actions.ts', "import { x } from './services/jobService';")).toEqual([]);
  });
  it('blocks the app shell from reaching into module internals', () => {
    expect(check('src/app/modules.ts', "import { x } from '@/modules/jobs/types';")).toHaveLength(1);
    expect(check('src/app/modules.ts', "import { x } from '@/modules/jobs';")).toEqual([]);
  });
  it('blocks core from importing modules or app', () => {
    expect(check('src/core/runtime.ts', "import { x } from '@/modules/jobs';")).toHaveLength(1);
    expect(check('src/core/runtime.ts', "import { x } from '../app/runtime';")).toHaveLength(1);
  });
  it('requires modules to use the core public index', () => {
    expect(check('src/modules/jobs/actions.ts', "import { x } from '@/core';")).toEqual([]);
    expect(check('src/modules/jobs/actions.ts', "import { x } from '@/core/actions/registry';")).toHaveLength(1);
  });
  it('ignores packages', () => {
    expect(check('src/modules/jobs/actions.ts', "import { z } from 'zod';")).toEqual([]);
  });
});
