import {
  Board,
  Edge,
  Hex,
  PortType,
  Resource,
  Terrain,
  Vertex,
} from './types.js';
import { shuffle } from './random.js';

// ---------------------------------------------------------------------------
// Board geometry. We use flat-top hexes laid out on axial coordinates within
// radius 2 (the standard 19-hex Catan island). Vertices and edges are derived
// from hex corners and de-duplicated by rounded position, which yields exact
// adjacency (vertex<->vertex, vertex<->edge, vertex<->hex) for free.
// ---------------------------------------------------------------------------

const HEX_SIZE = 1; // unit; multiply by a pixel scale at render time.

/** All 19 axial hex coordinates (|q|,|r|,|q+r| <= 2). */
function hexCoords(): { q: number; r: number }[] {
  const coords: { q: number; r: number }[] = [];
  for (let q = -2; q <= 2; q++) {
    for (let r = -2; r <= 2; r++) {
      const s = -q - r;
      if (Math.abs(q) <= 2 && Math.abs(r) <= 2 && Math.abs(s) <= 2) {
        coords.push({ q, r });
      }
    }
  }
  return coords;
}

function hexCenter(q: number, r: number): { cx: number; cy: number } {
  const cx = HEX_SIZE * 1.5 * q;
  const cy = HEX_SIZE * Math.sqrt(3) * (r + q / 2);
  return { cx, cy };
}

function hexCorners(cx: number, cy: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const angle = (Math.PI / 180) * (60 * i);
    pts.push({ x: cx + HEX_SIZE * Math.cos(angle), y: cy + HEX_SIZE * Math.sin(angle) });
  }
  return pts;
}

const key = (x: number, y: number) => `${x.toFixed(3)},${y.toFixed(3)}`;

/**
 * Build the static graph: hexes, vertices (corners), edges, and all adjacency.
 * Terrain/tokens/ports are filled in separately so geometry stays deterministic.
 */
export function buildGeometry(): Board {
  const coords = hexCoords();
  const hexes: Hex[] = [];

  const vertexMap = new Map<string, Vertex>();
  const edgeMap = new Map<string, Edge>();

  const getVertex = (x: number, y: number): Vertex => {
    const k = key(x, y);
    let v = vertexMap.get(k);
    if (!v) {
      v = { id: vertexMap.size, x, y, hexes: [], edges: [], neighbors: [], port: null };
      vertexMap.set(k, v);
    }
    return v;
  };

  const getEdge = (a: Vertex, b: Vertex): Edge => {
    const k = a.id < b.id ? `${a.id}-${b.id}` : `${b.id}-${a.id}`;
    let e = edgeMap.get(k);
    if (!e) {
      e = { id: edgeMap.size, v: [a.id, b.id], hexes: [] };
      edgeMap.set(k, e);
    }
    return e;
  };

  coords.forEach((c, i) => {
    const { cx, cy } = hexCenter(c.q, c.r);
    const corners = hexCorners(cx, cy).map((p) => getVertex(p.x, p.y));
    const hex: Hex = {
      id: i,
      q: c.q,
      r: c.r,
      cx,
      cy,
      terrain: 'desert',
      token: null,
      vertices: corners.map((v) => v.id),
      edges: [],
    };
    for (let j = 0; j < 6; j++) {
      const a = corners[j];
      const b = corners[(j + 1) % 6];
      const e = getEdge(a, b);
      if (!e.hexes.includes(i)) e.hexes.push(i);
      if (!hex.edges.includes(e.id)) hex.edges.push(e.id);
      if (!a.hexes.includes(i)) a.hexes.push(i);
      if (!b.hexes.includes(i)) b.hexes.push(i);
    }
    hexes.push(hex);
  });

  const vertices = [...vertexMap.values()].sort((a, b) => a.id - b.id);
  const edges = [...edgeMap.values()].sort((a, b) => a.id - b.id);

  // Fill vertex.edges / vertex.neighbors from the edge list.
  for (const e of edges) {
    const [a, b] = e.v;
    vertices[a].edges.push(e.id);
    vertices[b].edges.push(e.id);
    if (!vertices[a].neighbors.includes(b)) vertices[a].neighbors.push(b);
    if (!vertices[b].neighbors.includes(a)) vertices[b].neighbors.push(a);
  }

  return { hexes, vertices, edges };
}

// ----- Terrain / token / port assignment ------------------------------------

// Standard base-game supply.
const TERRAIN_BAG: Terrain[] = [
  ...Array<Terrain>(3).fill('brick'),
  ...Array<Terrain>(4).fill('wood'),
  ...Array<Terrain>(4).fill('sheep'),
  ...Array<Terrain>(4).fill('wheat'),
  ...Array<Terrain>(3).fill('ore'),
  'desert',
];

// 18 number tokens (the desert gets none). 6 and 8 are the "red" high-odds numbers.
const TOKEN_BAG: number[] = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
const RED_TOKENS = new Set([6, 8]);

// Nine ports around the coast. Resource/type assignment is fixed; their exact
// coastal positions can be tuned later to match the original art precisely.
const PORT_TYPES: PortType[] = ['3:1', 'wheat', 'ore', '3:1', 'sheep', '3:1', 'brick', 'wood', '3:1'];
// Indices into the angle-sorted list of 30 coastal edges (roughly even spacing).
const PORT_EDGE_SLOTS = [0, 3, 6, 10, 13, 16, 20, 23, 26];

function hexNeighbors(board: Board): Map<number, number[]> {
  const nb = new Map<number, number[]>();
  for (const h of board.hexes) nb.set(h.id, []);
  for (const e of board.edges) {
    if (e.hexes.length === 2) {
      const [a, b] = e.hexes;
      if (!nb.get(a)!.includes(b)) nb.get(a)!.push(b);
      if (!nb.get(b)!.includes(a)) nb.get(b)!.push(a);
    }
  }
  return nb;
}

/** True if any two adjacent hexes both carry a red (6/8) token. */
function hasAdjacentRedTokens(board: Board, nb: Map<number, number[]>): boolean {
  for (const h of board.hexes) {
    if (h.token !== null && RED_TOKENS.has(h.token)) {
      for (const n of nb.get(h.id)!) {
        const other = board.hexes[n];
        if (other.token !== null && RED_TOKENS.has(other.token)) return true;
      }
    }
  }
  return false;
}

// Balanced-board house rules (beyond the official 6/8 rule) so production doesn't concentrate.
// Pips = probability dots on each number token; a settlement spot's strength is the pip sum of
// its adjacent hexes. We cap that so no single opening spot is over-powered.
const PIPS: Record<number, number> = { 2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1 };
// A vertex needs 3 high hexes to exceed 12, and 3-high always sums to ≥13 — so cap 12 == "no
// 3-high super-spot" and reliably generates. ≤11 is ~150x rarer and impractical with retry.
const MAX_VERTEX_PIPS = 12;

/** True if two adjacent hexes share the same number token. */
function hasAdjacentSameNumber(board: Board, nb: Map<number, number[]>): boolean {
  for (const h of board.hexes) {
    if (h.token === null) continue;
    for (const n of nb.get(h.id)!) {
      if (board.hexes[n].token === h.token) return true;
    }
  }
  return false;
}

/** True if any settlement spot (vertex) collects more than MAX_VERTEX_PIPS — an over-strong spot. */
function hasOverproductiveVertex(board: Board): boolean {
  for (const v of board.vertices) {
    let pips = 0;
    for (const hid of v.hexes) {
      const t = board.hexes[hid].token;
      if (t !== null) pips += PIPS[t] || 0;
    }
    if (pips > MAX_VERTEX_PIPS) return true;
  }
  return false;
}

function assignPorts(board: Board, types: PortType[]): void {
  const center = { x: 0, y: 0 };
  const coastal = board.edges.filter((e) => e.hexes.length === 1);
  // Order coastal edges by the angle of their midpoint around the board center.
  const withAngle = coastal.map((e) => {
    const a = board.vertices[e.v[0]];
    const b = board.vertices[e.v[1]];
    const mx = (a.x + b.x) / 2 - center.x;
    const my = (a.y + b.y) / 2 - center.y;
    return { edge: e, angle: Math.atan2(my, mx) };
  });
  withAngle.sort((p, q) => p.angle - q.angle);

  PORT_EDGE_SLOTS.forEach((slot, i) => {
    const e = withAngle[slot % withAngle.length].edge;
    const type = types[i];
    board.vertices[e.v[0]].port = type;
    board.vertices[e.v[1]].port = type;
  });
}

/**
 * Produce a full, legal board: shuffled terrain + tokens (no two reds touching)
 * + ports. Deterministic given the rng seed. Returns the new rng state too.
 */
export function generateBoard(seed: number): { board: Board; rngState: number } {
  let rng = seed;
  const nb = hexNeighbors(buildGeometry());

  for (let attempt = 0; attempt < 1000; attempt++) {
    const board = buildGeometry();

    const st = shuffle(TERRAIN_BAG, rng);
    rng = st.state;
    const terrains = st.result;

    const tk = shuffle(TOKEN_BAG, rng);
    rng = tk.state;
    const tokens = tk.result;

    let ti = 0;
    board.hexes.forEach((h, i) => {
      h.terrain = terrains[i];
      h.token = h.terrain === 'desert' ? null : tokens[ti++];
    });

    if (hasAdjacentRedTokens(board, nb)) continue;    // official: no two red (6/8) adjacent
    if (hasAdjacentSameNumber(board, nb)) continue;   // balance: no duplicate numbers touching
    if (hasOverproductiveVertex(board)) continue;     // balance: cap the pip total at any settlement spot

    const ps = shuffle(PORT_TYPES, rng); rng = ps.state;   // randomise the harbours
    assignPorts(board, ps.result);
    return { board, rngState: rng };
  }

  // Extremely unlikely fallback: accept the last board.
  const board = buildGeometry();
  const st = shuffle(TERRAIN_BAG, rng);
  rng = st.state;
  const tk = shuffle(TOKEN_BAG, rng);
  rng = tk.state;
  let ti = 0;
  board.hexes.forEach((h, i) => {
    h.terrain = st.result[i];
    h.token = h.terrain === 'desert' ? null : tk.result[ti++];
  });
  const ps = shuffle(PORT_TYPES, rng); rng = ps.state;
  assignPorts(board, ps.result);
  return { board, rngState: rng };
}

export function desertHexId(board: Board): number {
  return board.hexes.find((h) => h.terrain === 'desert')!.id;
}
