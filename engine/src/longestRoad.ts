import { Board, GameState, PlayerColor } from './types.js';

// ---------------------------------------------------------------------------
// Longest road = the longest continuous path along a player's roads where no
// edge is used twice, and the path cannot pass *through* a vertex occupied by
// an opponent's settlement or city (that breaks the road). Road networks are
// tiny (<=15 edges) so an exhaustive DFS over edges is comfortably fast.
// ---------------------------------------------------------------------------

export function longestRoadLength(state: GameState, color: PlayerColor): number {
  const board = state.board;
  const myEdges = Object.entries(state.roads)
    .filter(([, owner]) => owner === color)
    .map(([id]) => Number(id));
  if (myEdges.length === 0) return 0;

  const myEdgeSet = new Set(myEdges);

  // A vertex is "blocked" (can be an endpoint but not a pass-through) if an
  // opponent has a building on it.
  const blocked = (vertexId: number): boolean => {
    const b = state.settlements[vertexId];
    return !!b && b.owner !== color;
  };

  // For each vertex, list of this player's edges incident to it.
  const incident = new Map<number, number[]>();
  for (const eid of myEdges) {
    const [a, b] = board.edges[eid].v;
    (incident.get(a) ?? incident.set(a, []).get(a)!).push(eid);
    (incident.get(b) ?? incident.set(b, []).get(b)!).push(eid);
  }

  let best = 0;
  const used = new Set<number>();

  const otherEnd = (edgeId: number, from: number): number => {
    const [a, b] = board.edges[edgeId].v;
    return a === from ? b : a;
  };

  const dfs = (vertex: number, length: number) => {
    if (length > best) best = length;
    if (blocked(vertex)) return; // cannot continue through an opponent building
    for (const eid of incident.get(vertex) ?? []) {
      if (used.has(eid)) continue;
      used.add(eid);
      dfs(otherEnd(eid, vertex), length + 1);
      used.delete(eid);
    }
  };

  // Start the search from every vertex that has one of the player's roads.
  for (const v of incident.keys()) {
    used.clear();
    dfs(v, 0);
  }
  return best;
}

/** Recompute the longest-road holder. Award at 5+; steal only on a strict lead. */
export function updateLongestRoad(state: GameState): void {
  const MIN = 5;
  const lengths = new Map<PlayerColor, number>();
  for (const p of state.players) lengths.set(p.color, longestRoadLength(state, p.color));

  const current = state.longestRoadOwner;
  const currentLen = current ? lengths.get(current)! : 0;

  let leader: PlayerColor | null = current;
  let leaderLen = current && currentLen >= MIN ? currentLen : 0;

  for (const p of state.players) {
    const len = lengths.get(p.color)!;
    if (len >= MIN && len > leaderLen) {
      leader = p.color;
      leaderLen = len;
    }
  }

  // If the current holder dropped below 5 (road broken by an opponent), the
  // title is recomputed among everyone else; if nobody qualifies, it's vacant.
  if (current && currentLen < MIN) {
    leader = null;
    leaderLen = 0;
    for (const p of state.players) {
      const len = lengths.get(p.color)!;
      if (len >= MIN && len > leaderLen) {
        leader = p.color;
        leaderLen = len;
      }
    }
  }

  if (leader !== current) {
    for (const p of state.players) p.hasLongestRoad = p.color === leader;
    state.longestRoadOwner = leader;
  }
}
