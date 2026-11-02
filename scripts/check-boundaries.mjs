import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { checkSource } from './boundaries.mjs';

const root = process.cwd();
const files = [];
(function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) files.push(full);
  }
})(path.join(root, 'src'));

const problems = files.flatMap((f) => {
  const rel = path.relative(root, f).split(path.sep).join('/');
  return checkSource(rel, readFileSync(f, 'utf8'));
});

if (problems.length) {
  console.error('Module boundary violations:\n' + problems.map((p) => '  ✗ ' + p).join('\n'));
  process.exit(1);
}
console.log(`Module boundaries OK (${files.length} files checked).`);
