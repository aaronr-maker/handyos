/**
 * ESLint side of the module-boundary rules (alias imports). The standalone checker,
 * scripts/check-boundaries.mjs, additionally resolves relative paths. Keep both in sync.
 */
export const MODULE_IDS = [
  'customers',
  'estimates',
  'jobs',
  'scheduling',
  'invoicing',
  'payments',
  'jobcosting',
  'messaging',
];

const MSG = 'Modules may only be imported through their public index: use "@/modules/<name>", never a deeper path.';

/** @param {string[]} ids */
export function boundaryConfigs(ids) {
  return [
    // Anywhere outside modules/: no deep imports into a module.
    {
      files: ['src/app/**/*.{ts,tsx}'],
      rules: { 'no-restricted-imports': ['error', { patterns: [{ group: ['@/modules/*/*'], message: MSG }] }] },
    },
    // Core must not know about modules or the app shell.
    {
      files: ['src/core/**/*.{ts,tsx}'],
      rules: {
        'no-restricted-imports': [
          'error',
          { patterns: [{ group: ['@/modules', '@/modules/*', '@/app', '@/app/*'], message: 'Core must not depend on modules or the app shell.' }] },
        ],
      },
    },
    // Each module: only its own internals, other modules via index, shared code via "@/core" (public index) only.
    ...ids.map((id) => ({
      files: [`src/modules/${id}/**/*.{ts,tsx}`],
      rules: {
        'no-restricted-imports': [
          'error',
          {
            patterns: [
              { group: ['@/modules/*/*'], message: MSG },
              { group: ['@/core/*'], message: 'Import shared code from "@/core" (its public index), not deep paths.' },
              { group: ['@/app', '@/app/*'], message: 'Modules must not depend on the app shell.' },
            ],
          },
        ],
      },
    })),
  ];
}
