#!/usr/bin/env bash
# Builds the hooked test pages described in README.md (never shipped: prototype/_*.html is gitignored).
#   _t.html    standalone + practice hooks (hookP + hookX)
#   _t2.html   standalone + all hooks (hookAll + hookP + hookX)
#   _rot.html / _rot2.html   rotate.html framing _t.html / _t2.html
#   _v214.html the v214 standalone (commit aa9ab15) + all hooks, for the before/after benchmark
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"; P="$HERE/../../prototype"
(cd "$P" && node build.mjs >/dev/null)
node - "$HERE" "$P" <<'JS'
const fs = require('fs'), path = require('path'), [here, P] = process.argv.slice(2);
const rd = (f) => fs.readFileSync(path.join(here, f), 'utf8');
const hookP = rd('hookP.txt'), hookX = rd('hookX.txt'), hookAll = rd('hookAll.txt');
const strip = (s) => s.replace(/^window\.CATAN = \{\s*/, '');
const hooksPX = hookP + hookX, hooksAll = hookAll + strip(hookP) + hookX;
const inject = (html, hooks) => { const n = html.split('window.CATAN = {').length - 1; if (n !== 1) throw new Error('expected one window.CATAN = { , found ' + n); return html.replace('window.CATAN = {', () => hooks); };
const std = fs.readFileSync(path.join(P, 'catan-standalone.html'), 'utf8');
fs.writeFileSync(path.join(P, '_t.html'), inject(std, hooksPX));
fs.writeFileSync(path.join(P, '_t2.html'), inject(std, hooksAll));
const rot = fs.readFileSync(path.join(P, 'rotate.html'), 'utf8');
fs.writeFileSync(path.join(P, '_rot.html'), rot.replace("frame.src = 'index.html'", "frame.src = '_t.html'"));
fs.writeFileSync(path.join(P, '_rot2.html'), rot.replace("frame.src = 'index.html'", "frame.src = '_t2.html'"));
const v214 = require('child_process').execSync('git show aa9ab15:prototype/catan-standalone.html', { cwd: P, maxBuffer: 64 << 20 }).toString();
fs.writeFileSync(path.join(P, '_v214.html'), inject(v214, hooksAll));
console.log('built _t _t2 _rot _rot2 _v214 in', P);
JS
