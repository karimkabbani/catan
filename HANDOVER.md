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

12. ☐ **Walkie-talkie (push-to-talk) — liked, decisions pending (2026-10-22).** A 🎙 next to your portrait:
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

### Also shipped since multiplayer (2026-06)

- **Concurrent games (table list).** The single hardcoded `'TABLE'` is gone — each game is a
  `games` row keyed by a code; the lobby lists active games to join/watch + "New game"; each
  client subscribes only to its own game's row, so independent games run side by side. The
  "table" is a presence grouping (`presence.table`) until a game starts. (Code still calls the
  internal concept "table"; the UI says "game".)
- **Player profiles.** Photo upload (file picker → reposition/zoom cropper → 256px JPEG stored
  base64 in `players.avatar`), nickname change, change PIN — under "Manage Profile". Avatars show
  on the home picker, lobby rows, and in-game corners. Requires `server/migrate-profiles.sql`.
- **Portrait pre-game.** Login / lobby / setup work in portrait; only the board forces landscape
  (gated by `body.ingame`). Tapping a name focuses the PIN synchronously so iOS opens the keyboard.
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

## 9. Continuing in Claude Code — first steps

The early-phase version of this section is gone — multiplayer, the lobby,
persistent identities, art/sound, the PWA, and player profiles are all built and
live. This is the current reality (last refreshed 2026-06-22).

### Layout that matters
- `prototype/app.js` (~2,560 lines) — the entire client: rendering, input state
  machine, online sync, lobby/identity/profile UI, animations, audio. The spine is
  still `render()` and `dispatch()`/`afterAction()`. Built into a single inlined
  `catan-standalone.html` by `build.mjs`.
- `prototype/index.html` (~810 lines) — markup + all CSS (the source of truth for
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
- **Engine tests:** `cd engine && npm test` — ~19 across `tests/board`,
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
Pick from the backlog in **section 8** ("Feature ideas"). The two natural clusters:
leaderboard + tendency stats share one persistent per-identity results table written
at game end; surrender + broadcast both ride the existing realtime/`games`-row
plumbing. Wiring the remaining settings (sfx / animation speed / auto-zoom) is the
smallest standalone win.
