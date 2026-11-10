# Catan: working rules for Claude

Karim's multiplayer Catan for his friends (Lebanese group; Ramzi, Kay, Nasam, Lapen…). Live at
https://karimkabbani.github.io/catan/. The full history, every feature and its design decisions are in
`HANDOVER.md` (section 8 is the numbered backlog): read the relevant item before changing a feature.

## How Karim works
- Plain, direct English. No em dashes. Explain things in lay terms when asked.
- Mock it first when he asks for mocks: design canvases (one board per file; publish each file before writing the
  next): main https://claude.ai/artifact/NRTc83WMEbQWPfp2UtYmNB, voice & video https://claude.ai/artifact/DjkXUjLaeYMZzcH4tpz9QX,
  design & UX sweep https://claude.ai/artifact/1qJ3HEEkQytq4WD93NJDtF. Otherwise build straight away.
- Other Claude sessions run in parallel: see "Parallel sessions" below. Never force-push main or gh-pages.
- **Deploy only when he says so** ("deploy", "build and deploy"). After deploying, confirm the live version.
- Report what you verified and what you couldn't (real-phone behaviour can't be tested headless).

## Layout
- `prototype/app.js`: the whole client (one IIFE, plain JS). `prototype/index.html`: all CSS + markup.
- `engine/src`: the pure rules engine (TypeScript), bundled by `prototype/build.mjs`.
- `server/*.sql`: Supabase schema/RPCs (project `ufisdymhbhkquxqpxdzp`). Karim runs DDL himself in the
  SQL editor; ask before any write/delete in the database and show him what it will touch first. When he has
  to run SQL, paste the full SQL in the chat (ready to copy) with click-by-click steps, never just a file path.
  Test new SQL on a throwaway local Postgres first (`initdb` + `pg_ctl`, Homebrew Postgres is installed).

## Parallel sessions (Karim runs several at once)
- Start from the latest main: `git fetch origin main` and branch from `origin/main`. Build on your own branch and
  push it. Never push main or gh-pages, never deploy, unless Karim says "deploy" in THIS session.
- Do not pick a version number. Leave `APP_VERSION` and the service-worker `VERSION` as they are, and write your
  HANDOVER §8 entry as `NEXT. 🔨 **vNEXT (date, built on branch <name>): title.**`. The session that merges assigns
  the real numbers (highest version on main + 1, next item number) and marks the entry deployed.
- When the work is ready, say so and stop. If Karim says "main has moved", run
  `git fetch origin main && git merge origin/main`, rebuild and rerun the tests before continuing.
- The merging session (the one Karim tells to "merge and deploy"): fetch main; for each ready branch, one at a
  time: merge it, assign the version and item numbers, rebuild, run the engine tests and the `tests/device` checks,
  deploy, confirm the live version. A conflict in `catan-standalone.html` is never resolved by hand: rebuild it.
  Never take a whole file from one side of a merge, resolve only the conflicting lines (2026-11-10: a whole-file
  "theirs" dropped two features main had gained).

## Every change
1. Bump `APP_VERSION` in `prototype/app.js` and `VERSION 'catan-vNNN'` in `prototype/sw.js` together (only the
   session that deploys; see "Parallel sessions").
2. `cd prototype && node build.mjs`, then `cd engine && npm test` (35 tests must pass).
3. Verify screens in headless Chrome against `prototype/catan-standalone.html` (see "UI verification" in
   HANDOVER.md §9): patch a LOCAL copy so `window.CATAN = {` also exposes test hooks (the IIFE's closures are
   reachable there), e.g. a `_mid()` that builds a game with `C.createGame` and calls `enterGame`. Never ship hooks.
   There are no demo modes (removed in v175). Headless Chrome won't go narrower than 500px.
4. `./deploy.sh "vNNN: what changed"` (builds, commits to main, pushes, publishes `prototype/` to gh-pages).
   GitHub Pages can take a few minutes; poll `app.js?x=random` for the new `APP_VERSION`.
5. Add a short entry to HANDOVER.md §8 and commit it.
6. After a big batch of fixes or features, run a regression sweep (parallel reviewers over the diff, each with
   one area) before calling it done: the 2026-10-25 sweep caught a critical bug introduced by the fixes themselves.

## Things that bit us before
- Online state is client-authoritative: writes go through `svUpdate` / `rpsUpdate` (version-guarded). Apply
  the merged result locally after a write (own echoes are deduped by version).
- `build.mjs` must inline code with function replacers (`$&` in code once corrupted the standalone build).
- iPhone home-screen app reports a viewport shorter than the screen (status-bar strip): see `fitAppHeight`.
- The display font draws "1" like a Roman "I": use the system font for numbers.
- version.json’s min is raised by hand only, when an old build would corrupt games, never by a routine deploy.
