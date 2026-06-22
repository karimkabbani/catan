import { generateBoard, desertHexId } from './board.js';
import {
  DevCard,
  GameState,
  Player,
  PlayerColor,
  Resource,
  RESOURCES,
} from './types.js';
import { shuffle } from './random.js';

export interface NewPlayer {
  color: PlayerColor;
  name: string;
}

function emptyResources(): Record<Resource, number> {
  return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 };
}

function buildDevDeck(): DevCard[] {
  return [
    ...Array<DevCard>(14).fill('knight'),
    ...Array<DevCard>(5).fill('victory_point'),
    ...Array<DevCard>(2).fill('road_building'),
    ...Array<DevCard>(2).fill('year_of_plenty'),
    ...Array<DevCard>(2).fill('monopoly'),
  ];
}

/** Snake order for setup: 0,1,..,N-1, then N-1,..,1,0. */
function snakeOrder(n: number): number[] {
  const fwd = Array.from({ length: n }, (_, i) => i);
  return [...fwd, ...fwd.slice().reverse()];
}

// House-rule win targets by player count (overridable via opts.targetPoints).
export function targetForCount(n: number): number {
  if (n === 2) return 15;   // 2-player house rule: longer game
  if (n === 3) return 13;
  if (n === 4) return 11;
  return 10;
}

export function createGame(opts: {
  id: string;
  players: NewPlayer[];
  seed: number;
  targetPoints?: number;
  randomFirst?: boolean;
}): GameState {
  const { id, players: ps, seed } = opts;
  // Base Catan is 3-4; we allow 2 as a house rule so two friends can play/test online.
  if (ps.length < 2 || ps.length > 4) {
    throw new Error('This game supports 2 to 4 players.');
  }
  const targetPoints = opts.targetPoints ?? targetForCount(ps.length);

  const { board, rngState } = generateBoard(seed);

  const deckShuffle = shuffle(buildDevDeck(), rngState);

  const players: Player[] = ps.map((p) => ({
    color: p.color,
    name: p.name,
    resources: emptyResources(),
    devCards: [],
    newDevCards: [],
    playedKnights: 0,
    roadsLeft: 15,
    settlementsLeft: 5,
    citiesLeft: 4,
    hasLongestRoad: false,
    hasLargestArmy: false,
  }));

  const bank: Record<Resource, number> = {} as Record<Resource, number>;
  for (const r of RESOURCES) bank[r] = 19;

  const pendingDiscards: Record<PlayerColor, number> = {} as Record<PlayerColor, number>;
  for (const p of players) pendingDiscards[p.color] = 0;

  // Random first player (the "who goes first" spinner lands here). Derived from the
  // seed so every device agrees; the turn order rotates to start with them, then
  // proceeds in seat sequence. Seats stay fixed — only the turn sequence rotates.
  // Gated by opts.randomFirst so the engine test suite keeps deterministic seat-0 order.
  const seatColors = players.map((p) => p.color);
  const firstIdx = opts.randomFirst && seatColors.length > 1
    ? (Math.imul((seed >>> 0) || 1, 2654435761) >>> 0) % seatColors.length : 0;
  const order = seatColors.slice(firstIdx).concat(seatColors.slice(0, firstIdx));

  return {
    id,
    board,
    players,
    order,
    currentPlayerIndex: 0,
    phase: 'setup',
    turnPhase: 'placeSettlement',
    setupIndex: 0,
    setupOrder: snakeOrder(players.length),
    setupLastVertex: null,
    dice: null,
    robberHex: desertHexId(board),
    bank,
    devDeck: deckShuffle.result,
    settlements: {},
    roads: {},
    pendingDiscards,
    stealCandidates: [],
    freeRoads: 0,
    longestRoadOwner: null,
    largestArmyOwner: null,
    hasPlayedDevCardThisTurn: false,
    hasRolledThisTurn: false,
    pendingTrade: null,
    winner: null,
    targetPoints,
    rngState: deckShuffle.state,
    log: ['Game created.'],
  };
}
