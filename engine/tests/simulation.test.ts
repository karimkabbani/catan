import { describe, it, expect } from 'vitest';
import { createGame } from '../src/setup.js';
import { applyAction, Action, currentColor, victoryPoints } from '../src/engine.js';
import { GameState, PlayerColor, RESOURCES } from '../src/types.js';

// A greedy auto-player good enough to drive full games and stress the engine.
// It never makes an illegal move on purpose, but the engine still validates.

function conserved(s: GameState): boolean {
  return RESOURCES.every((res) => {
    const held = s.players.reduce((n, p) => n + p.resources[res], 0);
    return held + s.bank[res] === 19;
  });
}

function vertexFree(s: GameState, v: number): boolean {
  if (s.settlements[v]) return false;
  return s.board.vertices[v].neighbors.every((n) => !s.settlements[n]);
}
function activeSetupColor(s: GameState): PlayerColor {
  return s.order[s.setupOrder[s.setupIndex]];
}

function step(s: GameState, action: Action, by: PlayerColor): GameState {
  const r = applyAction(s, action, by);
  if (!r.ok) throw new Error(`illegal: ${action.type} -> ${r.error}`);
  expect(conserved(r.state)).toBe(true);
  return r.state;
}

function runSetup(s0: GameState): GameState {
  let s = s0;
  while (s.phase === 'setup') {
    const color = activeSetupColor(s);
    const v = s.board.vertices.find((vt) => vertexFree(s, vt.id))!.id;
    s = step(s, { type: 'buildSettlement', vertex: v }, color);
    const e = s.board.vertices[v].edges.find((eid) => s.roads[eid] == null)!;
    s = step(s, { type: 'buildRoad', edge: e }, color);
  }
  return s;
}

function affordable(p: GameState['players'][number], cost: Partial<Record<string, number>>): boolean {
  return RESOURCES.every((r) => p.resources[r] >= ((cost as any)[r] ?? 0));
}

function takeMainActions(s: GameState): GameState {
  const color = currentColor(s);
  let guard = 0;
  while (s.turnPhase === 'main' && guard++ < 30) {
    const p = s.players.find((x) => x.color === color)!;

    // 1) Upgrade to a city if possible.
    const myCitySettlement = Object.entries(s.settlements).find(
      ([, b]) => b.owner === color && b.type === 'settlement',
    );
    if (myCitySettlement && affordable(p, { ore: 3, wheat: 2 }) && p.citiesLeft > 0) {
      const v = Number(myCitySettlement[0]);
      const r = applyAction(s, { type: 'buildCity', vertex: v }, color);
      if (r.ok) { s = r.state; expect(conserved(s)).toBe(true); continue; }
    }

    // 2) Build a settlement on a free vertex next to our road.
    if (affordable(p, { brick: 1, wood: 1, sheep: 1, wheat: 1 }) && p.settlementsLeft > 0) {
      const spot = s.board.vertices.find(
        (vt) =>
          vertexFree(s, vt.id) && vt.edges.some((eid) => s.roads[eid] === color),
      );
      if (spot) {
        const r = applyAction(s, { type: 'buildSettlement', vertex: spot.id }, color);
        if (r.ok) { s = r.state; expect(conserved(s)).toBe(true); continue; }
      }
    }

    // 3) Extend a road.
    if (affordable(p, { brick: 1, wood: 1 }) && p.roadsLeft > 0) {
      const edge = s.board.edges.find((e) => {
        if (s.roads[e.id] != null) return false;
        const [a, b] = e.v;
        return [a, b].some(
          (v) =>
            s.settlements[v]?.owner === color ||
            s.board.vertices[v].edges.some((eid) => s.roads[eid] === color),
        );
      });
      if (edge) {
        const r = applyAction(s, { type: 'buildRoad', edge: edge.id }, color);
        if (r.ok) { s = r.state; expect(conserved(s)).toBe(true); continue; }
      }
    }

    // 4) Buy a dev card.
    if (affordable(p, { ore: 1, sheep: 1, wheat: 1 }) && s.devDeck.length > 0) {
      const r = applyAction(s, { type: 'buyDevCard' }, color);
      if (r.ok) { s = r.state; expect(conserved(s)).toBe(true); continue; }
    }

    // 5) Convert excess via a bank trade toward ore/wheat (city fuel).
    const fat = RESOURCES.find((r) => p.resources[r] >= 4);
    if (fat) {
      const want = p.resources.ore <= p.resources.wheat ? 'ore' : 'wheat';
      if (want !== fat) {
        const r = applyAction(s, { type: 'bankTrade', give: fat, want }, color);
        if (r.ok) { s = r.state; expect(conserved(s)).toBe(true); continue; }
      }
    }
    break; // nothing useful left to do
  }
  return s;
}

function resolveRobber(s: GameState, color: PlayerColor): GameState {
  if (s.turnPhase === 'moveRobber') {
    // Move the robber onto an opponent if we can, to enable a steal.
    const target =
      s.board.hexes.find(
        (h) =>
          h.id !== s.robberHex &&
          h.vertices.some((v) => s.settlements[v] && s.settlements[v].owner !== color),
      )?.id ?? s.board.hexes.find((h) => h.id !== s.robberHex)!.id;
    s = step(s, { type: 'moveRobber', hex: target }, color);
    if (s.turnPhase === 'steal') {
      s = step(s, { type: 'steal', victim: s.stealCandidates[0] }, color);
    }
  }
  return s;
}

function playTurn(s: GameState): GameState {
  const color = currentColor(s);

  // Play a knight before rolling if we have one — builds toward Largest Army.
  const me = s.players.find((p) => p.color === color)!;
  if (me.devCards.includes('knight') && !s.hasPlayedDevCardThisTurn) {
    const r = applyAction(s, { type: 'playKnight' }, color);
    if (r.ok) {
      s = r.state;
      expect(conserved(s)).toBe(true);
      s = resolveRobber(s, color);
    }
  }

  // Roll.
  s = step(s, { type: 'rollDice' }, color);

  // Resolve any 7: discards, then move robber + steal.
  if (s.turnPhase === 'discard') {
    for (const p of s.players) {
      const owed = s.pendingDiscards[p.color];
      if (owed > 0) {
        const give: Partial<Record<string, number>> = {};
        let left = owed;
        for (const r of RESOURCES) {
          while (left > 0 && p.resources[r] - ((give as any)[r] ?? 0) > 0) {
            (give as any)[r] = ((give as any)[r] ?? 0) + 1;
            left--;
          }
        }
        s = step(s, { type: 'discard', resources: give as any }, p.color);
      }
    }
  }
  s = resolveRobber(s, color);

  if (s.turnPhase === 'main') s = takeMainActions(s);

  if (s.phase === 'ended') return s;

  // End turn (engine requires we're back in main).
  if (s.turnPhase === 'main') s = step(s, { type: 'endTurn' }, currentColor(s));
  return s;
}

describe('full-game simulation', () => {
  it('plays many complete games without illegal states; bank always conserved', () => {
    let wins = 0;
    for (let seed = 1; seed <= 12; seed++) {
      let s = runSetup(
        createGame({
          id: `sim-${seed}`,
          players: [
            { color: 'red', name: 'Red' },
            { color: 'blue', name: 'Blue' },
            { color: 'white', name: 'White' },
            { color: 'orange', name: 'Orange' },
          ],
          seed,
        }),
      );
      let turns = 0;
      while (s.phase !== 'ended' && turns++ < 2000) {
        s = playTurn(s);
      }
      expect(conserved(s)).toBe(true);
      if (s.phase === 'ended') {
        wins++;
        expect(s.winner).not.toBeNull();
        expect(victoryPoints(s, s.winner!)).toBeGreaterThanOrEqual(10);
      }
    }
    // The greedy bot is intentionally simple; the real value of this test is
    // that EVERY action across thousands of moves stayed legal and the bank
    // stayed conserved (asserted inside step()). We also confirm games can and
    // do reach a legitimate 10-VP win.
    expect(wins).toBeGreaterThanOrEqual(6);
  });
});
