#!/usr/bin/env node
// Rebuilds games from the move log (server/migrate-moves.sql) and checks every step, then optionally writes the games
// out as training data.
//
//   node server/moves/replay.mjs rows.json                 check every game in the file
//   node server/moves/replay.mjs rows.json --out dir       ...and write dir/games.jsonl + dir/decisions.jsonl
//   node server/moves/replay.mjs rows.json --out dir --full   decisions keep every hand (no hiding)
//
// rows.json: game_moves rows as JSON (an array, or one row per line), any number of games, e.g. from the SQL editor:
//   select json_agg(m order by m.id) from game_moves m where m.gid in (select gid from game_move_games where finished);
//
// The check: start from the game's first saved state, apply each move with the same engine the app runs
// (prototype/catan-engine.js) and each other save's recorded changes, and after every move compare the rng cursor, the
// bank, every hand and the turn with what the database saw (chk). At the end, the rebuilt state must equal the saved
// end state. A game that passes is complete: nothing happened in it that the log doesn't hold.
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

const here = path.dirname(fileURLToPath(import.meta.url));
const RES = ['brick', 'wood', 'sheep', 'wheat', 'ore'];
const TAGS = ['_w', '_av', '_a', '_n', '_act'];

export function loadEngine(file = path.join(here, '../../prototype/catan-engine.js')) {
  const ctx = { structuredClone, console };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8') + '\n;globalThis.Catan = Catan;', ctx);
  return ctx.Catan;
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
const ENGINE_KEYS = ['players', 'bank', 'devDeck', 'settlements', 'roads', 'robberHex', 'rngState', 'rolls', 'phase', 'turnPhase', 'winner',
  'currentPlayerIndex', 'longestRoadOwner', 'largestArmyOwner', 'log', 'tally', 'luckLog', 'pendingTrade'];
const pick = (s, keys) => Object.fromEntries(keys.filter((k) => s[k] !== undefined).map((k) => [k, s[k]]));

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
  const out = { gid: rows[0] && rows[0].gid, ok: true, problems: [], moves: 0, metas: 0, decisions: [], game: null, state: null };
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
      const r = C.applyAction(s, action, row.actor);
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
    } else if (row.kind === 'close') {
      break;
    } else if (row.kind === 'start') {
      fail(row, 'a second start row for the same game'); break;
    }
    prevAt = Number.isFinite(at) ? at : prevAt;
    if (row.snap) {
      ended = parse(row.snap);
      const a = canon(pick(s, ENGINE_KEYS)), b = canon(pick(ended, ENGINE_KEYS));
      if (a !== b) {
        const diff = ENGINE_KEYS.filter((k) => canon(s[k]) !== canon(ended[k]));
        fail(row, 'the rebuilt end state differs from the saved one in: ' + diff.join(', '));
      }
    }
  }
  out.state = s;
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
  const outDir = argv.includes('--out') ? argv[argv.indexOf('--out') + 1] : null, full = argv.includes('--full');
  const C = loadEngine();
  const byGame = new Map();
  for (const r of readRows(file)) { if (!byGame.has(r.gid)) byGame.set(r.gid, []); byGame.get(r.gid).push(r); }
  let bad = 0;
  const games = [], decisions = [];
  for (const [gid, rows] of byGame) {
    const g = replayGame(C, rows, { full });
    const status = g.ok ? 'ok ' : 'BAD';
    console.log(`${status} ${gid}  ${g.game ? g.game.code : '?'}  ${g.moves} moves, ${g.metas} other saves, ${g.decisions.length} choices${g.game && g.game.finished ? ', finished' : ''}`);
    for (const p of g.problems) console.log('    ' + p);
    if (!g.ok) bad++;
    if (g.game) games.push(Object.assign({ verified: g.ok }, g.game));
    decisions.push(...g.decisions.map((d) => Object.assign({ verified: g.ok }, d)));
  }
  if (outDir) {
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'games.jsonl'), games.map((g) => JSON.stringify(g)).join('\n') + '\n');
    fs.writeFileSync(path.join(outDir, 'decisions.jsonl'), decisions.map((d) => JSON.stringify(d)).join('\n') + '\n');
    console.log(`wrote ${games.length} games and ${decisions.length} decisions to ${outDir}`);
  }
  console.log(`${byGame.size - bad} of ${byGame.size} games replay exactly`);
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) main(process.argv.slice(2));
