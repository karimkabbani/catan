// Driven by selftest.sh against a throwaway Postgres (PGHOST/PGPORT/... set). Plays games the way the app saves them:
// every save reads the row, builds on the server's copy and writes it back version-guarded (NET._doSync, svUpdate,
// rpsUpdate in prototype/app.js), with the same save tags. Also saves the way older builds do, races two phones,
// sends a write the card guard refuses, a save that only moves tags, a seating change, a rematch and a reset.
//   node selftest.mjs before            a game already running before the log is switched on (table T0)
//   node selftest.mjs games rows.json   the rest; dumps game_moves to rows.json
//   node selftest.mjs check outDir rows.json   checks replay.mjs's output, and that a doctored log is caught
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadEngine, readRows, replayGame } from './replay.mjs';

const C = loadEngine();
const RES = ['brick', 'wood', 'sheep', 'wheat', 'ore'];
let seed = 12345;
const rnd = () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const pickOne = (a) => a[Math.floor(rnd() * a.length)];
const shuffle = (a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const clone = (v) => JSON.parse(JSON.stringify(v));
const nonce = () => Math.random().toString(36).slice(2, 10);
function assert(ok, msg) { if (!ok) { console.error('FAIL: ' + msg); process.exit(1); } }

// ---- database ----
function sql(q) { return execFileSync('psql', ['-qAt', '-v', 'ON_ERROR_STOP=1'], { input: q, encoding: 'utf8', maxBuffer: 1 << 30 }).trim(); }
const lit = (v) => '$j$' + JSON.stringify(v) + '$j$::jsonb';
function getRow(code) { const t = sql(`select json_build_object('state', state, 'version', version, 'players', players) from games where code = '${code}'`); return t ? JSON.parse(t) : null; }
const moveRows = () => Number(sql('select count(*) from game_moves'));
const hasLog = () => sql("select to_regclass('public.game_moves') is not null") === 't';
let between = null;   // runs once between a save's read and its write (a second phone getting in first)
// one version-guarded read-modify-write, retried like the app; build(serverState) -> the state to save, or null
function save(code, build) {
  for (let i = 0; i < 8; i++) {
    const row = getRow(code);
    const ns = build(clone(row.state));
    if (!ns) return false;
    if (between) { const f = between; between = null; f(); }
    const v = sql(`update games set state = ${lit(ns)}, version = ${row.version + 1} where code = '${code}' and version = ${row.version} returning version`);
    if (v) return true;
  }
  throw new Error('save kept losing the race');
}

// ---- the ways a phone saves ----
let newSaves = 0;
// this build: the move rides along in _act (NET._doSync)
function moveNew(code, action, by, auto) {
  return save(code, (s) => {
    const r = C.applyAction(s, action, by); if (!r.ok) return null;
    const n = r.state; n._w = 'dev-' + by; n._av = 'vNEXT'; n._a = action.type; n._n = nonce();
    n._act = { a: action, by, n: n._n }; if (auto) n._act.auto = auto;
    return n;
  }) && ++newSaves > 0;
}
// v254-v267: fresh tag, but whatever _act the last save had is copied along
function moveV260(code, action, by) {
  return save(code, (s) => { const r = C.applyAction(s, action, by); if (!r.ok) return null; Object.assign(r.state, { _w: 'old-' + by, _av: 'v260', _a: action.type, _n: nonce() }); return r.state; });
}
// before v254: every tag copied from the last save
function movePre254(code, action, by) { return save(code, (s) => { const r = C.applyAction(s, action, by); return r.ok ? r.state : null; }); }
// svUpdate / rpsUpdate: not an engine move
function meta(code, label, mutate) { return save(code, (s) => { if (mutate(s) === false) return null; Object.assign(s, { _w: 'dev-meta', _av: 'vNEXT', _a: label, _n: nonce() }); return s; }); }

// ---- a random but legal player ----
const tryAct = (s, a, by) => C.applyAction(s, a, by).ok;
function firstOk(s, by, acts) { for (const a of acts) if (tryAct(s, a, by)) return a; return null; }
function chooseMove(s) {
  const cur = C.currentColor(s), me = s.players.find((p) => p.color === cur);
  if (s.phase === 'setup') {
    const by = s.order[s.setupOrder[s.setupIndex]];
    if (s.turnPhase === 'placeSettlement') return { by, a: firstOk(s, by, shuffle(s.board.vertices.map((v) => ({ type: 'buildSettlement', vertex: v.id })))) };
    return { by, a: firstOk(s, by, shuffle(s.board.edges.map((e) => ({ type: 'buildRoad', edge: e.id })))) };
  }
  if (s.turnPhase === 'discard') {
    const by = Object.keys(s.pendingDiscards).find((c) => s.pendingDiscards[c] > 0);
    const p = s.players.find((x) => x.color === by), bag = shuffle(RES.flatMap((r) => Array(p.resources[r]).fill(r))), give = {};
    bag.slice(0, s.pendingDiscards[by]).forEach((r) => { give[r] = (give[r] || 0) + 1; });
    return { by, a: { type: 'discard', resources: give } };
  }
  if (s.turnPhase === 'roll') {
    if (me.devCards.includes('knight') && !s.hasPlayedDevCardThisTurn && rnd() < 0.4) return { by: cur, a: { type: 'playKnight' } };
    return { by: cur, a: { type: 'rollDice' }, auto: rnd() < 0.8 ? 'roll' : null };
  }
  if (s.turnPhase === 'moveRobber') return { by: cur, a: firstOk(s, cur, shuffle(s.board.hexes.map((h) => ({ type: 'moveRobber', hex: h.id })))) };
  if (s.turnPhase === 'steal') return { by: cur, a: { type: 'steal', victim: pickOne(s.stealCandidates) }, auto: s.stealCandidates.length === 1 ? 'steal' : null };
  if (s.turnPhase === 'placeRoad') return { by: cur, a: firstOk(s, cur, shuffle(s.board.edges.map((e) => ({ type: 'buildRoad', edge: e.id })))) };
  // main phase: an open offer gets answered, then confirmed or withdrawn
  const pt = s.pendingTrade;
  if (pt) {
    const waiting = s.players.filter((p) => p.color !== pt.from && !pt.acceptedBy.includes(p.color) && !pt.declinedBy.includes(p.color) && !(pt.counters && pt.counters[p.color]));
    if (waiting.length) {
      const p = waiting[0], x = rnd();
      if (x < 0.4) { const a = { type: 'acceptTrade', tid: pt.id }; if (tryAct(s, a, p.color)) return { by: p.color, a }; }
      if (x < 0.6) { const r = RES.find((q) => p.resources[q] > 0); if (r) { const a = { type: 'counterTrade', give: pt.give, want: { [r]: 1 }, tid: pt.id }; if (tryAct(s, a, p.color)) return { by: p.color, a }; } }
      return { by: p.color, a: { type: 'declineTrade', tid: pt.id }, auto: rnd() < 0.2 ? 'decline' : null };
    }
    const withWho = [...pt.acceptedBy, ...Object.keys(pt.counters || {})];
    for (const w of shuffle(withWho)) { const cv = ((pt.counters || {})[w] || {}).v || 0; const a = { type: 'confirmTrade', with: w, tid: pt.id, cv }; if (tryAct(s, a, cur)) return { by: cur, a }; }
    return { by: cur, a: { type: 'cancelTrade' } };
  }
  const opts = shuffle(['city', 'settlement', 'road', 'dev', 'play', 'bank', 'offer', 'end', 'end']);
  for (const o of opts) {
    let a = null;
    if (o === 'city') a = firstOk(s, cur, Object.keys(s.settlements).map((v) => ({ type: 'buildCity', vertex: Number(v) })));
    if (o === 'settlement') a = firstOk(s, cur, shuffle(s.board.vertices.map((v) => ({ type: 'buildSettlement', vertex: v.id }))));
    if (o === 'road' && rnd() < 0.5) a = firstOk(s, cur, shuffle(s.board.edges.map((e) => ({ type: 'buildRoad', edge: e.id }))));
    if (o === 'dev') a = firstOk(s, cur, [{ type: 'buyDevCard' }]);
    if (o === 'play') a = firstOk(s, cur, shuffle([{ type: 'playKnight' }, { type: 'playRoadBuilding' }, { type: 'playMonopoly', resource: pickOne(RES) }, { type: 'playYearOfPlenty', resources: [pickOne(RES), pickOne(RES)] }]));
    if (o === 'bank') { const g = RES.find((r) => me.resources[r] >= 4); if (g) a = firstOk(s, cur, [{ type: 'bankExchange', give: { [g]: 4 }, want: { [pickOne(RES.filter((r) => r !== g))]: 1 } }, { type: 'bankTrade', give: g, want: pickOne(RES.filter((r) => r !== g)) }]); }
    if (o === 'offer' && rnd() < 0.5) { const g = RES.find((r) => me.resources[r] > 0); if (g) a = firstOk(s, cur, [{ type: 'offerTrade', give: { [g]: 1 }, want: { [pickOne(RES.filter((r) => r !== g))]: 1 } }]); }
    if (o === 'end') a = firstOk(s, cur, [{ type: 'endTurn' }]);
    if (a) return { by: cur, a };
  }
  return { by: cur, a: { type: 'endTurn' } };
}
// plays `code` with `saver` until it ends (or `steps` saves); `extra(i)` can slip other saves in
function play(code, saver, steps = 5000, extra = null) {
  for (let i = 0; i < steps; i++) {
    const s = getRow(code).state;
    if (!s || s.phase === 'ended') return i;
    if (extra && extra(i, s)) continue;
    const m = chooseMove(s);
    assert(m.a, `no legal move found (${s.phase}/${s.turnPhase})`);
    assert(saver(code, m.a, m.by, m.auto), `save refused: ${JSON.stringify(m.a)} by ${m.by}`);
  }
  return steps;
}
function newGame(n) {
  const colors = ['red', 'blue', 'green', 'yellow', 'purple', 'black'].slice(0, n), names = ['Karim', 'Ramzi', 'Kay', 'Nasam', 'Lapen', 'Test'];
  const players = colors.map((c, i) => ({ color: c, name: names[i] }));
  const s = C.createGame({ id: 'table', players, seed: Math.floor(rnd() * 1e9), targetPoints: 10, randomFirst: true });
  s.whoStarts = 'random';
  const seats = colors.map((c, i) => ({ seat: i, color: c, name: names[i], playerId: 'p' + i, avatar: 'data:image/png;base64,AAAA' }));
  return { s, seats };
}

const mode = process.argv[2];
if (mode === 'before') {
  const { s, seats } = newGame(4);
  sql(`insert into games (code, phase, players, state, version) values ('T0', 'playing', ${lit(seats)}, ${lit(s)}, 1)`);
  play('T0', movePre254, 40);
  console.log('T0: 40 saves before the log existed');
} else if (mode === 'games') {
  assert(hasLog(), 'game_moves missing');
  const out = process.argv[3];
  // T0: the game that was already running carries on with this build
  const t0 = play('T0', moveNew);
  console.log(`T0: finished after ${t0} more saves`);

  // T1: a fresh game with a who-starts round, older builds, a race, a refused write, flags, a seating change
  const g1 = newGame(4);
  g1.s.rps = { round: 1, alive: g1.s.players.map((p) => p.color), picks: {}, done: false };
  sql(`insert into games (code, phase, players, state, version) values ('T1', 'playing', ${lit(g1.seats)}, ${lit(g1.s)}, 1)`);
  for (const p of g1.s.players) meta('T1', 'rps', (s) => { s.rps.picks[p.color] = pickOne(['r', 'p', 's']); });
  meta('T1', 'rps', (s) => { s.rps.done = true; });
  let raced = false, refused = false, tagsOnly = false, seated = false, flagged = 0;
  const t1 = play('T1', moveNew, 5000, (i, s) => {
    if (i === 30) { const m = chooseMove(s); movePre254('T1', m.a, m.by); return true; }
    if (i === 31 || i === 32) { const m = chooseMove(s); moveV260('T1', m.a, m.by); return true; }
    if (i === 50) { meta('T1', 'meta', (x) => { x.sv = { flags: [x.players[1].color] }; }); flagged++; return true; }
    if (i === 51) { meta('T1', 'meta', (x) => { delete x.sv; }); flagged++; return true; }
    if (i === 60) {   // a save that only moves tags writes nothing to the log
      const before = moveRows(); meta('T1', 'meta', () => { }); tagsOnly = moveRows() === before; return true;
    }
    if (i === 70) {   // the card guard refuses this one: it must leave no trace
      const before = moveRows(), row = getRow('T1'), bad = clone(row.state); bad.players[0].resources.brick += 5; bad._n = nonce();
      const v = sql(`update games set state = ${lit(bad)}, version = ${row.version + 1} where code = 'T1' and version = ${row.version} returning version`);
      refused = !v && moveRows() === before && getRow('T1').version === row.version; return true;
    }
    if (i === 80) { const row = getRow('T1'); const pl = clone(row.players); pl[2].name = 'Kay K'; sql(`update games set players = ${lit(pl)} where code = 'T1'`); seated = true; return true; }
    if (s.pendingTrade && !raced) {   // two phones answer the same offer at once: one write loses, re-reads, lands second
      const pt = s.pendingTrade, others = s.players.filter((p) => p.color !== pt.from && !pt.acceptedBy.includes(p.color) && !pt.declinedBy.includes(p.color) && !(pt.counters && pt.counters[p.color]));
      if (others.length >= 2) {
        raced = true;
        between = () => { moveNew('T1', { type: 'declineTrade', tid: pt.id }, others[1].color); };
        moveNew('T1', { type: 'declineTrade', tid: pt.id }, others[0].color);
        return true;
      }
    }
    return false;
  });
  assert(raced && refused && tagsOnly && seated && flagged === 2, `T1 scenarios: raced ${raced} refused ${refused} tagsOnly ${tagsOnly} seated ${seated}`);
  console.log(`T1: finished after ${t1} saves (race, refused write, tag-only save, flags, seat change, older builds)`);

  // T1 again: a rematch on the same table, then a reset before it ends
  const g2 = newGame(4);
  sql(`update games set state = ${lit(g2.s)}, players = ${lit(g2.seats)}, version = version + 1 where code = 'T1'`);
  play('T1', moveNew, 60);
  sql(`update games set phase = 'idle', state = null, players = '[]', version = 0 where code = 'T1'`);
  console.log('T1 rematch: 60 saves, then the table was reset');

  // T5: a 5-player game
  const g5 = newGame(5);
  sql(`insert into games (code, phase, players, state, version) values ('T5', 'playing', ${lit(g5.seats)}, ${lit(g5.s)}, 1)`);
  console.log(`T5: finished after ${play('T5', moveNew)} saves`);

  // T9: if logging breaks, the save still goes through (and T9's rows are dropped so the dump holds only real games)
  const g9 = newGame(3);
  sql(`insert into games (code, phase, players, state, version) values ('T9', 'playing', ${lit(g9.seats)}, ${lit(g9.s)}, 1)`);
  sql(`alter table game_moves add constraint t9_break check (code <> 'T9' or kind = 'start') not valid`);
  const m9 = chooseMove(getRow('T9').state);
  assert(moveNew('T9', m9.a, m9.by) && getRow('T9').version === 2, 'a save whose log row fails still lands');
  newSaves--;   // it saved, but on purpose left no move row
  sql(`alter table game_moves drop constraint t9_break`);
  assert(sql(`select count(*) from game_moves where code = 'T9'`) === '1', 'T9: only its start row');
  sql(`delete from game_moves where code = 'T9'`);
  console.log('T9: a save whose log row failed still landed');

  // T8: a game that had already ended when the log went in (rematch votes still being saved) is left alone
  const g8 = newGame(3); g8.s.phase = 'ended';
  sql(`insert into games (code, phase, players, state, version) values ('T8', 'ended', ${lit(g8.seats)}, ${lit(g8.s)}, 1)`);
  meta('T8', 'meta', (x) => { x.rm = { votes: { red: 'y' } }; });
  assert(sql(`select count(*) from game_moves where code = 'T8'`) === '0' && !getRow('T8').state.gid, 'an already-finished game is not logged');
  console.log('T8: a game finished before the log went in is not logged');

  // what the database holds
  const starts = JSON.parse(sql(`select json_agg(json_build_object('code', code, 'label', label) order by id) from game_moves where kind = 'start'`));
  assert(starts.map((x) => x.code + ':' + x.label).join(' ') === 'T0:mid-game T1:new T1:new T5:new', 'start rows: ' + JSON.stringify(starts));
  // every save from this build is one move row, except T0's first after the log went in: that one is T0's start row
  const nMoves = Number(sql(`select count(*) from game_moves where kind = 'move'`));
  assert(nMoves === newSaves - 1, `move rows ${nMoves}, saves from this build ${newSaves}`);
  assert(sql(`select count(*) from game_moves where seats::text like '%avatar%'`) === '0', 'no photos in the log');
  assert(sql(`select count(*) from game_moves where kind = 'close'`) === '1', 'one reset');
  assert(sql(`select count(*) from games where state is not null and state->>'gid' is null and code <> 'T8'`) === '0', 'every live game has an id');
  assert(sql(`select count(*) from game_moves where kind = 'meta' and label = 'rps'`) === '5', 'who-starts saves logged');
  const sizes = sql(`select string_agg(code || ' ' || n || ' rows ' || round(kb) || ' KB', ', ' order by code) from (select min(code) code, count(*) n, sum(pg_column_size(m.*)) / 1024.0 kb from game_moves m group by gid) x`);
  console.log('stored: ' + sizes);
  fs.writeFileSync(out, sql(`select coalesce(json_agg(m order by m.id), '[]'::json) from game_moves m`));
} else if (mode === 'check') {
  const dir = process.argv[3], rowsFile = process.argv[4];
  const games = fs.readFileSync(path.join(dir, 'games.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const decs = fs.readFileSync(path.join(dir, 'decisions.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert(games.length === 4, 'four games');
  assert(games.filter((g) => g.finished && g.verified).length === 3, 'the three finished games verified against their end state');
  assert(games.filter((g) => !g.finished && !g.verified).length === 1, 'the reset game is not marked verified (no end state to check)');
  assert(games.find((g) => g.code === 'T1' && g.finished).unchecked_moves >= 3, "older builds' moves are counted as taken-as-saved");
  assert(games.every((g) => g.board && g.seats.length >= 4), 'each game has its board and seats');
  assert(decs.length > 500 && decs.every((d) => d.playerId && d.state && !d.state.board), 'decisions carry who and what they saw');
  const d = decs.find((x) => x.state.phase === 'play');
  assert(d.state.players.every((p) => (p.color === d.color) === (typeof p.resources === 'object')), "others' hands are counts");
  assert(typeof d.state.devDeck === 'number' && d.state.rngState === undefined, 'deck hidden, no rng');
  assert(decs.some((x) => x.action.type === 'rollDice') && decs.some((x) => x.action.type === 'declineTrade'), 'manual rolls and declines kept');
  assert(decs.some((x) => x.name === 'Kay K'), 'the seat change reached the decisions');
  // the check really checks: a doctored log must fail
  const rows = readRows(rowsFile), t5 = rows.filter((r) => r.code === 'T5');
  const bad1 = clone(t5); const mv = bad1.filter((r) => r.kind === 'move' && r.action.type === 'buildRoad')[10]; mv.action.edge = (mv.action.edge + 1) % 72;
  assert(!replayGame(C, bad1).ok, 'a changed move is caught');
  const bad2 = clone(t5); bad2.splice(bad2.findIndex((r) => r.kind === 'move' && r.action.type === 'endTurn'), 1);
  assert(!replayGame(C, bad2).ok, 'a missing move is caught');
  assert(replayGame(C, t5).ok && replayGame(C, t5).verified, 'the real log passes');
  const bad3 = clone(t5); const end = bad3.find((r) => r.snap && r.kind !== 'start'); end.snap.robberBy = end.snap.robberBy === 'red' ? 'blue' : 'red';
  assert(!replayGame(C, bad3).ok, 'a difference in any key of the end state is caught');
  console.log(`check: ${games.length} games, ${decs.length} decisions, doctored logs caught`);
}
