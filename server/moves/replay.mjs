#!/usr/bin/env node
// Rebuilds games from the move log (server/migrate-moves.sql) and checks every step, then optionally writes the games
// out as training data.
//
//   node server/moves/replay.mjs rows.json                 check every game in the file
//   node server/moves/replay.mjs rows.json --out dir       ...and write dir/games.jsonl + dir/decisions.jsonl
//   node server/moves/replay.mjs rows.json --out dir --full   decisions keep every hand (no hiding)
//   --current-engine   replay every move with today's engine instead of the one its build ran (found in git by version)
//
// rows.json: game_moves rows as JSON (an array, or one row per line), any number of games. A game is ~130 KB, so export
// a few at a time from the SQL editor, e.g. select json_agg(m order by m.id) from game_moves m where m.gid = '...';
// or everything with psql: \copy (select row_to_json(m) from game_moves m order by m.id) to 'rows.json'
//
// The check: start from the game's first saved state, apply each move with the same engine the app runs
// (prototype/catan-engine.js) and each other save's recorded changes, and after every move compare the rng cursor, the
// bank, every hand and the turn with what the database saw (chk). At the end, the rebuilt state must equal the saved
// end state in every key. A game that gets there is verified: nothing happened in it that the log doesn't hold.
// Moves are replayed with the engine of the build that made them (by app version, from git).
//
// games.jsonl: one line per game: gid, code, start time, seats (colour -> name, player id), the board, who won and the
//   final points. decisions.jsonl: one line per move a player chose (the app's automatic moves are left out): the game,
//   the step, the time, how long since the previous save (think_ms), who (colour, name, player id), the move, and the
//   state they saw just before it. By default that state is what that player could see at the table: their own hand
//   and dev cards in full, everyone else's as counts, the dev deck as its size, no rng cursor.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const RES = ['brick', 'wood', 'sheep', 'wheat', 'ore'];
const TAGS = ['_w', '_av', '_a', '_n', '_act'];

function engineFrom(code) {
  const ctx = { structuredClone, console };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;globalThis.Catan = Catan;', ctx);
  return ctx.Catan;
}
export function loadEngine(file = path.join(here, '../../prototype/catan-engine.js')) { return engineFrom(fs.readFileSync(file, 'utf8')); }
// The engine of the build that made a move: each deploy is a commit "vNNN: ..." on main (deploy.sh), so its bundle is
// in git. A move is replayed with the rules the phone played it with; unknown builds (vNEXT, a branch) use today's.
const ENGINES = new Map();
export function engineForApp(app, fallback) {
  if (!app || !/^v\d+$/.test(app)) return fallback;
  if (ENGINES.has(app)) return ENGINES.get(app) || fallback;
  let C = null;
  try {
    const git = (args) => execFileSync('git', args, { cwd: here, encoding: 'utf8', maxBuffer: 1 << 28, stdio: ['ignore', 'pipe', 'ignore'] });
    const h = git(['log', '--all', '-1', '--format=%H', '--grep', '^' + app + ':']).trim();
    if (h) C = engineFrom(git(['show', h + ':prototype/catan-engine.js']));
  } catch (_) { C = null; }
  ENGINES.set(app, C);
  return C || fallback;
}

export function readRows(file) {
  const txt = fs.readFileSync(file, 'utf8').trim();
  if (!txt) return [];
  if (txt[0] === '[') return JSON.parse(txt);
  return txt.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

// JSON with sorted keys: the database's jsonb and JS order keys differently
export function canon(v) {
  if (Array.isArray(v)) return '[' + v.map(canon).join(',') + ']';
  if (v && typeof v === 'object') return '{' + Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => JSON.stringify(k) + ':' + canon(v[k])).join(',') + '}';
  return JSON.stringify(v === undefined ? null : v);
}
const clone = (v) => JSON.parse(JSON.stringify(v));
const parse = (v) => (typeof v === 'string' ? JSON.parse(v) : v);   // psql exports jsonb as text in some setups

// the same summary the database stores with each move (games_log's chk)
export function chkOf(s) {
  return { g: s.rngState, b: RES.map((r) => s.bank[r]), h: s.players.map((p) => RES.map((r) => p.resources[r])), t: s.currentPlayerIndex, p: s.turnPhase };
}
// what the engine owns: compared against the saved end state
// the end check compares every key the end state holds (it is saved without the board) except the save tags
const endKeys = (a, b) => Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter((k) => k !== 'board' && !TAGS.includes(k)).sort();
// engine actions, for spotting moves an older build saved as plain changes (applied, but not re-checked by the engine)
const ACTION_TYPES = new Set(['rollDice', 'buildSettlement', 'buildRoad', 'buildCity', 'buyDevCard', 'playKnight', 'playRoadBuilding', 'playYearOfPlenty',
  'playMonopoly', 'moveRobber', 'steal', 'discard', 'bankTrade', 'bankExchange', 'offerTrade', 'acceptTrade', 'declineTrade', 'counterTrade',
  'confirmTrade', 'cancelTrade', 'endTurn']);

// what `color` could see at the table
export function viewFor(s, color, full) {
  const o = clone(s);
  for (const k of ['board', 'log', 'luckLog', 'gid', 'sv', 'rm', 'rps', 'cup', ...TAGS]) delete o[k];
  if (full) return o;
  delete o.rngState;
  o.devDeck = (s.devDeck || []).length;
  o.players = o.players.map((p) => {
    if (p.color === color) return p;
    const n = RES.reduce((t, r) => t + (p.resources[r] || 0), 0);
    return Object.assign({}, p, { resources: n, devCards: (p.devCards || []).length, newDevCards: (p.newDevCards || []).length });
  });
  return o;
}

export function replayGame(C, rows, opts = {}) {
  rows = rows.slice().sort((a, b) => Number(a.id) - Number(b.id));
  const out = { gid: rows[0] && rows[0].gid, ok: true, verified: false, problems: [], moves: 0, metas: 0, unchecked: 0, decisions: [], game: null, state: null };
  const fail = (row, msg) => { out.ok = false; out.problems.push(`#${row ? row.id : '?'} (v${row ? row.version : '?'}): ${msg}`); };
  const startAt = rows.findIndex((r) => r.kind === 'start');
  if (startAt < 0) { fail(null, 'no start row'); return out; }
  if (startAt > 0) fail(rows[0], `${startAt} rows before the start row`);
  const start = rows[startAt];
  let s = clone(parse(start.snap)), seats = parse(start.seats) || [], prevAt = Date.parse(start.at), ended = null;
  const who = (color) => seats.find((x) => x && x.color === color) || {};
  out.game = { gid: start.gid, code: start.code, started_at: start.at, start: start.label, seats, board: s.board, targetPoints: s.targetPoints, friendly: !!s.friendly, cup: s.cup ? { name: s.cup.name, n: s.cup.n, of: s.cup.games } : null };
  for (let i = startAt + 1; i < rows.length; i++) {
    const row = rows[i], at = Date.parse(row.at);
    if (row.seats) seats = parse(row.seats);
    if (row.kind === 'move') {
      const action = parse(row.action);
      const before = s;
      const E = opts.currentEngine ? C : engineForApp(row.app, C);
      const r = E.applyAction(s, action, row.actor);
      if (!r.ok) { fail(row, `the engine refused ${action && action.type} by ${row.actor}: ${r.error}`); break; }
      s = r.state; out.moves++;
      const chk = parse(row.chk);
      if (chk && canon(chk) !== canon(chkOf(s))) { fail(row, `out of step after ${action.type}: saved ${canon(chk)}, replayed ${canon(chkOf(s))}`); break; }
      if (!row.auto) {
        const w = who(row.actor);
        out.decisions.push({ gid: row.gid, step: out.moves, at: row.at, think_ms: Number.isFinite(at - prevAt) ? at - prevAt : null,
          color: row.actor, name: w.name || null, playerId: w.playerId || null, app: row.app || null, action, state: viewFor(before, row.actor, opts.full) });
      }
    } else if (row.kind === 'meta') {
      s = Object.assign(clone(s), parse(row.patch) || {});
      for (const k of parse(row.gone) || []) delete s[k];
      out.metas++;
      if (ACTION_TYPES.has(row.label)) out.unchecked++;   // an engine move from an older build: taken as saved
    } else if (row.kind === 'close') {
      break;
    } else if (row.kind === 'start') {
      fail(row, 'a second start row for the same game'); break;
    }
    prevAt = Number.isFinite(at) ? at : prevAt;
    if (row.snap) {
      ended = parse(row.snap);
      const diff = endKeys(s, ended).filter((k) => canon(s[k]) !== canon(ended[k]));
      if (diff.length) fail(row, 'the rebuilt end state differs from the saved one in: ' + diff.join(', '));
      else out.endChecked = true;
    }
  }
  out.state = s;
  // verified = it reached the saved end state and matched it in every key; a game without one (still running, reset)
  // only had the per-move check (rng, bank, hands, turn), so it isn't
  out.verified = out.ok && !!out.endChecked;
  out.game.finished = s.phase === 'ended';
  out.game.ended_at = ended ? rows[rows.length - 1].at : null;
  out.game.winner = s.winner || null;
  out.game.points = s.players.map((p) => ({ color: p.color, vp: C.victoryPoints(s, p.color, true) }));
  out.game.moves = out.moves;
  return out;
}

function main(argv) {
  const file = argv[0];
  if (!file) { console.error('usage: node server/moves/replay.mjs rows.json [--out dir] [--full]'); process.exit(2); }
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null, full = argv.includes('--full'), currentEngine = argv.includes('--current-engine');
  const C = loadEngine();
  const byGame = new Map();
  for (const r of readRows(file)) { if (!byGame.has(r.gid)) byGame.set(r.gid, []); byGame.get(r.gid).push(r); }
  let bad = 0;
  const games = [], decisions = [];
  let verified = 0;
  for (const [gid, rows] of byGame) {
    const g = replayGame(C, rows, { full, currentEngine });
    const status = !g.ok ? 'BAD' : g.verified ? 'ok ' : 'ok?';
    console.log(`${status} ${gid}  ${g.game ? g.game.code : '?'}  ${g.moves} moves, ${g.metas} other saves${g.unchecked ? ` (${g.unchecked} moves from older builds, taken as saved)` : ''}, ${g.decisions.length} choices, ${g.verified ? 'end state matches' : g.game && g.game.finished ? 'finished' : 'no end state to check'}`);
    for (const p of g.problems) console.log('    ' + p);
    if (!g.ok) bad++;
    if (g.verified) verified++;
    if (g.game) games.push(Object.assign({ verified: g.verified, unchecked_moves: g.unchecked }, g.game));
    decisions.push(...g.decisions.map((d) => Object.assign({ verified: g.verified }, d)));
  }
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'games.jsonl'), games.map((g) => JSON.stringify(g)).join('\n') + '\n');
    fs.writeFileSync(path.join(outDir, 'decisions.jsonl'), decisions.map((d) => JSON.stringify(d)).join('\n') + '\n');
    console.log(`wrote ${games.length} games and ${decisions.length} decisions to ${outDir}`);
  }
  console.log(`${byGame.size - bad} of ${byGame.size} games replay without a problem; ${verified} also match their saved end state (verified)`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
