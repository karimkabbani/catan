#!/bin/bash
# Deploy the prototype/ site to GitHub Pages (https://karimkabbani.github.io/catan/).
# Usage: ./deploy.sh "commit message"
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"
( cd prototype && node build.mjs )          # rebuild engine bundle + standalone
( cd engine && npx vitest run --silent >/dev/null ) || { echo "Engine tests failed: not deploying"; exit 1; }   # never ship a broken rules engine
git add -A
git commit -m "${1:-update}" || echo "(nothing new to commit)"
git push origin main
git subtree push --prefix prototype origin gh-pages   # publish the site
echo "Deployed -> https://karimkabbani.github.io/catan/"
