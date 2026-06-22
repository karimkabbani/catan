# Catan web app — handover

A self-contained guide to the project as it stands, how every piece works, and
exactly what to do next. Written so you (or another Claude Code session) can pick
it up cold and keep building.

---

## 1. Goal

A browser-based rebuild of Catan to play privately with friends. Each player
opens it on their own phone, "Add to Home Screen" so it runs like a native web
app, joins a shared game with a short room code, and plays. Visuals are meant to
feel like the classic app (landscape, board on a blue sea, wooden UI).

Target stack: a pure TypeScript rules engine (done), a React/HTML front end (an
HTML/SVG prototype is done; can be ported to React/Lovable), and Supabase for
real-time multiplayer. Deploy via Lovable publish or Netlify.

---

## 2. Current status

| Area | State |
|------|-------|
| Rules engine (base 3–4 player Catan) | **Done, 19 passing tests** |
| Playable UI (pass-and-play, one device) | **Done** — landscape, classic-style skin |
| Drop-in art system (tiles, tokens, ports, pieces, icons, avatars, robber, sea, logo) | **Done and wired** |
| Art skinned from the official Catan iOS app | **Done (2026-06-17)** — Mayfair terrain, ripped pieces/ports/robber/avatars/logo/sea. Player colours switched to red/blue/green/yellow to match authentic art. Tokens use drawn discs (see ASSETS-CHECKLIST). Re-rip via `source material catan ipa/Catan_assets/tools/slice_for_webapp.py`. |
| Authentic HUD pass | **Done (2026-06-17)** — Fertigo Pro font, wood-textured panels/dock/overlays/buttons, real resource-orb bar, red dice faces, framed build-menu buttons, dev-card faces, stat badges (longest road / largest army / VP). HUD sprites in `assets/hud/`, ripped via `tools/slice_hud.py`. iOS CgBI-format loose buttons can't be read by PIL (skipped; styled with wood texture instead). |
| Full visual pass (A-to-Z) | **Done (2026-06-17)** — Title scene (cloth banner + wood table + character medallions, `#title` layer); board reworked to float on open sea with coastline glow + island shadow + dock-style ports + subtle CSS-3D tilt (`#board rotateX(13deg)`); roads now rotated wooden sprites (`road-eastwest-<color>`); all overlays themed with real resource icons + slide-in; victory screen (crown + winner avatar + standings); motion — dice tumble, piece pop-in, active-panel pulse, board/overlay entrance, water shimmer. Ceiling: true 3D piece models + physics animation would need a WebGL rebuild (not done by design). |
| Asset cropping tool | **Done** (`prototype/tile-cropper.html`) |
| Multiplayer (own-phone, room codes) | **Not started** — designed below (Phase 3) |
| Player-to-player trade UI | Engine supports it; **UI not built** (bank trade only) |
| PWA packaging + deploy | **Not started** (Phase 5) |
| Sound | **Not started** |

The thing standing between this and real multi-device play is Phase 3.

---

## 3. Repository map

```
Projects/Catan/
├── HANDOVER.md                ← this file
├── engine/                    ← pure TypeScript rules engine (the core)
│   ├── package.json           (vitest + esbuild + typescript dev deps)
│   ├── tsconfig.json
│   ├── README.md              (engine-specific notes)
│   ├── src/
│   │   ├── types.ts           domain types + GameState shape + COSTS
│   │   ├── random.ts          seeded RNG (mulberry32) + shuffle + dice
│   │   ├── board.ts           hex geometry + board generation
│   │   ├── longestRoad.ts     longest-road graph search + award logic
│   │   ├── setup.ts           createGame(): initial GameState
│   │   ├── engine.ts          applyAction() reducer — all the rules
│   │   └── index.ts           re-exports everything
│   └── tests/
│       ├── board.test.ts      geometry + generation invariants
│       ├── engine.test.ts     per-mechanic unit tests
│       └── simulation.test.ts 12-game auto-played integration test
├── prototype/                 ← the playable game
│   ├── index.html             dev entry (loads engine + app + asset config)
│   ├── app.js                 all UI: SVG board render + input + overlays
│   ├── catan-engine.js        bundled engine (IIFE global `Catan`) — built artifact
│   ├── catan-standalone.html  single-file build (engine + app inlined)
│   ├── build.mjs              rebuilds catan-engine.js and catan-standalone.html
│   ├── tile-cropper.html      standalone image-cropping tool for assets
│   ├── board_preview.png      a sample render
│   └── assets/                drop-in art (see §5.4)
│       ├── ASSETS-CHECKLIST.md
│       ├── README.md
│       ├── tiles/ icons/ tokens/ ports/ pieces/ avatars/
│       ├── (root) robber.png, sea.png, logo.png  ← when added
└── source-material/           ← original reference screenshots + recordings
```

---

## 4. The rules engine

### 4.1 Design principles

- **Pure reducer.** The only way state changes is
  `applyAction(state, action, byColor) → { ok: true, state } | { ok: false, error }`.
  It never mutates its input (it deep-clones). This is what makes multiplayer
  easy: any client can compute the next state and write it to a shared row, and
  everyone recomputes identically.
- **Plain-JSON state.** `GameState` has no class instances, so it serializes
  straight into a Supabase `jsonb` column.
- **Deterministic.** All randomness flows through `state.rngState` (a single
  integer cursor). Same seed + same actions ⇒ identical game. This is why the
  tests are reproducible and why board/dice/steal are all replayable.

### 4.2 `GameState` (the shared state object)

Key fields (see `engine/src/types.ts` for the exact definitions):

- `id`, `players[]`, `order[]` (colors), `currentPlayerIndex`
- `board` — `{ hexes[], vertices[], edges[] }`, static geometry + terrain/tokens/ports
- `phase` — `'setup' | 'play' | 'ended'`
- `turnPhase` — `'roll' | 'main' | 'moveRobber' | 'steal' | 'discard' | 'placeSettlement' | 'placeRoad'`
- `setupIndex`, `setupOrder[]`, `setupLastVertex` — snake-order setup tracking
- `dice`, `robberHex`, `bank{}`, `devDeck[]`
- `settlements{ vertexId → {type, owner} }`, `roads{ edgeId → color }`
- `pendingDiscards{}`, `stealCandidates[]`, `freeRoads`
- `longestRoadOwner`, `largestArmyOwner`
- `hasPlayedDevCardThisTurn`, `hasRolledThisTurn`, `pendingTrade`
- `winner`, `rngState`, `log[]`

Each `Player` holds: `color`, `name`, `resources{}`, `devCards[]`,
`newDevCards[]` (bought this turn, not yet playable), `playedKnights`,
`roadsLeft/settlementsLeft/citiesLeft`, `hasLongestRoad`, `hasLargestArmy`.

### 4.3 Board geometry (`board.ts`)

Flat-top hexes on axial coordinates within radius 2 → **19 hexes, 54 vertices,
72 edges**. Vertices/edges are derived from hex corners and de-duped by rounded
position, which yields exact adjacency for free. Every hex/vertex carries pixel
coordinates (`cx/cy`, `x/y`) at unit scale — multiply by a scale factor to render.

`generateBoard(seed)` shuffles the standard terrain bag (3 brick, 4 wood, 4 sheep,
4 wheat, 3 ore, 1 desert) and the 18 number tokens, **re-rolling until no two red
(6/8) tokens are adjacent**, then assigns 9 ports (4×3:1, one 2:1 per resource).
Port coastal positions are deterministic; they can be tuned later to match exact
art without affecting rules.

### 4.4 Actions (`engine.ts`)

`Action` union: `rollDice`, `buildRoad{edge}`, `buildSettlement{vertex}`,
`buildCity{vertex}`, `buyDevCard`, `playKnight`, `playRoadBuilding`,
`playYearOfPlenty{resources:[a,b]}`, `playMonopoly{resource}`, `moveRobber{hex}`,
`steal{victim}`, `discard{resources}`, `bankTrade{give,want}`,
`offerTrade{give,want}`, `acceptTrade`, `confirmTrade{with}`, `cancelTrade`,
`endTurn`.

Implemented rules: snake-order setup with second-settlement resource grants,
dice production with correct **bank-shortage handling** (if demand exceeds supply
and more than one player wants it, nobody gets it), the robber + 7-discard,
distance rule + road connectivity, all five dev cards, one-dev-card-per-turn,
bank/port trade ratios, longest road (a real DFS that respects opponent-cut
roads — `longestRoad.ts`), largest army, and win detection at 10 VP.

`offerTrade`/`acceptTrade`/`confirmTrade` exist for player-to-player trading but
the prototype UI doesn't surface them yet.

### 4.5 Tests & build

```
cd engine
npm install
npm test        # 19 tests: board.test, engine.test, simulation.test
npm run typecheck
```

`simulation.test.ts` auto-plays 12 full games and asserts the resource bank stays
conserved (`bank + all hands === 19` per resource) on **every** action — the
strongest correctness check we have.

Bundle the engine for the browser (IIFE exposing global `Catan`):

```
cd engine
npx esbuild src/index.ts --bundle --minify --format=iife \
  --global-name=Catan --outfile=../prototype/catan-engine.js
```

---

## 5. The prototype UI (`prototype/`)

Plain HTML/CSS/JS + SVG, no framework. Loads the bundled engine as `window.Catan`
and is purely a render + input layer — it contains **no game rules**.

### Design principle: maximize mobile-landscape real estate (standing directive)

Primary target is a phone held in landscape (the app forces landscape). Every screen
should **use the full landscape canvas** — no tiny centered cards marooned in dead space.
When laying out a screen, prefer: wider content (up to a sensible max), multi-column
grids over tall single columns, big readable text and touch targets, and scaling the
content to *fill* the available space (the menu's `fitTitle` scales the card up **and**
down, bounded by width and height — copy that pattern). Demote secondary actions to small
muted links rather than full buttons (e.g. the "Pass & play offline" link on the identity
screen — possibly removed entirely later). Treat this as the default lens for any new or
revised UI, not a one-off.

### 5.1 Files & how they fit

- `index.html` — markup, CSS, the `window.CATAN_ASSETS` config, then loads
  `catan-engine.js` and `app.js`. This is the version to run while developing
  (it reads asset images live from `assets/`).
- `app.js` — everything: board SVG generation, the four corner player plaques,
  the bottom resource dock + action buttons, all overlays (build, trade, discard,
  steal, dev-card, year-of-plenty, monopoly, start screen), and the input state
  machine.
- `catan-standalone.html` — a single self-contained file (engine + app inlined)
  for AirDropping to a phone. Rebuilt by `build.mjs`.

### 5.2 Rendering pipeline (`app.js`)

`render()` rebuilds: corner plaques (`renderPanels`), the prompt banner, the board
(`boardSVG`), the resource dock (`handBar`), and the action bar (`actionsBar`).
`boardSVG()` emits: `<defs>` (terrain radial gradients, a soft drop-shadow filter,
one clipPath per hex), the sandy coast circle, ports, the hex tiles (built-in art
via `richMotif()` drawn first, your tile image layered on top if present), number
tokens with probability pips, the robber, roads, buildings, and — depending on
mode — interactive hit targets (`.hit` elements carrying `data-kind`/`data-id`).

### 5.3 Input state machine

`ui.mode` ∈ `idle | placeSettlement | placeRoad | placeCity | moveRobber`.
Flow: a button or board tap calls `dispatch(action, color)` →
`Catan.applyAction(...)` → on success, `afterAction()` inspects the new
`turnPhase` and sets `ui.mode` / opens the right overlay (e.g. a 7 triggers the
discard sheet, then robber-move mode, then the steal sheet) → `render()`.
`window.CATAN.*` holds all the button handlers.

Layout is landscape; a CSS media query shows a "rotate your device" overlay in
portrait on phones. Seats map to corners `tl, tr, bl, br`; the active player is
highlighted and their hand shows in the bottom dock.

### 5.4 Asset system (drop-in art)

`window.CATAN_ASSETS` (defined in `index.html`) maps each visual to an image path
under `assets/`. The renderer draws its own built-in art first and overlays your
image **only if present**, so any missing file silently falls back. Slots:

- `tiles/` — `wood, brick, sheep, wheat, ore, desert` (.png), clipped to the hex
- `tokens/` — `2,3,4,5,6,8,9,10,11,12`
- `ports/` — `generic` (3:1) + `brick, wood, sheep, wheat, ore` (2:1)
- `icons/` — `brick, wood, sheep, wheat, ore` (resource bar)
- `pieces/` — `settlement-<color>` and `city-<color>` for red/blue/green/yellow
- `avatars/` — `p1..p4`
- root — `robber.png`, `sea.png`, `logo.png`

`assets/ASSETS-CHECKLIST.md` is the full table. `tile-cropper.html` is a
standalone tool that frames a region of any image and exports a correctly-named
PNG for the right folder (hex guide for tiles, square for icons/pieces, free for
sea/logo). It runs entirely in the browser.

Currently the renderer does **not** image-swap roads (colored lines) or dice/cards
(CSS/text). Adding road images means rotating a sprite along each edge angle —
straightforward but not yet done.

### 5.5 Build

```
cd prototype
node build.mjs      # bundles engine -> catan-engine.js, inlines -> catan-standalone.html
```

`build.mjs` shells out to esbuild (uses the copy in `engine/node_modules`) then
inlines both scripts into `catan-standalone.html`. Run `npm install` in `engine/`
first so esbuild is available.

---

## 6. Verification approach (recommended to keep)

- **Engine:** `cd engine && npm test` (vitest).
- **UI smoke test:** drive the real page headlessly with jsdom — start a 4-player
  game, click the first legal `.hit` through all of setup, roll, and confirm a
  clean turn handoff with no exceptions. (A version of this script was used during
  development; re-create it under `prototype/tools/` if you want it in-repo.)
- **Visual preview:** render `Catan._boardSVG()` (exposed for this purpose) to PNG
  with `@resvg/resvg-js` to eyeball the board without opening a browser.

---

## 7. Roadmap

### Phase 3 — Multiplayer (next, highest value)

Goal: each friend on their own phone, one shared game, joined by room code.

**Backend: Supabase (free tier).**
1. Create a project at supabase.com. Grab the Project URL + anon public key.
2. Create a table `games`:
   - `id text primary key` (the room code, e.g. `ABCD`)
   - `state jsonb` (the whole `GameState`)
   - `updated_at timestamptz default now()`
3. Enable **Realtime** on the `games` table.
4. (Optional) a `rooms`/lobby table, or just keep lobby state inside `state`.

**Client model (trusted friends → client-authoritative is fine):**
- The engine already produces serializable state, so store the entire `GameState`
  in `games.state`.
- On load, read the row and `render()` from it. Subscribe with
  `supabase.channel('game:'+code).on('postgres_changes', …)` to re-render on every
  update.
- To act: call `Catan.applyAction(state, action, myColor)`; if `ok`, write
  `state` back to the row (`update … set state = …, updated_at = now()`).
  The engine rejects out-of-turn / illegal actions, so only the current player's
  writes succeed.
- Identity: no auth needed. On joining, the player picks a color+name; persist
  `{ roomCode, myColor }` in `localStorage` so refreshes rejoin.
- Concurrency: turn-based play means a single writer at a time; use `updated_at`
  for optimistic checks if you want to be safe.

**Lobby / room flow:**
- "Create game" → generate a 4-letter code, insert a row with a pre-game lobby
  state (players joining, picking color/name). "Join game" → enter code.
- Host hits Start → call `createGame({ id: code, players, seed })`, write it.

**UI changes needed:**
- Replace the local start screen with create/join + lobby.
- Each client only shows action buttons when `currentColor === myColor`
  (the engine already enforces this server-of-truth-side).
- Hidden info: in `pass-and-play` everything shows. For multiplayer, hide other
  players' resource/dev counts in the panels, and only render `myColor`'s hand in
  the dock. (Engine state contains everything; this is purely a render filter.)
- **Build the player-to-player trade UI** here — the engine actions
  (`offerTrade`/`acceptTrade`/`confirmTrade`) already exist; surface offers to
  other clients via the shared state.

**If porting to React/Lovable:** keep `catan-engine.js` (or the TS source) as the
untouched core. Have Lovable build the lobby, board, and Supabase wiring around
`applyAction`. Don't let it re-implement the rules.

### Phase 4 — Art & sound (in progress)

- Art: the drop-in system is complete; populate `assets/` folders to taste.
- Sound: add `assets/audio/` (dice, build, robber, trade, win) and play the
  matching clip inside `dispatch()`/`afterAction()` for each action/turnPhase.

### Phase 5 — PWA + deploy

- Add `manifest.webmanifest`: `name`, `display: standalone`,
  `orientation: landscape`, and icons (`192`, `512`, plus `apple-touch-icon`).
  `index.html` already has the `apple-mobile-web-app-capable` meta tags.
- Add a minimal service worker to cache the app shell for offline launch.
- Deploy: Lovable publish (simplest if you build there) or drag the `prototype/`
  folder onto Netlify. Supabase is the backend either way.
- Send friends the URL + a one-line "Share → Add to Home Screen → open" guide.

---

## 8. Known limitations / TODO

### Backlog — deferred on purpose

- **Phase 2: hidden hands (server-authoritative redaction). DEFERRED — not worth it now.**
  Today the full game state (everyone's exact resource + dev cards, dev-deck order)
  lives in one shared `games` row that all clients read, so the data is technically
  visible in the browser even though the UI hides it. Closing this means moving the
  engine to a Supabase **Edge Function** referee: clients send actions, the server
  validates + holds the true state, and pushes each player only a **redacted view**
  (own hand full, opponents as counts, deck face-down). Also kills all cheating (RNG,
  state tampering). Decision (Karim): the group is trusted ("I trust them"), so the
  real-world risk is nil — not worth the rebuild. **Revisit only if** the play turns
  competitive, someone would actually peek, or it opens beyond the friend circle.
- Spectator experience is bare — read-only board, no "you're spectating" banner, no hand bar.
- Disconnect handling is basic — rejoin reclaims your seat (persistent identity), but a
  player who fully vanishes on their turn stalls the table; no skip/boot escape hatch.
- Post-game flow is minimal — one "Back to lobby" resets the table for everyone.
- Presence flickers when phones sleep/background (realtime times out ~30s).

### Feature ideas — requested by Karim (2026-06-22), not yet scoped

Captured to the backlog before they're forgotten; not prioritized or designed yet.

1. **Surrender / concede.** A player signals they want to surrender; if **all other
   active players agree**, the game ends. Needs: a "request surrender" action that
   notifies the table, an agree/decline prompt for everyone else, and end-the-game
   when unanimous (excluding the surrenderer). Online lives in the `games` row /
   realtime; decide what "ended" looks like (no winner, or remaining leader wins?).
   Edge cases: spectators don't vote; a second surrender request; someone disconnects
   mid-vote.

2. **Broadcast message.** Let a player write a quick limited note everyone sees.
   Constraints (Karim): **~50 char max**, and **only 3–5 total broadcasts per player
   per game** (pick a number). Ephemeral, toast-style on every client. Implementation:
   a realtime broadcast (or an event field on the `games` row) + a per-player counter
   in game/seat metadata. Keep it from being spammy; no history needed.

3. **Wire the remaining in-game settings.** Music is wired. Still to do: **Sound
   effects on/off** (gate `playSound`), **Animation speed slow/medium/fast** (scale
   the durations in dice/fly/countdown/zoom animations off `SETTINGS.anim`), and
   **Auto-zoom on/off** (gate the automatic board zoom-to-action). All per-device via
   the existing `SETTINGS` localStorage object.

4. **Leaderboard — total wins, split by player count.** Counts total wins per player
   for **3-player** and **4-player** games **separately**. Complex; Karim will share
   more specific requirements. Needs a persistent results store (a `results` table or
   a `wins` column keyed by identity + player-count), written at game end. Tie into
   the persistent `players` identities already in place.

5. **Player tendency stats.** Track each person's tendencies across games — e.g. who
   most often gets **Longest Road**, who most often gets **Largest Army**, etc. Likely
   the same persistent store as the leaderboard: aggregate per-identity counters
   recorded at game end (longest-road wins, largest-army wins, avg final points,
   dev-cards bought, robber-on-others, …). Surface in a stats/leaderboard screen.

6. **Special win celebrations.** Variant victory screens for notable wins — e.g. a
   **"Domination"** celebration when every other player is held **under 10 points** at
   the win. Detect the condition at game end and branch the victory screen (extra
   confetti/title/sound). Room for more variants (wire-to-wire, comeback, shutout).

7. **2-player and 5-player games.** Same standard map, **just a different score total**
   (Karim). 2-player: the engine already allows 2 as a house rule (`setup.ts`); needs
   UI/seat support + its own target points. 5-player: needs a 5th seat colour/avatar
   slot and a target-points value; keep the same board (no expansion geometry). Set
   `targetForCount()` accordingly.

### Older notes (some now done — left for history)

- 3–4 players only (base game). 5–6 needs the larger board + special build phase.
- Player-to-player trade: engine yes, UI no.
- Roads aren't image-swappable; dice/cards are drawn/text.
- No sound yet.
- Board port positions are deterministic but not matched to any specific art.
- No persistence of finished-game history.

---

## 9. Continuing in Claude Code — first steps

1. `cd engine && npm install && npm test` — confirm 19 green.
   - **Platform-binary gotcha:** `engine/node_modules` was populated on Linux, so
     the committed `esbuild`/`rollup` native binaries are wrong-arch on macOS. If
     `npm test` dies with "Cannot find module @rollup/rollup-darwin-arm64", run
     `npm install @rollup/rollup-darwin-arm64`. `build.mjs` already auto-resolves the
     correct `@esbuild/<host>` binary, so the standalone build is unaffected.
2. `cd ../prototype && node build.mjs` — rebuild artifacts; open `index.html`.
3. Read `app.js` top-to-bottom once — it's ~500 lines and self-describing; the
   `render()` and `dispatch()`/`afterAction()` functions are the spine.
4. Start Phase 3: stand up Supabase, add a `lib/net.js` (load state, subscribe,
   write-on-action), and replace the start screen with create/join + lobby.
5. Keep the engine untouched as the source of truth; everything new is UI + sync.

The engine is the hard part and it's done and tested. Most remaining work is
front-end and wiring.
```
