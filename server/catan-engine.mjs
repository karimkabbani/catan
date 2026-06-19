// engine/src/types.ts
var RESOURCES = ["brick", "wood", "sheep", "wheat", "ore"];
var TERRAIN_RESOURCE = {
  brick: "brick",
  wood: "wood",
  sheep: "sheep",
  wheat: "wheat",
  ore: "ore",
  desert: null
};
var PLAYER_COLORS = ["red", "blue", "green", "yellow"];
var COSTS = {
  road: { brick: 1, wood: 1 },
  settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1 },
  city: { ore: 3, wheat: 2 },
  devCard: { ore: 1, sheep: 1, wheat: 1 }
};
var VICTORY_POINTS_TO_WIN = 10;
var HAND_LIMIT_BEFORE_DISCARD = 7;

// engine/src/random.ts
function nextRandom(state) {
  let t = state + 1831565813 | 0;
  let x = t;
  x = Math.imul(x ^ x >>> 15, x | 1);
  x ^= x + Math.imul(x ^ x >>> 7, x | 61);
  const value = ((x ^ x >>> 14) >>> 0) / 4294967296;
  return { value, state: t };
}
function nextInt(state, max) {
  const r = nextRandom(state);
  return { value: Math.floor(r.value * max), state: r.state };
}
function shuffle(arr, state) {
  const result = arr.slice();
  let s = state;
  for (let i = result.length - 1; i > 0; i--) {
    const r = nextInt(s, i + 1);
    s = r.state;
    const j = r.value;
    [result[i], result[j]] = [result[j], result[i]];
  }
  return { result, state: s };
}
function rollDice(state) {
  const a = nextInt(state, 6);
  const b = nextInt(a.state, 6);
  return { dice: [a.value + 1, b.value + 1], state: b.state };
}

// engine/src/board.ts
var HEX_SIZE = 1;
function hexCoords() {
  const coords = [];
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
function hexCenter(q, r) {
  const cx = HEX_SIZE * 1.5 * q;
  const cy = HEX_SIZE * Math.sqrt(3) * (r + q / 2);
  return { cx, cy };
}
function hexCorners(cx, cy) {
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const angle = Math.PI / 180 * (60 * i);
    pts.push({ x: cx + HEX_SIZE * Math.cos(angle), y: cy + HEX_SIZE * Math.sin(angle) });
  }
  return pts;
}
var key = (x, y) => `${x.toFixed(3)},${y.toFixed(3)}`;
function buildGeometry() {
  const coords = hexCoords();
  const hexes = [];
  const vertexMap = /* @__PURE__ */ new Map();
  const edgeMap = /* @__PURE__ */ new Map();
  const getVertex = (x, y) => {
    const k = key(x, y);
    let v = vertexMap.get(k);
    if (!v) {
      v = { id: vertexMap.size, x, y, hexes: [], edges: [], neighbors: [], port: null };
      vertexMap.set(k, v);
    }
    return v;
  };
  const getEdge = (a, b) => {
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
    const hex = {
      id: i,
      q: c.q,
      r: c.r,
      cx,
      cy,
      terrain: "desert",
      token: null,
      vertices: corners.map((v) => v.id),
      edges: []
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
  for (const e of edges) {
    const [a, b] = e.v;
    vertices[a].edges.push(e.id);
    vertices[b].edges.push(e.id);
    if (!vertices[a].neighbors.includes(b)) vertices[a].neighbors.push(b);
    if (!vertices[b].neighbors.includes(a)) vertices[b].neighbors.push(a);
  }
  return { hexes, vertices, edges };
}
var TERRAIN_BAG = [
  ...Array(3).fill("brick"),
  ...Array(4).fill("wood"),
  ...Array(4).fill("sheep"),
  ...Array(4).fill("wheat"),
  ...Array(3).fill("ore"),
  "desert"
];
var TOKEN_BAG = [2, 3, 3, 4, 4, 5, 5, 6, 6, 8, 8, 9, 9, 10, 10, 11, 11, 12];
var RED_TOKENS = /* @__PURE__ */ new Set([6, 8]);
var PORT_TYPES = ["3:1", "wheat", "ore", "3:1", "sheep", "3:1", "brick", "wood", "3:1"];
var PORT_EDGE_SLOTS = [0, 3, 6, 10, 13, 16, 20, 23, 26];
function hexNeighbors(board) {
  const nb = /* @__PURE__ */ new Map();
  for (const h of board.hexes) nb.set(h.id, []);
  for (const e of board.edges) {
    if (e.hexes.length === 2) {
      const [a, b] = e.hexes;
      if (!nb.get(a).includes(b)) nb.get(a).push(b);
      if (!nb.get(b).includes(a)) nb.get(b).push(a);
    }
  }
  return nb;
}
function hasAdjacentRedTokens(board, nb) {
  for (const h of board.hexes) {
    if (h.token !== null && RED_TOKENS.has(h.token)) {
      for (const n of nb.get(h.id)) {
        const other = board.hexes[n];
        if (other.token !== null && RED_TOKENS.has(other.token)) return true;
      }
    }
  }
  return false;
}
function assignPorts(board) {
  const center = { x: 0, y: 0 };
  const coastal = board.edges.filter((e) => e.hexes.length === 1);
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
    const type = PORT_TYPES[i];
    board.vertices[e.v[0]].port = type;
    board.vertices[e.v[1]].port = type;
  });
}
function generateBoard(seed) {
  let rng = seed;
  const nb = hexNeighbors(buildGeometry());
  for (let attempt = 0; attempt < 1e3; attempt++) {
    const board2 = buildGeometry();
    const st2 = shuffle(TERRAIN_BAG, rng);
    rng = st2.state;
    const terrains = st2.result;
    const tk2 = shuffle(TOKEN_BAG, rng);
    rng = tk2.state;
    const tokens = tk2.result;
    let ti2 = 0;
    board2.hexes.forEach((h, i) => {
      h.terrain = terrains[i];
      h.token = h.terrain === "desert" ? null : tokens[ti2++];
    });
    if (hasAdjacentRedTokens(board2, nb)) continue;
    assignPorts(board2);
    return { board: board2, rngState: rng };
  }
  const board = buildGeometry();
  const st = shuffle(TERRAIN_BAG, rng);
  rng = st.state;
  const tk = shuffle(TOKEN_BAG, rng);
  rng = tk.state;
  let ti = 0;
  board.hexes.forEach((h, i) => {
    h.terrain = st.result[i];
    h.token = h.terrain === "desert" ? null : tk.result[ti++];
  });
  assignPorts(board);
  return { board, rngState: rng };
}
function desertHexId(board) {
  return board.hexes.find((h) => h.terrain === "desert").id;
}

// engine/src/longestRoad.ts
function longestRoadLength(state, color) {
  const board = state.board;
  const myEdges = Object.entries(state.roads).filter(([, owner]) => owner === color).map(([id]) => Number(id));
  if (myEdges.length === 0) return 0;
  const myEdgeSet = new Set(myEdges);
  const blocked = (vertexId) => {
    const b = state.settlements[vertexId];
    return !!b && b.owner !== color;
  };
  const incident = /* @__PURE__ */ new Map();
  for (const eid of myEdges) {
    const [a, b] = board.edges[eid].v;
    (incident.get(a) ?? incident.set(a, []).get(a)).push(eid);
    (incident.get(b) ?? incident.set(b, []).get(b)).push(eid);
  }
  let best = 0;
  const used = /* @__PURE__ */ new Set();
  const otherEnd = (edgeId, from) => {
    const [a, b] = board.edges[edgeId].v;
    return a === from ? b : a;
  };
  const dfs = (vertex, length) => {
    if (length > best) best = length;
    if (blocked(vertex)) return;
    for (const eid of incident.get(vertex) ?? []) {
      if (used.has(eid)) continue;
      used.add(eid);
      dfs(otherEnd(eid, vertex), length + 1);
      used.delete(eid);
    }
  };
  for (const v of incident.keys()) {
    used.clear();
    dfs(v, 0);
  }
  return best;
}
function updateLongestRoad(state) {
  const MIN = 5;
  const lengths = /* @__PURE__ */ new Map();
  for (const p of state.players) lengths.set(p.color, longestRoadLength(state, p.color));
  const current = state.longestRoadOwner;
  const currentLen = current ? lengths.get(current) : 0;
  let leader = current;
  let leaderLen = current && currentLen >= MIN ? currentLen : 0;
  for (const p of state.players) {
    const len = lengths.get(p.color);
    if (len >= MIN && len > leaderLen) {
      leader = p.color;
      leaderLen = len;
    }
  }
  if (current && currentLen < MIN) {
    leader = null;
    leaderLen = 0;
    for (const p of state.players) {
      const len = lengths.get(p.color);
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

// engine/src/setup.ts
function emptyResources() {
  return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 };
}
function buildDevDeck() {
  return [
    ...Array(14).fill("knight"),
    ...Array(5).fill("victory_point"),
    ...Array(2).fill("road_building"),
    ...Array(2).fill("year_of_plenty"),
    ...Array(2).fill("monopoly")
  ];
}
function snakeOrder(n) {
  const fwd = Array.from({ length: n }, (_, i) => i);
  return [...fwd, ...fwd.slice().reverse()];
}
function targetForCount(n) {
  if (n === 3) return 13;
  if (n === 4) return 11;
  return 10;
}
function createGame(opts) {
  const { id, players: ps, seed } = opts;
  if (ps.length < 2 || ps.length > 4) {
    throw new Error("This game supports 2 to 4 players.");
  }
  const targetPoints = opts.targetPoints ?? targetForCount(ps.length);
  const { board, rngState } = generateBoard(seed);
  const deckShuffle = shuffle(buildDevDeck(), rngState);
  const players = ps.map((p) => ({
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
    hasLargestArmy: false
  }));
  const bank = {};
  for (const r of RESOURCES) bank[r] = 19;
  const pendingDiscards = {};
  for (const p of players) pendingDiscards[p.color] = 0;
  return {
    id,
    board,
    players,
    order: players.map((p) => p.color),
    currentPlayerIndex: 0,
    phase: "setup",
    turnPhase: "placeSettlement",
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
    log: ["Game created."]
  };
}

// engine/src/engine.ts
var err = (error) => ({ ok: false, error });
var clone = (s) => typeof structuredClone === "function" ? structuredClone(s) : JSON.parse(JSON.stringify(s));
function currentColor(s) {
  return s.order[s.currentPlayerIndex];
}
function getPlayer(s, color) {
  const p = s.players.find((x) => x.color === color);
  if (!p) throw new Error(`No such player ${color}`);
  return p;
}
function totalCards(p) {
  return RESOURCES.reduce((n, r) => n + p.resources[r], 0);
}
function canPay(p, cost) {
  return RESOURCES.every((r) => p.resources[r] >= (cost[r] ?? 0));
}
function pay(s, p, cost) {
  for (const r of RESOURCES) {
    const amt = cost[r] ?? 0;
    p.resources[r] -= amt;
    s.bank[r] += amt;
  }
}
function ownsPort(s, color, port) {
  for (const [vid, b] of Object.entries(s.settlements)) {
    if (b.owner === color && s.board.vertices[Number(vid)].port === port) return true;
  }
  return false;
}
function bankRatio(s, color, give) {
  if (ownsPort(s, color, give)) return 2;
  if (ownsPort(s, color, "3:1")) return 3;
  return 4;
}
function victoryPoints(s, color, includeHidden = true) {
  let vp = 0;
  for (const b of Object.values(s.settlements)) {
    if (b.owner === color) vp += b.type === "city" ? 2 : 1;
  }
  const p = getPlayer(s, color);
  if (p.hasLongestRoad) vp += 2;
  if (p.hasLargestArmy) vp += 2;
  if (includeHidden) {
    vp += p.devCards.filter((c) => c === "victory_point").length;
    vp += p.newDevCards.filter((c) => c === "victory_point").length;
  }
  return vp;
}
function updateLargestArmy(s) {
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
function checkWin(s, color) {
  if (victoryPoints(s, color) >= (s.targetPoints ?? VICTORY_POINTS_TO_WIN)) {
    s.winner = color;
    s.phase = "ended";
    s.log.push(`${getPlayer(s, color).name} wins!`);
  }
}
function vertexIsFree(s, vertex) {
  if (s.settlements[vertex]) return false;
  for (const n of s.board.vertices[vertex].neighbors) {
    if (s.settlements[n]) return false;
  }
  return true;
}
function playerTouchesVertexByRoad(s, color, vertex) {
  for (const eid of s.board.vertices[vertex].edges) {
    if (s.roads[eid] === color) return true;
  }
  return false;
}
function roadConnects(s, color, edge) {
  const [a, b] = s.board.edges[edge].v;
  for (const v of [a, b]) {
    const building = s.settlements[v];
    if (building && building.owner === color) return true;
    const blockedByOpponent = building && building.owner !== color;
    if (!blockedByOpponent && playerTouchesVertexByRoad(s, color, v)) return true;
  }
  return false;
}
function produce(s, roll) {
  const demand = {};
  for (const hex of s.board.hexes) {
    if (hex.token !== roll || hex.id === s.robberHex) continue;
    const res = TERRAIN_RESOURCE[hex.terrain];
    if (!res) continue;
    for (const vid of hex.vertices) {
      const b = s.settlements[vid];
      if (!b) continue;
      const amt = b.type === "city" ? 2 : 1;
      (demand[b.owner] ??= {})[res] = ((demand[b.owner] ?? {})[res] ?? 0) + amt;
    }
  }
  for (const res of RESOURCES) {
    const claimants = Object.entries(demand).filter(([, d]) => (d[res] ?? 0) > 0);
    const total = claimants.reduce((n, [, d]) => n + (d[res] ?? 0), 0);
    if (total === 0) continue;
    if (total <= s.bank[res]) {
      for (const [color, d] of claimants) {
        getPlayer(s, color).resources[res] += d[res];
        s.bank[res] -= d[res];
      }
    } else if (claimants.length === 1) {
      const [color] = claimants[0];
      const give = s.bank[res];
      getPlayer(s, color).resources[res] += give;
      s.bank[res] = 0;
    }
  }
}
function beginRobber(s, roll) {
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
  s.turnPhase = anyDiscards ? "discard" : "moveRobber";
  if (roll === 7) s.log.push("Rolled a 7 \u2014 robber activates.");
}
function stealCandidatesForHex(s, hex, robberColor) {
  const set = /* @__PURE__ */ new Set();
  for (const vid of s.board.hexes[hex].vertices) {
    const b = s.settlements[vid];
    if (b && b.owner !== robberColor && totalCards(getPlayer(s, b.owner)) > 0) set.add(b.owner);
  }
  return [...set];
}
function applyAction(state, action, byColor) {
  if (state.phase === "ended") return err("The game is over.");
  const s = clone(state);
  const cur = currentColor(s);
  if (s.phase === "setup") {
    const active = s.order[s.setupOrder[s.setupIndex]];
    if (byColor !== active) return err(`It's ${getPlayer(s, active).name}'s turn to place.`);
    const player2 = getPlayer(s, byColor);
    const isSecondRound = s.setupIndex >= s.players.length;
    if (action.type === "buildSettlement") {
      if (s.turnPhase !== "placeSettlement") return err("Place a road, not a settlement.");
      if (!vertexIsFree(s, action.vertex)) return err("Too close to another building or occupied.");
      s.settlements[action.vertex] = { type: "settlement", owner: byColor };
      player2.settlementsLeft--;
      s.setupLastVertex = action.vertex;
      if (isSecondRound) {
        for (const hid of s.board.vertices[action.vertex].hexes) {
          const hex = s.board.hexes[hid];
          const res = TERRAIN_RESOURCE[hex.terrain];
          if (res && s.bank[res] > 0) {
            player2.resources[res]++;
            s.bank[res]--;
          }
        }
      }
      s.turnPhase = "placeRoad";
      return { ok: true, state: s };
    }
    if (action.type === "buildRoad") {
      if (s.turnPhase !== "placeRoad") return err("Place a settlement first.");
      if (s.roads[action.edge] != null) return err("That edge already has a road.");
      const touchesLast = s.setupLastVertex != null && s.board.edges[action.edge].v.includes(s.setupLastVertex);
      if (!touchesLast) return err("Setup road must touch the settlement you just placed.");
      s.roads[action.edge] = byColor;
      player2.roadsLeft--;
      s.setupLastVertex = null;
      s.setupIndex++;
      if (s.setupIndex >= s.setupOrder.length) {
        s.phase = "play";
        s.currentPlayerIndex = 0;
        s.turnPhase = "roll";
        updateLongestRoad(s);
        s.log.push("Setup complete. Play begins.");
      } else {
        s.currentPlayerIndex = s.setupOrder[s.setupIndex];
        s.turnPhase = "placeSettlement";
      }
      return { ok: true, state: s };
    }
    return err("During setup, place a settlement then a road.");
  }
  if (action.type === "discard") {
    const owed = s.pendingDiscards[byColor] ?? 0;
    if (owed <= 0) return err("You have nothing to discard.");
    const p = getPlayer(s, byColor);
    const given = RESOURCES.reduce((n, r) => n + (action.resources[r] ?? 0), 0);
    if (given !== owed) return err(`You must discard exactly ${owed} cards.`);
    if (!canPay(p, action.resources)) return err("You do not have those cards.");
    pay(s, p, action.resources);
    s.pendingDiscards[byColor] = 0;
    if (Object.values(s.pendingDiscards).every((n) => n === 0)) {
      s.turnPhase = "moveRobber";
    }
    return { ok: true, state: s };
  }
  if (action.type === "acceptTrade") {
    return acceptTrade(s, byColor);
  }
  if (action.type === "declineTrade") {
    return declineTrade(s, byColor);
  }
  if (byColor !== cur) return err(`It's not your turn.`);
  const player = getPlayer(s, cur);
  switch (action.type) {
    case "rollDice": {
      if (s.turnPhase !== "roll") return err("You have already rolled.");
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
        s.turnPhase = "main";
      }
      return { ok: true, state: s };
    }
    case "buildRoad": {
      const free = s.freeRoads > 0;
      if (!free && s.turnPhase !== "main") return err("Roll first.");
      if (s.roads[action.edge] != null) return err("That edge already has a road.");
      if (player.roadsLeft <= 0) return err("No roads left.");
      if (!roadConnects(s, cur, action.edge)) return err("Road must connect to your network.");
      if (!free) {
        if (!canPay(player, COSTS.road)) return err("Not enough resources for a road.");
        pay(s, player, COSTS.road);
      } else {
        s.freeRoads--;
      }
      s.roads[action.edge] = cur;
      player.roadsLeft--;
      updateLongestRoad(s);
      if (s.freeRoads > 0 && player.roadsLeft > 0) {
        s.turnPhase = "placeRoad";
      } else if (s.turnPhase === "placeRoad") {
        s.turnPhase = "main";
        s.freeRoads = 0;
      }
      checkWin(s, cur);
      return { ok: true, state: s };
    }
    case "buildSettlement": {
      if (s.turnPhase !== "main") return err("Roll first.");
      if (player.settlementsLeft <= 0) return err("No settlements left.");
      if (!vertexIsFree(s, action.vertex)) return err("Too close to another building or occupied.");
      if (!playerTouchesVertexByRoad(s, cur, action.vertex)) return err("Must build next to your road.");
      if (!canPay(player, COSTS.settlement)) return err("Not enough resources for a settlement.");
      pay(s, player, COSTS.settlement);
      s.settlements[action.vertex] = { type: "settlement", owner: cur };
      player.settlementsLeft--;
      updateLongestRoad(s);
      checkWin(s, cur);
      return { ok: true, state: s };
    }
    case "buildCity": {
      if (s.turnPhase !== "main") return err("Roll first.");
      const b = s.settlements[action.vertex];
      if (!b || b.owner !== cur || b.type !== "settlement") return err("Upgrade your own settlement.");
      if (player.citiesLeft <= 0) return err("No cities left.");
      if (!canPay(player, COSTS.city)) return err("Not enough resources for a city.");
      pay(s, player, COSTS.city);
      s.settlements[action.vertex] = { type: "city", owner: cur };
      player.settlementsLeft++;
      player.citiesLeft--;
      checkWin(s, cur);
      return { ok: true, state: s };
    }
    case "buyDevCard": {
      if (s.turnPhase !== "main") return err("Roll first.");
      if (s.devDeck.length === 0) return err("No development cards left.");
      if (!canPay(player, COSTS.devCard)) return err("Not enough resources for a development card.");
      pay(s, player, COSTS.devCard);
      const card = s.devDeck.shift();
      player.newDevCards.push(card);
      s.log.push(`${player.name} bought a development card.`);
      if (card === "victory_point") checkWin(s, cur);
      return { ok: true, state: s };
    }
    case "playKnight": {
      if (s.turnPhase !== "main" && s.turnPhase !== "roll") return err("Cannot play a knight now.");
      if (s.hasPlayedDevCardThisTurn) return err("You already played a development card this turn.");
      const idx = player.devCards.indexOf("knight");
      if (idx < 0) return err("No knight available to play.");
      player.devCards.splice(idx, 1);
      player.playedKnights++;
      s.hasPlayedDevCardThisTurn = true;
      updateLargestArmy(s);
      checkWin(s, cur);
      s.turnPhase = "moveRobber";
      s.log.push(`${player.name} played a knight.`);
      return { ok: true, state: s };
    }
    case "moveRobber": {
      if (s.turnPhase !== "moveRobber") return err("Not time to move the robber.");
      if (action.hex === s.robberHex) return err("Robber must move to a different hex.");
      s.robberHex = action.hex;
      const candidates = stealCandidatesForHex(s, action.hex, cur);
      if (candidates.length === 0) {
        s.turnPhase = s.hasRolledThisTurn ? "main" : "roll";
        s.stealCandidates = [];
      } else if (candidates.length === 1) {
        s.stealCandidates = candidates;
        s.turnPhase = "steal";
      } else {
        s.stealCandidates = candidates;
        s.turnPhase = "steal";
      }
      return { ok: true, state: s };
    }
    case "steal": {
      if (s.turnPhase !== "steal") return err("Not time to steal.");
      if (!s.stealCandidates.includes(action.victim)) return err("Invalid steal target.");
      const victim = getPlayer(s, action.victim);
      const pool = [];
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
      s.turnPhase = s.hasRolledThisTurn ? "main" : "roll";
      return { ok: true, state: s };
    }
    case "playRoadBuilding": {
      if (s.turnPhase !== "main") return err("Roll first.");
      if (s.hasPlayedDevCardThisTurn) return err("You already played a development card this turn.");
      const idx = player.devCards.indexOf("road_building");
      if (idx < 0) return err("No road-building card available.");
      player.devCards.splice(idx, 1);
      s.hasPlayedDevCardThisTurn = true;
      s.freeRoads = Math.min(2, player.roadsLeft);
      if (s.freeRoads === 0) return err("You have no roads left to place.");
      s.turnPhase = "placeRoad";
      s.log.push(`${player.name} played Road Building.`);
      return { ok: true, state: s };
    }
    case "playYearOfPlenty": {
      if (s.turnPhase !== "main") return err("Roll first.");
      if (s.hasPlayedDevCardThisTurn) return err("You already played a development card this turn.");
      const idx = player.devCards.indexOf("year_of_plenty");
      if (idx < 0) return err("No Year of Plenty card available.");
      for (const r of action.resources) if (s.bank[r] <= 0) return err("The bank is out of that resource.");
      player.devCards.splice(idx, 1);
      s.hasPlayedDevCardThisTurn = true;
      for (const r of action.resources) {
        player.resources[r]++;
        s.bank[r]--;
      }
      s.log.push(`${player.name} played Year of Plenty.`);
      return { ok: true, state: s };
    }
    case "playMonopoly": {
      if (s.turnPhase !== "main") return err("Roll first.");
      if (s.hasPlayedDevCardThisTurn) return err("You already played a development card this turn.");
      const idx = player.devCards.indexOf("monopoly");
      if (idx < 0) return err("No Monopoly card available.");
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
    case "bankTrade": {
      if (s.turnPhase !== "main") return err("Roll first.");
      const ratio = bankRatio(s, cur, action.give);
      if (player.resources[action.give] < ratio) return err(`You need ${ratio} ${action.give}.`);
      if (s.bank[action.want] <= 0) return err("The bank is out of that resource.");
      player.resources[action.give] -= ratio;
      s.bank[action.give] += ratio;
      player.resources[action.want] += 1;
      s.bank[action.want] -= 1;
      return { ok: true, state: s };
    }
    case "offerTrade": {
      if (s.turnPhase !== "main") return err("Roll first.");
      if (!canPay(player, action.give)) return err("You do not have what you are offering.");
      s.pendingTrade = { from: cur, give: action.give, want: action.want, acceptedBy: [], declinedBy: [] };
      return { ok: true, state: s };
    }
    case "cancelTrade": {
      s.pendingTrade = null;
      return { ok: true, state: s };
    }
    case "confirmTrade": {
      const t = s.pendingTrade;
      if (!t || t.from !== cur) return err("No trade of yours to confirm.");
      if (!t.acceptedBy.includes(action.with)) return err("That player has not accepted.");
      const other = getPlayer(s, action.with);
      if (!canPay(player, t.give)) return err("You can no longer cover this trade.");
      if (!canPay(other, t.want)) return err("They can no longer cover this trade.");
      for (const r of RESOURCES) {
        const g = t.give[r] ?? 0;
        const w = t.want[r] ?? 0;
        player.resources[r] += w - g;
        other.resources[r] += g - w;
      }
      s.pendingTrade = null;
      s.log.push(`${player.name} traded with ${other.name}.`);
      return { ok: true, state: s };
    }
    case "endTurn": {
      if (!s.hasRolledThisTurn) return err("You must roll before ending your turn.");
      if (s.turnPhase !== "main") return err("Resolve the current step before ending your turn.");
      player.devCards.push(...player.newDevCards);
      player.newDevCards = [];
      s.hasPlayedDevCardThisTurn = false;
      s.hasRolledThisTurn = false;
      s.pendingTrade = null;
      s.dice = null;
      s.freeRoads = 0;
      s.currentPlayerIndex = (s.currentPlayerIndex + 1) % s.players.length;
      s.turnPhase = "roll";
      return { ok: true, state: s };
    }
  }
  return err("Unknown or out-of-turn action.");
}
function acceptTrade(state, byColor) {
  if (!state.pendingTrade) return err("There is no trade to accept.");
  if (state.pendingTrade.from === byColor) return err("You cannot accept your own offer.");
  const other = getPlayer(state, byColor);
  if (!canPay(other, state.pendingTrade.want)) return err("You cannot cover this trade.");
  const s = clone(state);
  const t = s.pendingTrade;
  t.declinedBy = t.declinedBy.filter((c) => c !== byColor);
  if (!t.acceptedBy.includes(byColor)) t.acceptedBy.push(byColor);
  return { ok: true, state: s };
}
function declineTrade(state, byColor) {
  if (!state.pendingTrade) return err("There is no trade to decline.");
  if (state.pendingTrade.from === byColor) return err("You cannot decline your own offer.");
  const s = clone(state);
  const t = s.pendingTrade;
  t.acceptedBy = t.acceptedBy.filter((c) => c !== byColor);
  if (!t.declinedBy.includes(byColor)) t.declinedBy.push(byColor);
  return { ok: true, state: s };
}
export {
  COSTS,
  HAND_LIMIT_BEFORE_DISCARD,
  PLAYER_COLORS,
  RESOURCES,
  TERRAIN_RESOURCE,
  VICTORY_POINTS_TO_WIN,
  acceptTrade,
  applyAction,
  buildGeometry,
  createGame,
  currentColor,
  declineTrade,
  desertHexId,
  generateBoard,
  longestRoadLength,
  nextInt,
  nextRandom,
  rollDice,
  shuffle,
  targetForCount,
  updateLongestRoad,
  victoryPoints
};
