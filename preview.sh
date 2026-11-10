#!/bin/bash
# Publish one branch's prototype/ to gh-pages under preview/ -> https://karimkabbani.github.io/catan/preview/
# Usage: ./preview.sh <branch>
# One slot: overwrites whatever preview is there. Touches only gh-pages' preview/ folder: not main, not the live
# site's files, no version numbers. The preview copy is renamed "Catan preview" (home-screen icon) and gets its own
# service-worker cache, so it never clears the live site's cache.
set -e
cd "$(dirname "$0")"
export PATH="/opt/homebrew/bin:$PATH"
B="${1#origin/}"; [ -n "$B" ] || { echo "usage: ./preview.sh <branch>"; exit 1; }
git fetch -q origin "$B" gh-pages
SRC=$(git rev-parse --short "origin/$B")
TMP=$(mktemp -d); W="$TMP/wt"
git worktree add -q --detach "$W" "origin/$B"
trap 'git worktree remove --force "$W"; rm -rf "$TMP"' EXIT
cp -R engine/node_modules "$W/engine/node_modules"     # a copy, not a link: removing the worktree must not touch ours
(cd "$W/prototype" && node build.mjs >/dev/null)
P="$W/prototype"
sed -i.bak 's/"name": "Catan"/"name": "Catan preview"/; s/"short_name": "Catan"/"short_name": "Catan preview"/' "$P/manifest.webmanifest"
sed -i.bak 's/name="apple-mobile-web-app-title" content="Catan"/name="apple-mobile-web-app-title" content="Catan preview"/; s#<title>Catan</title>#<title>Catan preview</title>#' "$P/index.html"
sed -i.bak "s/const VERSION = 'catan-v/const VERSION = 'catan-preview-v/; s/keys.filter((k) => k !== VERSION)/keys.filter((k) => k !== VERSION \&\& k.indexOf('catan-preview-') === 0)/" "$P/sw.js"
rm -f "$P"/*.bak "$P"/_*.html
grep -q '"name": "Catan preview"' "$P/manifest.webmanifest" || { echo "manifest rename failed"; exit 1; }
grep -q "content=\"Catan preview\"" "$P/index.html" || { echo "home-screen title rename failed"; exit 1; }
grep -q "const VERSION = 'catan-preview-v" "$P/sw.js" && grep -q "indexOf('catan-preview-') === 0" "$P/sw.js" || { echo "service-worker cache rename failed"; exit 1; }
# the built + renamed folder as a tree (a throwaway commit in the worktree, so .gitignore applies)
git -C "$W" add -A prototype
git -C "$W" -c user.name=preview -c user.email=preview@localhost commit -q -m "preview build of $B" --allow-empty
PT=$(git -C "$W" rev-parse HEAD:prototype)
# gh-pages as it is, with preview/ replaced
export GIT_INDEX_FILE="$TMP/index"
git read-tree origin/gh-pages
git rm -r -q --cached --ignore-unmatch preview
git read-tree --prefix=preview/ "$PT"
T=$(git write-tree); unset GIT_INDEX_FILE
C=$(git commit-tree "$T" -p origin/gh-pages -m "preview: $B ($SRC)")
git push -q origin "$C:refs/heads/gh-pages"
echo "Preview of $B ($SRC) -> https://karimkabbani.github.io/catan/preview/"
