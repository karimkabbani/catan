# Catan: working rules for Claude

Karim's multiplayer Catan for his friends (Lebanese group; Ramzi, Kay, Nasam, Lapen…). Live at
https://karimkabbani.github.io/catan/. The full history, every feature and its design decisions are in
`HANDOVER.md` (section 8 is the numbered backlog): read the relevant item before changing a feature.

## How Karim works
- Plain, direct English. No em dashes. Explain things in lay terms when asked.
- Mock it first when he asks for mocks: the design canvas is https://claude.ai/artifact/NRTc83WMEbQWPfp2UtYmNB
  (one board per file; publish each file before writing the next). Otherwise build straight away.
- **Deploy only when he says so** ("deploy", "build and deploy"). After deploying, confirm the live version.
- Report what you verified and what you couldn't (real-phone behaviour can't be tested headless).

## Layout
- `prototype/app.js`: the whole client (one IIFE, plain JS). `prototype/index.html`: all CSS + markup.
- `engine/src`: the pure rules engine (TypeScript), bundled by `prototype/build.mjs`.
- `server/*.sql`: Supabase schema/RPCs (project `ufisdymhbhkquxqpxdzp`). Karim runs DDL himself in the
  SQL editor; ask before any write/delete in the database and show him what it will touch first.

## Every change
1. Bump `APP_VERSION` in `prototype/app.js` and `VERSION 'catan-vNNN'` in `prototype/sw.js` together.
2. `cd prototype && node build.mjs`, then `cd engine && npm test` (25 tests must pass).
3. Verify screens in headless Chrome against `prototype/catan-standalone.html` (see "UI verification" in
   HANDOVER.md §9): patch a LOCAL copy so `window.CATAN = {` also exposes test hooks (the IIFE's closures are
   reachable there), e.g. a `_mid()` that builds a game with `C.createGame` and calls `enterGame`. Never ship hooks.
   There are no demo modes (removed in v175). Headless Chrome won't go narrower than 500px.
4. `./deploy.sh "vNNN: what changed"` (builds, commits to main, pushes, publishes `prototype/` to gh-pages).
   GitHub Pages can take a few minutes; poll `app.js?x=random` for the new `APP_VERSION`.
5. Add a short entry to HANDOVER.md §8 and commit it.

## Things that bit us before
- Online state is client-authoritative: writes go through `svUpdate` / `rpsUpdate` (version-guarded). Apply
  the merged result locally after a write (own echoes are deduped by version).
- `build.mjs` must inline code with function replacers (`$&` in code once corrupted the standalone build).
- iPhone home-screen app reports a viewport shorter than the screen (status-bar strip): see `fitAppHeight`.
- The display font draws "1" like a Roman "I": use the system font for numbers.
