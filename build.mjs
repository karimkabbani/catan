// Rebuilds the two browser artifacts:
//   1. catan-engine.js     — the TS engine bundled to an IIFE global `Catan`
//   2. catan-standalone.html — index.html with engine + app.js inlined (single file)
//
// Run from the prototype/ folder:  node build.mjs
// Requires the engine deps installed once:  (cd ../engine && npm install)

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const engineDir = path.resolve(here, '../engine');

// Prefer the platform-specific esbuild binary (@esbuild/<os>-<arch>/bin/esbuild).
// The generic node_modules/.bin/esbuild shim can be a wrong-arch binary if the
// node_modules tree was populated on another platform.
function findEsbuild() {
  const platDir = path.join(engineDir, 'node_modules', '@esbuild');
  const want = `${process.platform}-${process.arch}`; // e.g. darwin-arm64
  if (fs.existsSync(platDir)) {
    const dirs = fs.readdirSync(platDir).filter((p) => !p.startsWith('.'));
    // exact host-platform match first, then any non-hidden package
    const ordered = [want, ...dirs.filter((p) => p !== want)];
    for (const p of ordered) {
      const b = path.join(platDir, p, 'bin', 'esbuild');
      if (fs.existsSync(b)) return b;
    }
  }
  const shim = path.join(engineDir, 'node_modules', '.bin', 'esbuild');
  return fs.existsSync(shim) ? shim : null;
}

console.log('• bundling engine -> catan-engine.js');
const esbuild = findEsbuild();
const bin = esbuild ? `"${esbuild}"` : 'npx esbuild';
execSync(
  `${bin} src/index.ts --bundle --minify --format=iife --global-name=Catan --outfile="${path.join(here, 'catan-engine.js')}"`,
  { cwd: engineDir, stdio: 'inherit' },
);

console.log('• inlining -> catan-standalone.html');
let html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const engineJs = fs.readFileSync(path.join(here, 'catan-engine.js'), 'utf8');
const appJs = fs.readFileSync(path.join(here, 'app.js'), 'utf8');
html = html.replace('<script src="catan-engine.js"></script>', '<script>\n' + engineJs + '\n</script>');
html = html.replace('<script src="app.js"></script>', '<script>\n' + appJs + '\n</script>');
fs.writeFileSync(path.join(here, 'catan-standalone.html'), html);

console.log('✓ built catan-engine.js and catan-standalone.html');
