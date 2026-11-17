import { describe, it, expect } from 'vitest';
import { buildGeometry, generateBoard } from '../src/board.js';
import { TERRAIN_RESOURCE } from '../src/types.js';

describe('board geometry', () => {
  const board = buildGeometry();

  it('has the standard 19 hexes, 54 vertices, 72 edges', () => {
    expect(board.hexes.length).toBe(19);
    expect(board.vertices.length).toBe(54);
    expect(board.edges.length).toBe(72);
  });

  it('every hex has 6 distinct vertices and 6 edges', () => {
    for (const h of board.hexes) {
      expect(new Set(h.vertices).size).toBe(6);
      expect(new Set(h.edges).size).toBe(6);
    }
  });

  it('adjacency is symmetric (vertex neighbors)', () => {
    for (const v of board.vertices) {
      for (const n of v.neighbors) {
        expect(board.vertices[n].neighbors).toContain(v.id);
      }
    }
  });

  it('each edge belongs to 1 (coast) or 2 (inland) hexes; 30 are coastal', () => {
    const coastal = board.edges.filter((e) => e.hexes.length === 1);
    expect(coastal.length).toBe(30);
    for (const e of board.edges) {
      expect(e.hexes.length === 1 || e.hexes.length === 2).toBe(true);
    }
  });
});

describe('generated board (seeded)', () => {
  it('has the correct terrain counts and 18 number tokens', () => {
    const { board } = generateBoard(12345);
    const counts: Record<string, number> = {};
    for (const h of board.hexes) counts[h.terrain] = (counts[h.terrain] ?? 0) + 1;
    expect(counts.brick).toBe(3);
    expect(counts.wood).toBe(4);
    expect(counts.sheep).toBe(4);
    expect(counts.wheat).toBe(4);
    expect(counts.ore).toBe(3);
    expect(counts.desert).toBe(1);

    const tokens = board.hexes.filter((h) => h.token !== null);
    expect(tokens.length).toBe(18);
    // desert carries no token
    expect(board.hexes.find((h) => h.terrain === 'desert')!.token).toBeNull();
  });

  it('never places two red tokens (6/8) on adjacent hexes', () => {
    for (let seed = 0; seed < 50; seed++) {
      const { board } = generateBoard(seed * 7919 + 1);
      const nb = new Map<number, number[]>();
      for (const h of board.hexes) nb.set(h.id, []);
      for (const e of board.edges) {
        if (e.hexes.length === 2) {
          nb.get(e.hexes[0])!.push(e.hexes[1]);
          nb.get(e.hexes[1])!.push(e.hexes[0]);
        }
      }
      const red = new Set([6, 8]);
      for (const h of board.hexes) {
        if (h.token && red.has(h.token)) {
          for (const n of nb.get(h.id)!) {
            const o = board.hexes[n];
            expect(o.token && red.has(o.token)).toBeFalsy();
          }
        }
      }
    }
  });

  it('places exactly 9 ports across 18 coastal vertices', () => {
    const { board } = generateBoard(999);
    const portVerts = board.vertices.filter((v) => v.port !== null);
    expect(portVerts.length).toBe(18); // 9 ports x 2 vertices each
    expect(TERRAIN_RESOURCE.desert).toBeNull();
  });

  it('is deterministic for a given seed', () => {
    const a = generateBoard(42).board.hexes.map((h) => `${h.terrain}:${h.token}`).join(',');
    const b = generateBoard(42).board.hexes.map((h) => `${h.terrain}:${h.token}`).join(',');
    expect(a).toBe(b);
  });

  it('never places two 3:1 harbours on neighbouring port slots', () => {
    // mirror assignPorts: coastal edges sorted by angle, ports at the fixed slots
    const SLOTS = [0, 3, 6, 10, 13, 16, 20, 23, 26];
    for (let seed = 1; seed <= 80; seed++) {
      const { board } = generateBoard(seed);
      const coastal = board.edges
        .filter((e) => e.hexes.length === 1)
        .map((e) => {
          const a = board.vertices[e.v[0]], b = board.vertices[e.v[1]];
          return { e, angle: Math.atan2((a.y + b.y) / 2, (a.x + b.x) / 2) };
        })
        .sort((p, q) => p.angle - q.angle);
      const ring = SLOTS.map((s) => board.vertices[coastal[s].e.v[0]].port);
      ring.forEach((t) => expect(t).not.toBeNull());   // sanity: we're reading real port slots
      for (let i = 0; i < ring.length; i++) {
        expect(ring[i] === '3:1' && ring[(i + 1) % ring.length] === '3:1').toBe(false);
      }
    }
  });
});

describe('5-6 player island (big)', () => {
  const nbOf = (board: ReturnType<typeof buildGeometry>) => {
    const nb = new Map<number, number[]>();
    for (const h of board.hexes) nb.set(h.id, []);
    for (const e of board.edges) if (e.hexes.length === 2) { nb.get(e.hexes[0])!.push(e.hexes[1]); nb.get(e.hexes[1])!.push(e.hexes[0]); }
    return nb;
  };
  it('has 30 hexes in columns of 3-4-5-6-5-4-3', () => {
    const board = buildGeometry(true);
    expect(board.hexes.length).toBe(30);
    const cols: Record<number, number> = {};
    for (const h of board.hexes) cols[h.q] = (cols[h.q] ?? 0) + 1;
    expect([-3, -2, -1, 0, 1, 2, 3].map((q) => cols[q])).toEqual([3, 4, 5, 6, 5, 4, 3]);
    for (const h of board.hexes) { expect(Number.isInteger(h.r)).toBe(true); expect(new Set(h.vertices).size).toBe(6); }
    for (const e of board.edges) expect(e.hexes.length === 1 || e.hexes.length === 2).toBe(true);
  });
  it('has the extension supply: terrain, 28 tokens, 2 deserts, 11 harbours', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { board } = generateBoard(seed * 31 + 7, true);
      const counts: Record<string, number> = {};
      for (const h of board.hexes) counts[h.terrain] = (counts[h.terrain] ?? 0) + 1;
      expect(counts).toEqual({ brick: 5, wood: 6, sheep: 6, wheat: 6, ore: 5, desert: 2 });
      const toks = board.hexes.filter((h) => h.token !== null).map((h) => h.token!).sort((a, b) => a - b);
      expect(toks).toEqual([2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5, 6, 6, 6, 8, 8, 8, 9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12]);
      const portVerts = board.vertices.filter((v) => v.port !== null);
      expect(portVerts.length).toBe(22);   // 11 harbours x 2 corners, none sharing a corner
      for (const v of portVerts) expect(v.hexes.length).toBeLessThan(3);   // on the coast
      const kinds: Record<string, number> = {};
      for (const v of portVerts) kinds[v.port!] = (kinds[v.port!] ?? 0) + 1;
      expect(kinds).toEqual({ '3:1': 10, sheep: 4, wheat: 2, ore: 2, brick: 2, wood: 2 });
    }
  });
  it('keeps the balance rules: no touching reds, no touching duplicates, no over-strong spot', () => {
    const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
    for (let seed = 1; seed <= 60; seed++) {
      const { board } = generateBoard(seed * 7919 + 3, true);
      const nb = nbOf(board);
      for (const h of board.hexes) {
        if (h.token === null) continue;
        for (const n of nb.get(h.id)!) {
          const o = board.hexes[n].token;
          expect(o === h.token).toBe(false);
          expect((h.token === 6 || h.token === 8) && (o === 6 || o === 8)).toBe(false);
        }
      }
      for (const v of board.vertices) expect(v.hexes.reduce((a, id) => a + (PIPS[board.hexes[id].token ?? 0] || 0), 0)).toBeLessThanOrEqual(12);
    }
  });
  it('is deterministic and leaves the 19-hex board untouched', () => {
    const a = generateBoard(42, true).board.hexes.map((h) => `${h.terrain}:${h.token}`).join(',');
    expect(generateBoard(42, true).board.hexes.map((h) => `${h.terrain}:${h.token}`).join(',')).toBe(a);
    expect(generateBoard(42).board.hexes.length).toBe(19);
    expect(generateBoard(42, false).board.hexes.map((h) => `${h.terrain}:${h.token}`).join(','))
      .toBe(generateBoard(42).board.hexes.map((h) => `${h.terrain}:${h.token}`).join(','));
  });
});
