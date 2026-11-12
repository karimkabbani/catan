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
| Rules engine (base 3–4 player Catan) | **Done, tested** (`cd engine && npm test`) |
| Playable UI (pass-and-play, one device) | **Removed in v175** — online only now |
| Drop-in art system (tiles, tokens, ports, pieces, icons, avatars, robber, sea, logo) | **Done and wired** |
| Art skinned from the official Catan iOS app | **Done (2026-06-17)** — Mayfair terrain, ripped pieces/ports/robber/avatars/logo/sea. Player colours switched to red/blue/green/yellow to match authentic art. Tokens use drawn discs (see ASSETS-CHECKLIST). Re-rip via `source material catan ipa/Catan_assets/tools/slice_for_webapp.py`. |
| Authentic HUD pass | **Done (2026-06-17)** — Fertigo Pro font, wood-textured panels/dock/overlays/buttons, real resource-orb bar, red dice faces, framed build-menu buttons, dev-card faces, stat badges (longest road / largest army / VP). HUD sprites in `assets/hud/`, ripped via `tools/slice_hud.py`. iOS CgBI-format loose buttons can't be read by PIL (skipped; styled with wood texture instead). |
| Full visual pass (A-to-Z) | **Done (2026-06-17)** — Title scene (cloth banner + wood table + character medallions, `#title` layer); board reworked to float on open sea with coastline glow + island shadow + dock-style ports + subtle CSS-3D tilt (`#board rotateX(13deg)`); roads now rotated wooden sprites (`road-eastwest-<color>`); all overlays themed with real resource icons + slide-in; victory screen (crown + winner avatar + standings); motion — dice tumble, piece pop-in, active-panel pulse, board/overlay entrance, water shimmer. Ceiling: true 3D piece models + physics animation would need a WebGL rebuild (not done by design). |
| Asset cropping tool | **Done** (`prototype/tile-cropper.html`) |
| Multiplayer (own-phone, online) | **Done (2026-06)** — Supabase realtime; persistent PIN identities; lobby of concurrent games; spectators; surrender; broadcast chat. Live at karimkabbani.github.io/catan |
| Player-to-player trade UI | **Done** — propose (`offerTrade`) → others respond/accept (`confirmTrade`); bank/port trades too |
| PWA packaging + deploy | **Done** — service worker (cache-first art, network-first code), installable, deployed via `./deploy.sh` to GitHub Pages |
| Sound | **Done** — SFX (gated by a setting) + a 3-track looping music playlist |
| Auto-zoom / cinematic camera | **Done (2026-06-30)** — camera follows the action; card counts tick with the animations |
| Board generation | **Done** — official Variable setup (random + 6/8 rule) + balanced house rules (pip-cap, no duplicate-number adjacency) + randomized harbours |

Phase 3 (multiplayer) is shipped and live; current work is gameplay/animation polish.

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
- `rotate.html` — the sideways-board host (§8 items 63-67). index.html sends every signed-in player here at launch;
  it runs the app in an iframe and turns that frame 90° while the board is up and the phone is upright.

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

Layout is landscape. On a phone held upright, rotate.html turns the whole app sideways while the board is up
(§8 item 63), so the "rotate your device" overlay (a CSS media query, portrait + touch) now only shows if the app
is opened without the host page, e.g. the standalone file. Seats map to corners `tl, tr, bl, br`; the active player is
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
- **Pause, save and resume games (idea logged 2026-10-25, NOT started: Karim isn't ready to invest yet).**
  Goal: any game (single or part of a cup) can be paused and resumed later, even days later, without blocking
  new games in parallel. Proposed design:
  1. Every new game gets its own code (stop reusing HOME_CODE 'TABLE'), so a saved game never blocks a table.
  2. **Saved games** (step 1, lower risk): a `paused` phase on the `games` row; no 6h purge for paused rows (expire
     after ~30 days); a game with nobody online for ~30 min becomes paused automatically (replaces "abandoned");
     Play tab gets a "Saved games" list (players, score, cup game N of M, paused when, Resume ›); Resume = everyone
     in the game back + ready-up (like the rematch bar), then 3·2·1 and play continues exactly where it stopped.
     Deleting a saved game needs everyone's agreement. Cups pause as a whole; stats only on a finished game.
  3. **Pause button** (step 2): in the radial menu's left arc; any player pauses instantly; full-screen "⏸ Paused
     by Kay" card on every phone with Resume / Back to lobby; no moves, clocks or offline bar while paused.
  Open decisions for Karim: who can pause (proposed: anyone, instantly); resume needs every player present
  (proposed: yes); auto-save when everyone leaves (proposed: yes, after 30 min).
  Risks (why it's a careful build, ~1 day + regression sweep): (a) moves slipping through in the seconds before
  every phone sees the pause, or from phones on older versions; (b) every stored deadline (RPS/poker picks, the
  who-starts position choice, quit vote 5 min, rematch 30s, turn clock, 3-min offline bar) is long expired on
  resume and would fire at once; (c) the app assumes one game per player (NET.code, findMyGame's single card);
  (d) pausing mid-discard/robber/free-road/trade must restore the right prompt on each phone; (e) the 6h purge and
  "abandoned" semantics change. Mitigations: a database trigger that refuses any state write to a paused row
  except the resume (closes (a) for every version), an engine rule refusing actions while paused, shifting every
  deadline by the pause length on resume, showing Pause only when every phone in the game is on the new version,
  and a regression sweep focused on (a)–(e).
- ~~Spectator experience is bare~~ → **fixed (v60)**: a spectator dock strip ("👁 Spectating — X's
  turn" + Leave), a `body.spectating` class driving the chrome, and the existing banner. No hidden-info leak.
- **A player who vanishes on their turn — policy, not a skip (v61).** Decision (Karim): a stalled game is
  NOT force-skippable. A game only counts in stats when it ends **properly** — a points win or a
  surrender/last-man-standing. If a player drops and the others can't continue, someone hits Leave and the
  game is **abandoned**: it ends for everyone and is **never recorded**. (The v60 `forceSkip` engine action +
  AFK "Skip turn" bar were removed in v61.) Mechanics: a seated player's Leave idles the games row (no
  winner → `recordResult` never fires); the Leave dialog says "counts as abandoned — not recorded in stats";
  remaining players get a "Game abandoned — not recorded" toast (onRow idle branch, when local state wasn't
  `ended`). A fully-abandoned row (everyone gone) is cleaned by the existing `purge_stale_games()` RPC.
- ~~Post-game flow is minimal~~ → **fixed (v60): Rematch button** on the victory screen restarts the same
  seated players + win target with one tap (`LOBBY.rematch()`, version-guarded; onRow replays the 3·2·1
  intro for everyone). "Back to lobby" still there.
- ~~Presence flickers when phones sleep~~ → **softened (v60)**: a 22s grace window keeps a briefly-dropped
  member in the roster (dimmed, "away…") instead of reshuffling, and we re-track presence on wake
  (visibilitychange/focus/online). A 3s heartbeat sweeps expired grace entries.

### Feature ideas — requested by Karim (2026-06-22)

Status as of 2026-06-30. ✅ shipped · ◐ partial · ☐ pending.

1. ✅ **Surrender — SHIPPED as a white-flag concede model** (replaced the original vote idea).
   Each player raises/lowers their own white flag any time (🏳️ waving beside their corner +
   a toast to the table). When everyone-but-one has conceded, the lone player **still standing
   wins** (last-man-standing, not points leader). Coordinated through the `games` row
   (version-guarded), **not** realtime broadcast — broadcast dropped votes. State: `state.sv.flags`.

2. ✅ **Broadcast message — SHIPPED.** "Say" in the radial (online seated players), 50-char,
   3 per player per game. Renders as a chat bubble anchored to the speaker's corner avatar
   (close ×, ~7s). Realtime broadcast, table-scoped. Delivery reliable in practice so far.

3. ✅ **In-game settings — sfx + animation speed + auto-zoom ALL SHIPPED.** SFX gates `playSound`;
   animation speed scales JS-timed animations via `aScale()`; **auto-zoom** now drives the cinematic
   camera (see "Shipped 2026-06-30" below).

4. ✅ **Leaderboard — SHIPPED.** Real `game_results` store keyed on persistent identity; the Stats screen
   shows GP / W / Win% / **WAE** (wins-above-expected, normalised for table size) and a per-player detail
   view (streak, H2H, bonuses). **v62–v66:** month/year season selector (adaptive single-row → year+month
   rows at scale, chronological order, auto-scroll to selection); **v60:** 2p/3p/4p size filters. **v67:**
   the season-crowns column was removed at Karim's request (kept the code lean).

5. ✅ **Player tendency stats — SHIPPED** as the per-player detail screen (tap a name): longest-road /
   largest-army counts, avg place, current/best win streak, head-to-head records.

6. ✅ **Special win celebrations — Domination SHIPPED.** Every rival held under 10 at the win →
   gold DOMINATION badge + extra confetti + a second fanfare. Room for more variants later.

7. ◐ **2-player SHIPPED (15-pt target); 5-player pending.** 2p is in the setup + engine
   (`targetForCount(2)=15`). 5p is blocked on art — piece sets exist for only 4 colours; a fifth
   player needs a full 5th-colour set + a target value.

8. ☐ **Game history / replay — PARKED (2026-10-20), not worth building now.** Idea: chess.com-style
   ← → through past moves. Feasible because the engine is a deterministic reducer with the RNG in
   state: log each action (~65 B, ~20–40 KB/game) and replay from the start state. Hard parts are the
   UI, not the data: step by TURN not by action (Catan turns are 5–15 micro-actions), highlight what
   changed, and render a past state without disturbing live sync. Also log the non-engine mutations
   (surrender flags, flag-win, quit) or replays end wrong. Hidden info: full reveal post-game only; in
   game it would have to stay public-only. Discussed options, in order of cost:
   a. **Turn history sheet (in-game "what did I miss")**: tappable newest-first list grouped by turn,
      built on the banner feed + `state.log` + `state.rolls`, plus structured production/steal events.
      Cheapest fit for the in-game need.
   b. **VP-over-time chart** on the victory screen, key moments marked.
   c. **Full post-game replay** with full reveal; optionally store moves to rewatch from Stats.
   Revisit if people keep asking "what just happened?" mid-game (→ a) or argue about how a game was
   won (→ b/c). Whatever is built first, start logging actions early: history only exists from then on.

9. ☐ **Undo by unanimous vote — DESIGNED, promising, not built (2026-10-21).** For misclicks.
   - **Scope:** only YOUR last action, only while nobody else has acted since. Chained actions undo as
     one unit: Knight = play + robber move + steal; a 7 = robber move + steal.
   - **Undoable:** end turn, build road/settlement/city, bank/port trade, player trade, Year of Plenty,
     Road Building, steal, Monopoly, Knight (Karim's call: the group is trusted and the victim votes).
   - **Never:** dice roll, buying a dev card, the game-winning move. (Seeded RNG means re-stealing from
     the same victim yields the same card, so undo can't fish for a better card — only leak knowledge.)
   - **Vote:** unanimous ✓ from every other seated player. One ✗ cancels. 30s with any non-answer
     cancels (never auto-approves; just keeps the game from hanging). Requester can cancel. Game is
     frozen while a vote is open. No per-game limit.
   - **Entry point:** after an undoable move, an 8s bar bottom-centre above the hand, only for the actor:
     "Ended your turn · ↩ Undo" (always names what will be undone). After it fades, a ↩ stays in the
     radial menu while the undo is still valid. Not in the banner (crowded, shared space). Voters get a
     top card "Kay wants to undo: Ended turn · ✓ Allow / ✗ No (0:27)"; the requester sees
     "Waiting for Sam, Alex… · Cancel".
   - **Build notes:** the writer of an undoable action stores the pre-action state in the row (minus the
     board, which never changes, a few KB), cleared by the next action. Vote via the svUpdate /
     surrender CAS pattern; the final approver restores. Mark the restore (`state.undone` nonce) so
     applyRemoteState skips its fly/steal/robber detectors and just snaps back + toasts. Next player
     rolling before the vote = undo gone (correct). Effort: medium.

10. ✅ **Rock-paper-scissors to decide who starts — BUILT v161 (2026-10-22).** Lobby switch for the host; since v162
   guests see it too ("Win at 11 pts · Who starts: ✊ …") via `lobby_presence.ws` (`server/migrate-whostarts.sql`,
   applied by Karim in the SQL editor 2026-10-22).
   v164: the reveal is on the board (hands beside corners). v165: 10s first round. v166: the winner CHOOSES their
   position (1st–4th, 20s, default 1st); others keep table order, rotated to fit (`rpsChooseMut`). `state.rps` + `rpsUpdate`/`syncRps`; engine refuses moves until done; demo: `?rpsdemo`.
   v171: once every player has picked, the round reveals after a 1s beat (`RPS_ALLIN_MS`) instead of waiting out the
   clock; picks lock at that point (you can change yours until the last person picks). 2-player games get the same
   "When do you go?" choice (1st / 2nd).
   - **Lobby option** "Who starts: 🎲 Random / ✊ Rock-paper-scissors", default RPS. Online only
     (pass-and-play keeps the spinner, since picks would be visible). Also runs before rematches.
   - **Round:** everyone gets ✊ ✋ ✌️ + a 5s countdown; picks hidden until a simultaneous reveal over
     each portrait ("Rock… paper… scissors… shoot!"). Exactly two shapes thrown -> the winning shape's
     players survive, the rest grey out. All same or all three shapes -> "Again!" with the same players.
     Survivors replay until one remains; they go first and turn order continues around the table.
     4 players resolve about half of rounds -> expect 2–3 rounds, ~15–20s.
   - **No pick in 5s:** the game throws a random hand for them (never eliminates), and makes it obvious:
     auto hand shown faded with a 🎲 badge + "Kay didn't pick: random ✋"; their own screen says "You
     didn't pick in time, so the game threw ✊ for you"; if it wins: "Kay goes first (on a random pick 🎲)".
   - **Decided 2026-10-22:** you can change your pick until the 5s end (last tap counts); the game's
     creator sets it next to the points target ("Who starts: ✊ Rock-paper-scissors | 🎲 Random", others see
     it read-only, the Start button reads "· ✊ who starts"); rematches keep their 5·4·3 countdown and then
     run RPS; 5 tied rounds -> the game picks at random among survivors ("too many draws, the game
     decides 🎲"); spectators watch the reveal; turn order goes around from the winner, setup snakes as
     usual. Lobby mockups on the canvas above.
   - **Build notes:** a pre-setup `state.rps = { round, alive: [colors], picks: {color: 'r'|'p'|'s'} }`
     via the svUpdate CAS pattern; each phone writes its own pick; once all alive picked or the 5s
     lapse passes, any phone resolves (CAS = once). Group is trusted, so picks in shared state are fine.
     Engine needs a helper to rotate `order`/`setupOrder` to the chosen first player before any setup move.

11. ✅ **The robber wears the thief's face — BUILT v160, reworked v165 (2026-10-22): the robber's own body
   (`assets/robber-body.png`, head + hat cut away) with the thief's face as a big round head, no horns.** (`state.robberBy` /
   `robberVictim` in the engine; `robberTokenSVG` on the board; `robberFlySrc` flies it for uploaded photos only,
   built-in portrait files fly as the classic robber; tap -> toast "X put the robber here and robbed Y".) Whoever last moved
   the robber (7 or Knight) is shown on it: their profile photo in a round token with a black bandit
   eye-mask drawn over it (no photo -> initial on their colour, masked). Start of game = the normal robber
   on the desert. Follows the robber everywhere (board, the fly animation, Who robbed who). Tap it:
   "Sam put me here · robbed Karim". Profile photos already exist -> low cost.
   - **Update 2026-10-22 (mockups: claude.ai/artifact/NRTc83WMEbQWPfp2UtYmNB):** the eye-mask was dropped,
     since it can't line up reliably on real photos. Direction is **option C: nothing on the face**. The
     photo sits untouched in a red ring with **devil horns** on top (cheeky, works on any photo, no setup).
     The robber keeps its current spot at the hex centre, covering the number as today (Karim: keep it).
     Photo size isn't a concern (avatars are already-loaded ~10–40 KB squares).
   - **Open decision:** full horned token replacing the robber, or a horned badge on the classic figure.

12. ◐ **Walkie-talkie — built v208, rolled back v209, back with the iPhone earpiece fix in v210 (2026-11-06); see items 42-44.** Original notes (2026-10-22): A 🎙 next to your portrait:
   tap to start talking (red "LIVE" ring on your portrait), tap to stop, auto-cut at 15s. Not hold-to-talk
   (voice notes dropped press-and-hold in v87 because it was fragile on iOS). Speaker's portrait pulses
   sound waves while their audio plays; two speakers at once both play. Settings toggle "Walkie-talkie
   sound"; a muted player shows 🔇 so others know.
   - **Engine options:** A) near-live: ~1s chunks uploaded while talking (reusing the voice-note storage +
     messages plumbing) and auto-played as they land, ~1–2s delay — recommended start. B) true live
     (WebRTC) needs a TURN/relay server for mobile networks — more setup + possible running cost.
   - **Main risk:** iOS blocks audio that starts without a tap; the v131 audio-session keepalive should
     allow auto-play, but test on real phones first.
   - **Open decisions:** start with A? Auto-play incoming audio by default, or muted until each player
     opts in?

13. ✅ **Quick tournament ("cup") — BUILT v169 (2026-10-23). Series format only** (Karim: heats/king-of-the-table
   won't be used; mockups of all three on the canvas). Host picks Format "One game | 🏆 Tournament" at the table,
   games (default 3, 2–9) and each game's target (slider goes down to 6 in cup mode). Rides presence as `ws = 'cup:N'`
   (no schema change); guests see "🏆 Tournament · 3 games, each to 7 pts".
   - `state.cup = { name: "<host>'s Cup", games, n, host: playerId, hist: [{place, vp, robbed}], stop }`, carried game to
     game by `LOBBY.rematch`. Points per finish 3·2·1·0 (3p: 3·1·0, 2p: 3·0). Ties: games won, then total VP.
   - RPS decides who starts every game. Between games the rematch vote becomes "✓ Ready for game N": no time limit,
     the cup waits for everyone. Mid-game drop-outs: the game just waits (existing behaviour).
   - "Step away" from the between-games screen doesn't mark you as left; the table lobby then offers
     "🏆 Back to <cup> · game N next" (`LOBBY.cupRow`, `CATAN.cupRejoin`). Host (or anyone, if the host is offline)
     can "End the cup now": standings so far are final. Starting a new game over a paused cup needs a second tap.
   - In game: 🏆 points beside every corner + a "game 2 of 3" pill. Final: champion screen with per-game medals,
     tie-break line, cup-long awards (Robber magnet, Most points scored), "Rematch the cup".
   - v170: Who starts is a choice in cups too (presence `ws = 'cup:N:r' | 'cup:N:x'`; old 'cup:N' reads as RPS).
     **Cup stats:** each cup game's `game_results.standings[i].cup = { id, name, n, of, cp, cr }` (running cup points
     and rank); `STATS.cups()` rebuilds every cup from its latest game. Stats tab shows "Cups · all time" (winners +
     list); a player's page shows "Cups won X of Y". Only cups started on v170+ carry an id; earlier ones fall back to host+name.

14. ✅ **Lobby redesign — BUILT v170 (2026-10-23). Screens only, same plumbing** (mockups: canvas rows "Lobby
   redesign" + "Host flow"). Three tabs: **Play · Chat · Stats** (`LV.tab`), slim header (CATAN + avatar → profile;
   "Switch player" moved into the profile).
   - **Play** (not at a table): one hero card for what's happening now: a gathering table (seats + settings line +
     Join / Just watch), else a live game (Watch), else "Nobody's playing yet · Start a game". Then other tables,
     who's online, the latest chat message, "Play on one phone".
   - **Room** (at a table): 2×2 seats from `readyList()` (👑 host = creator, else first seated), tap your own seat for
     colour (+ Any), lines for first-in-line / here-not-seated / watching, one settings line (host: Edit → bottom
     sheet with Format, games, points Auto + buttons, Who starts), one primary action. Paused cup → cup card.
   - **Mapping to the old plumbing:** "Join" = `enterTable` + ready; "Just watch"/"Watch" = `enterTable` + spectate
     (a running game takes spectators straight in); "Take a seat"/"Leave seat" = `lobbyReady`; "Start a game" =
     `lvStart` (offers a gathering table first via the guard sheet, else the standing table `TABLE` if nobody's
     there, else a new code), with `LOBBY.created` set so the starter hosts. Main Game / separate game are gone from view.
   - **Chat** tab: bubbles (newest at the bottom), unread badge (`LV.chatSeen`, localStorage), a Join/Back strip.
   - **Stats** tab: the existing stats screens draw into the tab via `statsOut()`.
   - Old renderers removed: `tableListHTML`, `atTableHTML`, `lobbyRows`, `lobbyChatHTML`, `CATAN.newTable`/`guardJoin`.

15. ✅ **Quits made clear — v172 (2026-10-23).** Stats column "Pen" renamed "Quits" with a note under the table
   (walked out mid-game: the game ends, the quitter is counted last as a loss, the points leader gets the win; the
   number itself doesn't change any ranking). The quit dialog names who will win ("Sam wins as the points leader
   (7 VP)", button "Quit · finish last"); the results screen shows a 🚪 note and lists the quitter last (`finishOrder`,
   `quitLeader`, `quitNoteHTML`). Also fixed: the Domination badge showed after any quit and in every game to under
   10 points; it now needs a real win in a game to 10+.

16. ✅ **Everyone in the lobby — v173 (2026-10-23).** The Play tab's "Friends · N online" grid shows every registered
   player (`AUTH.list()` = the `player_list` RPC, refetched at most every 2 min into `LV.roster`): online ones first
   with what they're doing, the rest greyed out as "offline". Matched to presence by name (the RPC returns no id).
   v174: tap any face -> that player's Stats page (`CATAN.lvStatsFor`, by id, else by name; no games -> toast).
   Stats "Head to head" now carries a note: who finished higher, in every game you both played (any size, all time).

17. ✅ **One-phone play and demos removed — v175 (2026-10-23).** Karim: not needed. Gone: the "Play on one phone"
   link, "Pass & play offline" on sign-in, the offline New Game screen (`startScreen`, `CATAN._start/_setCount/demo`),
   `CATAN.restart`, and every demo (`?rig` / `rigNearWin`, `?showcase` / `showcase` + `demoEcho`, `?rpsdemo` / `rpsDemo`
   + `rpsBots`, `demoMode`, `exitDemo`). If the server can't be reached, sign-in now says so instead of falling back
   to offline play. The in-game `online` checks stay (they're woven through shared code). app.js 5,628 -> ~5,310 lines.

18. ✅ **No more ghost "playing" — v177 (2026-10-23).** Seen live: Lapen sat on a results screen for 14 min, then
   backgrounded, and kept showing as "playing". Presence `mode` now follows the game (`afterAction`): `'results'` on
   the results screen ("just finished"), back to `'playing'` on a rematch. `lvTables()` only treats a table as live
   if a `playing` member isn't away (heartbeat < 18s), and drops tables with nobody actually in the room, so
   just-finished / gone-quiet tables get no card. Rooms show "🏁 X · still on the last game's results". The 5-min
   presence drop-off is unchanged (shorter would flicker people mid-game). Old clients read 'results' as not playing.

19. ✅ **"Go!" nudge — v178 (2026-10-23).** Seated guests get a big **Go!** under "Waiting for X to start". It sends a
   `messages` row (`type 'go'`, code = the table) via `LOBBY.sendBroadcast`; `NET.onMsg` routes it to `lvGoIn` (lobby
   only, ignored in a game). Host: toast "👉 Ramzi: Go!" + vibrate; every phone in the room: "👉 Go!" pops on the
   nudger's seat for 6s; host's Start reads "· N want to go" (nudges in the last 2 min). 15s cooldown per player.

20. ✅ **Pinned rematch bar — v180 (2026-10-23).** (Mockups: canvas row "Rematch: a pinned bar nobody can miss".) The vote
   moved out of the bottom of the results card into `#rmbar`, fixed at the top over the results AND the board
   (`rmBarModel` / `syncRmBar`, ticked every second; only rewritten when its content changes). States: asked
   ("Sam wants a rematch · 0:24", chips ✓/…/💤, I'm in / Not this time), you're in ("Waiting for…"), all in (green,
   "Rematch starting…"), no / lapsed (red, 4s, then slides away). Chime (`trade` sound) + vibrate once per question
   for whoever didn't ask. Cups between games use the same bar ("🏆 Kay's Cup · game 2 of 3 · Ready for game 2");
   the card keeps only "End the cup now". "View board" is no longer yanked back to the results. The card's
   "Rematch? Ask the table" moved up under the winner's name.

21. ✅ **Lobby tab bar flush to the bottom — v181 (2026-10-24).** Karim's iPhone 16 Pro (home-screen app) showed a
   ~63pt band under the tab bar. Diagnosis from the screenshot: the band = the TOP safe area (status bar / Dynamic
   Island, ~62pt), not the bottom one (34pt). The iOS home-screen app reports a layout viewport shorter by the
   status-bar strip, so `position:fixed; inset:0` stops short; the old `bottom: -safe-area-bottom` hack on `#title`
   corrected by the wrong amount. Fix: `fitAppHeight()` sets `--app-h` from `screen.width/height` (by orientation)
   only when `navigator.standalone`, and `html.ios-pwa #title.lvmode` sizes from the top to it. In the lobby
   (`#title.lvmode`) the tab bar owns the bottom edge (bottom:0, no title padding; `.lvtabs` pads by the safe area),
   so browsers and Android are flush too. Safety net: `body.inlobby` paints the tab-bar colour under it. The game
   board (landscape: no status bar) and the card screens (sign-in, profile) are untouched.
   **v182 correction:** v181's full-height sizing clipped the tab labels: iOS also only DRAWS fixed content down to
   the short viewport's bottom. Now `fitAppHeight` only measures the gap (`--vp-gap` = real screen height minus
   `innerHeight`) and the lobby stays inside the drawable area; the tab bar's bottom padding becomes
   `max(8px, safe-area-bottom - gap)` (the cut-off line already sits above the home bar), and `body.inlobby` paints
   the strip below in the tab bar's colour so it reads as one bar to the edge.

22. ✅ **Quit vote + Stats redesign — v183 (2026-10-24).** (Mockups: canvas row "Stats redesign (no more Quits)".)
   - **Quit vote:** a mid-game quit now opens `state.qv = { deadline (5 min), votes, done, count, auto }`. Everyone still
     in the game votes, the leader included; it must be unanimous ("Everyone must agree" in the pinned bar). All yes ->
     counted (leader's win, quitter last); any no -> not counted at all (no `game_results` row). Timeout -> counted
     only if the leader was within 2 points of the target (`qvNearWin`), settled by any phone still on the results.
     `recordResult` waits for the vote; the quitter's phone no longer records. Card title reads "Game ended early" /
     "Game not counted" until it counts. Rematch waits for the vote. Limitation: if every phone leaves before it
     settles, that game is never recorded. Pre-v183 clients still record a quit immediately.
   - **Stats:** "Quits" column + note removed (the penalty flag is still stored per row). New `statsScreen`: month
     chips + "All sizes" select, podium for the top 3 ranked (photos from `LV.roster`), photo leaderboard rows with a
     win-% bar, cups card, recent games with "Today 22:31 / Yesterday" (`g.at`). New `statsPlayerScreen`: big win %,
     last-10 W/L strip, tiles (avg place, streak, cups, Longest Road, Largest Army, times 2nd), head to head with split
     bars. Numbers use the system font (the display font draws 1 like a Roman I).

23. ✅ **Tournament names — v184–v186 (2026-10-24).** v184: Stats shows the year ("All-time · 2026 · Oct", headings
   "October 2026"). v185: cups get a random name from the group's slang (`CUP_NAMES`, `pickCupName` skips the phone's
   last 6), editable in the settings sheet (+ 🎲 reroll); "3-game tourney · Oct 24" shows underneath (`cupSub`,
   `cup.at`). Old "X's Cup" names display as "N-game tourney" (`cupTitle`). The 24 Oct cup was renamed in the DB to
   "First Tourney" (jsonb update of its 3 `game_results` rows, 2026-10-24). v186: a name already used gets the next
   number on Start ("Yalla Classic #2"; `uniqueCupName`, checked against `STATS.cups()`, case-insensitive).
   Also 2026-10-24: Karim deleted the 14 Kay-vs-test games himself (SQL editor); the "test" player stays.

24. ✅ **Poker hand for who starts — v187 (2026-10-25).** (Mockups: canvas row "Poker hand".) Third "Who starts"
   option (`whoStarts: 'poker'`; presence `ws 'poker'`, cups `cup:N:p`). Rides the RPS machinery: `state.rps` with
   `kind: 'poker'`, `deck`, `hands`; `picks[c]` = 'k' kept / 's<N>' swapped. 15s (`POKER_MS`) to tap up to 3 cards
   and swap once (`pokerSwap` draws from the shared deck inside one `rpsUpdate`, so simultaneous swaps can't clash);
   undecided players keep their hand. `pkScore` ranks 5-card hands (A-2-3-4-5 straight, kickers); exact ties deal
   again for just the tied players (5 rounds max, then random). Reveal 5.2s with each hand beside its corner
   (`pkBoard`), then the same winner-chooses-position flow. CSS-drawn cards (`.pkc`). Old clients can't render a poker
   start: everyone should be on v187.
   **Build fix:** `build.mjs` inlined app.js with a string `replace`, so `$&` in app.js (v186's `uniqueCupName`)
   mangled `catan-standalone.html` (the live site loads app.js directly and was unaffected). Now uses function
   replacers.

25. ✅ **Bug sweep — v188 (2026-10-25).** Lint + three parallel code reviews (sync/votes, lobby, who-starts/stats). Fixed:
   - `svUpdate` now applies the merged server state locally after a write (and when its mutation is a no-op but the
     server is newer); own echoes are deduped by version, so near-simultaneous taps (rematch/quit votes, GG, RPS
     picks) used to vanish on the second phone. Only applied if the phone is still in that game.
   - Quits: the quitter goes into `state.left` (an honest "rematch isn't possible"), a quit stops a cup
     (`cup.stop`), quit-vote voters exclude anyone who left, an empty voter list settles by the near-win rule,
     leaving the results (`markLeft`) re-checks the vote (and records first if it now counts), the 5-min timeout
     settles on the server (no local pre-record), and `cupHist` skips a quit game until it's counted.
   - Lobby: `cupRow` comparison (null vs undefined) rebuilt the room every poll; Start has an in-flight guard and a
     version-guarded write (no double boards); `LOBBY.created` resets unless entering the room you created;
     phones asleep (`away`) aren't dealt in; reopening during a paused cup returns you to that table
     (`catanLastTable`); sheets don't rebuild while you type; lobby chat first-loads the newest 50; own message
     not duplicated.
   - Stats: cups carry `fin`; only finished cups count as "won" / in the tally; others say "unfinished".
   - Who-starts: `rpsMode` returns 'gone' once setup has begun (no ceremony replay after reopening).
   - Hardening: `escapeHtml` escapes `'`; `faceHTML` only accepts image data URLs / `assets/` paths (`safeImg`);
     table codes must match `^[A-Z0-9]{4,6}$` (`safeCode`).
   - Not fixed (minor): ghost click after `data-nav` pointerup, phone-clock skew on deadlines, silent poker-swap
     failure after 6 retries, settings/chat-read marker shared across users on one phone, dead code (`actionsBar`,
     `recentRowsHTML`, `cameraPanTo`, `cinematicHex`…).
   - Repo `CLAUDE.md` added so cloud/phone Claude Code sessions follow the same rules.

26. ✅ **v189–v191 (2026-10-25).** v189: poker swap is any number of cards (five-card draw), not up to 3.
   v190: **Ranked / Friendly** ("Counts in stats?") in Game settings: `LOBBY.friendly` (resets to Ranked on every
   `enterTable`), carried as `state.friendly` (rematches keep it), presence `ws` gets a trailing `:f` / `f`
   (`wsInfo` parses it); `recordResult` skips friendly games; in-game pill "🤝 Friendly game · not in stats";
   results note. Older clients would still record a friendly game. v191: tab bar redesign: the selected tab's
   icon sits in a gold pill, others greyed (`.lvico` only, so the unread badge stays red).
27. ✅ **v192–v193 (2026-10-25).** v192: poker is hold-and-draw (tap the cards you KEEP, marked HELD; Draw
   replaces the rest; `rpsLocal.sel` = held indices). v193: radial menu tidy (Karim kept the four original
   icons): Build top, Trade right, End turn bottom, Cards left, evenly spaced; Settings / Dice stats / Leave
   ("Stop" for spectators) are a labelled black-and-gold arc left of the ring (`.radbtn.util`, Leave has a red
   edge). The always-on `#dicetab` and the far-left `#settingstab` gear are retired (elements kept, always
   hidden). Off-turn during play the ring still shows, Build/Trade/End greyed, Cards lit: `openDev` shows MY
   hand and is view-only (`'wait'` taps toast, no Buy, "View only" pill). Rejected: refined ring with new
   icons, side panel (B), tray under the ring (covered the resource bar).
28. ✅ **v194 (2026-10-25).** Offline players. Bug: the in-game online dot used "in the presence roster", which
   keeps an 'away' entry for 5 minutes, so a player who closed the app stayed green. `isPlayerOnline` now uses
   only `LOBBY.liveIds` (heartbeat < 18s). New: once a seated player has been offline `ABSENT_MS` (3 min, timed
   per phone in `offSince`), the others get a pinned bar "💤 Kay has been offline for N min · End the game"
   (`rmBarModel` play branch, refreshed from `applyPresence`). `endByQuit(absent)` ends it on their behalf:
   leader among the rest wins, all absent colours go into `left`, `state.quitAbsent` changes the wording
   ("went offline"). Ranked: the usual unanimous quit vote. Friendly: no vote (qv pre-settled as not counted),
   also for a normal friendly quit, whose confirm text now says nothing is recorded.
29. ✅ **v195 (2026-10-25).** An offline ending (`endByQuit(absent)`) never counts, ranked included: no vote,
   qv pre-settled as not counted (in 2 players the only voter was the one who'd gain). Only a real Quit can
   count against you. Way back into a game after the app was closed: `LOBBY.findMyGame` (on join, then every
   10s from the lobby heartbeat) reads `games` rows with phase 'playing' (`state->left`, `state->>phase`
   selected via PostgREST) for one where I hold a seat and haven't left; the Play tab then leads with
   "YOUR GAME IS STILL ON · Back to your game" (`CATAN.lvRejoin` = `enterTable`, and `NET.onRow` seats me).
   That game is dropped from the "Watch" rows. Works even when nobody is online (it doesn't rely on presence).
30. ✅ **v196 (2026-10-25).** Past games' final boards. `recordResult` also saves `final` = `finalSnapshot(state)`
   (the whole ended state minus `SNAP_DROP`: rng seed, undrawn deck, who-starts hands, open trades/votes, setup
   steps; plus `seats` = color/playerId/name, no photos). Needs `server/migrate-final.sql` (one `alter table`);
   without the column the save retries without `final`, and the Stats list falls back to the old select, so it is
   safe either way. Stats → Recent games: rows with a board (`snap:final->>id`) show "🗺️ board ›" and open
   `openPastGame(gid)`: fetches that one row, photos from `LV.roster` by name, `online = false`, `ARCHIVE = {at}`,
   `enterGame` → the normal results card, quiet, dated "📅 Final board · …", "Back to stats" (`closePastGame`).
   "View board" shows every hand + dev cards (the ended-game spectator view). `renderLobby` is a no-op while
   ARCHIVE; any real `enterGame` clears it. Older games have no board (nothing was saved).
31. ✅ **v197 (2026-10-25).** Review fixes for v193–v196. `recordResult` returns while `ARCHIVE` (a live row update
   could set `online` back to true under the viewer and re-record the past game under a new id).
   `findMyGame` no longer downloads every playing game's `players` column (photos, ~20–80 KB per poll): it filters
   server-side with `players cs [{playerId: me}]`, selects only code + phase, and reads `players` for the one
   matching game at most once a minute. `closePastGame` keeps `state` (like leaving any game). Verified with a
   fake Supabase client in headless Chrome: ranked/friendly/absent quits, result + snapshot save, the no-column
   fallback, archive open/no re-record/board/close, and findMyGame (found, then cleared once I'm in `left`).
32. ✅ **v198 (2026-10-25).** Four-reviewer sweep of v183–v197. Fixed: (1) the offline "End the game" bar was hidden
   every second by the results-bar ticker (now the ticker calls `syncRmBar` during play); (2) a cup quit vote that
   settles as counted now redraws the champion screen (`cupQvDrawn`), it used to keep the pre-vote champion;
   (3) leaving a finished game from the menu marks you left BEFORE going offline (the settling vote's result was
   never recorded); (4) `openPastGame` re-checks `NET.started` after its fetch (a game starting meanwhile was
   left with `online=false` for the whole game) and a failed open closes the viewer; (5) live table rows no
   longer overwrite `gameSeats`/`online` under the viewer; viewer is silent (no GG bursts, no music);
   (6) cup host "here" counts away-but-in-roster again (v194 made a 20s phone sleep hand guests "End the cup");
   (7) `offSince` resets per game; (8) white-flag ending never overwrites an already-ended game;
   (9) `leaveTable` clears `cupRow`; (10) `findMyGame` also finds a cup paused between games you're in (row phase
   'ended', `state.cup` not stopped/finished) -> "Your cup is waiting · Back to the cup"; `leave()` clears myGame.
   Known, not fixed (minor): an uncounted quit/offline ending inside a cup leaves the cup "unfinished" in Stats;
   two simultaneous quits leave the second quitter as a voter; dev-card screen can close when a trade settles and
   stays view-only if your turn starts while open; poker HELD marks can carry into the next game's first hand;
   "Back to your game" can point at an abandoned game until cleanup (6h); viewer photos matched by name; a row
   first written by a pre-v196 phone has no board.
33. ✅ **v199 (2026-10-25): Batch A of the whole-app sweep (game-breakers).** (1) Lost moves: `_doSync`,
   `svUpdate`, `rpsUpdate` never leave a phone silently out of step: read errors retry (nothing written yet),
   write errors / exhausted retries call `NET.lost(code)` (`version = -1`, toast) so the next row re-applies the
   server state; requests time out after 10s (`netTimeout`); a write that landed on a newer row applies the
   merged state (`data.version !== before`). (2) `syncTradeUI` only closes trade sheets (`hideTradeSheets`: the
   offer builder or respond sheet), never the Knight question / dev cards / build / settings; ignores offers in an
   ended game and for spectators (they crashed). New dialogs reset `overlay.onclick`. (3) `afterAction` clears a
   stuck `ui.spinning` once setup is under way (a phone asleep at the who-starts finale could never act).
   (4) Offline "End the game" bar also in setup (dead phone stalled setup). (5) Engine: Road Building refused
   with no legal edge, ends early when the 2nd road has none (`legalRoadCount`); Year of Plenty checks the total
   asked; client YoP sheet has ✗. 3 new engine tests (28). (6) `lvStartGo` checks the TABLE row: a live/abandoned
   game or paused cup there -> fresh code. (7) `rpsResolve` won't resolve a round that already has a result.
   (8) PWA: `swReg.update()` on every return to the app; a new build arriving mid-game reloads on the next
   `showLobby` (`window.catanUpdatePending`). (9) Hourly sweep no longer deletes LOBBY chat (`.neq('code','LOBBY')`).
   Also: the off-turn cards screen re-renders when it becomes playable (`ui.devView`) and closes when the robber
   needs the board; poker HELD marks reset per deal. Batches B–D (wrong results, polish, security) not done yet.
34. ✅ **v200 (2026-10-25): Batch B (wrong results / wrong information).** Steal fly passes the real resource for
   the counts (third parties' corner counts were off until the next roll). Trade sheets keep ✓/✗/auto-decline off
   the resource columns (`.traderoot .tgrid` padding; on SE-size phones ✓ sat on brick, ✗ on wheat). "1" drawn as
   "I": offer counts, discard/YoP titles, `.btimer`, countdown, voice timer use the system font (`.rpsn`).
   Engine: Longest Road per the rules (holder keeps on a tie; a tie for longest among others leaves it with
   nobody); `checkWin` for the new current player at `endTurn` (and at `rollDice` for old states) so points won
   on someone else's turn win as your turn starts; `checkWin` clears `pendingTrade`; trade offers get an `id`
   (`tradeSeq`) and counters a `v`: accept/decline/counter/confirm carry `tid`/`cv` (client `seenTid()`) and the
   engine refuses an answer to a changed offer (old clients send none: accepted as before); negative/non-integer
   counts refused (`countsOk`). 4 new engine tests (32). Stats: white flags only in a live game (raise, Leave
   dialog, `syncSurrenderUI`); `endByFlags` no longer records/shows locally first, it waits for `svUpdate`'s
   merged state; `recordResult` waits while `NET.inflight` (my move not yet on the server) and `syncAction`
   records once it lands; `STATS.cups()` treats a cup idle > 6h (past the cleanup, can't resume) as ended early;
   Stats refetch when opened if older than 60s (`STATS.loadedAt`). Lobby: `startTableNow` polls presence first;
   the auto target counts seated players only (start and room preview). Automatic rematch re-reads the row and
   needs the server's all-yes. RPS: my local pick is used at resolve if my write hasn't landed (`rpsLocal.myPick`).
35. ✅ **v201 (2026-10-25): Batches C (polish) + D (security).** Game poll checks `version,phase` first and
   fetches the full row (state + photos) only when it changed and realtime hasn't delivered it, re-syncing
   (`version -1`) or every 30s (`NET.headKey`, set in `onRow`; in-flight guard). Lobby: `LOBBY.roomHost()` skips
   an asleep creator (Start + "Waiting for X"); sign-in: rpc errors carry `net`, `AUTH.resume` keeps you signed
   in on a network blip, `AUTH.list` null -> "Can't reach the game server · Try again"; login buttons use `lvArg`
   (apostrophes). Lobby chat: sending no longer moves the cursor (msgs merged + sorted by id), no auto-scroll
   unless near the bottom, no redraw while typing in `#lchatIn`. Quick messages save while typing (debounced) and
   reset on logout. Board: a remote update keeps my placement mode; counter-offer flies use the counter's terms;
   robber drag ignores a 2nd finger + handles `pointercancel`; player trades can ask for what other players hold
   (not capped by the bank); a winning VP card skips the "bought" pop-up; khalesna pokes the discarder
   (`pokeTarget`). One countdown at a time (`cdRunning`, enters `LOBBY.lastRow`); no countdown/spin replay on a
   rejoin once who-starts is under way; `syncRps` 'gone' unfreezes. Chat cursor only after it's known
   (`NET.msgReady`). Layout: game-over/spectator bar sits between the bottom corners; bottom corners' robbed tag
   under the cup pill (`top:36px`); reaction pill under the cup pill (`body.hascuppill`); banner name ellipsised
   and turn line no-wrap (`.bname`, `.bphase`); offer bar above the hand; compact #rmbar + results header under
   430px tall; body popups hidden behind the rotate gate; bigger 💬 / ✕ targets; no Domination after a surrender;
   the quitter doesn't get the fanfare (`quittingNow`). Security (`server/migrate-security.sql`, Karim runs it):
   RLS on `lobby_presence`, presence photo cap, PIN lockout (5 wrong -> 10 min), new token on PIN change (client
   saves it), max 60 players, no anon delete on `messages` (`clear_game_chat(code)` RPC, server purges game chat
   after 3h), size caps on messages/results. Tested on a local Postgres copy. supabase-js pinned to 2.117.0 with
   crossorigin (cacheable). `deploy.sh` runs the engine tests first. Not done: games rows stay writable by the
   app (moves are written by phones), voice bucket rules unchanged.
36. ✅ **v202 (2026-10-25): regression sweep of v199–v201 (4 reviewers) + fixes.** No core-flow breakage found;
   fixed what our own changes introduced: quick messages: Done within 800ms of an edit wiped the list (the debounce
   fired with `qmDraft = null`) -> `quickDone` clears the timer, `persistQuick` skips null. Room host: the creator
   keeps it unless away > 90s (`m.age` from presence); a stand-in host starts with the CREATOR's broadcast settings
   (`wsInfo(cr.ws)`, `cr.target`) and can't edit them. `pokeTarget` uses `currentDiscarder()`. Stats: a failed forced
   refresh keeps the games; background refresh never pulls you off a player page (`#st2player`). Rematch: the
   automatic start retries the server all-yes check (5 x 1.2s) while the last "yes" lands; a manual rematch at
   version -1 reads the real version. Sync: `netTimeout` falls back to AbortController + setTimeout (iOS < 16; a hung
   poll used to block polling for the session); `subscribe()` resets `NET.polling`; lobby full-row refresh every 5s
   (30s in game). Trades: confirm sends `cv: 0` when no counter was seen, the engine compares `(counter?.v ?? 0)`
   (an accept that turned into a counter meanwhile is refused; 1 new test, 33). `hideTradeSheets` also matches the
   pass-and-play `.menuscreen.trade`. Paused-cup card has "Start a separate game instead". SQL (migrate-security.sql,
   re-runnable): an expired PIN lock resets the count; game chat purged after 6h (cups) instead of 3h.
37. ✅ **v203 (2026-10-26): poker start froze two phones (Kay/Ramzi/Lapen, 2026-10-25 21:24 UTC).** Supabase edge logs:
   Kay started the game at 21:24:14; Lapen's (Android) and Ramzi's (iOS) phones reloaded at 21:24:16 / 21:24:23,
   i.e. the v199 update reload (`controllerchange`) fired during the 3·2·1, which isn't `body.ingame`. After coming
   back in, each phone made exactly one game read and then no GET at all for 2.5 min (POST heartbeats continued);
   their Draws never reached the server, Kay's phone resolved at the deadline with random hands, the others only
   moved when Kay's Leave idled the row. The exact phone-level stall couldn't be reproduced (a puppeteer + local
   mock-Supabase harness in /private/tmp/claude-501/pp plays it fine, and a hung request recovers via netTimeout).
   Fixes: (1) no update reload while `window.catanBusy()` (in a room, a countdown or a game); the pending reload
   happens in the heartbeat at a calm lobby moment (not while typing) or on `showLobby` with no table;
   (2) `LOBBY.join` walks straight back into a running game I'm seated in after any reload (was: paused cups only),
   with `findMyGame` retrying that for a minute after opening (`rejoinUntil`); (3) `netWatchdog()` in the heartbeat:
   nothing heard from the game (`NET.heardAt`: poll head OK / any onRow) for 12s -> re-subscribe; for 40s in a game ->
   reload (then (2) puts the phone back). Harness: reload mid-countdown -> back in without a tap, all three draws
   land; a 20s silence -> catches up; a 50s silence -> reloads, rejoins, catches up.
38. ✅ **v204 (2026-10-26).** The automatic walk-back-in (v203) only applies to a game with a move in the last 10 min
   (`games.updated_at`, read by `LOBBY.join` and `findMyGame` as `g.recent`): an abandoned game (everyone closed the
   app) stays a "Back to your game" card instead of pulling someone in alone until the 6h cleanup.
39. ✅ **v205 (2026-10-28). Dice luck meter.** Engine: `tally.cardsGot/cardsFair` (cards the dice paid vs the
   36-outcome average; city = 2; robber/bank ignored) and `state.luckLog` (per roll: [roller index, each player's
   luck x10]); new games only (`luckLog: []` in setup; old games never start a log). App: slim edge gauge (`.pluck`,
   die on top, number under, full at ±5, dimmed + '·' for the first 2 rounds) on each corner's board side; cup /
   robbed / flag pills moved 12px out. Tap -> `openLuck`: lay explanation, name chips, SVG chart of everyone's luck
   per roll with finger scrub. Dice-stats rows + Blessed/Cursed awards switched to the card measure (award bar 5
   cards; pre-v205 games keep the old 'times hit' measure, bar 4). One-time "New: dice luck" card (`NEWS` /
   `SETTINGS.seen`, synced to the login's settings) at a calm moment in play. Dropped from the mock: robber marks on
   the chart (robberies aren't logged per roll).
40. ✅ **v206 (2026-10-28). Luck meter polish.** Own icon (`luckIcon()`: two 3D dice, no face pointing at you, so it
   never reads as a roll). The one-time card became a 3-step coach-mark tour (`coachStart/coachPlace/coachAct`:
   dimmed screen, spotlight on the real gauge, pointing bubble; your gauge -> what the number means -> an opponent's
   gauge with "Show me"); news id `luck-tour`. Luck panel redesigned: verdict column (big number, verdict word that
   matches the awards, slider, one sentence, two tiles) + chart column, "How it's worked out" footer; fits 844x390.
   Settings: "New-feature tips: Show again" clears `SETTINGS.seen`. Headless gotcha: Chrome's --screenshot measures
   at a shorter viewport than it shoots, so fixed-position overlays look misplaced; use puppeteer setViewport.
41. ✅ **v207 (2026-10-28).** More air around the luck gauge: gauge 6px off the corner, cup / robbed pills 28px,
   flag 26px.


42. ✅ **v208 (2026-11-06). Walkie-talkie.** (Mockups: canvas row "Walkie-talkie: tap to talk, the whole table hears it",
   drawn over a real v207 screenshot.) A mic (`.pwt`) in the strip beside MY corner, after the luck gauge; on screens
   under 800px wide it sits above the corner, right of the 💬 (the resource bar reaches the strip there). Tap to talk,
   tap to stop, auto-stop at 15s (`WT_MAX_MS`); while live: red Stop, a white ring running down, "LIVE 0:09" pill, and my
   corner glows. Transport: realtime BROADCAST on the existing `game-<code>` channel (not the polled messages table, too
   slow): event `wt` = { c: color, id: talk id, s: seq, d: base64 16 kHz int16 PCM, e: last } every ~0.5s (~22 KB
   each), nothing stored. Receivers play chunks back to back on the SFX `actx` with a 0.3s lead (`wtPlay`, resampled to
   the context rate). If `audioHealthy()` is false (no tap since open/return, or after a mic use marks `audioStale`)
   chunks are held (max 16s) and a "Kay is talking · Listen" bar (`#wtlisten`) shows under the banner; Listen or any
   tap (`unlockAudio` -> `wtFlushPending`) plays them. Talkers' corners get `.wtalk` (red glow) + a bouncing-bars badge
   on the photo (`.pwteq`). Setting "Walkie-talkie sound" (`SETTINGS.walkie`, synced to the profile): off -> nothing
   plays (glow still shows) and the phone announces `wtm` {c, m:1} on subscribe, on change and every 10s; others show a
   crossed-out speaker (`.pwtmute`, 40s TTL). `keepAudioSession` now also runs for walkie (plays through the mute
   switch). Voice notes and walkie block each other. `wtReset()` on enterGame / unsubscribeGame. Verified headless with
   Chrome's fake mic: 2.6s -> 6 chunks with the end flag, held + Listen bar while locked, played after a tap, duplicates
   ignored, mute badge on/off, glow clears after playback; layouts at 844x390 and 667x375. NOT verified: real iPhones
   (auto-play after a tap, the record-mode switch after talking, speaker vs earpiece), real Supabase broadcast delivery.
43. ↩ **v209 (2026-11-06). Walkie-talkie rolled back.** Karim: "it's buggy, it's not working" on real phones (no details
   yet). `prototype/` restored to the v207 code exactly (only APP_VERSION / SW VERSION bumped to v209 so phones update).
   The v208 code lives on branch `walkie-v208` (commit 104473b; `git diff 4d368db 104473b -- prototype/app.js
   prototype/index.html` shows the whole feature). Before retrying: find out what failed on the phones (mic not
   starting? nothing heard? only after talking? broadcast not arriving?) and test on two real phones before deploying.
44. ✅ **v210 (2026-11-06). Walkie-talkie back, with the iPhone fix.** Cause found with `prototype/walkie-test.html`
   (a standalone diagnostic page, not linked from the game: it streams its log and recordings to a Node listener on
   the laptop over the broadcast channel `wtdiag`). On Karim's iPhone (iOS 26): Supabase broadcast and the v208 mic
   capture both worked; the bug was that once the page has used the mic, iOS plays its sound faintly through the
   EARPIECE (and suspends Web Audio). Fix: `micSessionOn()` sets `navigator.audioSession.type = 'play-and-record'`
   just before every getUserMedia, `micSessionOff()` sets it back to `'playback'` (loudspeaker) when the mic closes.
   Note getUserMedia is REFUSED while the type is 'playback', so every mic use must call micSessionOn first (voice
   notes do too now). With audioSession (iOS 17+) the walkie records on the SFX context `actx` itself (`WT.ownCtx`
   false), which is the tested combination, and taps don't rebuild actx mid-talk; older iOS keeps the v208 path.
   Verified: two headless tabs over real Supabase, both paths, plus a voice note after a walkie talk. Not yet
   verified: the game on two real iPhones (Karim testing).
   Karim's first two-iPhone test: voices came through both ways. Side effect: the game music gets louder while
   your mic is on (iOS uses the call volume in play-and-record) and drops back after. Idea parked by Karim ("keep it
   for now and see"): pause the music on the talker's phone, and on listeners' phones while a voice plays (iOS
   ignores <audio>.volume, so pause rather than lower).
45. ✅ **v211 (2026-11-06). Chat + walkie during "who starts".** The rock-paper-scissors / poker card (`#rpsroot`, z 37,
   full-screen dim) sat over the corners' 💬 and mic and over the chat layers. Now `#rpsroot` lets taps through
   (only `.rpscard` catches them) and, while it's up (`body:has(#rpsroot:not(.hidden))`), the corners go to z 38,
   bubbles / Listen bar 39, emoji tray / message history 40. Under 800px the bl mic sits straight above the corner
   while the card is up (the card covers its usual spot). Setup placement already had both.
46. ✅ **Chat tray redesign (discussed 2026-11-06, built in v212-v214: items 47-49).** Still open from it: the "learning"
   tray and the context chip (backlog below). Karim: the 💬 entry sits on the corner edge over the luck meter;
   the mic overlaps the robbed pill on big iPhones (Pro Max landscape); texts are used less because they're behind ⋯.
   Direction agreed: one fixed "talk" home for 💬 + 🎤 beside the corner; the tray's first screen = ~8 favourite emojis,
   ~6 favourite texts as one-tap chips, then ✏️ Type and ⋯ More (all emojis, all texts, 🎤 voice note, edit). Voice
   notes move into More (the walkie is the main mic now). FIXED order for now. Backlog: a "learning" tray that
   reorders by each player's own use, and a context chip (e.g. 😡 tfeh right after you're robbed). Picker page for
   Karim's favourites: https://claude.ai/artifact/6LhGjuvF7hns6GqPBaYgV1
   Karim's picks (2026-11-06), the set EVERYONE gets, each player can edit/reorder their own: 51 emojis in 7 groups
   😂😜🤡😘🫣 | 😮😩🤦🤷😭💔😒😴🥱 | 😡🖕🍅💩🤮🐍🍆👎 | 👍👏💯🔥💪🤝🙏🍻🤑👀🧿 | 🐒🐰🐭🐥🍌🥚🥕 | 🌾🪵🪨🐑🧱 |
   🇱🇧🇸🇦🇦🇪🇮🇪🇬🇷🇳🇱 ; 14 texts: yalla, haha, wtf, hek sarit?, ma32oul?!, shu hal 7azz, fayyish, wleeee, tfeh,
   bel marra, ahbil, habibi, tizeh fik, nikouna. He wants it all on screen (bigger tray/pop-up, not a swipe strip).
   Mocks on the canvas row "Chat v2" (CT-0..CT-E): capsule talk button, ideas A tray / B centre sheet / C drawer /
   D tabs, E edit mode. Karim picked T2 + B-from-the-corner + E (and ❤️ added: 52 emojis).
47. ✅ **v212 (2026-11-06). Chat v2 built.** `.pchat` (svg bubble) and `.pwt` are two 38px buttons side by side just above
   the luck meter (`bottom:calc(100% + 6px)`, left +4 / +48): the bottom of the gap is under the resource bar on
   small phones, so this is the one spot that works everywhere; the robbed pill stays put. During who-starts on
   <800px they shift left over the corner. Tray `#emotray` (openEmojiTray → trayMain): from my corner, bottom-aligned,
   width min(600, room); emojis left (`trayEmojis()` = SETTINGS.emojis or EMOJI_DEFAULT, space-separated), texts right
   (AUTH.quickList, new DEFAULT_QUICK_MSGS = Karim's 14), footer Type / Voice note (straight into recording) / Edit.
   Auto-close 10s (not while editing). Edit (`trayEdit`): wiggle tiles, drag reorder (`wireReorder`, document-level
   pointer listeners because moving the node drops pointer capture), ×, ＋ = search `emoji-data.json` (1,914 emojis,
   lazy-loaded), add text, reset. SETTINGS.emojis syncs via player_set_settings only if it fits the 500-char limit
   (else device-only). Receivers now keep 16 chars of an emoji (was 8: cut long flags/ZWJ). Headless-verified at
   874/667/568 wide incl. drag, ×, search, reset, throw; not yet on a real phone.
48. ✅ **v213 (2026-11-06). Chat v3: three buttons.** Karim felt v212's one big tray lost "few, big choices". Now `.pemo` 😀
   (+4px), `.pchat` 💬 (+48px), `.pwt` 🎤 (+92px) sit in a row above the luck meter; during who-starts they stack
   vertically above the corner (all widths: the card covers the row). `openTray('emo'|'txt')` (trayMode): emojis only
   at 46px (`.etbig`, 8 per row, scrolls past ~32), or texts only (`.etpill` 15.5px) with an inline type box (Send /
   Enter, never auto-closes while focused) and a red Voice note button. Trays open ABOVE the button row (placeTray
   uses the buttons' box; beside it when there's <190px above, e.g. 568-wide phones). Swipe sideways inside a tray
   flips emo<->txt (`wireTraySwipe`, capture-phase pointer listeners); in `wireTrayDrag` the throw ghost only appears
   once the finger leaves the tray, and a moved-but-inside drag sends nothing. Edit is per tray. EMOJI_DEFAULT is
   Karim's order (set via https://claude.ai/artifact/B2kDf7n2z72zzVssd8zuxi): 😡🖕🤮😂💪🍅🥚🥕💩🍌🐰🐒🐭🐥👀👍👎😜❤️💔
   😮😩🤦🤷😭🤑😒😴🥱😘🫣🐑👏💯🔥🤝🙏🍻🧿🤡🌾🐍🪵🪨🧱🇱🇧🇸🇦🇦🇪🇮🇪🇬🇷🇳🇱🍆. Canvas row "Chat v3" (CV-1..4).
   Headless-verified at 874/667/568 (tap, swipe both ways, button toggles, throw, edits, who-starts); not on a phone.
49. ✅ **v214 (2026-11-06). Talk buttons swap with the robbed counter + hold to pick up.** Karim: the row above the luck
   meter made the trays start mid-screen. Now `.pemo/.pchat/.pwt` sit in the gap beside the corner (top:24px, +28/+72/+116,
   just clears the resource bar's icons at 568-667 wide) and `.corner.bl:has(.pemo) .probbed` goes above the luck meter
   (level with the dice); a cup game's `.pcup` sits beside it. 💬 is an outline icon like 😀/🎤. Emoji tray: side gutters
   + 6px gaps, `touch-action:pan-y` (up/down scrolls natively even when starting on an emoji; sideways stays ours for
   the tray swipe), height capped ~4½ rows. Gestures (`wireTrayDrag`, HOLD_MS 260): quick tap = send; move first =
   scroll/flip; HOLD = the emoji lifts (ghost visible everywhere, inside the tray too) and a non-passive touchmove
   blocks scrolling; drop on a player = throw, elsewhere = cancel. Verified headless incl. synthesized touch scroll.
   **Karim tested v214 in a real game (2026-11-07): working.** That also covers the v210 walkie and v212-v213 chat on real
   phones. No regression sweep has been run yet on the v208-v214 batch (Karim: not yet).

50. ✅ **Voice & video at the table: built and live for everyone since 2026-11-08 (items 51-64).** Original brief (2026-11-07), kept for history; later decisions supersede it (badges in the name row, badges are the switches, no tap-your-picture card, victory corners 1x). Karim: refine the requirements
   and mocks only, no code. Requirements, decisions, vendor costs and open questions: `docs/prd-voice-video.md`.
   Mocks: canvas "Catan: Voice & video" https://claude.ai/artifact/DjkXUjLaeYMZzcH4tpz9QX (Take 2 P1-P3 + Take 3
   T1-T6 are current). Gist: a real call (hosted WebRTC) for the whole table night, everyone hears everyone, tap your
   own picture for Audio / Video, red badges = one-tap mute / camera off, asked once then remembered, "mute X for me"
   announced to the table, spectators included, victory corners grow 1.5x with live faces, walkie only as fallback,
   music never paused. Vendor lean: Daily (10k free min) over LiveKit (5k hard cap, then $50/mo).
   **2026-11-07: Karim decided (D13-D22 in the doc), chose LiveKit, and the trial went live.** LiveKit Cloud project
   "Karim-Catan-Mutliplayer" (sic), URL wss://karim-catan-mutliplayer-tzxbs8vf.livekit.cloud, API key APIt4WQZiH5PiJd
   (secret only in Supabase Edge Function secrets; old key APIydyY33REnTLq unused, to delete). Supabase Edge Function
   `voice-token` deployed by Karim via the dashboard editor (source: `server/functions/voice-token/index.ts`, Verify JWT
   off, secrets LIVEKIT_URL / LIVEKIT_API_KEY / LIVEKIT_API_SECRET); checked: LiveKit's /rtc/validate accepts its tokens.
   Trial page + its own home-screen app: https://karimkabbani.github.io/catan/voice-trial/ (`prototype/voice-trial/`,
   self-hosted livekit-client 2.22.4, logs in as a real player, room "trial", sends diagnostics on the Supabase broadcast
   channel `vtdiag`). Game untouched (still v214). Test players: test / test2. Notes: this cloud sandbox can't carry a
   WebRTC call (HTTPS proxy only), so call quality is tested on Karim's iPhones; `deploy.sh`'s engine tests time out on
   the slow sandbox (all 34 pass with --testTimeout=120000) and `git subtree push` needs a full clone (`git fetch
   --unshallow`).
   Trial t1-t6 results (same day): see `docs/prd-voice-video.md` section 11. Key one: after a 45 s+ lock the returning
   iPhone went fully silent until the trial copied the game's audio setup (silent keep-alive loop + rebuild the sound
   engine on the first tap after returning, app.js `keepAudioSession` / `onAudioWake`); with it, sound survived a
   55 s lock and the call wasn't even dropped. The game build must reuse that setup for the voices.

51. ✅ **v215 (2026-11-07), deployed with voice limited to the test players test / test2 (voice-config.json "only"): live voice & video at the table.** Spec `docs/prd-voice-video.md`,
   mocks on the "Catan: Voice & video" canvas (Take 3). Code: the `LIVE` object + `voice*` functions in app.js (after
   the walkie block; NB the older `VOICE` object is the voice-NOTE recorder, different thing). One LiveKit call per table
   (`table-<LOBBY.table>`), joined as listener by `voiceSync` (every 2s) once the game's AudioContext exists; voices play
   through the game's `actx` (webAudioMix) and move onto a rebuilt context in `initAudio` -> `voiceOnCtx` (the t6 fix).
   Pass from the Supabase function `voice-token`. Tap own picture -> `voiceCard` (Audio/Video, or Mic/Camera switches +
   Leave + My recent messages / Change my colour); badges via `voiceBadges` (own = one-tap buttons), tags via `voiceTag`
   (muted / muted you / can't hear / no voice), glow = `.vtalk` class from audio levels, camera <video> kept per player in
   `LIVE.vids` and re-mounted after every corner/lobby/banner redraw (`voiceMountVideos`). Ask once (`voiceAsk`) ->
   `SETTINGS.voice` (synced); remembered Audio/Video turns the mic on only on the first join of a table (`autoDone`).
   Mute for me = per-voice gain 0 + data message 'mute' + announcement; 'st' heartbeat (15s) carries deaf / my mutes.
   Hide -> mic/cam off, "Voice back on · your mic is off" on return. Walkie button shows whenever there's no call
   (`voiceDown`). Off switch: `prototype/voice-config.json` {"enabled": false} + deploy. Lib self-hosted:
   `prototype/livekit-client-2.22.4.umd.js`, lazy-loaded. Regression sweep (3 reviewers) found and fixed: incoming audio
   never attached (nobody would have heard anyone), stale join after leaving a table, duplicate-device reconnect loop,
   mic not released on mute (stopMicTrackOnMute), lobby/chat redraw every 15s, own-seat colour tap, rps-out grey, SW cache
   growth. Not built: monthly minute counter / 80% warning (needs a table + LiveKit webhook), "Update to hear" screen on
   old phones (the existing auto-update on the lobby covers it; others see "no voice"). Headless-verified with faked
   participants; a real in-game call needs phones.

52. ✅ **v216 (2026-11-07). In-game live video fix.** Karim: video showed on the room seats but not in the game corners
   (badges + audio fine). Likely causes: the corners' dim filter, their constant innerHTML redraws moving the <video>, and
   LiveKit adaptiveStream pausing video whose element kept vanishing. Now each player's <video> plays in a hidden, fixed
   `#vholder` and every picture draws it onto a `canvas.vvid` (~15 fps, `vDraw` rAF loop); adaptiveStream off.

53. ✅ **v217 (2026-11-07). Bigger corners + video aspect fix.** Karim: in-game video and badges too small; video
   stretched in the room's "Talk to the table" chip and squashed on seats. `.pava` tiers (index.html, near the `.vb`
   rules): 800+ wide & 390+ high 104x120 (badges 30px, victory grows 1.15x), 740+/370+ 80x92, 600+/330+ 64x74, else
   48x56. Applies to everyone (layout, not voice). The video canvas now sizes itself to its picture box (cover crop, no
   stretch); the chip shows a small round live face. Victory hides the last roll's dice.

54. ✅ **v218-v220 (2026-11-07).** v218: speaking glow drawn INSIDE the corner picture (`.pava[data-vid].vtalk::before`),
   emoji/texts buttons lower beside bigger corners. v219: all v217 layout changes (bigger corners, lower buttons) only for
   players with voice: `body.vlive` (set in `voiceSync` when `voiceOn()`); friends keep the old look until voice opens.
   Tiny watcher faces show only the mic badge. v220 (Karim): victory keeps corners at 1x (gold frame + crown on the
   winner only). Canvas "Catan: Voice & video" bottom rows show every place video appears (real renders). Voice still
   limited to test/test2 via `voice-config.json` "only"; Karim decides when to open it to everyone.
55. ✅ **v221 (2026-11-07). Design & UX sweep fixes** (canvas "Catan: Design & UX sweep",
   https://claude.ai/artifact/1qJ3HEEkQytq4WD93NJDtF, items 1-6; 7 crown and 8 polish not done yet, Karim to look again).
   1 voice badges: dark disc + gold rim + cream icon when on, red (`.vb.vred`) only for a muted mic. 2 talking: white
   ring (not gold, gold = your turn) + live sound bars under the mic badge (`.vbars`, driven by `--vlv`). 3 `#vcard` and
   `#msghist` are dark wood like the trays, placed by `popAt()` with a pointer to the picture, 44px close (`.popx`),
   green switches, outline "Leave the call", "My recent messages" only when you sent some. 4 walkie `.pwt` sits in the
   😀/💬 row with bigger corners; emoji tray never goes under the banner, shows whole rows + a faded peek (`.etbig.more`).
   5+6 `fitDock()` (after every `renderPanels`): with `body.vlive`, the bottom bar keeps between the bottom corners and
   their luck gauges (squeezes gaps; watcher strip names scroll with a fade, own face hidden under 800px since it's in
   the banner); right-corner dice slide left off the menu button (for everyone). Popup restyle, tray and dice fixes
   apply to all players; the rest only shows with voice. Checked headless at 932, 812, 667, 568 wide.

56. ✅ **v222 (2026-11-08, deployed). Practice table for the test players** (`test`, `test2` only:
   `practiceAllowed()`). Lobby home shows "🧪 Practice table" → a room with you + two computer players (Zaatar, Kibbeh)
   and a REAL voice/video call in its own LiveKit room `table-P<id>` (so the call, room seats, corners, victory video can be
   tried alone). "Start a new game" (full setup) or "Jump into a game in progress" (`practiceMidGame`: everyone auto-plays
   the opening + ~8 rounds with 4 bonus cards a turn, stops at your turn, nobody above target-4). Nothing hits the game
   server: `PRACTICE.on` makes dispatch skip `NET.syncAction`, `svUpdate`/`rpsUpdate` apply locally (`practiceWrite`),
   `sendBroadcast` no-ops, voice notes play back locally, `NET.code` stays null (so no stats). Bots (`botMove`) play
   through `applyRemoteState` like real remote players: greedy setup by pips, roll (knight if robbed), robber on you,
   city > settlement > road > dev card > bank trade, discard biggest piles, answer your trade offers. Leave/Play again go
   back to the practice table. Bot seats have `playerId: null` (always "online").
57. ✅ **v223 (2026-11-08, deployed).** Practice table: pretend video/voice for the computer players (only
   alongside a real call, only on this phone): `PRACTICE.fake` participants returned by `voicePart`; Zaatar "on video"
   (a canvas captureStream of his portrait with a gentle sway), Kibbeh on audio only; v224: Zaatar (on camera) is the one who sometimes self-mutes, so the red badge shows;
   every 9-18s one says a line via speechSynthesis with the white ring + sound bars (`practiceTalk`). Mute-for-me works on
   them (silences the line, "muted" tag). Bot seats now carry ids `bot-*` (`isPlayerOnline` treats them as online).
   Victory shortcuts: "🏆 Skip to a victory screen" on the practice table, and "I win / A computer wins" in the in-game
   Leave dialog (`practiceWin`).
58. ✅ **v225 (2026-11-08, deployed). Camera cutout (notch / Dynamic Island).** In landscape the cutout sits
   mid-height on one side edge; on Karim's 16 Pro it covered his camera badge (and with the camera on the right, the round
   menu button). Canvas "Catan: Design & UX sweep" board 9 compared 4 options; Karim picked D: with voice (`body.vlive`)
   the mic/camera badges move off the picture into the plaque's name row (`.pname.prow` = `.nm` + `.vrow`), name on the
   screen-edge side, badges on the board side; the row sits under the picture for bottom corners and ABOVE it for top
   corners (a name beside the picture fell under the island). Pictures trimmed (108/84/68px tall) so corners keep their
   size; online dot on the board side for right corners. For everyone: `markCutSide()` sets `body.cut-l/cut-r` from
   `window.orientation` (90 = phone top on the left), and the menu/trophy/dice tabs step in by the safe-area inset when
   the camera is on the right. Checked headless at 932/874(16 Pro, island drawn both ways)/812/667/568: nothing under the
   island. The real rotation value on iPhone must be confirmed on the phone.
59. ✅ **v226 (2026-11-08, deployed in v229). Your badges are the controls.** Karim: drop the tap-your-picture card.
   My own two badges always show (`voiceBadges` mine branch): calm = on, red + slash = off (`VI_MICX`, new `VI_CAMX`); one
   tap toggles, with a 1s toast ("📷 Camera on" / "Mic off") so a mis-tap is noticed. Not green for on (green = a player
   colour and the online dot). Others' badges only show what's on (+ red mic when muted on camera). Tapping my own
   in-game picture now opens my recent messages like anyone's (the voice card only while the call is still connecting /
   down); room + practice seats: my face no longer opens the card. The card remains behind "Talk to the table" (room, not
   seated) and the watcher's own face in the spectator bar.
60. ✅ **v227 (2026-11-08, deployed in v229). Switches everywhere.** The watcher's bottom bar shows your two switches
   (`.specvc`) instead of a face that opened the card; the room's "Talk to the table" chip (not seated) is a row with the
   two switches; your own small face (banner / room watchers) no longer opens the card while the call is up (`voiceWho`).
   The voice card now only appears while the call is connecting or down, to explain. `voiceRefresh` also redraws a
   watcher's bottom bar. `fitDock` re-runs every second in-game with voice (a bottom corner can shift after a redraw
   without resizing; the bar overlapped by 4px at 932/874 before).
61. ✅ **v228 (2026-11-08, deployed in v229).** Room + practice seats: badges beside the name (`lvNameRow`), not on
   the face, same look as in the game (yours = switches, red when off). First-time question is now a NEW-feature card,
   "Talk while you play": Video and voice / Voice only / Just listen (mic and camera off, still hear and see everyone).
   v229: "Pick how you join:", all three options styled alike, a "Decide later" link; no instruction line under your seat.
62. ✅ **2026-11-08: voice & video opened to everyone** (`voice-config.json` → `{ "enabled": true }`, no "only" list).
   Kill switch: set `"enabled": false` (read network-first by every phone, takes effect within ~2s of the next check).
   Practice table stays test/test2 only. Still not built: monthly minute counter + 80% warning (watch the LiveKit dashboard).
63. ✅ **v230 (2026-11-08, deployed). Sideways board** (test2 only until v234, item 67). Karim: keep rotation lock on
   and still get the landscape board, without going native. Safari can't lock orientation, so `rotate.html` hosts the
   whole app in an iframe; while the board is up and a touch screen is upright it sizes the frame landscape and turns it
   90° (the phone's top on your left), or -90° after Settings → Sideways board → Flip it over (stored in `catanSideFlip`).
   The app inside sees a real landscape viewport, so CSS, media queries, taps and swipes need no changes: the browser maps
   touches through the rotation (verified headless: taps land on the right point, a drag pans the board the way the
   finger moves). With rotation lock off, turning the phone gives a real landscape screen and the frame stays unturned.
   The frame sits in the host's safe area; inside it `FRAMED` turns off `fitAppHeight` / `markCutSide`, and `html.framed`
   zeroes the app's own safe-area margins (item 66). Routing: index.html's head script sends any saved player to
   rotate.html at launch, and `sidewaysSync` does it after sign-in (only from the plain lobby). Messages: the app sends
   `{catanSideways, ingame, user}`, the host answers `{catanSideAngle}` (item 65). Known limits: the chat keyboard opens
   along the phone's long edge, the status-bar strip costs ~50px of width, and swipe-home is on a side edge.
64. ✅ **v231 (2026-11-08, deployed).** Built on top of another session's v230 (sideways board for test2). The rejoin note
   says "tap 📷 to turn your camera on" (was "tap your picture"). Your own badge taps update the remembered choice
   (`voiceRemember`): mic off -> 'listen', mic on -> 'audio', mic + camera on -> 'video' (still rejoins camera OFF); saved
   to the profile like the first pick; automatic switches (lock screen) don't change it. iPhone's own camera/mic permission
   prompt is separate: whether a home-screen app re-asks each session is unverified.
65. ✅ **v232 (2026-11-08, deployed). Sideways board: camera pictures turned upright.** With rotation lock on, iOS
   thinks the phone is upright, so the camera films a sideways-board player on their side. rotate.html tells the app its turn
   angle (`catanSideAngle` → `SIDE_ANGLE`); `vDraw` turns that player's picture back by it, and the angle travels with the
   call state (`st.rot`, also on the 15s heartbeat) so everyone else's phone turns it too. Sign assumed: an unmirrored
   front-camera frame has the head on the left when the phone's top is on the left. Not yet confirmed on real phones:
   if a face shows upside down, negate the angle in `vDraw`.

66. ✅ **v233 (2026-11-08, deployed). Sideways board: corners hug the phone's long sides.** Karim's screenshot:
   in rotate.html's turned frame the corners sat ~33pt off the phone's right edge and ~22pt off its left. Cause: iPhone
   still reports its PORTRAIT safe-area insets (62 top / 34 bottom) to the frame, and the app applied 40% of them to the
   game's top/bottom (= the phone's right/left). Fix: every `env(safe-area-inset-*)` in index.html now goes through
   `--sa-t/r/b/l` (set on :root), and `html.framed` (added when `FRAMED`) zeroes them; the host already keeps the frame
   inside the safe area. Normal (unframed) phones unchanged. Verified headless by faking the 62/34 insets: 33/22 -> 8/8.
67. ✅ **v234 (2026-11-08, deployed). Sideways board for everyone** (was test2 only, item 63). The three test2 checks
   now accept any signed-in player: index.html head redirect, `sidewaysUser()`, rotate.html. Nobody signed in stays on
   index.html; after sign-in `sidewaysSync` moves them to rotate.html from the plain lobby. The practice table stays
   test/test2 only (`practiceAllowed`). Everything else (voice, badges, cutout, camera turn) was already for all.
68. ✅ **v235 (2026-11-08, deployed). Tidy-up, no behaviour change.** rotate.html: dropped the dead "send other players
   back to index.html" branch and the leftover `SIDE_USER` check (the frame turns for anyone signed in); comments in
   rotate.html, index.html and app.js no longer say test2. HANDOVER items 63-67 renumbered and rewritten to match the
   code; §5.1 lists rotate.html; §5.3 explains when the rotate overlay still shows.
69. 🔧 **Saved-branch fix (2026-11-08, not live): robber drag stuck inside the sideways frame.** Lapen (Pixel 7) saw the
   robber stranded in the sea, none on the board, and no menu button: he had rolled a 7 and started dragging the robber.
   Reproduced in Chrome with the Pixel 7 profile and real touch events: inside rotate.html's frame (turned or not) the
   game got pointerdown only, never move/up/cancel. Cause: `startRobberDrag` called render(), which removed the robber
   element under the finger; a plain page re-targets the touch, a frame does not. Fix: the resting robber sits in
   `<g class="restrob">`, hidden by `#board.rdragging` (no redraw), and the drag captures the pointer on <body>.
   Verified: framed upright, framed landscape and plain page all deliver 8 moves + lift and land on the right hex.
   Also found: video roughly halves the frame rate during play under a 4x-slowed CPU (~28 vs ~52 fps; headless
   numbers are noisy, real GPU differs); the gold pulse on the active corner repaints the corner every frame.
   Still to check on a real Android: faces turned 90 degrees (item 65's assumed sign), own badges red while own
   video still showed, and what Lapen means by "screen cut".
70. 🔧 **Saved-branch Android test pass (2026-11-09, not live).** Chrome with the Pixel 7 profile (Android 14, 412x839,
   DPR 2.625, touch), real CDP touch events, CPU throttled 4x. No KVM here, so no real Android emulator.
   - Touch sweep (scratchpad px/sweep.js, 10 checks: pinch, pan, menu tap, emoji tray open/send/scroll/flip, emoji throw,
     robber drag + confirm): sideways upright, sideways flipped and plain landscape all 10/10 after the fixes.
   - Fixed: emoji tray would not scroll or swipe on the turned board. touch-action pan-y is read along the PHONE, i.e.
     the game's sideways: `html.sideturned` (set from the host's angle) swaps to pan-x.
   - Fixed: own camera badge lied after leaving the app (Lapen's red badges with live video). A background switch-off can
     fail on Android; the code then marked the camera off anyway and the on-return retry skipped it, so the camera kept
     sending under a red badge (privacy). Now `voiceLiveCam/Mic()` ask LiveKit what is really sent, a failed switch-off
     keeps the badge 'on', and the return retry uses the real state. Verified with a camera stub that refuses while hidden.
   - Faces were NOT turned: read in the game's orientation, Lapen's screenshot shows every face upright (earlier claim withdrawn).
   - Speed (26 identical recorded moves replayed, medians of 3, 4x CPU): v214 52 fps / 3% dropped frames / 2.3 s of
     >50 ms stalls; saved code no video 50 / 4% / 5.5 s; sideways frame costs nothing (51 / 3%); 4 videos 33-34 fps /
     18-21% dropped; gold pulse off 37 / 14%. `fitDock` rewritten (read once, write once, skip when unchanged, one
     queued call per frame): stalls 5.5 -> 4.8 s. Removing the `:has()` rules would save ~0.8 s more (not done). The rest
     of the 2x vs v214 is spread over the bigger corners/badges. Bot thinking is excluded (it is far heavier than a real game).
   - Pre-existing (also before today): at 568 wide with 4 players the resource bar overflows by a few px.
   Still unverifiable here: real LiveKit camera on Android, what Lapen means by "screen cut", real GPU paint cost.
71. ✅ **v237 (2026-11-09, deployed, release step 1): voice & video and the sideways board back, cheaper, limited to
   test / test2 by voice-config.json.** Built on the saved branch (items 69-70) on branch `claude/voice-video-sideways-perf-48ku4d`,
   merged to main as 23b11bb (a merge commit carrying that branch's tree exactly, since the rollback commits conflict with it).
   Published with `git commit-tree HEAD:prototype -p origin/gh-pages` + a plain push: `git subtree push` was refused as
   non-fast-forward because gh-pages' history came from another clone's split; never force it. Friends see v214 behaviour with
   the cheaper rendering; the launch redirect to rotate.html only fires once the app has cached that this player is allowed.
   - **Measured first** (`tests/device/prof.js`, CDP profiler over the 26-move replay): without video the newer code's script
     is only +0.1 s and style/layout unchanged vs v214; the earlier "2x per-move work" was the stall metric exaggerating
     (same work in fewer, longer tasks). Video is the real cost: +1.5 s script (half of it the harness's fake cameras) and
     +1.4 s native paint. So the work went into paint, not logic.
   - Video pictures (`vDraw`): drawn only when the camera delivered a new frame (`requestVideoFrameCallback`; a 1 s silence
     falls back to the old 66 ms timer, so an unpainted <video> still shows), 15 fps cap kept, nothing drawn while the app is
     hidden, one 2d context per canvas, canvas at 1.5x pixel density (was 2x). `body.vlive .corner{will-change:transform}`:
     each corner is its own layer, so the dim filter and glow are composited instead of re-rasterised with every frame.
   - Gold "your turn" pulse kept, but as an opacity animation on `.corner.active::after` (compositor only) instead of an
     animated box-shadow that repainted the corner, video included, every frame.
   - All 11 `:has()` rules replaced by classes: `body.rpsup` / `.rpsstrip` (`rpsBodySync`, the who-starts card),
     `.corner.haschat` (own corner with the talk buttons), `.corner.vtalkin` (someone talking, set by the glow loop),
     `#title.lvmode` (already there). The 125 ms glow loop writes only when a level changed.
   - `renderCounts` (a card landing/lifting) now writes the resource number in place; it rebuilt all four corners per card.
     `CATAN.specView` only redraws the bottom bar.
   - **Staged rollout gate:** voice-config.json `"sidewaysOnly": [names]` limits the turned board to those players
     (`sidewaysUser`); the others run unturned (= the plain look). The answer is cached in localStorage `catanSideOK` for
     index.html's launch redirect. No list = everyone, as before. Voice keeps its own `"only"` list.
   - **Numbers** (bench3, emulated Pixel 7, 4x CPU, medians of 3; headless software paint, so fps is directional, the
     new "busy ms" column (main-thread TaskDuration) is the steadiest): no video: stalls 4.1 -> 3.35 s, busy 17.2 -> 15.5 s
     (v214: 2.2 s / 23.4 s busy, so the new code does LESS total work than v214 but in longer tasks); 4 videos plain:
     40 -> 45 fps, 12 -> 8% dropped, busy 23.3 -> 22.6 s; 4 videos sideways: 39 -> 43 fps, 13 -> 9%. The harness's
     fake cameras alone cost ~1 fps. Of the CSS variants only will-change measured (+3 fps); pulse and filter changes are
     GPU-side and can only show on a phone. Diagnostic (`-nodraw` / `-nopaint`): with the pictures neither drawn nor
     painted the replay still runs at 45 fps, i.e. the app's own video drawing is now ~free here; the rest of the gap to
     no-video (54 fps) is the four streams decoding in their <video> elements, which any approach needs.
   - **Verified headless:** `sweep.js` 10/10 on six combinations (Pixel 7 and iPhone 15 profiles x sideways upright, sideways
     flipped, plain landscape); `verify.js` 11/11 (the behaviours above); `badge2.js` honest camera badge after returning;
     `handfit.js` clear at 932/874/812/667, the 568-wide 4-player overflow is pre-existing. Engine: 34 tests pass.
     `tests/device/make-pages.sh` builds every test page (incl. the v214 and pre-badge-fix baselines), `runbench.sh` +
     `med.js` run and summarise the benchmark, `README.md` there explains all of it.
   - **Needs a real phone** (checklist: `docs/phone-test-v237.md`): Safari/WebKit touch feel in the turned frame, camera
     permission re-prompting in the home-screen app, audio after a lock, AirPods, an incoming call, 4G, 10 min of camera
     (heat/battery), the camera turn sign (item 65), what Lapen's "screen cut" is, real GPU frame rate with 4 videos.
   - **Release plan:** (1) ✅ 2026-11-09: voice-config.json `{ "enabled": true, "only": ["test", "test2"], "sidewaysOnly":
     ["test", "test2"] }` + v237 live; (2) two-phone test (`docs/phone-test-v237.md`); (3) drop both lists (edit the json +
     deploy; the phones pick it up within ~2 s). Practice table stays test-only. Only one session deploys.
72. ✅ **v238 (2026-11-09, deployed): sideways board turns on any touch screen.** Karim's first two-device test (iPhone 16 Pro as test,
   Android Studio Pixel 7 emulator as test2, v237 live): faces upright on both devices (item 65's sign confirmed, at least
   iPhone -> Android), badges in the name rows, voice both ways, honest mute (muted iPhone showed no sound bars). But the
   emulator's board never turned while upright: rotate.html tested `(pointer:coarse)`, and the emulator (a virtual mouse
   beside the touch screen) reports a fine PRIMARY pointer. Now `(any-pointer:coarse)` or `navigator.maxTouchPoints > 0`
   also count; a desktop window still never turns (checked headless: desktop portrait not turned, touch profile turned).
   Same-room note for future tests: a howl that fades is the Mac mic <-> iPhone speaker loop, not a mute bug; AirPods fix it.
73. ✅ **v239 (2026-11-09, deployed): no more camera blink.** Karim (emulator test): every ~5 s all camera pictures flashed black for an
   instant. Cause: the 5 s heartbeat (online dots) and every move rebuild the corners' innerHTML; the picture's <canvas> was
   thrown away and a fresh, black one waited for the next draw tick (up to ~70 ms). Since v216 (the canvas approach).
   Fix: `LIVE.cvs[id]` keeps each player's drawn canvases; `voiceMountVideos` re-attaches one of the right size instead of
   creating a new one, so the last frame stays on screen through the rebuild. verify.js checks node and pixels survive.
74. ✅ **v240 (2026-11-09, deployed): the unturned frame fills the screen.** Karim's iPhone (v239 lobby): dark bands above and below
   the lobby, the tab bar no longer on the bottom edge. Cause: rotate.html always kept the frame inside the phone's safe
   area, and html.framed zeroed the app's own insets, so in the lobby (unturned) nobody drew into the status-bar and home-bar
   strips. Now: unturned, the frame covers the whole screen and the angle message also carries the host's insets
   (`sa`), the home-screen viewport gap (`gap`, see fitAppHeight), `standalone` and the orientation; the app sets
   `--sa-*`, `--vp-gap` / `html.ios-pwa` and `body.cut-l/r` (markCutSide now uses the host's orientation when
   framed) from them, so it lays out exactly like the plain v214 page. Turned, the host keeps the frame inside the safe
   area and the app's insets stay zero (item 66). `tests/device/frame.js` fakes the 62/34 insets on the host and checks
   both states plus the way back to the lobby.
75. ✅ **v241 (2026-11-09, deployed): the strip under the lobby's tab bar.** Karim's iPhone on v240: top fixed, but a dark band
   still sat under the tab bar. It is the strip below the home-screen app's short viewport (item 21): iOS fills it with
   the PAGE's background, and inside the sideways frame that page is rotate.html (brown), not index.html (whose
   `body.inlobby` paints it in the tab bar's colour). Now the app also tells the host `inlobby`, and rotate.html's
   `body.inlobby{background:#120903}` paints the strip; the host applies its body classes before the "geometry
   unchanged" early return (they were skipped whenever the frame did not move, so a player outside the sideways list
   never got the sea colour in a game either). frame.js checks the host colour in the lobby and in a game.
76. ✅ **v243 (2026-11-09, deployed): opaque iPhone status bar (design canvas board 10, Karim chose B).** v242's diagnostic line on
   Karim's 16 Pro: host 402x812 of a 402x874 screen, insets 62/0/34/0. So the 62 pt strip under the lobby's tab bar was
   exactly the status-bar strip iOS withholds from a home-screen app with a translucent status bar (item 21), the v214
   geometry, not something the frame added. Now `apple-mobile-web-app-status-bar-style` is `black` (index.html and
   rotate.html): a solid black status bar, the page starts below it and reaches the real bottom edge, so the Play / Chat /
   Stats buttons sit right above the home indicator. `hostGap` (rotate.html) and `--vp-gap` (fitAppHeight) are 0 now,
   on purpose: the old correction would have pushed the bar onto the home indicator. In the turned game the phone's top
   edge (the board's right side) is a black band instead of sea; the frame was already kept clear of it. Everyone gets the
   new status bar on their next launch (the meta is read at launch). The v242 diagnostic line stays for the test players
   until the phone confirms insets 0/0/34/0. Mocks: canvas "Catan: Design & UX sweep" board 10 (real renders, A vs B).
77. ✅ **v244 (2026-11-09, deployed): the status bar style is baked in per install.** v243 on Karim's 16 Pro: still translucent
   (insets 62/0/34/0, viewport 812), and the tab bar 26 pt taller because v243 had switched the item-21 correction off.
   iOS captures `apple-mobile-web-app-status-bar-style` when the icon is added; a changed meta only applies to a fresh
   "Add to Home Screen". So `hostGap` (rotate.html) and `fitAppHeight` (app.js) now apply the correction only while the
   measured top inset is > 0 (page under the status bar = translucent install) and 0 otherwise (opaque install). The meta
   stays `black`: whether a re-added icon gets the opaque bar is being checked on Karim's phone; if it does, option B is
   only for re-installs and the friends keep A until they re-add the icon.
78. ✅ **v245 (2026-11-09, deployed): status bar confirmed, diagnostic line removed.** Karim deleted the icon and re-added it: black
   status bar, insets 0/0/34/0, the Play / Chat / Stats buttons right above the home indicator (option B works, for icons
   added from v243 on). The v242 numbers line under the version is gone (app.js `hostDiagLine`, rotate.html `vp`).
   State of play: an icon added before v243 keeps the translucent bar and the v242 geometry (bar-coloured 62 pt strip)
   until its owner re-adds the icon; v244's inset test makes both layouts correct at once. Nothing to do for the friends
   unless they want the new look: delete the icon, open the site in Safari, Share -> Add to Home Screen.
79. ✅ **v246 (2026-11-09, deployed): the turned board gets the home-indicator strip back.** Karim: with rotation lock on the corners
   were a size smaller than in real landscape. Cause: the host kept the turned frame clear of BOTH long-edge strips (status
   bar 62 + home indicator 34), so the game was 778 pt wide and fell under the 800 pt "big corners" tier that real landscape
   (874) meets. Now the turned frame runs to the phone's bottom edge and the app gets the 34 pt as its right inset (`--sa-r`;
   left when flipped): corners step in 15% of it as for the cutout, and `html.sideturned` moves the round menu, trophy and
   dice buttons in by it (the home indicator sits mid-edge, exactly where the menu button is). A fresh icon (opaque status
   bar) now gets 812 pt: big tier in both modes. An icon added before v243 keeps the 62 pt status-bar strip outside the
   frame (white time over the corners otherwise): 750 pt, medium tier, until re-added. frame.js checks the width, the inset
   and the menu button's step-in.
80. ✅ **v247 (2026-11-09, deployed): medium corners everywhere; cutout diagnostic.** Karim: the big corners (v217's 800+ tier) feel
   clunky, and they only showed at some widths (lock off 874, turned fresh icon 812, old icon 750), so the size changed with
   the rotation lock. The 800+ tier (104x108 pictures, 30px badges, 26px name-row badges) is retired; the 740+ tier
   (80x84) is the top size on every phone. Also: with lock off, camera on the right, the round menu button sits under the
   Dynamic Island in BOTH landscape directions (so not the orientation sign, item 58): the side inset reaching the app is
   0. A temporary in-game line (`sideDiag`, test players only: the host's innerWidth/Height, window.orientation,
   screen.orientation, its insets, what it sent, the app's --sa-r/l and cut class) shows what the iPhone reports; remove
   it with the fix.
81. ✅ **v248 (2026-11-09, deployed): menu button clear of the Dynamic Island in real landscape.** v247's diagnostic on Karim's
   16 Pro, lock off, landscape: host 874x402, `window.orientation` 0, `screen.orientation` portrait-primary/0, insets
   0/62/20/62. So the iOS home-screen app never says which way it was turned (item 58's sign question is moot: the value is
   0), and its side insets are symmetric, so the camera side cannot be known. `markCutSide` now sets BOTH `cut-l` and
   `cut-r` when the orientation is 0 in landscape with a side inset (not on the turned board, where the inset is the
   home-indicator strip): the round menu / trophy / dice buttons step in by the inset whichever way the phone is held, a
   small cost on the camera-free side, no button under the island. Applies to the plain page too (the friends' installs).
   The diagnostic line is gone. Headless: orientation 0 + symmetric insets -> both classes, menu button 66 px in.
82. ✅ **v249 (2026-11-09, deployed): dice in one spot per corner; practice table with four players and slower rolls.** Karim: the
   last roll's dice felt like a different spot at every corner, and under the cutout on the left. They were centred on the
   left corners and left-aligned (off the menu button, v221) on the right ones. Now every corner hangs them off its
   board-side edge: above a bottom corner, below a top one, right-aligned on the left corners, left-aligned on the right
   ones (`.pdice` rules; v221's vlive-only rule retired). Practice table: a third computer player, Tabbouleh (audio only,
   like Kibbeh), so all four corners are in play; a computer player's roll now sits for 4 s before its next move (was
   0.6 s). Checked headless at 874x402: the dice edge within 2 px of each corner's inner edge on all four corners.
83. ✅ **2026-11-09: voice & video and the sideways board opened to everyone** (release step 3). voice-config.json is
   `{ "enabled": true }` again: no "only" list, no "sidewaysOnly" list. Karim's two-device test (iPhone 16 Pro + the Android
   emulator) passed the checklist; the friends get the features on their next lobby visit (the config is read every few
   seconds). Kill switch: `"enabled": false`; to re-limit, put the lists back (item 71). Known: an icon added before v243
   keeps the translucent status bar and the strip under the lobby's tab bar until re-added (Karim is telling the friends to
   delete and re-add the icon). Watch the LiveKit dashboard: the free tier is 5,000 minutes a month, a four-player evening on
   the call is ~480. First real Android run (Lapen's Pixel) is the remaining real-device check.
84. ✅ **v250 (2026-11-10, deployed): your own white flag pinned on your portrait, tap to lower.**
   Karim: his own flag was hidden. It sat beside his corner, under the 😀 💬 🎤 row (v214). Tried first: on top of the
   corner panel, but your last-roll dice land there and on a 16 Pro (camera on your side, voice on) the island clipped it.
   Now `.pflag.mine` sits on the top-left of your picture (24px, still waving), clear of dice, island, robbed pill and
   talk row at 874x402 (voice on/off), 667x375 and 568x320. Tapping it opens "Lower your white flag?"
   (`CATAN.flagTap` -> the existing `lowerFlag`). Opponents' flags unchanged (beside their corner: louder, and their
   pictures carry the unread dot and trade answers). The Leave dialog still raises/lowers too.
85. ✅ **v251 (2026-11-10, deployed): Monopoly is a staged show on every screen** (built as v250 in a parallel session, renumbered on merge). Karim: Monopoly was too
   fast, he only noticed it from the commentary. Before: only the player who played it saw a quick fly (110 ms apart, one
   sound); everyone else saw nothing but the counts jump and a banner that gave the total away. Now, on every screen: a
   centred card ("Monopoly! / Ramzi takes every / [icon] Brick", 1.5 s), then it slides up and a tally appears; each opponent
   in seat order gets a red ring with "−3" (grey "0" if they had none) and their cards fly face-up one by one (240 ms apart,
   160 ms when more than 12) into the player's corner, the tally and the hands ticking per card; it ends on "+7 Brick" with
   a green ring on the taker, and only then the banner line ("Ramzi played Monopoly on Brick: took 7 💰"). Nobody had any:
   "Nobody had any Brick 😬". Observers detect it from the engine log line (`detectMonopoly`), which also stops a one-card
   Monopoly being misread as a robber steal or a bank trade. Non-blocking, follows the animation-speed setting. A
   7-card, 3-player Monopoly takes ~7 s. `showMonopolyFly` in app.js, `.monoshow`/`.monoring` CSS in index.html.
86. ✅ **v252 (2026-11-10, deployed): "cards disappeared" during bank/port exchanges** (built as v250 in a parallel session, renumbered on merge). Players
   reported cards vanishing when exchanging with the bank (e.g. 12 for 3). Cause found in code (not reproduced on a phone):
   an N-card exchange was N separate `bankTrade` moves, each saved separately, so (a) a dropped save could leave part of the
   exchange undone, and (b) this phone's own realtime echoes, arriving before the HTTP reply, were drawn as news, so the
   hand stepped back through the in-between states (cards vanish, then return). Fix: engine action `bankExchange {give,want}`
   (whole bundles at each resource's ratio, one card back per bundle, all-or-nothing; refused whole if it doesn't add up or
   the bank can't cover it), dispatched once by `CATAN.tradeBank`; failure toasts "Exchange didn't go through: …".
   Every write now stamps `state._w = NET.myId`; `NET.onRow` skips rows with my stamp while `NET.inflight > 0`, leaving
   `NET.version` alone so the next save still sees the row moved and applies the merged result. Verified: engine test
   (35/35), headless run with a fake Supabase (one save per exchange, totals conserved, dropped save rolls back cleanly,
   landed-but-reply-lost keeps the whole exchange once, no step back; the control without the skip shows 2>1>2).
   Next (agreed, not built): audit-log trigger + 19-per-resource guard in the database, block outdated app versions, a
   "Report a problem" button. The card engine itself was checked: no path found that destroys cards.
87. ✅ **v253 (2026-11-10, deployed together with v254; SQL `server/migrate-audit.sql` run by Karim 2026-11-10): card guard + audit log.** Follows item 86.
   `server/migrate-audit.sql` (Karim runs it in the Supabase SQL editor): `catan_card_problems(state)` checks each resource
   across hands + bank is 19, nothing below 0, knights (deck + hands + `playedKnights`) 14, VP cards 5, road building /
   year of plenty / monopoly at most 2 each (played ones aren't kept in the state, so "exactly 25" can't be checked). A
   BEFORE trigger on `games` refuses (returns null: the phone's version-guarded save gets 0 rows, retries, then re-syncs)
   any write that breaks those rules, unless the game was already broken before (never freezes a legacy game), and logs to
   `game_audit` every write that changed anyone's cards or the bank: per-player deltas, bank delta, writer device
   (`state._w`), app version (`state._av`), move (`state._a`), whose turn, problems, refused. Kept 30 days; RLS on with no
   policies, so only the SQL editor can read it. The app stamps `_av`/`_a` on every write and runs the same check
   (`cardProblems`) before saving: a bad move is never sent, the phone goes back to the server's copy with a toast. Note:
   a pre-v253 phone copies the previous writer's `_w/_av/_a`, so the log can misattribute its writes until old builds are
   blocked (next step). Verified: migration on local Postgres 16 (twice, idempotent): lost brick and lost knight refused,
   valid moves/played knight/played monopoly saved and logged, legacy broken game not frozen, new game and reset pass,
   anon can't read the log; simulation test now also checks the dev-card rules (35/35); headless fake-server run 18/18
   incl. an injected card-losing engine (not saved, phone back on server copy). To investigate a report:
   `select * from game_audit where code = 'TABLE' order by at desc limit 50;`
88. ✅ **v254 (2026-11-10, deployed; SQL `server/migrate-audit-2.sql` run by Karim 2026-11-10): outdated builds
   are blocked.** The update path (index.html `controllerchange` -> `catanUpdatePending`) never reloads while `catanBusy()`,
   which is true whenever the phone sits at a table, so a phone parked at the Main Game could run an old build for days.
   New `prototype/version.json` `{ "min": "vNNN" }` (network-first in sw.js). `APPGATE` in app.js reads it every 60 s (5 s
   heartbeat, throttled) and on every return to the app; below the minimum: an "A new version is out. Update to keep
   playing." bar (#appgate, top, above everything), `dispatch` refuses moves online, and the phone reloads by itself at a
   calm moment (not its turn, not a countdown, not typing; at most once per 2 min via sessionStorage so an offline
   phone can't loop). A mid-game reload walks back into the game (LOBBY.join). **Bump `min` by hand only for a release
   that matters for the game's integrity**; cosmetic deploys leave it, so nobody is reloaded mid-game for them.
   Builds before v254 can't read it; for those, every save now carries a fresh tag `state._n` (writeNonce), and the
   database marks a save whose tag is missing or copied as `old_build` with app "before v254" and no writer/move, instead
   of naming the previous phone. migrate-audit.sql is updated to include this for fresh installs. Verified: migration on
   local Postgres 16 on top of the v253 install (twice) and fresh; headless: gate detects min v255, bar shows, moves
   blocked, no reload on own turn, reloads when not, no reload loop, current build unblocked (7/7); exchange/sync suite
   19/19 incl. a fresh tag on every save.
89. ✅ **v255 (2026-11-10, deployed; built on branch claude/ecstatic-turing-02d47u): Monopoly try-out on the practice table.** Karim wanted to see the v251 Monopoly show without a real game. "Jump into a game in progress" now plants it: signed in as `test` you land with a playable Monopoly card and the computers holding 2-3 extra Wheat each (toast: roll, then play it); as `test2` you land with 5 extra Brick and the computer after you holds a Monopoly, which it plays on its first move (toast: end your turn and watch). Cards come from the bank and the dev deck, so totals stay true. Computer players now play Monopoly whenever they hold one and it nets 3+ cards, aiming at the resource that hurts most with the human's cards counted double (same spirit as the robber), and skip the pre-roll Knight while holding one. Not on "Skip to a victory screen". `practiceMonopolySetup` in app.js. Verified headless (rotate frame, 900x700): test took 10-13 Wheat in every run where the scripted roll landed; test2 8 of 8 runs saw Zaatar monopolise Brick with the show on screen. Engine tests 35/35.
90. ✅ **v256 (2026-11-10, deployed; built on branch claude/busy-wright-3fnlte): updates reach phones at the next launch.** GitHub Pages' CDN caches files for up to 10 minutes (max-age 600), and `cache:'reload'` only skips the browser's own cache, so a phone could still get the old app.js or index.html from the CDN for up to ten minutes after a deploy. `networkFirst` in `sw.js` now fetches same-origin files (index.html, app.js, rotate.html, catan-engine.js, voice-config.json, version.json) with `?cb=<current minute>` added, so the CDN treats each minute as a new URL; the service-worker cache is still stored and matched under the original URL. Cross-origin requests unchanged. Result: a deploy shows on phones at the next launch instead of up to ten minutes later. The service-worker file itself can still lag up to ten minutes, which only delays the "reload at a calm moment", not the new code. Engine tests 35/35.

91. ✅ **v257 (2026-11-10, deployed; built on branch claude/ecstatic-turing-02d47u): Monopoly has its own sound.** Karim: the show opened with the Knight sound, so a Monopoly sounded like a Knight. Chosen from a sound board (artifact https://claude.ai/artifact/7tkrkNS2TQTmFjbM6UPyum, five options plus a mixer, replaying the show at game timings): the card now appears with the robber sound ("you are being robbed"), and each player who loses cards gets a whoosh as their ring appears; the per-card resource sound and the closing trade sound are unchanged. No new files. A player with none gets no whoosh (the board played one for them too). `showMonopolyFly` in app.js. Verified headless with playSound spied: robber +0 ms, whoosh +1500, resource per card from +1880, trade at the end, for both test (me playing it) and test2 (a computer playing it on me). Engine tests 35/35.

92. ✅ **v258 (2026-11-10, deployed; built on branch claude/ecstatic-turing-02d47u): no auto-zoom during a Monopoly; practice computers pace like people.** Karim tried the test2 Monopoly with auto-zoom on: the computer fired Monopoly, a trade and a road back to back, and the camera kept zooming. (1) A Monopoly (mine or anyone's) drops a running auto-zoom and glides back to the whole board before the show (`monoCamHome`, called before the card counts are held, since cancelCine clears held counts); while `.monoshow` is on screen every auto-zoom path is off (`cineOK()` replaces `SETTINGS.autozoom` in runCine, cinematicRoll and the setup grant), so cards still fly, just without the camera. A manual zoom is left alone. (2) Practice table: computers wait for a Monopoly show to finish plus 2 s, and each main-phase move gets 2-4 s of thinking (was 0.9 s). Verified headless (test2, auto-zoom on): roll, Monopoly 4 s later, zoom 1.0 for the whole show, next move ~3 s after it ends. Engine tests 35/35.

93. ✅ **v259 (2026-11-10, deployed; built on branch claude/relaxed-hamilton-igr7v8): watchers sit in the sea around the island, with video and chat.** Karim: a spectator should also be able to use video and chat. Before, watchers were in the call (switches in their bottom bar) but their camera was a 30px circle in the banner (which wrapped at 667) and they had no 😀/💬. A first take put them in a column down the left edge; Karim rejected it (it sat on the left players' dice and your own chat buttons, and the watcher's bottom bar was odd and scrolled). After mock-ups (a tab under the banner that grew when someone talked, an on-demand panel), Karim chose his own idea: **faces floating in the sea around the island**. (1) `renderWatchRail` / `placeWatchers` (`#watchrail`, a full-screen click-through layer): each watcher is a 44px round face, the same size on every phone and never growing, placed on an ellipse 26px off the coast (`boardBox` = the hex tiles' bounds): left of the island at mid-height, right of it, lower right, upper right (`WSPOTS`); a fifth+ watcher folds the last spot into "+N" (tap = the names). Live camera, white talking glow, mic badge, unread dot; tap = their messages + "Mute X for me". While the board is zoomed in (`zoom.s > 1.03`) the faces fade to 18% and stop taking taps; `zApply` / `cineApply` re-place them. Tap "👁 N" in the banner to hide/show them on this phone (`wHidden`, localStorage `catanHideWatchers`); a watcher's own face stays. Checked headless at 932/812/667: no overlap with corners, dice, luck gauges, chat buttons, banner, bottom bar or menu tab. (2) **A watcher's own face** takes the left spot: camera + mic badges are the switches (as on a player's picture), 😀 💬 sit under it (same trays: emojis, texts, voice note, hold-and-drag throws at a player). Before the call connects, tapping it opens the voice card. (3) **A watcher's bottom bar** is only the cards of the player they're looking at (no player chips, no scrolling, no Leave: the menu has "Stop"). Tapping a player's corner looks at their cards (tap again = follow whoever's up); that corner shows "👁 viewing" (`.pviewing`). The game-over bar is unchanged. (4) **Chat plumbing**: messages go out with colour null and the player id (`messages.sender`, already in the table: no SQL); phones key them `w:<player id>` (`meKey`, `isWKey`), which `cornerOf`, `logMsg`, `showMsgHistory` and the bubbles take like a seat colour. Bubbles sit beside the face toward the board (`.b-side`, `.b-sider` for faces on the right); emojis fly from the face. Older builds show a watcher's text as the top toast and ignore their emojis. Not verified: real phones, a real call, the sideways (turned) board. The 568-wide bottom-bar overflow in `handfit.js` is the same on main. Engine tests 35/35.

94. ✅ **v260 (2026-11-11, deployed; built on branch claude/fervent-planck-bp2wct): trading, ask for anything, counter anything.** Karim (game night): offering 1 ore, the wood wouldn't swipe down. Cause: `tSetNet` capped what you could ask for at the most any other player held (since v232), so with nobody holding wood the swipe silently did nothing, and the cap also revealed hidden hands. Mocked first (main canvas, section "Trading: ask for anything, counter anything", boards TR-A0..TR-D3), then built all four. (A) Asking from the table is free (cap 19, every card of that resource); give is still capped by your hand; a counter can still only ask for what the offerer holds. (B) A swipe that changes nothing says why: the column shakes (`.tshake`), a 40 ms buzz, and a 2 s line above the table (`tradeRefused`, `.tflash`): "You only have 3 ore", "You have no brick", "4 wheat buys 1 card (you have 1)", "The bank has no wood left", "Karim only has 2 ore". (C) A player who can't cover an offer is no longer auto-declined: they see it, the missing card is outlined (`.tslot.short`), ✓ stays hidden, and a line says "You have no wood. Swap it for something you have, or decline." (`tradeShortSync`, `.tmsg`); swapping it makes ✓ send a counter. The pre-filled short card can be swiped out but not up. Auto-decline-this-turn unchanged. (D) Open requests: online, an offer may give nothing ("Ask the table" title); responders see "Karim needs 1 wood · what do you want for it?", their wood pre-filled, ✓ only once they name a price (sent as a counter); the offerer's bar says "You asked for 1 wood" and "N replies. Tap a ? …". Not in hotseat (responders there can't counter). Engine: an offer must ask for something (`anyCards`), a plain accept of an open request is refused, a counter must give and receive something; 1 new test (36). Practice computers answer an open request with a counter for 1 of what you hold most of, never a plain accept. An older build receiving an open request could accept it as a gift (its engine lacks the check) until it updates. Verified headless at 844x390 (26 checks: A-D flows, wording, ✓ visibility, the counter and open-request state, bot answer, hotseat refusal). Not verified: real phones (buzz, shake feel). **Practice table (test / test2), for trying it:** the computers now offer me trades on their turns (most turns, `botOffer`), cycling one I can't cover, an open request and a plain one; the other computers pass at once, the offerer waits up to 45 s for my answer, then trades on it (accept or counter) or withdraws (`botOfferStep`). Computers short of what I ask counter with their biggest piles instead of always declining. "Jump into a game in progress" sets up a try-out (`practiceTradeSetup`, replacing the v258 Monopoly try-out): test lands already rolled (a 5 paying nothing, so the automatic roll can't hand anyone wood) with 3 ore and nobody at the table holding wood; test2 lands with no wood and no wheat. Verified headless: three bot offers in turn (short, open, plain), each answered from the reply sheet and traded on; a decline withdraws; with no wood around, computers counter (10 counters over 6 offers x 3 computers).

95. ✅ **v261 (2026-11-11, deployed; built on branch claude/confident-brown-ns95wp): 3 minutes in the background and you leave the call.** Karim: a phone left in a pocket (mostly Android: iPhones usually drop by themselves) stayed in the table's call all night, using LiveKit minutes (every connected person counts, listeners included; muting saves data, not minutes) and listening. Now `voiceWanted()` returns null once the app has been hidden for `VOICE_AWAY_MS` (3 min, `LIVE.hidAt` set on visibilitychange), so `voiceSync` leaves through `voicePark()`: like `voiceLeave` but it keeps `autoDone` (the rejoin keeps the mic OFF) and your own mutes, and remembers the call in `LIVE.parked`. Back in the app: rejoin at once (not at the next 2 s check) with the toast "Voice back · your mic is off"; if you're no longer at that table, nothing rejoins and the mutes are dropped. Mic and camera still go off the moment the app is hidden (unchanged), so the 3 min are only a grace period for a quick look at another app. Others simply see you out of the call. A one-off `setTimeout` at hide makes the leave happen on time even though the 2 s check is slowed in the background; a frozen page drops out anyway. Verified headless with a fake LiveKit room and a skewed clock, 8/8: 2 min away keeps the call, 3 min leaves it, no rejoin while still hidden, rejoin on return with mic off + toast + mutes kept, no rejoin after leaving the table. Not verifiable here: a real Android in a pocket (does Chrome keep the page alive for 3 min, does the rejoin work on unlock); first check on Lapen's Pixel.
96. ✅ **v262 (2026-11-12, deployed; built on branch claude/cool-dirac-dtydqh): Stats, cups become part of the games.** Karim on Stats · November saw the 2el3ab Cup, which was played on 27 Oct (2 of 3 games, ended early by the 6h rule): the old `cupsHTML` card showed every cup whatever the filter, and each cup game also appeared again in Recent games tagged "cup". Mocked on the design & UX canvas (board 11), then built; real screenshots with the 175 real games on board 12. (1) Order: podium, Recent games, rest of the leaderboard, note ("Cup games count too"). (2) Recent games fold a cup's games into one gold card at its latest game (`cupCardHTML`; the newest cup on screen is open with its games, older ones one line; "Nasam won 2el3ab Cup · 2 of 3 games, ended early · Ramzi 2nd"). Only cups with a game in the filtered games show, so month and size filters apply. (3) A trophy tag on podium and leaderboard names = finished cups won in the games on screen (`cupWins`, `trophyTag`; lifetime on All-time). (4) Tap a cup: `statsCupScreen` (champion, cup table with total VP and cup points from the last game's `cup.cp`, the points rule, games with board links, unplayed games of an ended-early cup). (5) "Show more games" adds 12 items (`statsMore`, reset by any filter), so older cups are reachable on All-time. The Cups card (`cupsHTML`, `.st2cup/.st2tally/.st2cupl`) is gone; the player page's Cups won tile is unchanged. Cup games always counted as normal wins/losses (`STATS.board` never excluded them). Verified headless with the real data (read-only select): Oct, Nov, All-time (+ show more x2 brings both cups), both cup pages (points match the stored cp), 4-player filter hides the 3-player cups. (6) Size filter default is "3 & 4 players" (`statsCount = 'big'`, Karim: the group doesn't count 2-player games); "All sizes" and 2/3/4 players stay in the select. With the real data this changes the all-time podium: all sizes = Ramzi 40%, Lapen, Kay; 3 & 4 = Nasam 34%, Ramzi 33%, Lapen 33%. (7) A player's page has the same size select (one shared `statsCount`; `statsSizes`, `sizeGames`, `sizeSelHTML`): win %, rank, last-10 strip, tiles, cups won and head to head all follow it (`STATS.detail/streak/h2h` take a games list); a size with no games for that player says so. Checked with Ramzi: 3 & 4 = 33% #2, all = 40% #1, 3p 21/55 + 4p 1/12 = 22/67. Engine tests 36/36. Not verified: a real phone (narrower than the 500px headless minimum).

### Also shipped since multiplayer (2026-06)

- **Concurrent games (table list).** The single hardcoded `'TABLE'` is gone — each game is a
  `games` row keyed by a code; the lobby lists active games to join/watch + "New game"; each
  client subscribes only to its own game's row, so independent games run side by side. The
  "table" is a presence grouping (`presence.table`) until a game starts. (Code still calls the
  internal concept "table"; the UI says "game".)
- **Player profiles.** Photo upload (file picker → reposition/zoom cropper → 256px JPEG stored
  base64 in `players.avatar`), nickname change, change PIN — under "Manage Profile". Avatars show
  on the home picker, lobby rows, and in-game corners. Requires `server/migrate-profiles.sql`.
- **Portrait pre-game.** Login / lobby / setup work in portrait; only the board is landscape
  (gated by `body.ingame`; since v230 rotate.html turns it sideways for you, §8 item 63). Tapping a name focuses the PIN synchronously so iOS opens the keyboard.
- **Settings gear** shows only while the radial is open; **music** is a 3-track looping playlist.
- **The `.ghost` trap (fixed, worth remembering):** an SVG `<style>` applies document-wide, so a
  bare `.ghost{pointer-events:none}` in the board SVG silently disabled every `.btn.ghost`. Scope
  SVG `<style>` rules.

### Shipped (2026-06-30 session)

- **Auto-zoom / cinematic camera** (behind the existing Auto-zoom setting, per-device, off-able): on
  every screen the camera glides to the action and back — the **dice-roll tours each producing terrain**
  in turn (cards fly from the terrain centre), **robber** placement, and **settlement/city/road** builds.
  The placer zooms in close (and in setup holds the frame through their road); observers get a gentle
  pan, or nothing at full-board view. Built on a `zoom {s,tx,ty}` CSS transform on `#board-area`; any
  manual pan/pinch cancels it. **Note:** that transform doesn't render in headless screenshots — verify on device.
- **Robber arc** — the robber lifts off its hex, arcs across the board (raised + enlarged), and lands
  full-size, for everyone (was a teleport for observers). Own `robberfly` keyframe.
- **Card counts sync to the animation** — a player's resource count holds at the old value and ticks
  up/down as each card lands/leaves: roll production, steal (victim down, thief up), player + bank/port
  trades (both sides), and the 2nd-settlement grant. Two-sided lag (`ui.cardLag` in, `ui.cardOut` out),
  set at detection so the new value never flashes first; `onlift`/`onland` on `flyImage` tick it.
- **Balanced boards + randomized harbours** — official Variable setup (random terrain/numbers, 6/8 never
  adjacent) PLUS house rules: no two equal numbers adjacent, and a pip-cap of 12 at any settlement spot
  (mathematically == no spot fed by 3 high-odds {5,6,8,9} hexes). Harbour *types* now shuffled each game.
  All in `engine/src/board.ts`.
- **City-build fix** — placement ghosts now render ON TOP of the buildings (a z-order regression had
  hidden the city-upgrade marker behind the settlement, blocking the tap); the upgrade marker blinks.
- **Resource flies launch from the terrain centre** (was offset), robust to mid-glide timing.
- **Radial menu** — labels removed, ~20% smaller, and the emoji buttons (chat + leave) reframed to match
  the icon buttons' blue/gold glossy circle.
- **Roll-7 robber prompt** — dropped the dark overlay on every hex (now invisible tap targets); the
  robber gets a gentle gold pulse instead.
- **Cache reliability** — a `v##` build stamp in the bottom-left corner (`APP_VERSION`, bumped with the
  SW `VERSION`); the SW fetches code with `cache:'reload'` (bypass the HTTP cache); the page auto-reloads
  when a new worker takes over (unless mid-game). **Caveat:** GitHub Pages still takes a few minutes to
  publish each push, so the live site lags a deploy by a few minutes.
- **Smaller fixes:** stuck "X is discarding" overlay after a 7 now cleared on every screen; your own VP
  dev cards count in your own star total (opponents stay hidden); robber-move/auto-steal sync race fixed
  (serialized + ordered the row writes); a lone ✗ to cancel a build mid-placement; observer-side
  animations for steal (face-down to non-parties), dev-card buy, and bank trade; portrait-lock for the
  pre-game screens on phones (touch only); the lobby card re-fits when players join.

### Dice stats (v129, 2026-10-20)

- The engine logs every dice total in `state.rolls` (shared via the games row; games saved before
  v129 start logging from their next roll). Lives with the game only — nothing written to Supabase.
- In-game: a round chart button under the radial tab (`#dicetab`, hidden during setup and behind
  dialogs) opens a bar chart of 2–12, with gold ticks for the fair-dice expectation. Tap a column
  for "8 came up 7 times · fair dice 6.5 (+0.5)"; the default line is 7s rolled vs expected.
- Victory screen: a "📊 Dice stats" button opens the same chart; Back returns to the victory
  screen without replaying the fanfare (`showVictory(true)`).

### End of game (v130, 2026-10-20)

- **Leaving a finished game only moves you.** "Back to lobby" (`CATAN.leaveEnded`) and a seated
  player's Leave on an ended game no longer idle the games row, so the others keep the final board.
  `onRow` ignores an ended row for anyone not already looking at it (no re-entry, no Watch), and
  `startTable` may overwrite an ended row (purging its chat/voice). Only a Rematch or a new game at
  the table moves people. The 9s surrender auto-reset is gone. Stale ended rows go via the 6h purge.
- **Final board view.** "🗺️ View board" (or tap outside the victory card) dismisses the victory
  (`endView` stops `afterAction` re-popping it). Banner: "Game over — X wins · Results ›" (tappable);
  a 🏆 tab in the radial tab's spot reopens the results. Everything is revealed: corners count every
  VP card, and the hand bar lets anyone flip through each player's hand + unplayed dev cards.

### Sound dropping out until relaunch (v131, 2026-10-20)

- Reported: SFX sometimes silent until the app is relaunched. Not reproduced (no iPhone in the loop).
  Likely cause: the single Web Audio context dies on iOS and was never rebuilt. After a call, Siri,
  another app's audio or a lock it goes `'interrupted'`, which the old `state === 'suspended'` check
  never resumed. After a voice-note recording (mic → record mode) or a headphone switch it can stay
  `'running'` but silent.
- Fix: `unlockAudio` (every tap) rebuilds the context when it isn't running, after any return from
  the background (`onAudioWake` marks it stale) and after a voice note (`audioStale` in
  `VOICE._teardown`). Throttled to once a second. Decoded buffers are reused across contexts, and
  failed sound loads are retried on later taps.
- Diagnostic: Settings shows "Sound engine: <state> · N/16 sounds · rebuilt N×". If someone still
  hears nothing while it reads `running · 16/16`, the cause is outside the engine (volume, Bluetooth
  route, Focus mode).

### "Express yourself" + awards (planned and built 2026-10-20: v132 awards, v133 chat, v134 narrator)

Implementation notes: tallies live in `state.tally` (engine: `tallyRoll`, robber cost in `produce` +
`steal`). Emoji travel as `messages.type = 'emoji'` (body = emoji, dur = tap count, url =
`m:<moment key>`), so no migration was needed; v131 clients show them as plain bubbles. v138: emoji runs stream in ~0.5s chunks,
`url = r:<run>|t:<tap offsets ms>|m:<moment>`; receivers replay the sender's rhythm (`emoPlay`). Moment keys
are shared log indices (`L<i>`, `longestRoadOwner:<logLen>`), so reactions from every phone land on the
same pill. `noteMoments` + `narrate` run next to `announceFromLog` in both `dispatch` and
`applyRemoteState`. Narrator memory resets per board.

Context: the group plays WITHOUT a voice call and spectating is rare, so the app is the only table
talk. Goal: make the table feel alive (live-stream mechanics adapted to 2–4 players, not a comment
stream). Three rounds, one deploy each:

1. **Awards + tallies.** Engine tallies per player: robber cost (cards stolen + production blocked by
   the robber) and "numbers hit vs normal" (each roll: did a number on a hex your buildings touch come
   up; normal = sum of those numbers' odds). Victory screen: 🦹 Robber magnet, 🍀 Blessed / 💀 Cursed
   by the dice ("Alex's numbers came up 14 times. Normal is about 9."), each only past a threshold.
   Dice stats gets a per-player "luck so far" line. Game-level only.
2. **Alive table.** 💬 opens a 7-emoji tray from your portrait (😂 😡 😭 🔥 🙏 👀 🫠), "more" opens the old
   picker. Emoji are spammable bursts with combo counts (no cooldown; taps batched into one message).
   Reactions attach to banner events ("Sam stole from Alex · 😂 3 😡 1"). Suggested one-tap chip by
   your portrait on notable events, for the involved player AND bystanders; never mid-action, ≤1/10s.
3. **Narrator.** Occasional banner commentary from the tallies ("No 8 for 11 rolls", "Sam is one point
   away"), at most one every few turns.

Out of scope: spectator reactions, scrolling comment stream, other awards, per-player tray
customisation, lifetime awards in Stats, replay (#8).

### Older notes (some now done — left for history)

- ~~3–4 players only~~ → **2–4 players** now (2p = 15 pts). 5–6 still needs a 5th+ colour's piece
  art (and 6 would also need the larger board / special build phase).
- ~~Player-to-player trade: engine yes, UI no~~ → **trade UI shipped** (propose → respond/accept).
- Roads aren't image-swappable; dice/cards are drawn/text.
- ~~No sound yet~~ → **SFX + music shipped.**
- Board port positions are deterministic but not matched to any specific art.
- ~~No persistence of finished-game history~~ → still open; the leaderboard/stats (#4/#5) close it.

---

NEXT. 🔨 **vNEXT (2026-11-12, built on branch claude/cool-dirac-dtydqh): Stats, the rest of the leaderboard goes back above Recent games.** Karim, after v262: order is now podium, leaderboard (4th down), the ranking note, then Recent games (cup cards and Show more unchanged). Verified headless with the real games (October).

## 9. Continuing in Claude Code — first steps

The early-phase version of this section is gone — multiplayer, the lobby,
persistent identities, art/sound, the PWA, and player profiles are all built and
live. This is the current reality (last refreshed 2026-11-07; CLAUDE.md has the per-change checklist).

### Layout that matters
- `prototype/app.js` (~6,600 lines) — the entire client: rendering, input state
  machine, online sync, lobby/identity/profile UI, animations, audio. The spine is
  still `render()` and `dispatch()`/`afterAction()`. Built into a single inlined
  `catan-standalone.html` by `build.mjs`.
- `prototype/index.html` (~2,000 lines) — markup + all CSS (the source of truth for
  styling; `catan-standalone.html` is generated, never edit it directly).
- `prototype/catan-engine.js` — the TS engine bundled to an IIFE global `Catan`;
  regenerated by `build.mjs` from `engine/src/`. Treat the engine as read-only
  truth — new work is UI + sync, not rules.
- `prototype/supabase-config.js` — `window.SUPA` url + anon key (safe to publish).
- `prototype/sw.js` — service worker. Bump `VERSION` only when an existing cached
  asset's bytes change; code files are network-first so they update on their own.
- `server/*.sql` — the Supabase schema. `schema.sql` (games), `auth.sql` (players +
  identity/PIN RPCs), `migrate-profiles.sql` (the avatar/nickname migration). The
  live Catan DB must be migrated by hand in the Supabase SQL editor — the Supabase
  MCP in this workspace points at Karim's *work* project, not Catan.

### Build / test / ship
- **Build:** `cd prototype && node build.mjs` — rebuilds the engine bundle and
  re-inlines everything into `catan-standalone.html`.
- **Ship:** `./deploy.sh "message"` from the repo root — builds, commits to `main`,
  and `git subtree push`es `prototype/` to the `gh-pages` branch. Live at
  https://karimkabbani.github.io/catan/ . Deploy only when Karim asks.
- **Engine tests:** `cd engine && npm test` — across `tests/board`,
  `tests/engine`, `tests/simulation`.
  - **Platform-binary gotcha (still real):** `engine/node_modules` was populated on
    Linux, so the committed `rollup` native binary is wrong-arch on macOS. If
    `npm test` dies with "Cannot find module @rollup/rollup-darwin-arm64", run
    `npm install @rollup/rollup-darwin-arm64`. `build.mjs` auto-resolves the right
    `@esbuild/<host>` binary, so the standalone build is unaffected.
- **UI verification (the established pattern):** headless Chrome against
  `catan-standalone.html` with an injected driver script that drives `CATAN.*`,
  asserts with a `mark(text, ok)` banner, and screenshots the result line. Use
  `--virtual-time-budget` to let async settle. For online-only flows, inject a fake
  `window.supabase` before load.
  - **Since v175 there are no demo modes** (`?rig`, `?showcase`, `?rpsdemo`, `CATAN.rig/demo` are gone). To reach a
    game state, patch a LOCAL copy of the standalone: replace `window.CATAN = {` with `window.CATAN = { _st: () => state,
    _sv: (q) => showVictory(q), _game: (n, rps) => {…C.createGame(…); online = true; myColor = …; enterGame(s); },` —
    inside the IIFE that hook sees every closure variable. Never ship the hook. Headless Chrome won't go narrower than
    500px, so phone screenshots are laid out at 500 wide.

### What's next
State on 2026-11-09: **v249 is live and voice & video + the sideways board are open to everyone** (items 71-83: perf work,
honest camera badge, no blink, opaque iPhone status bar, medium corners, cutout and dice placement, four-player practice
table). The pre-perf snapshot is branch `saved-v234-voice-sideways`. Next: watch the first real game nights (Lapen's Pixel is
the first real Android run), the LiveKit minutes, and the friends re-adding their icons for the new status bar. Still to confirm on phones:
faces upright (item 65's sign), touch feel on a real iPhone and Android, the chat keyboard sideways, "screen cut". Then pick
from section 8, in order:
0. **Voice & video follow-ups:** watch the first real games (3-4 people, 4G, AirPods, an incoming call, 20 min of camera);
   build the monthly minute counter + 80% warning (needs a table + LiveKit webhook); check whether iPhone re-asks camera/mic
   permission each session; delete the old LiveKit key APIydyY33REnTLq; a regression sweep over v215-v231.
   Not done from the design sweep (canvas "Catan: Design & UX sweep"): 7 victory crown, 8 small polish.
1. **Regression sweep over v208-v214** (walkie + chat v2/v3): due, but Karim said wait.
2. **Undo by unanimous vote** (item 9): fully designed, medium effort, the biggest gameplay gap (misclicks).
3. **Pause, save and resume** (backlog top of §8): designed, ~1 day + sweep; Karim not ready yet, and three
   decisions are his (who can pause, resume needs everyone, auto-save after 30 min).
4. **Chat extras** (item 46): a tray that reorders by each player's own use; a context chip (😡 tfeh after a steal).
5. Parked music idea (item 44): pause the music on the talker's phone, and on listeners' while a voice plays.
6. Small open decision: horned robber, full piece or badge (item 11).
7. **"Report a problem" button** (backlog, Karim 2026-11-10: later): in settings, open to everyone, no passcode. Saves the
   last ~20 moves from `game_audit` (items 86-88) plus the player's note, so a "my cards vanished" report points at the
   exact moment. Repairs stay manual: Karim reads the log in the SQL editor; a host-only "rewind to before this move",
   announced to the table, only if the log shows it's needed (a per-player passcode undo was rejected: it rewinds
   everyone's game and breaks the card totals the guard enforces).
Parked or blocked: game history / replay (item 8); 5-player (item 7, needs a fifth colour's art).
