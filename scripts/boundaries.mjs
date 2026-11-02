import path from 'node:path';

/**
 * Module boundary rules for HandyOS (see README, "Module rules"):
 *  1. A file inside module A may import module B only through B's public index.
 *  2. App code (src/app, src/main.tsx) may import a module only through its public index.
 *  3. src/core must not import from src/modules or src/app.
 *  4. Modules must not import from src/app.
 */
const SPEC_RE = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"])([^'"\n]+)\1/g;

/** Resolve an import specifier to a path relative to src/ (posix), or null for packages. */
export function resolveSpecifier(fromFile, specifier) {
  if (specifier.startsWith('@/')) return specifier.slice(2);
  if (specifier.startsWith('.')) {
    const abs = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), specifier));
    return abs.startsWith('src/') ? abs.slice(4) : null;
  }
  return null;
}

/** Where does a src-relative path live? */
export function locate(srcPath) {
  const parts = srcPath.split('/');
  if (parts[0] === 'modules' && parts[1]) {
    const rest = parts.slice(2).join('/').replace(/\.(ts|tsx)$/, '');
    return { area: 'module', module: parts[1], isPublic: rest === '' || rest === 'index' };
  }
  if (parts[0] === 'core') return { area: 'core' };
  if (parts[0] === 'app') return { area: 'app' };
  return { area: 'other' };
}

/**
 * @param {string} file  repo-relative posix path, e.g. src/modules/jobs/actions.ts
 * @param {string} source file contents
 * @returns {string[]} human-readable violations
 */
export function checkSource(file, source) {
  const self = locate(file.replace(/^src\//, ''));
  const problems = [];
  for (const match of source.matchAll(SPEC_RE)) {
    const spec = match[2];
    const target = resolveSpecifier(file, spec);
    if (target === null) continue;
    const to = locate(target);
    const where = `${file}: imports "${spec}"`;

    if (self.area === 'core' && (to.area === 'module' || to.area === 'app')) {
      problems.push(`${where} — core must not depend on modules or the app shell`);
    } else if (self.area === 'module' && to.area === 'app') {
      problems.push(`${where} — modules must not depend on the app shell`);
    } else if (self.area === 'module' && to.area === 'module' && to.module !== self.module && !to.isPublic) {
      problems.push(`${where} — reaches into the internals of module "${to.module}"; import "@/modules/${to.module}" instead`);
    } else if (self.area !== 'module' && self.area !== 'core' && to.area === 'module' && !to.isPublic) {
      problems.push(`${where} — reaches into the internals of module "${to.module}"; import "@/modules/${to.module}" instead`);
    } else if (self.area === 'module' && to.area === 'core' && target.replace(/\.(ts|tsx)$/, '') !== 'core' && target !== 'core/index') {
      problems.push(`${where} — import shared code from "@/core" (its public index), not deep paths`);
    }
  }
  return problems;
}
