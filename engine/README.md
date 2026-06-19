# Catan rules engine

A pure, framework-agnostic TypeScript engine for base (3–4 player) Catan. No UI,
no network, no clock — just rules. It's the reliable core we'll build the React
UI and Supabase sync around.

## Why it's built this way

- **Pure reducer.** `applyAction(state, action, byColor)` returns a brand-new
  state or an error. It never mutates the input. This is exactly what a
  multiplayer app needs: any client can compute the next state and write it to
  the shared row, and every client recomputes identically.
- **Plain-JSON state.** `GameState` has no class instances, so it serializes
  straight into a Supabase `jsonb` column and diffs cleanly.
- **Deterministic.** All randomness (board, dice, dev-card draws, robber steals)
  flows through a single seeded cursor, `state.rngState`. Same seed + same
  actions → identical game. That's what makes the tests reproducible.

## Usage

```ts
import { createGame, applyAction, currentColor, victoryPoints } from './src';

let state = createGame({
  id: 'room-ABCD',
  players: [
    { color: 'red', name: 'Karim' },
    { color: 'blue', name: 'Sam' },
    { color: 'white', name: 'Alex' },
  ],
  seed: Date.now(),
});

const result = applyAction(state, { type: 'buildSettlement', vertex: 17 }, 'red');
if (result.ok) state = result.state;
else console.log(result.error); // human-readable reason it was rejected
```

## What's implemented

Board generation (19 hexes, correct terrain/token counts, no two red 6/8 tokens
adjacent, 9 ports), snake-order setup with starting resources, dice + resource
production with correct bank-shortage handling, the robber and the 7-discard,
roads / settlements / cities with the distance and connectivity rules, all five
dev cards (knight, road building, year of plenty, monopoly, victory point),
bank/port trading and player-to-player trade offers, longest road (a real
graph search that respects opponent-cut roads), largest army, and win detection
at 10 VP.

## Actions

`rollDice`, `buildRoad`, `buildSettlement`, `buildCity`, `buyDevCard`,
`playKnight`, `playRoadBuilding`, `playYearOfPlenty`, `playMonopoly`,
`moveRobber`, `steal`, `discard`, `bankTrade`, `offerTrade`, `acceptTrade`,
`confirmTrade`, `cancelTrade`, `endTurn`. See `src/engine.ts` for the exact
shapes.

## How the UI should drive it

Read `state.turnPhase` to know what input to ask for:
`roll → main → (moveRobber → steal) / discard → … → endTurn`, plus
`placeSettlement` / `placeRoad` during setup. The board geometry in
`state.board` already carries pixel coordinates (`cx/cy` for hexes, `x/y` for
vertices, midpoints for edges) at unit scale — multiply by a scale factor and
render. Settlements are keyed by vertex id, roads by edge id.

## Tests

```
npm install
npm test
```

19 tests: board geometry/legality, every core mechanic, and a 12-game
simulation that asserts the bank is conserved and no illegal state arises across
thousands of moves.

## Not yet included (deliberate, base game first)

5–6 player extension, the longest-road tie edge case where a tie shouldn't
transfer the title (handled: title only moves on a strict lead), and a hard cap
on trade spam. None affect a normal base game among friends.
```
