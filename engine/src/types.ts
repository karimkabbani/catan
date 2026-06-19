// ---------------------------------------------------------------------------
// Core domain types for the Catan rules engine.
// State is plain JSON (no class instances) so it serializes cleanly into
// Supabase JSONB and is easy to diff / sync across clients.
// ---------------------------------------------------------------------------

export type Resource = 'brick' | 'wood' | 'sheep' | 'wheat' | 'ore';
export const RESOURCES: Resource[] = ['brick', 'wood', 'sheep', 'wheat', 'ore'];

export type Terrain = Resource | 'desert';

/** Maps a terrain hex to the resource it produces (desert produces nothing). */
export const TERRAIN_RESOURCE: Record<Terrain, Resource | null> = {
  brick: 'brick',
  wood: 'wood',
  sheep: 'sheep',
  wheat: 'wheat',
  ore: 'ore',
  desert: null,
};

export type PlayerColor = 'red' | 'blue' | 'green' | 'yellow';
export const PLAYER_COLORS: PlayerColor[] = ['red', 'blue', 'green', 'yellow'];

export type PortType = '3:1' | Resource;

export type DevCard =
  | 'knight'
  | 'victory_point'
  | 'road_building'
  | 'year_of_plenty'
  | 'monopoly';

export type BuildingType = 'settlement' | 'city';

// ----- Static board geometry (generated once per game) ----------------------

export interface Hex {
  id: number;
  q: number; // axial coordinate
  r: number;
  cx: number; // pixel center (unit size; scale at render time)
  cy: number;
  terrain: Terrain;
  token: number | null; // 2..12, null on desert
  vertices: number[]; // 6 corner vertex ids
  edges: number[]; // 6 edge ids
}

export interface Vertex {
  id: number;
  x: number;
  y: number;
  hexes: number[]; // adjacent hex ids (1..3)
  edges: number[]; // incident edge ids (2..3)
  neighbors: number[]; // adjacent vertex ids
  port: PortType | null;
}

export interface Edge {
  id: number;
  v: [number, number]; // endpoint vertex ids
  hexes: number[]; // adjacent hex ids (1 coastal, 2 inland)
}

export interface Board {
  hexes: Hex[];
  vertices: Vertex[];
  edges: Edge[];
}

// ----- Dynamic placements ---------------------------------------------------

export interface BuildingPlacement {
  type: BuildingType;
  owner: PlayerColor;
}

export interface Player {
  color: PlayerColor;
  name: string;
  resources: Record<Resource, number>;
  /** Dev cards playable now (bought on a previous turn). */
  devCards: DevCard[];
  /** Dev cards bought this turn — not playable until next turn. */
  newDevCards: DevCard[];
  playedKnights: number;
  roadsLeft: number;
  settlementsLeft: number;
  citiesLeft: number;
  hasLongestRoad: boolean;
  hasLargestArmy: boolean;
}

export type TurnPhase =
  | 'roll' // current player must roll the dice
  | 'main' // build, trade, play one dev card
  | 'moveRobber' // choose a hex to move the robber to
  | 'steal' // choose a victim adjacent to the new robber hex
  | 'discard' // players over the hand limit must discard (on a 7)
  | 'placeSettlement' // initial setup: place a settlement
  | 'placeRoad'; // initial setup OR road-building: place a road

export interface PendingTrade {
  from: PlayerColor;
  give: Partial<Record<Resource, number>>;
  want: Partial<Record<Resource, number>>;
  /** Players who have accepted and are willing to make this trade. */
  acceptedBy: PlayerColor[];
  /** Players who have explicitly declined (so the proposer sees the rejection). */
  declinedBy: PlayerColor[];
}

export interface GameState {
  id: string;
  board: Board;
  players: Player[];
  /** Turn order, by color. */
  order: PlayerColor[];
  currentPlayerIndex: number;

  phase: 'setup' | 'play' | 'ended';
  turnPhase: TurnPhase;

  /**
   * Setup tracking. During setup we walk the snake order
   * (0,1,..,N-1, N-1,..,1,0). `setupIndex` points into that sequence.
   */
  setupIndex: number;
  setupOrder: number[]; // player indices in snake order
  setupLastVertex: number | null; // settlement just placed, for road adjacency

  dice: [number, number] | null;
  robberHex: number;

  /** Bank supply remaining per resource. */
  bank: Record<Resource, number>;
  /** Remaining development cards to draw (shuffled). */
  devDeck: DevCard[];

  settlements: Record<number, BuildingPlacement>; // keyed by vertex id
  roads: Record<number, PlayerColor>; // keyed by edge id

  /** On a 7: how many cards each player still owes. */
  pendingDiscards: Record<PlayerColor, number>;
  /** Valid steal targets after moving the robber. */
  stealCandidates: PlayerColor[];

  /** Free roads still to place (road-building card grants 2). */
  freeRoads: number;

  longestRoadOwner: PlayerColor | null;
  largestArmyOwner: PlayerColor | null;

  hasPlayedDevCardThisTurn: boolean;
  hasRolledThisTurn: boolean;

  pendingTrade: PendingTrade | null;

  winner: PlayerColor | null;
  targetPoints: number; // victory points needed to win (house rule by player count)
  rngState: number; // seeded RNG cursor (deterministic)
  log: string[];
}

// ----- Costs ----------------------------------------------------------------

export const COSTS = {
  road: { brick: 1, wood: 1 } as Partial<Record<Resource, number>>,
  settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1 } as Partial<Record<Resource, number>>,
  city: { ore: 3, wheat: 2 } as Partial<Record<Resource, number>>,
  devCard: { ore: 1, sheep: 1, wheat: 1 } as Partial<Record<Resource, number>>,
};

export const VICTORY_POINTS_TO_WIN = 10;
export const HAND_LIMIT_BEFORE_DISCARD = 7; // strictly more than this -> must discard half
