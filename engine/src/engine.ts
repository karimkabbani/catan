import {
  COSTS,
  DevCard,
  GameState,
  HAND_LIMIT_BEFORE_DISCARD,
  Player,
  PlayerColor,
  PortType,
  Resource,
  RESOURCES,
  TERRAIN_RESOURCE,
  VICTORY_POINTS_TO_WIN,
} from './types.js';
import { rollDice, nextInt } from './random.js';
import { updateLongestRoad } from './longestRoad.js';

// ---------------------------------------------------------------------------
// The engine is a pure reducer: applyAction(state, action, byColor) returns a
// brand new state (or an error). All randomness flows through state.rngState,
// so a sequence of actions is fully reproducible. Nothing here touches the DOM,
// the network, or the clock — it's just rules.
// ---------------------------------------------------------------------------

export type Action =
  | { type: 'rollDice' }
  | { type: 'buildSettlement'; vertex: number }
  | { type: 'buildRoad'; edge: number }
  | { type: 'buildCity'; vertex: number }
  | { type: 'buyDevCard' }
  | { type: 'playKnight' }
  | { type: 'playRoadBuilding' }
  | { type: 'playYearOfPlenty'; resources: [Resource, Resource] }
  | { type: 'playMonopoly'; resource: Resource }
  | { type: 'moveRobber'; hex: number }
  | { type: 'steal'; victim: PlayerColor }
  | { type: 'discard'; resources: Partial<Record<Resource, number>> }
  | { type: 'bankTrade'; give: Resource; want: Resource }
  | { type: 'offerTrade'; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>> }
  | { type: 'acceptTrade' }
  | { type: 'declineTrade' }
  | { type: 'counterTrade'; give: Partial<Record<Resource, number>>; want: Partial<Record<Resource, number>> }
  | { type: 'confirmTrade'; with: PlayerColor }
  | { type: 'cancelTrade' }
  | { type: 'endTurn' };

export type ApplyResult =
  | { ok: true; state: GameState }
  | { ok: false; error: string };

const err = (error: string): ApplyResult => ({ ok: false, error });
const clone = (s: GameState): GameState =>
  typeof structuredClone === 'function' ? structuredClone(s) : JSON.parse(JSON.stringify(s));

// ----- small helpers --------------------------------------------------------

export function currentColor(s: GameState): PlayerColor {
  return s.order[s.currentPlayerIndex];
}
function getPlayer(s: GameState, color: PlayerColor): Player {
  const p = s.players.find((x) => x.color === color);
  if (!p) throw new Error(`No such player ${color}`);
  return p;
}
function totalCards(p: Player): number {
  return RESOURCES.reduce((n, r) => n + p.resources[r], 0);
}
function canPay(p: Player, cost: Partial<Record<Resource, number>>): boolean {
  return RESOURCES.every((r) => p.resources[r] >= (cost[r] ?? 0));
}
function pay(s: GameState, p: Player, cost: Partial<Record<Resource, number>>): void {
  for (const r of RESOURCES) {
    const amt = cost[r] ?? 0;
    p.resources[r] -= amt;
    s.bank[r] += amt;
  }
}
function ownsPort(s: GameState, color: PlayerColor, port: PortType): boolean {
  for (const [vid, b] of Object.entries(s.settlements)) {
    if (b.owner === color && s.board.vertices[Number(vid)].port === port) return true;
  }
  return false;
}
/** Best bank ratio for giving away a specific resource (2 / 3 / 4). */
function bankRatio(s: GameState, color: PlayerColor, give: Resource): number {
  if (ownsPort(s, color, give)) return 2;
  if (ownsPort(s, color, '3:1')) return 3;
  return 4;
}

// ----- victory points & awards ----------------------------------------------

export function victoryPoints(s: GameState, color: PlayerColor, includeHidden = true): number {
  let vp = 0;
  for (const b of Object.values(s.settlements)) {
    if (b.owner === color) vp += b.type === 'city' ? 2 : 1;
  }
  const p = getPlayer(s, color);
  if (p.hasLongestRoad) vp += 2;
  if (p.hasLargestArmy) vp += 2;
  if (includeHidden) {
    vp += p.devCards.filter((c) => c === 'victory_point').length;
    vp += p.newDevCards.filter((c) => c === 'victory_point').length;
  }
  return vp;
}

function updateLargestArmy(s: GameState): void {
  const MIN = 3;
  const current = s.largestArmyOwner;
  const currentKnights = current ? getPlayer(s, current).playedKnights : 0;
  let leader = current;
  let leaderN = current && currentKnights >= MIN ? currentKnights : 0;
  for (const p of s.players) {
    if (p.playedKnights >= MIN && p.playedKnights > leaderN) {
      leader = p.color;
      leaderN = p.playedKnights;
    }
  }
  if (leader !== current) {
    for (const p of s.players) p.hasLargestArmy = p.color === leader;
    s.largestArmyOwner = leader ?? null;
  }
}

function checkWin(s: GameState, color: PlayerColor): void {
  if (victoryPoints(s, color) >= (s.targetPoints ?? VICTORY_POINTS_TO_WIN)) {
    s.winner = color;
    s.phase = 'ended';
    s.log.push(`${getPlayer(s, color).name} wins!`);
  }
}

// ----- placement validity ---------------------------------------------------

function vertexIsFree(s: GameState, vertex: number): boolean {
  if (s.settlements[vertex]) return false;
  // distance rule: no adjacent vertex may hold a building.
  for (const n of s.board.vertices[vertex].neighbors) {
    if (s.settlements[n]) return false;
  }
  return true;
}

function playerTouchesVertexByRoad(s: GameState, color: PlayerColor, vertex: number): boolean {
  for (const eid of s.board.vertices[vertex].edges) {
    if (s.roads[eid] === color) return true;
  }
  return false;
}

function roadConnects(s: GameState, color: PlayerColor, edge: number): boolean {
  const [a, b] = s.board.edges[edge].v;
  for (const v of [a, b]) {
    const building = s.settlements[v];
    if (building && building.owner === color) return true;
    // connected to one of the player's roads, but not "through" an opponent building
    const blockedByOpponent = building && building.owner !== color;
    if (!blockedByOpponent && playerTouchesVertexByRoad(s, color, v)) return true;
  }
  return false;
}

// ----- resource production --------------------------------------------------

function produce(s: GameState, roll: number): void {
  // Gather demand: color -> resource -> count.
  const demand: Record<string, Partial<Record<Resource, number>>> = {};
  for (const hex of s.board.hexes) {
    if (hex.token !== roll || hex.id === s.robberHex) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res) continue;
    for (const vid of hex.vertices) {
      const b = s.settlements[vid];
      if (!b) continue;
      const amt = b.type === 'city' ? 2 : 1;
      (demand[b.owner] ??= {})[res] = ((demand[b.owner] ?? {})[res] ?? 0) + amt;
    }
  }

  // Respect the bank: if total demand for a resource exceeds supply and more
  // than one player wants it, nobody gets it (official rule). If exactly one
  // player wants it, they take whatever is left.
  for (const res of RESOURCES) {
    const claimants = Object.entries(demand).filter(([, d]) => (d[res] ?? 0) > 0);
    const total = claimants.reduce((n, [, d]) => n + (d[res] ?? 0), 0);
    if (total === 0) continue;
    if (total <= s.bank[res]) {
      for (const [color, d] of claimants) {
        getPlayer(s, color as PlayerColor).resources[res] += d[res]!;
        s.bank[res] -= d[res]!;
      }
    } else if (claimants.length === 1) {
      const [color] = claimants[0];
      const give = s.bank[res];
      getPlayer(s, color as PlayerColor).resources[res] += give;
      s.bank[res] = 0;
    } // else: shortage with multiple claimants -> nobody receives this resource
  }
}

// ----- robber flow ----------------------------------------------------------

function beginRobber(s: GameState, roll: number): void {
  // Set discard obligations for anyone over the hand limit.
  let anyDiscards = false;
  for (const p of s.players) {
    const n = totalCards(p);
    if (n > HAND_LIMIT_BEFORE_DISCARD) {
      s.pendingDiscards[p.color] = Math.floor(n / 2);
      anyDiscards = true;
    } else {
      s.pendingDiscards[p.color] = 0;
    }
  }
  s.turnPhase = anyDiscards ? 'discard' : 'moveRobber';
  if (roll === 7) s.log.push('Rolled a 7 — robber activates.');
}

function stealCandidatesForHex(s: GameState, hex: number, robberColor: PlayerColor): PlayerColor[] {
  const set = new Set<PlayerColor>();
  for (const vid of s.board.hexes[hex].vertices) {
    const b = s.settlements[vid];
    if (b && b.owner !== robberColor && totalCards(getPlayer(s, b.owner)) > 0) set.add(b.owner);
  }
  return [...set];
}

// ----- the reducer ----------------------------------------------------------

export function applyAction(state: GameState, action: Action, byColor: PlayerColor): ApplyResult {
  if (state.phase === 'ended') return err('The game is over.');
  const s = clone(state);
  const cur = currentColor(s);

  // ----- SETUP PHASE -------------------------------------------------------
  if (s.phase === 'setup') {
    const active = s.order[s.setupOrder[s.setupIndex]];
    if (byColor !== active) return err(`It's ${getPlayer(s, active).name}'s turn to place.`);
    const player = getPlayer(s, byColor);
    const isSecondRound = s.setupIndex >= s.players.length;

    if (action.type === 'buildSettlement') {
      if (s.turnPhase !== 'placeSettlement') return err('Place a road, not a settlement.');
      if (!vertexIsFree(s, action.vertex)) return err('Too close to another building or occupied.');
      s.settlements[action.vertex] = { type: 'settlement', owner: byColor };
      player.settlementsLeft--;
      s.setupLastVertex = action.vertex;
      // Second settlement yields starting resources from adjacent hexes.
      if (isSecondRound) {
        for (const hid of s.board.vertices[action.vertex].hexes) {
          const hex = s.board.hexes[hid];
          const res = TERRAIN_RESOURCE[hex.terrain];
          if (res && s.bank[res] > 0) {
            player.resources[res]++;
            s.bank[res]--;
          }
        }
      }
      s.turnPhase = 'placeRoad';
      return { ok: true, state: s };
    }

    if (action.type === 'buildRoad') {
      if (s.turnPhase !== 'placeRoad') return err('Place a settlement first.');
      if (s.roads[action.edge] != null) return err('That edge already has a road.');
      const touchesLast =
        s.setupLastVertex != null && s.board.edges[action.edge].v.includes(s.setupLastVertex);
      if (!touchesLast) return err('Setup road must touch the settlement you just placed.');
      s.roads[action.edge] = byColor;
      player.roadsLeft--;
      s.setupLastVertex = null;
      s.setupIndex++;
      if (s.setupIndex >= s.setupOrder.length) {
        // Setup complete -> first player's turn begins.
        s.phase = 'play';
        s.currentPlayerIndex = 0;
        s.turnPhase = 'roll';
        updateLongestRoad(s);
        s.log.push('Setup complete. Play begins.');
      } else {
        s.currentPlayerIndex = s.setupOrder[s.setupIndex];
        s.turnPhase = 'placeSettlement';
      }
      return { ok: true, state: s };
    }
    return err('During setup, place a settlement then a road.');
  }

  // ----- DISCARD (can be submitted by any over-limit player) ---------------
  if (action.type === 'discard') {
    const owed = s.pendingDiscards[byColor] ?? 0;
    if (owed <= 0) return err('You have nothing to discard.');
    const p = getPlayer(s, byColor);
    const given = RESOURCES.reduce((n, r) => n + (action.resources[r] ?? 0), 0);
    if (given !== owed) return err(`You must discard exactly ${owed} cards.`);
    if (!canPay(p, action.resources)) return err('You do not have those cards.');
    pay(s, p, action.resources);
    s.pendingDiscards[byColor] = 0;
    if (Object.values(s.pendingDiscards).every((n) => n === 0)) {
      s.turnPhase = 'moveRobber';
    }
    return { ok: true, state: s };
  }

  // A non-current player may accept or decline the standing trade offer.
  if (action.type === 'acceptTrade') {
    return acceptTrade(s, byColor);
  }
  if (action.type === 'declineTrade') {
    return declineTrade(s, byColor);
  }
  if (action.type === 'counterTrade') {
    return counterTrade(s, byColor, action.give, action.want);
  }

  // Everything below is restricted to the player whose turn it is.
  if (byColor !== cur) return err(`It's not your turn.`);
  const player = getPlayer(s, cur);

  switch (action.type) {
    case 'rollDice': {
      if (s.turnPhase !== 'roll') return err('You have already rolled.');
      const r = rollDice(s.rngState);
      s.rngState = r.state;
      s.dice = r.dice;
      s.hasRolledThisTurn = true;
      const sum = r.dice[0] + r.dice[1];
      s.log.push(`${player.name} rolled ${sum}.`);
      if (sum === 7) {
        beginRobber(s, 7);
      } else {
        produce(s, sum);
        s.turnPhase = 'main';
      }
      return { ok: true, state: s };
    }

    case 'buildRoad': {
      const free = s.freeRoads > 0;
      if (!free && s.turnPhase !== 'main') return err('Roll first.');
      if (s.roads[action.edge] != null) return err('That edge already has a road.');
      if (player.roadsLeft <= 0) return err('No roads left.');
      if (!roadConnects(s, cur, action.edge)) return err('Road must connect to your network.');
      if (!free) {
        if (!canPay(player, COSTS.road)) return err('Not enough resources for a road.');
        pay(s, player, COSTS.road);
      } else {
        s.freeRoads--;
      }
      s.roads[action.edge] = cur;
      player.roadsLeft--;
      updateLongestRoad(s);
      if (s.freeRoads > 0 && player.roadsLeft > 0) {
        s.turnPhase = 'placeRoad';
      } else if (s.turnPhase === 'placeRoad') {
        s.turnPhase = 'main';
        s.freeRoads = 0;
      }
      checkWin(s, cur);
      return { ok: true, state: s };
    }

    case 'buildSettlement': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      if (player.settlementsLeft <= 0) return err('No settlements left.');
      if (!vertexIsFree(s, action.vertex)) return err('Too close to another building or occupied.');
      if (!playerTouchesVertexByRoad(s, cur, action.vertex)) return err('Must build next to your road.');
      if (!canPay(player, COSTS.settlement)) return err('Not enough resources for a settlement.');
      pay(s, player, COSTS.settlement);
      s.settlements[action.vertex] = { type: 'settlement', owner: cur };
      player.settlementsLeft--;
      updateLongestRoad(s); // a new settlement may cut an opponent's road
      checkWin(s, cur);
      return { ok: true, state: s };
    }

    case 'buildCity': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      const b = s.settlements[action.vertex];
      if (!b || b.owner !== cur || b.type !== 'settlement') return err('Upgrade your own settlement.');
      if (player.citiesLeft <= 0) return err('No cities left.');
      if (!canPay(player, COSTS.city)) return err('Not enough resources for a city.');
      pay(s, player, COSTS.city);
      s.settlements[action.vertex] = { type: 'city', owner: cur };
      player.settlementsLeft++; // settlement piece returns to supply
      player.citiesLeft--;
      checkWin(s, cur);
      return { ok: true, state: s };
    }

    case 'buyDevCard': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      if (s.devDeck.length === 0) return err('No development cards left.');
      if (!canPay(player, COSTS.devCard)) return err('Not enough resources for a development card.');
      pay(s, player, COSTS.devCard);
      const card = s.devDeck.shift()!;
      player.newDevCards.push(card);
      s.log.push(`${player.name} bought a development card.`);
      if (card === 'victory_point') checkWin(s, cur);
      return { ok: true, state: s };
    }

    case 'playKnight': {
      if (s.turnPhase !== 'main' && s.turnPhase !== 'roll') return err('Cannot play a knight now.');
      if (s.hasPlayedDevCardThisTurn) return err('You already played a development card this turn.');
      const idx = player.devCards.indexOf('knight');
      if (idx < 0) return err('No knight available to play.');
      player.devCards.splice(idx, 1);
      player.playedKnights++;
      s.hasPlayedDevCardThisTurn = true;
      updateLargestArmy(s);
      checkWin(s, cur);
      s.turnPhase = 'moveRobber';
      s.log.push(`${player.name} played a knight.`);
      return { ok: true, state: s };
    }

    case 'moveRobber': {
      if (s.turnPhase !== 'moveRobber') return err('Not time to move the robber.');
      if (action.hex === s.robberHex) return err('Robber must move to a different hex.');
      s.robberHex = action.hex;
      const candidates = stealCandidatesForHex(s, action.hex, cur);
      if (candidates.length === 0) {
        s.turnPhase = s.hasRolledThisTurn ? 'main' : 'roll';
        s.stealCandidates = [];
      } else if (candidates.length === 1) {
        // auto-steal handled by issuing a steal action; expose the single target
        s.stealCandidates = candidates;
        s.turnPhase = 'steal';
      } else {
        s.stealCandidates = candidates;
        s.turnPhase = 'steal';
      }
      return { ok: true, state: s };
    }

    case 'steal': {
      if (s.turnPhase !== 'steal') return err('Not time to steal.');
      if (!s.stealCandidates.includes(action.victim)) return err('Invalid steal target.');
      const victim = getPlayer(s, action.victim);
      const pool: Resource[] = [];
      for (const r of RESOURCES) for (let i = 0; i < victim.resources[r]; i++) pool.push(r);
      if (pool.length > 0) {
        const pick = nextInt(s.rngState, pool.length);
        s.rngState = pick.state;
        const stolen = pool[pick.value];
        victim.resources[stolen]--;
        player.resources[stolen]++;
        s.log.push(`${player.name} stole a card from ${victim.name}.`);
      }
      s.stealCandidates = [];
      s.turnPhase = s.hasRolledThisTurn ? 'main' : 'roll';
      return { ok: true, state: s };
    }

    case 'playRoadBuilding': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      if (s.hasPlayedDevCardThisTurn) return err('You already played a development card this turn.');
      const idx = player.devCards.indexOf('road_building');
      if (idx < 0) return err('No road-building card available.');
      player.devCards.splice(idx, 1);
      s.hasPlayedDevCardThisTurn = true;
      s.freeRoads = Math.min(2, player.roadsLeft);
      if (s.freeRoads === 0) return err('You have no roads left to place.');
      s.turnPhase = 'placeRoad';
      s.log.push(`${player.name} played Road Building.`);
      return { ok: true, state: s };
    }

    case 'playYearOfPlenty': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      if (s.hasPlayedDevCardThisTurn) return err('You already played a development card this turn.');
      const idx = player.devCards.indexOf('year_of_plenty');
      if (idx < 0) return err('No Year of Plenty card available.');
      for (const r of action.resources) if (s.bank[r] <= 0) return err('The bank is out of that resource.');
      // (Both must be available; take them.)
      player.devCards.splice(idx, 1);
      s.hasPlayedDevCardThisTurn = true;
      for (const r of action.resources) {
        player.resources[r]++;
        s.bank[r]--;
      }
      s.log.push(`${player.name} played Year of Plenty.`);
      return { ok: true, state: s };
    }

    case 'playMonopoly': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      if (s.hasPlayedDevCardThisTurn) return err('You already played a development card this turn.');
      const idx = player.devCards.indexOf('monopoly');
      if (idx < 0) return err('No Monopoly card available.');
      player.devCards.splice(idx, 1);
      s.hasPlayedDevCardThisTurn = true;
      let taken = 0;
      for (const p of s.players) {
        if (p.color === cur) continue;
        taken += p.resources[action.resource];
        p.resources[action.resource] = 0;
      }
      player.resources[action.resource] += taken;
      s.log.push(`${player.name} monopolised ${action.resource} (+${taken}).`);
      return { ok: true, state: s };
    }

    case 'bankTrade': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      const ratio = bankRatio(s, cur, action.give);
      if (player.resources[action.give] < ratio) return err(`You need ${ratio} ${action.give}.`);
      if (s.bank[action.want] <= 0) return err('The bank is out of that resource.');
      player.resources[action.give] -= ratio;
      s.bank[action.give] += ratio;
      player.resources[action.want] += 1;
      s.bank[action.want] -= 1;
      return { ok: true, state: s };
    }

    case 'offerTrade': {
      if (s.turnPhase !== 'main') return err('Roll first.');
      if (!canPay(player, action.give)) return err('You do not have what you are offering.');
      s.pendingTrade = { from: cur, give: action.give, want: action.want, acceptedBy: [], declinedBy: [], counters: {} };
      return { ok: true, state: s };
    }

    case 'cancelTrade': {
      s.pendingTrade = null;
      return { ok: true, state: s };
    }

    case 'confirmTrade': {
      const t = s.pendingTrade;
      if (!t || t.from !== cur) return err('No trade of yours to confirm.');
      const counter = t.counters?.[action.with];
      if (!counter && !t.acceptedBy.includes(action.with)) return err('That player has not accepted.');
      // a counter-offer trades on the responder's terms; a plain accept uses the original offer
      const terms = counter ?? { give: t.give, want: t.want };
      const other = getPlayer(s, action.with);
      if (!canPay(player, terms.give)) return err('You can no longer cover this trade.');
      if (!canPay(other, terms.want)) return err('They can no longer cover this trade.');
      for (const r of RESOURCES) {
        const g = terms.give[r] ?? 0;
        const w = terms.want[r] ?? 0;
        player.resources[r] += w - g;
        other.resources[r] += g - w;
      }
      s.pendingTrade = null;
      s.log.push(`${player.name} traded with ${other.name}.`);
      return { ok: true, state: s };
    }

    case 'endTurn': {
      if (!s.hasRolledThisTurn) return err('You must roll before ending your turn.');
      if (s.turnPhase !== 'main') return err('Resolve the current step before ending your turn.');
      // Cards bought this turn become playable next turn.
      player.devCards.push(...player.newDevCards);
      player.newDevCards = [];
      s.hasPlayedDevCardThisTurn = false;
      s.hasRolledThisTurn = false;
      s.pendingTrade = null;
      s.dice = null;
      s.freeRoads = 0;
      s.currentPlayerIndex = (s.currentPlayerIndex + 1) % s.players.length;
      s.turnPhase = 'roll';
      return { ok: true, state: s };
    }
  }

  // acceptTrade is the one turn-action a non-current player may take; handle it
  // outside the "current player only" guard.
  return err('Unknown or out-of-turn action.');
}

/** A non-current player accepts the standing trade offer. */
export function acceptTrade(state: GameState, byColor: PlayerColor): ApplyResult {
  if (!state.pendingTrade) return err('There is no trade to accept.');
  if (state.pendingTrade.from === byColor) return err('You cannot accept your own offer.');
  const other = getPlayer(state, byColor);
  if (!canPay(other, state.pendingTrade.want)) return err('You cannot cover this trade.');
  const s = clone(state);
  const t = s.pendingTrade!;
  t.declinedBy = t.declinedBy.filter((c) => c !== byColor);
  if (t.counters) delete t.counters[byColor];
  if (!t.acceptedBy.includes(byColor)) t.acceptedBy.push(byColor);
  return { ok: true, state: s };
}

/** A non-current player proposes different terms (a counter-offer). Stored in the offerer's frame
 *  (give = what the offerer would give, want = what the offerer would want / this responder gives). */
export function counterTrade(
  state: GameState,
  byColor: PlayerColor,
  give: Partial<Record<Resource, number>>,
  want: Partial<Record<Resource, number>>,
): ApplyResult {
  if (!state.pendingTrade) return err('There is no trade to counter.');
  if (state.pendingTrade.from === byColor) return err('You cannot counter your own offer.');
  const me = getPlayer(state, byColor);
  if (!canPay(me, want)) return err('You cannot cover your counter-offer.');
  const s = clone(state);
  const t = s.pendingTrade!;
  t.acceptedBy = t.acceptedBy.filter((c) => c !== byColor);
  t.declinedBy = t.declinedBy.filter((c) => c !== byColor);
  t.counters = t.counters ?? {};
  t.counters[byColor] = { give, want };
  return { ok: true, state: s };
}

/** A non-current player declines the standing trade offer. */
export function declineTrade(state: GameState, byColor: PlayerColor): ApplyResult {
  if (!state.pendingTrade) return err('There is no trade to decline.');
  if (state.pendingTrade.from === byColor) return err('You cannot decline your own offer.');
  const s = clone(state);
  const t = s.pendingTrade!;
  t.acceptedBy = t.acceptedBy.filter((c) => c !== byColor);
  if (t.counters) delete t.counters[byColor];
  if (!t.declinedBy.includes(byColor)) t.declinedBy.push(byColor);
  return { ok: true, state: s };
}
