#!/bin/bash
# Deploy the prototype/ site to GitHub Pages (https://karimkabbani.github.io/catan/).
# Usage: ./deploy.sh "commit message"
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"
( cd prototype && node build.mjs )          # rebuild engine bundle + standalone
git add -A
git commit -m "${1:-update}" || echo "(nothing new to commit)"
git push origin main
git subtree push --prefix prototype origin gh-pages   # publish the site
echo "Deployed -> https://karimkabbani.github.io/catan/"
