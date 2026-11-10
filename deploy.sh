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
# publish the site: gh-pages = prototype/ on top of the current gh-pages, keeping the preview/ slot (./preview.sh)
git fetch -q origin gh-pages
T=$(git rev-parse HEAD:prototype)
if git cat-file -e origin/gh-pages:preview 2>/dev/null; then
  IDX=$(mktemp); rm -f "$IDX"
  GIT_INDEX_FILE="$IDX" git read-tree "$T"
  GIT_INDEX_FILE="$IDX" git read-tree --prefix=preview/ origin/gh-pages:preview
  T=$(GIT_INDEX_FILE="$IDX" git write-tree); rm -f "$IDX"
fi
git push origin "$(git commit-tree "$T" -p origin/gh-pages -m "${1:-update}")":refs/heads/gh-pages
echo "Deployed -> https://karimkabbani.github.io/catan/"
