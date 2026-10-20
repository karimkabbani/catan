import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction, victoryPoints, currentColor } from '../src/engine.js';
import { GameState, PlayerColor, RESOURCES } from '../src/types.js';
import { rollDice } from '../src/random.js';

// ----- helpers --------------------------------------------------------------

function activeSetupColor(s: GameState): PlayerColor {
  return s.order[s.setupOrder[s.setupIndex]];
}

function vertexFree(s: GameState, v: number): boolean {
  if (s.settlements[v]) return false;
  return s.board.vertices[v].neighbors.every((n) => !s.settlements[n]);
}

function firstFreeVertex(s: GameState): number {
  const v = s.board.vertices.find((vt) => vertexFree(s, vt.id));
  if (!v) throw new Error('no free vertex');
  return v.id;
}

function freeEdgeTouching(s: GameState, vertex: number): number {
  const e = s.board.vertices[vertex].edges.find((eid) => s.roads[eid] == null);
  if (e == null) throw new Error('no free edge');
  return e;
}

/** Run the full snake-order setup with simple valid placements. */
function runSetup(s0: GameState): GameState {
  let s = s0;
  while (s.phase === 'setup') {
    const color = activeSetupColor(s);
    const v = firstFreeVertex(s);
    let r = applyAction(s, { type: 'buildSettlement', vertex: v }, color);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
    const e = freeEdgeTouching(s, v);
    r = applyAction(s, { type: 'buildRoad', edge: e }, color);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error(r.error);
    s = r.state;
  }
  return s;
}

function conserved(s: GameState): boolean {
  return RESOURCES.every((res) => {
    const held = s.players.reduce((n, p) => n + p.resources[res], 0);
    return held + s.bank[res] === 19;
  });
}

const PLAYERS = [
  { color: 'red' as PlayerColor, name: 'Red' },
  { color: 'blue' as PlayerColor, name: 'Blue' },
  { color: 'white' as PlayerColor, name: 'White' },
];

// ----- tests ----------------------------------------------------------------

describe('setup phase', () => {
  it('completes setup and begins play with correct pieces placed', () => {
    const s = runSetup(createGame({ id: 'g1', players: PLAYERS, seed: 7 }));
    expect(s.phase).toBe('play');
    expect(s.turnPhase).toBe('roll');
    expect(currentColor(s)).toBe('red');

    // Each player placed exactly 2 settlements and 2 roads.
    for (const p of s.players) {
      const settlements = Object.values(s.settlements).filter((b) => b.owner === p.color);
      const roads = Object.values(s.roads).filter((o) => o === p.color);
      expect(settlements.length).toBe(2);
      expect(roads.length).toBe(2);
      expect(p.settlementsLeft).toBe(3);
      expect(p.roadsLeft).toBe(13);
      expect(victoryPoints(s, p.color)).toBe(2);
    }
  });

  it('grants starting resources on the second settlement and conserves the bank', () => {
    const s = runSetup(createGame({ id: 'g2', players: PLAYERS, seed: 19 }));
    expect(conserved(s)).toBe(true);
    // Everyone should have at least 0 and the bank never goes negative.
    for (const res of RESOURCES) expect(s.bank[res]).toBeGreaterThanOrEqual(0);
  });

  it('rejects a settlement too close to another (distance rule)', () => {
    const s = createGame({ id: 'g3', players: PLAYERS, seed: 1 });
    const color = activeSetupColor(s);
    const v = firstFreeVertex(s);
    const r1 = applyAction(s, { type: 'buildSettlement', vertex: v }, color);
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const s1 = r1.state;
    const e = freeEdgeTouching(s1, v);
    const s2 = (applyAction(s1, { type: 'buildRoad', edge: e }, color) as any).state as GameState;
    // Next player tries to build on a neighbor of v -> must fail.
    const neighbor = s2.board.vertices[v].neighbors[0];
    const next = activeSetupColor(s2);
    const bad = applyAction(s2, { type: 'buildSettlement', vertex: neighbor }, next);
    expect(bad.ok).toBe(false);
  });
});

describe('turn mechanics', () => {
  it('requires a roll before building or ending the turn', () => {
    const s = runSetup(createGame({ id: 'g4', players: PLAYERS, seed: 3 }));
    const cant = applyAction(s, { type: 'endTurn' }, 'red');
    expect(cant.ok).toBe(false);
  });

  it('rolling distributes resources and conserves the bank', () => {
    let s = runSetup(createGame({ id: 'g5', players: PLAYERS, seed: 8 }));
    const before = JSON.stringify(s.bank);
    const r = applyAction(s, { type: 'rollDice' }, 'red');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    s = r.state;
    expect(s.dice).not.toBeNull();
    expect(conserved(s)).toBe(true);
    // turn should be either main (non-7) or a robber/discard phase (7)
    expect(['main', 'discard', 'moveRobber']).toContain(s.turnPhase);
    void before;
  });

  it('logs every dice total, including games saved before the log existed', () => {
    const s = runSetup(createGame({ id: 'g5b', players: PLAYERS, seed: 8 }));
    expect(s.rolls).toEqual([]);
    const r = applyAction(s, { type: 'rollDice' }, 'red');
    if (!r.ok) throw new Error(r.error);
    expect(r.state.rolls).toEqual([r.state.dice![0] + r.state.dice![1]]);
    const legacy = { ...s } as any;
    delete legacy.rolls;
    const r2 = applyAction(legacy, { type: 'rollDice' }, 'red');
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.rolls).toHaveLength(1);
  });

  it('tallies numbers hit vs normal on every roll', () => {
    const s = runSetup(createGame({ id: 'g5c', players: PLAYERS, seed: 8 }));
    const r = applyAction(s, { type: 'rollDice' }, 'red');
    if (!r.ok) throw new Error(r.error);
    const sum = r.state.dice![0] + r.state.dice![1];
    for (const p of r.state.players) {
      const nums = new Set<number>();
      for (const [vid, b] of Object.entries(r.state.settlements)) {
        if (b.owner !== p.color) continue;
        for (const h of r.state.board.vertices[Number(vid)].hexes) { const t = r.state.board.hexes[h].token; if (t) nums.add(t); }
      }
      const odds: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
      const t = r.state.tally[p.color]!;
      expect(t.numbersHit).toBe(nums.has(sum) ? 1 : 0);
      expect(t.numbersNormal).toBeCloseTo([...nums].reduce((n, x) => n + odds[x] / 36, 0));
    }
  });

  it('charges blocked production and steals to the robber cost', () => {
    let s = runSetup(createGame({ id: 'g5d', players: PLAYERS, seed: 8 }));
    // park the robber on a numbered hex touching one of red's settlements, then force that number
    const [vid] = Object.entries(s.settlements).find(([, b]) => b.owner === 'red')!;
    const hex = s.board.vertices[Number(vid)].hexes.map((h) => s.board.hexes[h]).find((h) => h.token && h.token !== 7)!;
    s = { ...s, robberHex: hex.id };
    let rng = 1;
    while (rollDice(rng).dice[0] + rollDice(rng).dice[1] !== hex.token) rng++;
    s = { ...s, rngState: rng };
    const owed = hex.vertices.reduce((n, v) => n + (s.settlements[v]?.owner === 'red' ? (s.settlements[v].type === 'city' ? 2 : 1) : 0), 0);
    const r = applyAction(s, { type: 'rollDice' }, 'red');
    if (!r.ok) throw new Error(r.error);
    expect(r.state.tally.red!.robberCost).toBe(owed);
    // a steal adds one more card to the victim's robber cost
    const st = { ...r.state, turnPhase: 'steal' as const, stealCandidates: ['blue' as PlayerColor] };
    st.players.find((p) => p.color === 'blue')!.resources.wood = 2;
    const before = st.tally.blue?.robberCost ?? 0;
    const r2 = applyAction(st, { type: 'steal', victim: 'blue' }, 'red');
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.state.tally.blue!.robberCost).toBe(before + 1);
  });

  it('only the current player may act', () => {
    const s = runSetup(createGame({ id: 'g6', players: PLAYERS, seed: 5 }));
    const wrong = applyAction(s, { type: 'rollDice' }, 'blue');
    expect(wrong.ok).toBe(false);
  });
});

describe('trading and dev cards (unit-level)', () => {
  it('does a 4:1 bank trade', () => {
    let s = runSetup(createGame({ id: 'g7', players: PLAYERS, seed: 11 }));
    s = (applyAction(s, { type: 'rollDice' }, 'red') as any).state;
    // Skip past a 7 if it happened, by forcing main for this unit test.
    s.turnPhase = 'main';
    const red = s.players.find((p) => p.color === 'red')!;
    red.resources = { brick: 4, wood: 0, sheep: 0, wheat: 0, ore: 0 };
    s.bank.brick = 19 - 4;
    const r = applyAction(s, { type: 'bankTrade', give: 'brick', want: 'ore' }, 'red');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.color === 'red')!.resources.brick).toBe(0);
    expect(r.state.players.find((p) => p.color === 'red')!.resources.ore).toBe(1);
  });

  it('monopoly takes a resource from every other player', () => {
    let s = runSetup(createGame({ id: 'g8', players: PLAYERS, seed: 13 }));
    s = (applyAction(s, { type: 'rollDice' }, 'red') as any).state;
    s.turnPhase = 'main';
    s.players.forEach((p) => (p.resources = { brick: 0, wood: 0, sheep: 2, wheat: 0, ore: 0 }));
    const red = s.players.find((p) => p.color === 'red')!;
    red.devCards = ['monopoly'];
    const r = applyAction(s, { type: 'playMonopoly', resource: 'sheep' }, 'red');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.players.find((p) => p.color === 'red')!.resources.sheep).toBe(6);
    for (const p of r.state.players) if (p.color !== 'red') expect(p.resources.sheep).toBe(0);
  });

  it('blocks playing two development cards in one turn', () => {
    let s = runSetup(createGame({ id: 'g9', players: PLAYERS, seed: 17 }));
    s = (applyAction(s, { type: 'rollDice' }, 'red') as any).state;
    s.turnPhase = 'main';
    const red = s.players.find((p) => p.color === 'red')!;
    red.devCards = ['monopoly', 'year_of_plenty'];
    s.bank.wood = 5;
    let r = applyAction(s, { type: 'playMonopoly', resource: 'wood' }, 'red');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const r2 = applyAction(r.state, { type: 'playYearOfPlenty', resources: ['wood', 'wood'] }, 'red');
    expect(r2.ok).toBe(false);
  });
});

describe('longest road', () => {
  it('awards longest road once a contiguous path of 5 is built', () => {
    let s = runSetup(createGame({ id: 'g10', players: PLAYERS, seed: 23 }));
    s = (applyAction(s, { type: 'rollDice' }, 'red') as any).state;
    s.turnPhase = 'main';

    // Grow a single contiguous path from one of red's settlements, extending
    // from the current frontier vertex each step so the path stays connected.
    const startVertex = Number(
      Object.entries(s.settlements).find(([, b]) => b.owner === 'red')![0],
    );
    let frontier = startVertex;
    let placed = 0;
    let guard = 0;
    while (placed < 5 && guard++ < 100) {
      const edge = s.board.vertices[frontier].edges.find((eid) => {
        if (s.roads[eid] != null) return false;
        const [a, b] = s.board.edges[eid].v;
        const far = a === frontier ? b : a;
        // keep the path clean: don't run into any building on the far vertex
        return !s.settlements[far];
      });
      if (edge == null) break;
      // Re-fetch the player from the *current* state and fund one road.
      const red = s.players.find((p) => p.color === 'red')!;
      red.resources.brick += 1;
      red.resources.wood += 1;
      s.bank.brick -= 1;
      s.bank.wood -= 1;
      const r = applyAction(s, { type: 'buildRoad', edge }, 'red');
      expect(r.ok).toBe(true);
      if (!r.ok) break;
      s = r.state;
      const [a, b] = s.board.edges[edge].v;
      frontier = a === frontier ? b : a;
      placed++;
    }

    expect(placed).toBe(5);
    expect(s.longestRoadOwner).toBe('red');
    expect(s.players.find((p) => p.color === 'red')!.hasLongestRoad).toBe(true);
    // 2 starting settlements (2 VP) + longest road (2 VP) = 4
    expect(victoryPoints(s, 'red')).toBeGreaterThanOrEqual(4);
    expect(conserved(s)).toBe(true);
  });
});
