/* Catan prototype — landscape "classic look" skin.
   Rules come entirely from the tested engine (window.Catan). This file is
   rendering + input only. The tile/token/port art below is original SVG drawn
   to evoke the classic board; exact ripped assets swap in during final polish. */
(function () {
  'use strict';
  const C = window.Catan;
  const RES = ['brick', 'wood', 'sheep', 'wheat', 'ore'];
  const ICON = { brick: '🧱', wood: '🪵', sheep: '🐑', wheat: '🌾', ore: '🪨' };
  const PCOLOR = { red: '#cf3b34', blue: '#2f6bd6', green: '#3da34d', yellow: '#e8c41f' };
  // Document-canvas backgrounds per screen. iOS standalone paints the safe-area strip
  // (below the home indicator) with the <body> bg, which no fixed element can cover —
  // so we switch body bg to match: dark wood on menus, deep sea in-game.
  const MENU_BG = '#24150a', GAME_BG = '#0c3d68';
  const PSTROKE = { red: '#7d1f1b', blue: '#17376f', green: '#1f6b2c', yellow: '#9a7d0c' };
  const PINK = { red: '#fff', blue: '#fff', green: '#fff', yellow: '#23303c' };
  function hexA(hex, a) { const n = parseInt(hex.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; }

  // ---- sound (Web Audio: overlapping SFX + iOS unlock-on-first-tap) ----------
  const SFX = {
    roll: 'assets/audio/dice_finished.mp3', road: 'assets/audio/road.mp3',
    settlement: 'assets/audio/village.mp3', city: 'assets/audio/city.mp3',
    robber: 'assets/audio/robber.mp3', trade: 'assets/audio/trade.mp3',
    buy: 'assets/audio/button_down.mp3', click: 'assets/audio/button_up.mp3',
    win: 'assets/audio/fanfare.mp3', knight: 'assets/audio/knight.mp3', whoosh: 'assets/audio/whoosh.mp3',
    res_brick: 'assets/audio/res_brick.mp3', res_wood: 'assets/audio/res_lumber.mp3',
    res_sheep: 'assets/audio/res_wool.mp3', res_wheat: 'assets/audio/res_grain.mp3',
    res_ore: 'assets/audio/res_ore.mp3',
  };
  let actx = null; const sndBuf = {};
  function initAudio() {
    if (actx) return;
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    actx = new AC();
    for (const name in SFX) {
      fetch(SFX[name]).then((r) => r.arrayBuffer()).then((b) => actx.decodeAudioData(b))
        .then((buf) => { sndBuf[name] = buf; }).catch(() => {});
    }
  }
  function unlockAudio() { if (!actx) initAudio(); if (actx && actx.state === 'suspended') actx.resume(); }
  function playSound(name, vol) {
    if (!actx || !sndBuf[name]) return;
    try {
      const s = actx.createBufferSource(); s.buffer = sndBuf[name];
      const g = actx.createGain(); g.gain.value = vol == null ? 0.6 : vol;
      s.connect(g); g.connect(actx.destination); s.start(0);
    } catch (e) { /* ignore */ }
  }
  function soundForAction(action) {
    switch (action.type) {
      case 'buildRoad': playSound('road'); break;
      case 'buildSettlement': playSound('settlement'); break;
      case 'buildCity': playSound('city'); break;
      case 'moveRobber': playSound('robber'); break;
      case 'bankTrade': playSound('trade'); break;
      case 'buyDevCard': playSound('buy'); break;
      case 'playKnight': playSound('knight'); break;
    }
  }
  // create + unlock the audio on the first user interaction (required by iOS)
  ['pointerdown', 'touchstart', 'click'].forEach((ev) =>
    window.addEventListener(ev, unlockAudio, { once: false, passive: true }));
  // small UI click on any button/menu control (matches the original sfx_button_up).
  // pointerdown only, so one tap = one click; board hit-targets aren't buttons, so
  // placements keep their own build sounds without an extra click.
  document.addEventListener('pointerdown', (e) => {
    const t = e.target;
    if (t && t.closest && t.closest('button, .dcard, .radbtn, .seg, [onclick]')) { unlockAudio(); playSound('click', 0.5); }
  }, { passive: true });

  // Translucent placement-ghost markers (match the original game's look).
  const GHOST = { settlement: 'assets/hud/candidate-settlement.png', city: 'assets/hud/candidate-city.png', road: 'assets/hud/candidate-road.png' };

  // The sea is the real water-hex tile replicated across the whole background:
  // every hex from just outside the island (cube distance 3) out to WATER_MAXR.
  // Same geometry as the engine (cx=1.5q, cy=√3·(r+q/2), flat-top corners at 60°·i)
  // so the grid tiles seamlessly against the land hexes.
  const HEX_PTS = [];
  for (let i = 0; i < 6; i++) { const a = (Math.PI / 180) * (60 * i); HEX_PTS.push([Math.cos(a), Math.sin(a)]); }
  // Fill a RECTANGLE of water hexes (not a hexagon) so the whole viewport — including
  // its corners and anywhere you can pan to — is real ocean hexes, never a blue gap.
  // X is the wide axis (landscape); bounds cover the 1x view plus the pan overscroll.
  const WATER_X = 20, WATER_Y = 10.5;
  const VB_HALF = 6.2;            // viewBox half-size (keep in sync with boardSVG)
  let boardCx = 0, boardCy = 0;   // island/viewBox centre, set in boardSVG, used by zClamp
  const WATER_HEXES = (() => {
    const out = [];
    for (let q = -13; q <= 13; q++) for (let r = -14; r <= 14; r++) {
      const s = -q - r;
      if (Math.max(Math.abs(q), Math.abs(r), Math.abs(s)) < 3) continue;   // skip the island region
      const cx = 1.5 * q, cy = Math.sqrt(3) * (r + q / 2);
      if (Math.abs(cx) > WATER_X || Math.abs(cy) > WATER_Y) continue;        // rectangular sea
      out.push({ cx, cy, pts: HEX_PTS.map(([dx, dy]) => [cx + dx, cy + dy]) });
    }
    return out;
  })();

  let state = null;
  let ui = { mode: 'idle', pending: null };
  let animateDice = false;   // set true on a roll, consumed by dice()
  let justPlaced = null;     // {kind:'v'|'e', id} of the most recent placement, for pop-in
  const $ = (id) => document.getElementById(id);
  const vX = (id) => state.board.vertices[id].x;
  const vY = (id) => state.board.vertices[id].y;

  function activeColor() {
    if (!state) return null;
    if (state.phase === 'setup') return state.order[state.setupOrder[state.setupIndex]];
    return C.currentColor(state);
  }
  function activePlayer() { return state.players.find((p) => p.color === activeColor()); }

  // ---- legality mirrors (for highlighting only) ----------------------------
  function vertexFree(v) {
    if (state.settlements[v]) return false;
    return state.board.vertices[v].neighbors.every((n) => !state.settlements[n]);
  }
  function touchesOwnRoad(v, color) { return state.board.vertices[v].edges.some((e) => state.roads[e] === color); }
  function legalSettlementVertices(color) {
    if (state.phase === 'setup') return state.board.vertices.filter((vt) => vertexFree(vt.id)).map((vt) => vt.id);
    return state.board.vertices.filter((vt) => vertexFree(vt.id) && touchesOwnRoad(vt.id, color)).map((vt) => vt.id);
  }
  function legalCityVertices(color) {
    return Object.entries(state.settlements).filter(([, b]) => b.owner === color && b.type === 'settlement').map(([id]) => Number(id));
  }
  function roadConnects(edge, color) {
    const [a, b] = state.board.edges[edge].v;
    for (const v of [a, b]) {
      const bld = state.settlements[v];
      if (bld && bld.owner === color) return true;
      if (!(bld && bld.owner !== color) && touchesOwnRoad(v, color)) return true;
    }
    return false;
  }
  function legalRoadEdges(color) {
    if (state.phase === 'setup') {
      return state.board.edges.filter((e) => state.roads[e.id] == null && state.setupLastVertex != null && e.v.includes(state.setupLastVertex)).map((e) => e.id);
    }
    return state.board.edges.filter((e) => state.roads[e.id] == null && roadConnects(e.id, color)).map((e) => e.id);
  }
  function ownsPort(color, port) {
    return Object.entries(state.settlements).some(([id, b]) => b.owner === color && state.board.vertices[Number(id)].port === port);
  }
  function bankRatio(color, give) { if (ownsPort(color, give)) return 2; if (ownsPort(color, '3:1')) return 3; return 4; }

  // ---- dispatch ------------------------------------------------------------
  function dispatch(action, byColor) {
    const actor = byColor || activeColor();   // capture NOW — actions like endTurn change who's active
    const r = C.applyAction(state, action, actor);
    if (!r.ok) { toast(r.error); return false; }
    soundForAction(action);
    if (action.type === 'buildSettlement' || action.type === 'buildCity') justPlaced = { kind: 'v', id: action.vertex };
    else if (action.type === 'buildRoad') justPlaced = { kind: 'e', id: action.edge };
    // detect what was stolen (which of the victim's resources dropped) for the fly
    let steal = null;
    if (action.type === 'steal') {
      const before = state.players.find((p) => p.color === action.victim).resources;
      const after = r.state.players.find((p) => p.color === action.victim).resources;
      const res = RES.find((x) => after[x] < before[x]);
      if (res) steal = { res, victim: action.victim, thief: actor };
    }
    let trade = null;
    if (action.type === 'confirmTrade' && state.pendingTrade) {
      const pt = state.pendingTrade;
      trade = { a: pt.from, b: action.with, g: sumObj(pt.give), w: sumObj(pt.want) };
    }
    const fromRobber = state.robberHex;
    state = r.state;
    // fly the thief across — unless I dragged it there myself (the drag was the motion)
    const robberMoved = state.robberHex !== fromRobber && !skipRobberFly;
    if (robberMoved) ui.robberFlying = true;
    afterAction(); render();
    if (robberMoved) showRobberFly(fromRobber, state.robberHex);
    if (steal) showStealFly(steal.victim, steal.thief);   // res known only to detect a steal happened, not shown
    if (trade) showTradeFly(trade.a, trade.b, trade.g, trade.w);   // bank fly fires once from tradeBank()
    if (online) NET.syncAction(action, actor);   // push my move to the server as the correct actor
    return true;
  }
  // is it this device's turn to act? (always true in pass-and-play)
  function isMyTurn() { return !online || (myColor && activeColor() === myColor); }
  function afterAction() {
    ui.mode = 'idle';
    if (state.phase === 'ended') { render(); showVictory(); return; }
    if (ui.spinning) return;   // who-goes-first spinner playing — don't render over it / prompt yet
    // Hold off on prompts while an animation plays: the dice reveal, or one player's
    // discard fly. Each animation's end re-runs afterAction to advance the sequence —
    // so the 7 reveal finishes before discards, and discards happen one at a time.
    if (ui.diceRevealing || ui.discardAnimating || ui.robberFlying) { render(); return; }
    // discards happen sequentially in turn order; promptDiscards picks who's up
    if (state.turnPhase === 'discard') { promptDiscards(); return; }
    if (!isMyTurn()) { render(); return; }   // online: spectating another player's turn
    // dice roll automatically at the start of each turn (no manual roll)
    if (state.phase === 'play' && state.turnPhase === 'roll') {
      setTimeout(() => {
        if (state.turnPhase === 'roll' && isMyTurn()) {
          ui.diceRevealing = true;          // suppress the corner dice during the reveal
          dispatch({ type: 'rollDice' });
          showDiceReveal(state.dice);
        }
      }, 350);
      return;
    }
    if (state.turnPhase === 'moveRobber') { ui.mode = 'moveRobber'; toast('Drag the robber onto a hex'); return; }
    if (state.turnPhase === 'steal') { promptSteal(); return; }
    if (state.turnPhase === 'placeRoad' && state.phase === 'play') { ui.mode = 'placeRoad'; return; }
    if (state.phase === 'setup') ui.mode = state.turnPhase === 'placeRoad' ? 'placeRoad' : 'placeSettlement';
  }

  // ---- tile art ------------------------------------------------------------
  // Optional exact-art swap: place your own cropped tile images in assets/tiles/
  // and list them in window.CATAN_ASSETS (see assets/README.md). When absent,
  // the game draws its own original terrain art below.
  const ASSETS = (window.CATAN_ASSETS) || {};
  // Resource icon: your image if supplied, else the emoji. Falls back if missing.
  function iconHTML(r) {
    return (ASSETS.icons && ASSETS.icons[r])
      ? `<img class="ic-img" src="${ASSETS.icons[r]}" alt="${r}" onerror="this.replaceWith(document.createTextNode('${ICON[r]}'))">`
      : `<span class="ic">${ICON[r]}</span>`;
  }

  const TILE = {
    wood:  { a: '#3f9a4a', b: '#1d5a26' }, brick: { a: '#c4703e', b: '#82401f' },
    sheep: { a: '#aade63', b: '#6aa83a' }, wheat: { a: '#edcf66', b: '#c89a2a' },
    ore:   { a: '#9aa6b2', b: '#5f6b76' }, desert:{ a: '#e6d29a', b: '#c2a468' },
  };
  function defs(hexes) {
    let g = '';
    for (const k in TILE) g += `<radialGradient id="t_${k}" cx="42%" cy="34%" r="74%"><stop offset="0%" stop-color="${TILE[k].a}"/><stop offset="100%" stop-color="${TILE[k].b}"/></radialGradient>`;
    // coastline glow: faint shallow-water ring that fades into the open sea
    g += `<radialGradient id="coast" cx="50%" cy="48%" r="58%"><stop offset="62%" stop-color="#bfe3f2" stop-opacity="0.34"/><stop offset="84%" stop-color="#7fc0e0" stop-opacity="0.16"/><stop offset="100%" stop-color="#7fc0e0" stop-opacity="0"/></radialGradient>`;
    g += `<filter id="soft" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="0.05" stdDeviation="0.05" flood-opacity="0.45"/></filter>`;
    g += `<filter id="islandShadow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="0.32"/></filter>`;
    for (const hx of hexes) {
      const pts = hx.vertices.map((id) => `${vX(id).toFixed(3)},${vY(id).toFixed(3)}`).join(' ');
      g += `<clipPath id="hc${hx.id}"><polygon points="${pts}"/></clipPath>`;
    }
    WATER_HEXES.forEach((wh, i) => {
      const pts = wh.pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ');
      g += `<clipPath id="wc${i}"><polygon points="${pts}"/></clipPath>`;
    });
    return `<defs>${g}</defs>`;
  }
  function tree(x, y, sc) {
    sc = sc || 1; const w = 0.15 * sc, h = 0.4 * sc;
    return `<g><rect x="${x - 0.02}" y="${y + h * 0.28}" width="0.045" height="${h * 0.28}" fill="#5a3a1a"/>` +
      `<polygon points="${x},${y - h * 0.55} ${x - w},${y + h * 0.12} ${x + w},${y + h * 0.12}" fill="#246a2b"/>` +
      `<polygon points="${x},${y - h * 0.2} ${x - w * 1.15},${y + h * 0.4} ${x + w * 1.15},${y + h * 0.4}" fill="#16481d"/></g>`;
  }
  function richMotif(t, cx, cy) {
    if (t === 'wood') {
      const pos = [[-0.5, -0.28], [-0.16, -0.5], [0.2, -0.32], [0.5, -0.46], [-0.36, 0.12], [0.04, 0.04], [0.42, 0.14], [-0.14, 0.44], [0.28, 0.46]];
      return pos.map(([dx, dy]) => tree(cx + dx, cy + dy, 0.92)).join('');
    }
    if (t === 'sheep') {
      let s = `<g stroke="#4e7d2c" stroke-width="0.04">` +
        `<path d="M ${cx - 0.6} ${cy + 0.18} q 0.6 -0.12 1.2 0" fill="none"/>` +
        `<path d="M ${cx - 0.55} ${cy + 0.46} q 0.55 -0.12 1.1 0" fill="none"/></g>`;
      const sheep = (x, y) => `<g><ellipse cx="${x}" cy="${y}" rx="0.16" ry="0.11" fill="#f4f3ee"/><circle cx="${x - 0.15}" cy="${y - 0.02}" r="0.06" fill="#3a3a3a"/></g>`;
      return s + sheep(cx - 0.28, cy - 0.32) + sheep(cx + 0.3, cy - 0.06) + sheep(cx + 0.02, cy + 0.34);
    }
    if (t === 'wheat') {
      let s = '<g fill="none" stroke-linecap="round">';
      for (let i = 0; i < 7; i++) { const x = cx - 0.66 + i * 0.22; s += `<path d="M ${x} ${cy + 0.7} q 0.12 -0.7 0 -1.4" stroke="${i % 2 ? '#eccd5e' : '#b8901f'}" stroke-width="0.055"/>`; }
      return s + '</g>';
    }
    if (t === 'ore') {
      const peak = (x, base, ht, w) => `<polygon points="${x - w},${cy + base} ${x},${cy + base - ht} ${x + w},${cy + base}" fill="#6f7a86" stroke="#4a535c" stroke-width="0.02"/>` +
        `<polygon points="${x - w * 0.34},${cy + base - ht * 0.62} ${x},${cy + base - ht} ${x + w * 0.34},${cy + base - ht * 0.62}" fill="#eef3f7"/>`;
      return peak(cx - 0.42, 0.52, 0.8, 0.42) + peak(cx + 0.44, 0.52, 0.66, 0.4) + peak(cx + 0.02, 0.58, 1.04, 0.5);
    }
    if (t === 'brick') {
      let s = '';
      const bands = ['#a85730', '#bb6638', '#974c29'];
      for (let i = 0; i < 3; i++) s += `<path d="M ${cx - 0.72} ${cy - 0.34 + i * 0.34} q 0.72 -0.16 1.44 0" stroke="${bands[i]}" stroke-width="0.14" fill="none" opacity="0.75"/>`;
      return s + `<ellipse cx="${cx - 0.05}" cy="${cy + 0.42}" rx="0.34" ry="0.15" fill="#7d3a1e" opacity="0.7"/>`;
    }
    if (t === 'desert') {
      let s = '<g fill="none" stroke="#c2a468" stroke-width="0.05" opacity="0.85">' +
        `<path d="M ${cx - 0.66} ${cy - 0.05} q 0.33 -0.18 0.66 0 t 0.66 0"/><path d="M ${cx - 0.5} ${cy + 0.32} q 0.33 -0.18 0.66 0 t 0.66 0"/></g>`;
      s += `<g fill="#5b8a40"><rect x="${cx + 0.26}" y="${cy - 0.4}" width="0.09" height="0.46" rx="0.045"/><rect x="${cx + 0.17}" y="${cy - 0.22}" width="0.08" height="0.18" rx="0.04"/><rect x="${cx + 0.35}" y="${cy - 0.18}" width="0.08" height="0.14" rx="0.04"/></g>`;
      return s + `<ellipse cx="${cx - 0.36}" cy="${cy + 0.42}" rx="0.13" ry="0.075" fill="#b08a52"/>`;
    }
    return '';
  }

  function token(hx) {
    const t = hx.token;
    const big = (t === 6 || t === 8);   // 6 & 8 are red discs (and larger)
    if (ASSETS.tokens && ASSETS.tokens[t]) {
      // size by height so the numbers read consistently; box width is generous so
      // two-digit numbers fit, preserveAspectRatio centers each glyph.
      const h = big ? 0.62 : 0.5;
      return `<image href="${ASSETS.tokens[t]}" x="${hx.cx - 0.5}" y="${hx.cy - h / 2}" width="1" height="${h}" preserveAspectRatio="xMidYMid meet"/>`;
    }
    // fallback: white outlined number, red disc for 6/8 (no cream chip)
    const disc = big ? `<circle cx="${hx.cx}" cy="${hx.cy}" r="0.3" fill="#c0392b" stroke="#fff" stroke-width="0.03"/>` : '';
    return `${disc}<text x="${hx.cx}" y="${hx.cy}" text-anchor="middle" dominant-baseline="central" font-size="0.5" font-weight="800" fill="#fff" stroke="#222" stroke-width="0.035" paint-order="stroke">${t}</text>`;
  }

  // ---- board ---------------------------------------------------------------
  // layer: 'static' (terrain/water/ports/tokens — built once per game), 'dynamic'
  // (robber/roads/buildings/placement spots — rebuilt each action), or 'all'.
  function boardSVG(layer) {
    layer = layer || 'all';
    const stat = layer !== 'dynamic', dyn = layer !== 'static';
    // viewBox centered on the island so it stays prominent; the water-hex grid
    // extends beyond it and (with meet on a full-screen SVG) fills the screen.
    const xs = state.board.vertices.map((v) => v.x), ys = state.board.vertices.map((v) => v.y);
    const cx0 = (Math.min(...xs) + Math.max(...xs)) / 2, cy0 = (Math.min(...ys) + Math.max(...ys)) / 2;
    boardCx = cx0; boardCy = cy0;
    const half = VB_HALF;
    const minx = cx0 - half, miny = cy0 - half, w = half * 2, h = half * 2;
    const P = [defs(state.board.hexes)];

    if (stat) {
    // authentic coast: a ring of water hexes (real ripped water tile) around the
    // island; the animated sea texture shows beyond it.
    WATER_HEXES.forEach((wh, i) => {
      const pts = wh.pts.map((p) => `${p[0].toFixed(3)},${p[1].toFixed(3)}`).join(' ');
      P.push(`<polygon points="${pts}" fill="#1f6aa8"/>`);
      P.push(`<image href="assets/tiles/water.png" x="${wh.cx - 1}" y="${wh.cy - 1}" width="2" height="2" preserveAspectRatio="xMidYMid slice" clip-path="url(#wc${i})"/>`);
      P.push(`<polygon points="${pts}" fill="none" stroke="#17578f" stroke-width="0.025" opacity="0.5"/>`);
    });

    // ports: one resource badge out in the water, with two wooden bridges
    // reaching the two coastal settlement spots (matches the original). Collected
    // into PORTS and flushed AFTER the terrain tiles below, so the plank bridges
    // sit on top of the coastline instead of being painted over by the land hexes.
    const portSeen = new Set();
    const PORTS = [];
    for (const v of state.board.vertices) {
      if (!v.port || portSeen.has(v.id)) continue;
      const pid = v.neighbors.find((nid) => state.board.vertices[nid].port === v.port && !portSeen.has(nid));
      const b = pid != null ? state.board.vertices[pid] : null;
      portSeen.add(v.id); if (b) portSeen.add(b.id);
      const ends = b ? [v, b] : [v];
      // badge sits out in the water (centered on the perpendicular bisector of
      // the port edge, so it's symmetric between the two bridges)
      const mx0 = b ? (v.x + b.x) / 2 : v.x, my0 = b ? (v.y + b.y) / 2 : v.y;
      const dl = Math.hypot(mx0 - cx0, my0 - cy0) || 1;
      const bx = mx0 + ((mx0 - cx0) / dl) * 0.78, by = my0 + ((my0 - cy0) / dl) * 0.78;
      // a real plank bridge from each coastal corner to the badge: the plank
      // sprite is TILED along the span at its natural proportions (no stretching),
      // rotated to the bridge's actual angle.
      const PH = 0.18, PNAT = PH * (46 / 27);   // plank natural length at this thickness
      for (const e of ends) {
        const blen = Math.hypot(bx - e.x, by - e.y);
        const ang = Math.atan2(by - e.y, bx - e.x) * 180 / Math.PI;
        const mbx = (e.x + bx) / 2, mby = (e.y + by) / 2;
        if (ASSETS.ports && ASSETS.ports.bridge) {
          const total = blen + 0.08;
          const n = Math.max(1, Math.round(total / PNAT));
          const pw = total / n;
          let planks = '';
          for (let i = 0; i < n; i++) { const px = -total / 2 + i * pw; planks += `<image href="${ASSETS.ports.bridge}" x="${px.toFixed(3)}" y="${(-PH / 2).toFixed(3)}" width="${pw.toFixed(3)}" height="${PH}" preserveAspectRatio="xMidYMid slice"/>`; }
          // NB: no filter on this <g>. iOS/WebKit silently drops a filtered group
          // that also has a transform — which is exactly why the planks vanished on
          // iPhone while roads (filter on the <image>, not the <g>) render fine.
          PORTS.push(`<g transform="translate(${mbx.toFixed(3)} ${mby.toFixed(3)}) rotate(${ang.toFixed(2)})">${planks}</g>`);
        } else {
          PORTS.push(`<line x1="${e.x}" y1="${e.y}" x2="${bx}" y2="${by}" stroke="#8a5a2c" stroke-width="0.1" stroke-linecap="round"/>`);
        }
      }
      // the resource / ratio badge in the water
      if (ASSETS.ports && ASSETS.ports[v.port]) {
        PORTS.push(`<image href="${ASSETS.ports[v.port]}" x="${bx - 0.32}" y="${by - 0.32}" width="0.64" height="0.64" preserveAspectRatio="xMidYMid meet" filter="url(#soft)"/>`);
      } else {
        const lbl = v.port === '3:1' ? '3:1' : '2:1';
        PORTS.push(`<circle cx="${bx}" cy="${by}" r="0.3" fill="#6b4423" stroke="#3f2410" stroke-width="0.03"/>`);
        PORTS.push(`<text x="${bx}" y="${by}" text-anchor="middle" dominant-baseline="central" font-size="0.2" font-weight="800" fill="#f3e6cf">${lbl}</text>`);
      }
    }

    // hex tiles
    for (const hx of state.board.hexes) {
      const pts = hx.vertices.map((id) => `${vX(id).toFixed(3)},${vY(id).toFixed(3)}`).join(' ');
      // sandy hex border (matches the original board's tan spacing between hexes,
      // and the tan rim already baked into the tile art)
      P.push(`<polygon points="${pts}" fill="url(#t_${hx.terrain})" stroke="#f1e0b6" stroke-width="0.12" filter="url(#soft)"/>`);
      // Always draw the built-in art first; if you've supplied a tile image it
      // is layered on top. A missing/not-yet-added image just shows the art.
      P.push(`<g clip-path="url(#hc${hx.id})">${richMotif(hx.terrain, hx.cx, hx.cy)}</g>`);
      if (ASSETS.tiles && ASSETS.tiles[hx.terrain]) {
        P.push(`<image href="${ASSETS.tiles[hx.terrain]}" x="${hx.cx - 1}" y="${hx.cy - 1}" width="2" height="2" preserveAspectRatio="xMidYMid slice" clip-path="url(#hc${hx.id})"/>`);
      }
      P.push(`<polygon points="${pts}" fill="none" stroke="#f1e0b6" stroke-width="0.1" opacity="0.9"/>`);
      if (hx.token != null) P.push(token(hx));
    }

    // flush the ports on top of the terrain: plank bridges reach from each coast
    // corner out to the badge in the water, never hidden behind the land tiles.
    for (const s of PORTS) P.push(s);
    }  // ----- end static layer -----

    if (dyn) {
    // robber — drawn figure + your robber sprite on top (dynamic: it moves on a 7).
    // Hidden while it's mid-flight to a new hex (showRobberFly animates the piece across).
    if (!ui.robberFlying && !ui.robberDragging) {
    const rb = state.board.hexes[state.robberHex];
    // just the transparent sprite (matches the flying robber); the drawn silhouette is
    // only a fallback when no art is supplied.
    if (ASSETS.robber) P.push(`<image href="${ASSETS.robber}" x="${rb.cx - 0.42}" y="${rb.cy - 0.55}" width="0.84" height="0.95" preserveAspectRatio="xMidYMid meet"/>`);
    else P.push(`<g filter="url(#soft)"><ellipse cx="${rb.cx}" cy="${rb.cy + 0.34}" rx="0.18" ry="0.05" fill="#000" opacity="0.3"/><path d="M ${rb.cx} ${rb.cy - 0.34} q 0.2 0 0.2 0.28 l 0.05 0.34 q 0 0.08 -0.1 0.08 l -0.3 0 q -0.1 0 -0.1 -0.08 l 0.05 -0.34 q 0 -0.28 0.2 -0.28 z" fill="#33312f" stroke="#111" stroke-width="0.02"/><circle cx="${rb.cx}" cy="${rb.cy - 0.28}" r="0.11" fill="#33312f" stroke="#111" stroke-width="0.02"/></g>`);
    }

    // roads — authentic wooden road sprite rotated to each edge angle (falls
    // back to drawn colour bars if the sprite is missing)
    for (const [eid, owner] of Object.entries(state.roads)) {
      const [a, b] = state.board.edges[eid].v;
      const ax = vX(a), ay = vY(a), bx = vX(b), by = vY(b);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay);
      const ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
      const rpop = (justPlaced && justPlaced.kind === 'e' && justPlaced.id === Number(eid)) ? ' popin' : '';
      if (ASSETS.roads && ASSETS.roads[owner]) {
        const rw = len * 1.06, rh = len * 0.42;
        // Rotation lives on the <g>; the pop-in (a CSS transform) goes on the inner
        // <image>. Keeping them on separate elements stops the CSS animation from
        // clobbering the SVG rotate attribute (which left roads "floating").
        P.push(`<g transform="rotate(${ang} ${mx} ${my})"><image class="road${rpop}" href="${ASSETS.roads[owner]}" x="${mx - rw / 2}" y="${my - rh / 2}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" filter="url(#soft)"/></g>`);
      } else {
        P.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${PSTROKE[owner]}" stroke-width="0.26" stroke-linecap="round"/>`);
        P.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${PCOLOR[owner]}" stroke-width="0.17" stroke-linecap="round"/>`);
      }
    }

    // buildings — use the ripped art; the SVG shapes below are only a fallback
    // for when no ripped piece asset exists (never both, or the drawn shape would
    // show through behind the real sprite).
    for (const [id, b] of Object.entries(state.settlements)) {
      const x = vX(Number(id)), y = vY(Number(id)), c = PCOLOR[b.owner], s = PSTROKE[b.owner];
      const art = ASSETS.pieces && ASSETS.pieces[b.type] && ASSETS.pieces[b.type][b.owner];
      const bpop = (justPlaced && justPlaced.kind === 'v' && justPlaced.id === Number(id)) ? ' popin' : '';
      if (art) {
        P.push(`<image class="piece${bpop}" href="${art}" x="${x - 0.32}" y="${y - 0.42}" width="0.64" height="0.72" preserveAspectRatio="xMidYMid meet"/>`);
      } else if (b.type === 'city') {
        P.push(`<g filter="url(#soft)"><rect x="${x - 0.28}" y="${y - 0.16}" width="0.56" height="0.4" rx="0.05" fill="${c}" stroke="${s}" stroke-width="0.05"/><polygon points="${x - 0.28},${y - 0.16} ${x},${y - 0.34} ${x + 0.06},${y - 0.34} ${x + 0.06},${y - 0.05} ${x + 0.28},${y - 0.05} ${x + 0.28},${y - 0.16}" fill="${c}" stroke="${s}" stroke-width="0.04"/><rect x="${x - 0.18}" y="${y + 0.02}" width="0.12" height="0.14" fill="${s}"/></g>`);
      } else {
        P.push(`<g filter="url(#soft)"><polygon points="${x},${y - 0.3} ${x + 0.22},${y - 0.08} ${x + 0.22},${y + 0.22} ${x - 0.22},${y + 0.22} ${x - 0.22},${y - 0.08}" fill="${c}" stroke="${s}" stroke-width="0.05"/></g>`);
      }
    }

    // interactive targets — translucent ghost markers (like the original game),
    // each paired with an invisible hit target so transparent pixels still click.
    const color = activeColor();
    if (ui.mode === 'placeSettlement' || ui.mode === 'placeCity') {
      const isCity = ui.mode === 'placeCity';
      const src = isCity ? GHOST.city : GHOST.settlement;
      const list = isCity ? legalCityVertices(color) : legalSettlementVertices(color);
      for (const id of list) {
        const x = vX(id), y = vY(id);
        P.push(`<image class="ghost" href="${src}" x="${x - 0.27}" y="${y - 0.4}" width="0.54" height="0.58" preserveAspectRatio="xMidYMid meet"/>`);
        P.push(`<circle class="hit" data-kind="vertex" data-id="${id}" cx="${x}" cy="${y}" r="0.33" fill="#fff" fill-opacity="0"/>`);
      }
    }
    if (ui.mode === 'placeRoad') {
      for (const eid of legalRoadEdges(color)) {
        const [a, b] = state.board.edges[eid].v;
        const ax = vX(a), ay = vY(a), bx = vX(b), by = vY(b);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
        const rw = len * 1.0, rh = len * 0.4;
        P.push(`<g transform="rotate(${ang} ${mx} ${my})"><image class="ghost" href="${GHOST.road}" x="${mx - rw / 2}" y="${my - rh / 2}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet"/></g>`);
        P.push(`<line class="hit" data-kind="edge" data-id="${eid}" x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="#fff" stroke-opacity="0" stroke-width="0.34" stroke-linecap="round"/>`);
      }
    }
    if (ui.mode === 'moveRobber') {
      for (const hx of state.board.hexes) {
        if (hx.id === state.robberHex) continue;
        P.push(`<circle class="hit" data-kind="hex" data-id="${hx.id}" cx="${hx.cx}" cy="${hx.cy}" r="0.5" fill="#000" fill-opacity="0.22" stroke="#000" stroke-opacity="0.45" stroke-width="0.05"/>`);
      }
    }

    // tentative placement awaiting confirmation — real piece + pulsing glow
    if (ui.confirm) {
      const act = ui.confirm.action, col = ui.confirm.color;
      if (act.type === 'buildRoad') {
        const [a, b] = state.board.edges[act.edge].v;
        const ax = vX(a), ay = vY(a), bx = vX(b), by = vY(b);
        const mx = (ax + bx) / 2, my = (ay + by) / 2;
        const len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
        P.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${PCOLOR[col]}" stroke-width="0.34" stroke-linecap="round"><animate attributeName="opacity" values="0.35;0.85;0.35" dur="1s" repeatCount="indefinite"/></line>`);
        if (ASSETS.roads && ASSETS.roads[col]) { const rw = len * 1.06, rh = len * 0.42; P.push(`<g transform="rotate(${ang} ${mx} ${my})"><image href="${ASSETS.roads[col]}" x="${mx - rw / 2}" y="${my - rh / 2}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" filter="url(#soft)"/></g>`); }
      } else if (act.type === 'moveRobber') {
        const hx = state.board.hexes[act.hex];
        P.push(`<circle cx="${hx.cx}" cy="${hx.cy}" r="0.5" fill="none" stroke="#fff" stroke-width="0.07"><animate attributeName="r" values="0.44;0.56;0.44" dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;1;0.5" dur="1s" repeatCount="indefinite"/></circle>`);
        if (ASSETS.robber) P.push(`<image href="${ASSETS.robber}" x="${hx.cx - 0.42}" y="${hx.cy - 0.55}" width="0.84" height="0.95" preserveAspectRatio="xMidYMid meet" filter="url(#soft)"/>`);
      } else {
        const id = act.vertex, x = vX(id), y = vY(id);
        const type = act.type === 'buildCity' ? 'city' : 'settlement';
        P.push(`<circle cx="${x}" cy="${y}" r="0.4" fill="none" stroke="${PCOLOR[col]}" stroke-width="0.07"><animate attributeName="r" values="0.34;0.46;0.34" dur="1s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.5;1;0.5" dur="1s" repeatCount="indefinite"/></circle>`);
        if (ASSETS.pieces && ASSETS.pieces[type] && ASSETS.pieces[type][col]) P.push(`<image href="${ASSETS.pieces[type][col]}" x="${x - 0.32}" y="${y - 0.42}" width="0.64" height="0.72" preserveAspectRatio="xMidYMid meet" filter="url(#soft)"/>`);
      }
    }

    }  // ----- end dynamic layer -----
    const id = layer === 'dynamic' ? 'board-dyn' : 'board';
    return `<svg id="${id}" viewBox="${minx} ${miny} ${w} ${h}" preserveAspectRatio="xMidYMid meet"><style>.ghost{pointer-events:none}</style>${P.join('')}</svg>`;
  }

  function onBoardClick(e) {
    if (zoom.swallowClick) { zoom.swallowClick = false; return; }  // a pan/pinch/double-tap, not a tap-to-place
    if (online && !isMyTurn()) return;                            // only the active player touches the board online
    const t = e.target.closest('.hit'); if (!t) return;
    const kind = t.getAttribute('data-kind'), id = Number(t.getAttribute('data-id')), color = activeColor();
    // placements are tentative — tap a spot, then confirm with the check
    if (kind === 'vertex') { ui.confirm = { action: ui.mode === 'placeCity' ? { type: 'buildCity', vertex: id } : { type: 'buildSettlement', vertex: id }, color }; render(); }
    else if (kind === 'edge') { ui.confirm = { action: { type: 'buildRoad', edge: id }, color }; render(); }
    else if (kind === 'hex') { ui.confirm = { action: { type: 'moveRobber', hex: id }, color }; render(); }
  }

  // ---- drag the robber onto a hex (on a 7 / knight) ------------------------
  let robberDrag = null, skipRobberFly = false;
  function hexAtPoint(x, y) {
    const el = document.elementFromPoint(x, y);
    const hit = el && el.closest ? el.closest('.hit[data-kind="hex"]') : null;
    return hit ? Number(hit.getAttribute('data-id')) : null;
  }
  function highlightDropHex(id) {
    document.querySelectorAll('.hit[data-kind="hex"]').forEach((c) =>
      c.classList.toggle('droptarget', Number(c.getAttribute('data-id')) === id));
  }
  function startRobberDrag(e) {
    if (ui.mode !== 'moveRobber' || (online && !isMyTurn()) || !ASSETS.robber) return;
    e.preventDefault(); e.stopPropagation();
    const svg = $('board'), m = svg && svg.getScreenCTM ? svg.getScreenCTM() : null;
    const img = document.createElement('img');
    img.src = ASSETS.robber; img.className = 'robberdrag';
    img.style.width = (m ? 0.84 * m.a : 60) + 'px'; img.style.height = (m ? 0.95 * m.a : 68) + 'px';
    img.style.left = e.clientX + 'px'; img.style.top = e.clientY + 'px';
    document.body.appendChild(img);
    robberDrag = { img, over: undefined };
    ui.robberDragging = true; render();   // hide the resting robber while it's in hand
    document.addEventListener('pointermove', moveRobberDrag);
    document.addEventListener('pointerup', dropRobberDrag);
  }
  function moveRobberDrag(e) {
    if (!robberDrag) return;
    robberDrag.img.style.left = e.clientX + 'px'; robberDrag.img.style.top = e.clientY + 'px';
    const hex = hexAtPoint(e.clientX, e.clientY);
    if (hex !== robberDrag.over) { robberDrag.over = hex; highlightDropHex(hex); }
  }
  function dropRobberDrag(e) {
    document.removeEventListener('pointermove', moveRobberDrag);
    document.removeEventListener('pointerup', dropRobberDrag);
    const hex = hexAtPoint(e.clientX, e.clientY);
    if (robberDrag && robberDrag.img) robberDrag.img.remove();
    robberDrag = null; ui.robberDragging = false; zoom.swallowClick = true;
    if (hex != null && hex !== state.robberHex) {
      skipRobberFly = true; dispatch({ type: 'moveRobber', hex }); skipRobberFly = false;   // drag = the motion
    } else {
      render();   // dropped off-board or on the same hex -> cancel, robber stays put
    }
  }

  // ---- panels --------------------------------------------------------------
  // seats in clockwise screen order so turns visibly progress clockwise
  const SEATS = ['tl', 'tr', 'br', 'bl'];
  function renderPanels() {
    state.players.forEach((p, i) => {
      const el = $('p-' + SEATS[i]); el.style.display = 'flex';
      // during the who-goes-first spinner, no corner shows .active (it would pre-reveal the result)
      el.className = 'corner ' + SEATS[i] + (!ui.spinning && p.color === activeColor() ? ' active' : '');
      // tint the panel with the player's colour
      const pc = PCOLOR[p.color];
      el.style.background = `linear-gradient(${hexA(pc, 0.92)}, ${hexA(pc, 0.62)}), var(--wood-tex)`;
      el.style.backgroundSize = 'cover';
      const vp = C.victoryPoints(state, p.color, false);
      const cards = RES.reduce((n, r) => n + p.resources[r], 0);
      const dev = p.devCards.length + p.newDevCards.length;
      const road = C.longestRoadLength(state, p.color);
      const bdg = (HUD.badge) || {};
      // one stacked stat = real icon + count (emoji fallback); highlight when this
      // player holds Longest Road / Largest Army.
      const stat = (src, val, emoji, title, hot) =>
        `<div class="pstat${hot ? ' hot' : ''}" title="${title}">${src ? `<img src="${src}" alt="">` : emoji}<b>${val}</b></div>`;
      const av = (ASSETS.avatars && ASSETS.avatars[i]) ? `<img src="${ASSETS.avatars[i]}" alt="" onerror="this.outerHTML='${escapeHtml(p.name[0] || '?')}'">` : escapeHtml(p.name[0] || '?');
      // dice appear at the active player's corner once they've rolled this turn
      const di = (!ui.diceRevealing && p.color === activeColor() && state.dice && state.phase === 'play')
        ? `<div class="pdice">${diceFaces(state.dice)}</div>` : '';
      el.innerHTML = `${di}
        <div class="pcol">${stat(bdg.res, cards, '🃏', 'Resource cards')}${stat(bdg.card, dev, '🎴', 'Development cards')}${stat(bdg.vp, vp, '⭐', 'Victory points')}${stat(bdg.army, p.playedKnights, '⚔️', 'Knights played', p.hasLargestArmy)}${stat(bdg.road, road, '🛣️', 'Longest road', p.hasLongestRoad)}</div>
        <div class="pport"><div class="pava" style="border-color:${PCOLOR[p.color]}">${av}</div><div class="pname">${escapeHtml(p.name)}</div></div>`;
    });
    for (let i = state.players.length; i < 4; i++) $('p-' + SEATS[i]).style.display = 'none';
  }

  const HUD = ASSETS.hud || {};
  function resIc(r) { return (HUD.res && HUD.res[r]) ? `<img class="ri" src="${HUD.res[r]}" alt="${r}">` : ICON[r]; }
  function resOrb(r, n) {
    if (HUD.res && HUD.res[r]) {
      return `<span class="res"><img src="${HUD.res[r]}" alt="${r}" onerror="this.replaceWith(document.createTextNode('${ICON[r]}'))"><span class="rcount">${n}</span></span>`;
    }
    return `<span class="chip">${iconHTML(r)}${n}</span>`;
  }
  const HAND_ORDER = ['wheat', 'wood', 'ore', 'sheep', 'brick'];   // original app order
  function handBar() {
    // online: always show MY hand; pass-and-play: show the active player's
    const p = (online && myColor) ? state.players.find((x) => x.color === myColor) : activePlayer();
    if (!p) return '';
    // slim, original-style: five resource orbs + counts, attached to the bottom
    return HAND_ORDER.map((r) => resOrb(r, p.resources[r])).join('');
  }

  // the two dice faces shown at the active player's corner
  function diceFaces(d) {
    const [a, b] = d;
    const roll = animateDice ? ' rolling' : '';
    animateDice = false;
    if (HUD.dice && HUD.dice[a]) {
      return `<img class="d1${roll}" src="${HUD.dice[a]}" alt="${a}"><img class="d2${roll}" src="${HUD.dice[b]}" alt="${b}">`;
    }
    return `<span class="dice">🎲 ${a}+${b}</span>`;
  }
  // only at the very start of a fresh game — not on rejoin/mid-setup
  function isFreshStart(s) {
    return !!s && s.phase === 'setup' && s.setupIndex === 0 && Object.keys(s.settlements || {}).length === 0;
  }
  function isFreshSetup() { return isFreshStart(state); }
  // big 3..2..1 countdown in the centre, then `done()` — runs on every screen at game start
  function showCountdown(done) {
    const el = $('countdown');
    if (!el) { if (done) done(); return; }
    let n = 3;
    (function step() {
      if (n <= 0) { el.classList.add('hidden'); el.innerHTML = ''; if (done) done(); return; }
      el.innerHTML = `<div class="cd-num">${n}</div>`;   // re-set replays the pop animation
      el.classList.remove('hidden');
      playSound('click', 0.55);
      n--;
      setTimeout(step, 900);
    })();
  }
  // "who goes first" spinner: corners light up around the table, decelerating, and
  // stop on the first player (already decided by the engine, so every device agrees).
  // ui.spinning holds off placement/active-highlight until it lands.
  function showFirstPlayerSpin(done) {
    const n = state.players.length;
    const ti = state.players.findIndex((p) => p.color === activeColor());   // the first player's seat
    if (ti < 0 || n < 2) { if (done) done(); return; }
    ui.spinning = true; renderPanels();   // drop any .active highlight while we spin
    const loops = 2 + Math.floor(Math.random() * 2);   // visual flourish only; the winner is already fixed
    const steps = loops * n + ti + 1;                  // the final highlight lands on ti
    let step = 0;
    const hi = (idx) => { for (let k = 0; k < n; k++) { const el = $('p-' + SEATS[k]); if (el) el.classList.toggle('spin-on', k === idx); } };
    const clear = () => { for (let k = 0; k < n; k++) { const el = $('p-' + SEATS[k]); if (el) el.classList.remove('spin-on', 'spin-win'); } };
    function tick() {
      hi(step % n); playSound('click', 0.35); step++;
      if (step >= steps) {
        const el = $('p-' + SEATS[ti]); if (el) { el.classList.remove('spin-on'); el.classList.add('spin-win'); }
        playSound('win', 0.7); toast(state.players[ti].name + ' goes first!');   // fanfare on landing
        setTimeout(() => { clear(); ui.spinning = false; if (done) done(); }, 1500);
        return;
      }
      const remaining = steps - step;
      const interval = remaining > n + 1 ? 85 : 85 + (n + 1 - remaining) * 75;   // ease-out near the end
      setTimeout(tick, interval);
    }
    tick();
  }
  // big dice appear in the centre on roll, then fly down to the active corner
  function showDiceReveal(dice) {
    if (!dice || !HUD.dice || !HUD.dice[dice[0]]) { ui.diceRevealing = false; renderPanels(); afterAction(); render(); return; }
    playSound('roll', 0.7);
    const [a, b] = dice;
    const el = $('dicereveal');
    el.innerHTML = `<img class="d1" src="${HUD.dice[a]}" alt="${a}"><img class="d2" src="${HUD.dice[b]}" alt="${b}">`;
    el.classList.remove('hidden');
    el.style.transition = 'none';
    el.style.left = '50%'; el.style.top = '44%';
    el.style.transform = 'translate(-50%,-50%) scale(1)'; el.style.opacity = '1';
    const pi = state.players.findIndex((p) => p.color === activeColor());
    const seatEl = $('p-' + SEATS[pi]);
    void el.offsetWidth;  // reflow so the next transition animates
    setTimeout(() => {
      const r = seatEl.getBoundingClientRect();
      el.style.transition = 'left .55s cubic-bezier(.4,0,.5,1), top .55s cubic-bezier(.4,0,.5,1), transform .55s ease, opacity .4s ease .2s';
      el.style.left = (r.left + r.width / 2) + 'px';
      el.style.top = (r.top + r.height / 2) + 'px';
      el.style.transform = 'translate(-50%,-50%) scale(0.42)'; el.style.opacity = '0';
    }, 700);
    setTimeout(() => { el.classList.add('hidden'); ui.diceRevealing = false; renderPanels(); showResourceFly(); afterAction(); render(); }, 1300);
  }
  // which producing hex sends which resource to which player on this roll
  function productionMap() {
    if (!state.dice) return [];
    const total = state.dice[0] + state.dice[1];
    if (total === 7) return [];
    const out = [];
    for (const hx of state.board.hexes) {
      if (hx.token !== total || hx.id === state.robberHex) continue;
      const res = hx.terrain;            // terrain name == resource (skip desert)
      if (!RES.includes(res)) continue;
      for (const vid of hx.vertices) {
        const b = state.settlements[vid];
        if (b) out.push({ hx, color: b.owner, resource: res, count: b.type === 'city' ? 2 : 1 });
      }
    }
    return out;
  }
  // animate an icon flying from one screen point to another. Anchored via left/top,
  // animated with transform (which iOS Safari handles reliably) via a keyframe.
  function flyImage(src, sx, sy, tx, ty, delay, opts) {
    if (!src) return;
    opts = opts || {};
    const hw = opts.w ? opts.w / 2 : (opts.card ? 20 : 22), hh = opts.h ? opts.h / 2 : (opts.card ? 28 : 22);
    const img = document.createElement('img');
    img.src = src; img.className = 'flyres' + (opts.card ? ' fcard' : '');
    if (opts.w) img.style.width = opts.w + 'px'; if (opts.h) img.style.height = opts.h + 'px';
    img.style.left = (sx - hw) + 'px'; img.style.top = (sy - hh) + 'px';
    img.style.setProperty('--dx', (tx - sx).toFixed(1) + 'px');
    img.style.setProperty('--dy', (ty - sy).toFixed(1) + 'px');
    img.style.animation = `flyto .95s ${Math.round(delay)}ms ease both`;
    document.body.appendChild(img);
    if (opts.sound) setTimeout(() => playSound(opts.sound, opts.vol), delay);
    setTimeout(() => img.remove(), delay + 1050);
  }
  function flyResource(res, sx, sy, tx, ty, delay) {
    flyImage((HUD.res && HUD.res[res]) || (ASSETS.icons && ASSETS.icons[res]), sx, sy, tx, ty, delay, { sound: 'res_' + res, vol: 0.45 });
  }
  // screen-pixel position of a hex centre (accounts for viewBox + pan/zoom via the SVG CTM)
  function hexScreenXY(hexId, dyAdj) {
    const svg = $('board');
    if (!svg || !svg.getScreenCTM || !state.board.hexes[hexId]) return null;
    const m = svg.getScreenCTM(); if (!m) return null;
    const hx = state.board.hexes[hexId];
    const pt = svg.createSVGPoint(); pt.x = hx.cx; pt.y = hx.cy + (dyAdj || 0);
    const s = pt.matrixTransform(m);
    return { x: s.x, y: s.y, scale: m.a };
  }
  // fly the robber piece from its old hex to the new one — runs on every screen
  function showRobberFly(fromHex, toHex) {
    const a = hexScreenXY(fromHex, -0.08), b = hexScreenXY(toHex, -0.08);
    const finish = () => { ui.robberFlying = false; afterAction(); render(); };
    if (!ASSETS.robber || !a || !b) { finish(); return; }
    const w = 0.84 * a.scale, h = 0.95 * a.scale;   // match the on-board robber size
    flyImage(ASSETS.robber, a.x, a.y, b.x, b.y, 0, { w, h });   // robber sound already plays from the move
    setTimeout(finish, 1000);   // the fly animates ~0.95s, then the piece settles at the new hex
  }
  function showResourceFly() {
    const map = productionMap();
    if (!map.length) return;
    const svg = $('board'); if (!svg || !svg.getScreenCTM) return;
    const ctm = svg.getScreenCTM(); if (!ctm) return;
    const STAGGER = 460;   // wider so each resource reads clearly one-at-a-time
    let delay = 0;
    // grouped by player, so each player's resources stream in as a clear sequence
    for (let pi = 0; pi < state.players.length; pi++) {
      const color = state.players[pi].color;
      const panel = $('p-' + SEATS[pi]); if (!panel) continue;
      const r = panel.getBoundingClientRect();
      const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
      for (const e of map) {
        if (e.color !== color) continue;
        for (let k = 0; k < e.count; k++) {
          const pt = svg.createSVGPoint(); pt.x = e.hx.cx + (k ? 0.18 : -0.18); pt.y = e.hx.cy;
          const s = pt.matrixTransform(ctm);
          flyResource(e.resource, s.x, s.y, tx, ty, delay);
          delay += STAGGER;
        }
      }
    }
  }
  // discarded cards fly FACE-UP from the player's corner to the bank (board center).
  // discards are public in Catan, so each resource is revealed — the opposite of a steal.
  // discards play one player at a time: while these cards fly, the next discarder
  // isn't prompted; the end callback re-runs afterAction to advance the sequence.
  function showDiscardFly(color, sel) {
    ui.discardAnimating = true;
    const pi = state.players.findIndex((p) => p.color === color);
    const panel = $('p-' + SEATS[pi]);
    let delay = 0;
    if (panel) {
      const r = panel.getBoundingClientRect();
      const sx = r.left + r.width / 2, sy = r.top + r.height / 2;
      const svg = $('board');
      const br = svg ? svg.getBoundingClientRect()
                     : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      const tx = br.left + br.width / 2, ty = br.top + br.height / 2;
      const STAGGER = 260;
      for (const res of RES) {
        for (let k = 0; k < (sel[res] || 0); k++) { flyResource(res, sx, sy, tx, ty, delay); delay += STAGGER; }
      }
    }
    setTimeout(() => { ui.discardAnimating = false; afterAction(); render(); }, delay + 1050);
  }
  // a stolen card flies FACE-DOWN from the victim's corner to the thief's corner
  // (the resource is kept secret — only that something was taken is shown)
  function showStealFly(victimColor, thiefColor) {
    const vi = state.players.findIndex((p) => p.color === victimColor);
    const ti = state.players.findIndex((p) => p.color === thiefColor);
    const vp = $('p-' + SEATS[vi]), tp = $('p-' + SEATS[ti]);
    if (!vp || !tp) return;
    const vr = vp.getBoundingClientRect(), tr = tp.getBoundingClientRect();
    flyImage('assets/hud/cardback.png', vr.left + vr.width / 2, vr.top + vr.height / 2,
      tr.left + tr.width / 2, tr.top + tr.height / 2, 0, { card: true, sound: 'whoosh', vol: 0.55 });
  }
  function sumObj(o) { return RES.reduce((n, r) => n + ((o && o[r]) || 0), 0); }
  // a completed trade: face-down cards fly BOTH ways between the two traders at once
  function showTradeFly(aColor, bColor, nGive, nWant) {
    const ia = state.players.findIndex((p) => p.color === aColor);
    const ib = state.players.findIndex((p) => p.color === bColor);
    if (ia < 0 || ib < 0) return;
    const ea = $('p-' + SEATS[ia]), eb = $('p-' + SEATS[ib]);
    if (!ea || !eb) return;
    const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
    const ax = ra.left + ra.width / 2, ay = ra.top + ra.height / 2, bx = rb.left + rb.width / 2, by = rb.top + rb.height / 2;
    const STAG = 210;
    playSound('trade', 0.5);
    let d = 0;
    for (let i = 0; i < (nGive || 0); i++) { flyImage('assets/hud/cardback.png', ax, ay, bx, by, d, { card: true }); d += STAG; }
    d += 340;   // brief pause, THEN the return cards come back (sequential, not simultaneous)
    for (let i = 0; i < (nWant || 0); i++) { flyImage('assets/hud/cardback.png', bx, by, ax, ay, d, { card: true }); d += STAG; }
  }
  // a bank/port trade: the given resources fly to the bank (board centre), then one
  // comes back. Face-up, since a bank trade is open (your own cards at a known ratio).
  function showBankFly(color, giveObj, wantObj) {
    const pi = state.players.findIndex((p) => p.color === color);
    const panel = $('p-' + SEATS[pi]); if (!panel) return;
    const r = panel.getBoundingClientRect();
    const px = r.left + r.width / 2, py = r.top + r.height / 2;
    const svg = $('board');
    const br = svg ? svg.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
    const res = HUD.res || {}, ic = ASSETS.icons || {};
    const STAG = 120;
    playSound('trade', 0.5);
    let d = 0;
    RES.forEach((rr) => { for (let i = 0; i < (giveObj[rr] || 0); i++) { flyImage(res[rr] || ic[rr], px, py, cx, cy, d, {}); d += STAG; } });
    d += 340;   // all the given cards reach the bank, then your received cards come back
    RES.forEach((rr) => { for (let i = 0; i < (wantObj[rr] || 0); i++) { flyImage(res[rr] || ic[rr], cx, cy, px, py, d, {}); d += STAG; } });
  }
  // detect a confirmed trade from a remote state change (proposer's pendingTrade
  // cleared + resources actually moved) so spectators see the swap animation too
  function detectTrade(a, s) {
    if (!a || !a.pendingTrade || s.pendingTrade) return null;
    const pt = a.pendingTrade;
    const po = a.players.find((p) => p.color === pt.from), pn = s.players.find((p) => p.color === pt.from);
    if (!po || !pn || !RES.some((r) => po.resources[r] !== pn.resources[r])) return null;  // a cancel, not a trade
    let acc = null;
    for (const p of s.players) {
      if (p.color === pt.from) continue;
      const o = a.players.find((x) => x.color === p.color);
      if (o && RES.some((r) => o.resources[r] !== p.resources[r])) { acc = p.color; break; }
    }
    return acc ? { a: pt.from, b: acc, g: sumObj(pt.give), w: sumObj(pt.want) } : null;
  }
  // a remote discard: a player's pending-discard count dropped + their cards shrank
  function detectDiscard(a, s) {
    if (!a || a.turnPhase !== 'discard') return null;
    for (const ps of s.players) {
      const pa = a.players.find((x) => x.color === ps.color);
      if (!pa) continue;
      if ((a.pendingDiscards[ps.color] || 0) <= (s.pendingDiscards[ps.color] || 0)) continue;
      const sel = {}; let any = false;
      RES.forEach((r) => { const d = (pa.resources[r] || 0) - (ps.resources[r] || 0); if (d > 0) { sel[r] = d; any = true; } });
      if (any) return { color: ps.color, sel };
    }
    return null;
  }
  function watchingTag() {   // "👁 N" shown to everyone in an online game when people are spectating
    if (!online) return '';
    const n = LOBBY.spectators().length;
    return n ? ` <span class="watchtag">👁 ${n}</span>` : '';
  }
  function banner() {
    if (state.phase === 'ended') return `🏆 ${escapeHtml(state.players.find((p) => p.color === state.winner).name)} wins!${watchingTag()}`;
    const p = activePlayer();
    if (online && !myColor) return `<span class="bdot" style="background:${PCOLOR[p.color]}"></span> 👁 Spectating — ${escapeHtml(p.name)}'s turn${watchingTag()}`;
    const phase = state.phase === 'setup' ? 'Setup' : (isMyTurn() ? 'your turn' : 'to play');
    return `<span class="bdot" style="background:${PCOLOR[p.color]}"></span> ${escapeHtml(p.name)} — ${phase}${watchingTag()}`;
  }
  function renderBanner() { const b = $('banner'); if (b && state) b.innerHTML = banner(); }   // live count refresh from presence

  function actionsBar() {
    if (state.phase === 'ended') return `<button class="btn full" onclick="CATAN.restart()">New game</button>`;
    const tp = state.turnPhase, p = activePlayer();
    if (state.phase === 'setup') return `<div class="hint">Tap the board to ${tp === 'placeSettlement' ? 'place a settlement' : 'place a road'}.</div>`;
    if (tp === 'roll') {
      let b = `<button class="btn" onclick="CATAN.roll()">🎲 Roll dice</button>`;
      if (p.devCards.includes('knight')) b += `<button class="btn wood" onclick="CATAN.playKnight()">⚔️ Knight</button>`;
      return b;
    }
    if (tp === 'main') {
      const buildBtn = (mode, emoji) => (HUD.build && HUD.build[mode])
        ? `<button class="btn iconbtn" onclick="CATAN.build('${mode}')"><img src="${HUD.build[mode]}" alt="${mode}"></button>`
        : `<button class="btn wood" onclick="CATAN.build('${mode}')">${emoji}</button>`;
      let b = buildBtn('placeRoad', '🛣️') + buildBtn('placeSettlement', '🏠') + buildBtn('placeCity', '🏛️');
      b += `<button class="btn wood" onclick="CATAN.buyDev()">🎴 Dev</button>`;
      if (p.devCards.length) b += `<button class="btn wood" onclick="CATAN.openDev()">▶️ Card</button>`;
      b += `<button class="btn wood" onclick="CATAN.openTrade()">🔁 Trade</button><button class="btn end" onclick="CATAN.endTurn()">End turn</button>`;
      return b;
    }
    if (tp === 'placeRoad') return `<div class="hint">Place ${state.freeRoads} free road(s) — tap the board.</div>`;
    if (tp === 'moveRobber') return `<div class="hint">Tap a hex to move the robber.</div>`;
    return '';
  }

  // ---- overlays (unchanged logic) -----------------------------------------
  function showOverlay(html) { const o = $('overlay'); o.innerHTML = `<div class="sheet">${html}</div>`; o.classList.remove('hidden', 'menu'); }
  function showFullMenu(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden'); o.classList.add('menu'); }
  // Re-render a menu sheet without replaying its slide-up / reloading images: if the
  // same view is already open, swap only its inner content; otherwise mount fresh.
  function paintMenu(view, html) {
    const o = $('overlay');
    const cur = (!o.classList.contains('hidden') && o.classList.contains('menu')) ? o.querySelector('.menuscreen') : null;
    if (cur && cur.dataset.view === view) {
      const tmp = document.createElement('div'); tmp.innerHTML = html;
      cur.innerHTML = tmp.firstElementChild.innerHTML;
    } else {
      showFullMenu(html);
      const ms = o.querySelector('.menuscreen'); if (ms) ms.dataset.view = view;
    }
  }
  function hideOverlay() { const o = $('overlay'); o.classList.add('hidden'); o.classList.remove('menu'); o.innerHTML = ''; o.onclick = null; }
  // discard order: starting from the player AFTER the roller, around the table,
  // with the roller last (matches the original app).
  function discardOrder() {
    const n = state.players.length, ri = state.currentPlayerIndex;
    return state.players.map((p, i) => ({ p, k: ((i - ri - 1 + n) % n) })).sort((a, b) => a.k - b.k).map((x) => x.p);
  }
  function currentDiscarder() { return discardOrder().find((p) => (state.pendingDiscards[p.color] || 0) > 0); }
  function promptDiscards() {
    const cur = currentDiscarder();
    if (!cur) { render(); return; }   // everyone has discarded — afterAction moves on to the robber
    if (!online || cur.color === myColor) {
      ui.pending = { color: cur.color, need: state.pendingDiscards[cur.color], sel: { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 } };
      renderDiscard();
    } else {
      // online: only the current discarder is prompted; everyone else waits and watches
      showOverlay(`<h3>Discarding</h3><p class="muted" style="text-align:center;margin:10px 0"><b style="color:var(--gold)">${escapeHtml(cur.name)}</b> is discarding…</p>`);
    }
  }
  function renderDiscard() {
    const { color, need, sel } = ui.pending;
    const p = state.players.find((x) => x.color === color);
    const total = RES.reduce((n, r) => n + sel[r], 0);
    const rows = RES.map((r) => `<div class="trow"><span>${resIc(r)} ${r}</span><span class="ctr"><button onclick="CATAN.disc('${r}',-1)">−</button> ${sel[r]} / ${p.resources[r]} <button onclick="CATAN.disc('${r}',1)">+</button></span></div>`).join('');
    showOverlay(`<h3>${escapeHtml(p.name)}: discard ${need}</h3><p class="muted">Over 7 cards — pass the device.</p>${rows}<button class="btn full" ${total === need ? '' : 'disabled'} onclick="CATAN.discSubmit()">Discard ${total}/${need}</button>`);
  }
  function promptSteal() {
    const cands = state.stealCandidates;
    if (cands.length === 1) { dispatch({ type: 'steal', victim: cands[0] }, activeColor()); return; }
    const btns = cands.map((c) => { const pl = state.players.find((p) => p.color === c); return `<button class="btn full" onclick="CATAN.steal('${c}')"><span class="dot" style="background:${PCOLOR[c]}"></span> ${escapeHtml(pl.name)}</button>`; }).join('');
    showOverlay(`<h3>Steal from…</h3>${btns}`);
  }
  // Build screen — full-bleed, matching the original app's "Building" menu:
  // three piece cards (art + remaining count + resource cost), red X, resource bar.
  function openBuildMenu() {
    const p = activePlayer(), res = HUD.res || {}, b = HUD.build || {};
    const COST = { road: { brick: 1, wood: 1 }, settlement: { brick: 1, wood: 1, sheep: 1, wheat: 1 }, city: { ore: 3, wheat: 2 } };
    const can = (c) => RES.every((r) => (p.resources[r] || 0) >= (c[r] || 0));
    const costRow = (c) => RES.filter((r) => c[r]).map((r) => `<span class="ci"><img src="${res[r] || ''}" alt="${r}">${c[r]}</span>`).join('');
    const card = (mode, art, label, cost, left) => {
      const ok = can(cost) && left > 0;
      return `<div class="buildcard${ok ? '' : ' off'}" ${ok ? `onclick="CATAN.build('${mode}')"` : ''}>
        <div class="bclabel">${label}</div>
        <div class="binset">${art ? `<img src="${art}" alt="${label}">` : ''}<span class="bcount">${left}</span></div>
        <div class="bcost">${costRow(cost)}</div></div>`;
    };
    showFullMenu(`<div class="menuscreen">
      <div class="menutitle">Building</div>
      <div class="buildgrid">
        ${card('placeRoad', b.placeRoad, 'Road', COST.road, p.roadsLeft)}
        ${card('placeSettlement', b.placeSettlement, 'Settlement', COST.settlement, p.settlementsLeft)}
        ${card('placeCity', b.placeCity, 'City', COST.city, p.citiesLeft)}
      </div>
      <div class="menubar">${handBar()}</div>
      <button class="menuclose" onclick="CATAN.close()"><img src="assets/hud/decline.png" alt="Close"></button>
    </div>`);
  }
  // Cards screen — full-bleed, matching the original app (8267): a horizontal row
  // of parchment cards (composited faces: template + faded illustration), with the
  // title on the banner, the exact rules text, and the owned-count in the corner.
  function openDev() {
    const p = activePlayer(), res = HUD.res || {}, face = HUD.devFace || {};
    const ORDER = ['knight', 'year_of_plenty', 'road_building', 'monopoly', 'victory_point'];
    const TITLE = { knight: 'Knight', year_of_plenty: 'Year of Plenty', road_building: 'Road Building', monopoly: 'Monopoly', victory_point: 'Victory Point' };
    const RULES = {
      knight: 'When you play this Card, you move the Robber and steal a Resource from the owner of an adjacent Settlement or City.',
      year_of_plenty: 'When you play this Card, you can select 2 Resources of your choice from the bank.',
      road_building: 'When you play this Card, you can build 2 Roads free of charge.',
      monopoly: 'When you play this Card, announce 1 type of Resource. All other players must give you their entire supply of that Resource type.',
      victory_point: 'You obtain an extra Victory Point with this Card, which will remain invisible to the other players until the end of the game.',
    };
    const played = state.hasPlayedDevCardThisTurn;
    const cnt = (list) => list.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
    const owned = cnt(p.devCards), fresh = cnt(p.newDevCards);

    // Buy card first
    const COSTD = { ore: 1, wheat: 1, sheep: 1 };
    const canBuy = RES.every((r) => (p.resources[r] || 0) >= (COSTD[r] || 0)) && state.devDeck.length > 0;
    const costRow = (c) => RES.filter((r) => c[r]).map((r) => `<span class="ci"><img src="${res[r] || ''}">${c[r]}</span>`).join('');
    let cards = `<div class="devcard2 buy${canBuy ? '' : ' off'}" style="background-image:url('${face.buy || ''}')" ${canBuy ? 'onclick="CATAN.buyDev()"' : ''}>
      <div class="dtext">Buy Development Card</div>
      <div class="dcost2">${costRow(COSTD)}</div>
      <div class="dremain2">Dev. Cards remaining: ${state.devDeck.length}</div></div>`;

    // every card type, always shown, with the owned count in the corner
    for (const c of ORDER) {
      const n = (owned[c] || 0) + (fresh[c] || 0);
      const playable = c !== 'victory_point' && !played && (owned[c] || 0) > 0;
      cards += `<div class="devcard2${playable ? '' : ' off'}" style="background-image:url('${face[c] || ''}')" ${playable ? `onclick="CATAN.dev('${c}')"` : ''}>
        <div class="dtitle">${TITLE[c]}</div>
        <div class="dtext">${RULES[c]}</div>
        <div class="dcount">${n}</div></div>`;
    }

    showFullMenu(`<div class="menuscreen">
      <div class="menutitle">Development Cards</div>
      <div class="cardscroll">${cards}</div>
      <div class="menubar">${handBar()}</div>
      <button class="menuclose" onclick="CATAN.close()"><img src="assets/hud/decline.png" alt="Close"></button>
    </div>`);
  }
  function openYoP() {
    ui.pending = { yop: [] };
    showOverlay(`<h3>Year of Plenty — pick 2</h3><div class="grid">${RES.map((r) => `<button class="btn wood" onclick="CATAN.yop('${r}')">${resIc(r)} (${state.bank[r]})</button>`).join('')}</div><p class="muted" id="yopsel">Selected: none</p><button class="btn ghost full" onclick="CATAN.close()">Cancel</button>`);
  }
  function openMonopoly() {
    showOverlay(`<h3>Monopoly</h3><div class="grid">${RES.map((r) => `<button class="btn wood" onclick="CATAN.mono('${r}')">${resIc(r)} ${r}</button>`).join('')}</div><button class="btn ghost full" onclick="CATAN.close()">Cancel</button>`);
  }
  // ---- trade -------------------------------------------------------------
  // describe a give/want bundle as little resource icons
  function offerStr(obj) {
    const res = HUD.res || {};
    const parts = RES.filter((r) => obj && obj[r]).map((r) => `${obj[r]}<img class="ri" src="${res[r] || ''}">`);
    return parts.length ? parts.join(' ') : '—';
  }
  // open the trade builder (proposer, on your turn, when no offer is pending)
  function openTrade() {
    if (state.pendingTrade) { syncTradeUI(); return; }
    if (online && !isMyTurn()) { toast('Not your turn'); return; }
    ui.trade = { mode: 'players', give: zeroRes(), want: zeroRes() };
    ui.tradeView = 'builder';
    renderTradeBuilder();
  }
  function zeroRes() { return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }; }
  function renderTradeBuilder() {
    const t = ui.trade, p = activePlayer(), color = activeColor(), res = HUD.res || {};
    const bank = t.mode === 'bank';
    const cols = HAND_ORDER.map((r) => {
      const hold = p.resources[r], ratio = bankRatio(color, r);
      if (bank) {
        const canGive = Math.floor(hold / ratio) >= 1;   // need a full ratio's worth to give
        return `<div class="tcol">
          <div class="tratio">${ratio}:1</div>
          <button class="tarrow give" ${canGive ? '' : 'disabled'} onclick="CATAN.tBankGive('${r}')">▲</button>
          <div class="tamt give">${t.give[r] ? '−' + t.give[r] : ''}</div>
          <div class="torb"><img src="${res[r] || ''}"><span class="tcount">${hold}</span></div>
          <div class="tamt want">${t.want[r] ? '+' + t.want[r] : ''}</div>
          <button class="tarrow want" ${state.bank[r] > 0 ? '' : 'disabled'} onclick="CATAN.tBankWant('${r}')">▼</button>
        </div>`;
      }
      return `<div class="tcol">
        <button class="tarrow give" ${hold > 0 ? '' : 'disabled'} onclick="CATAN.tGive('${r}')">▲</button>
        <div class="tamt give">${t.give[r] ? '−' + t.give[r] : ''}</div>
        <div class="torb"><img src="${res[r] || ''}"><span class="tcount">${hold}</span></div>
        <div class="tamt want">${t.want[r] ? '+' + t.want[r] : ''}</div>
        <button class="tarrow want" onclick="CATAN.tWant('${r}')">▼</button>
      </div>`;
    }).join('');
    let action;
    if (bank) {
      const credits = RES.reduce((n, r) => n + t.give[r] / bankRatio(color, r), 0);   // give is always a ratio multiple
      const wantTot = RES.reduce((n, r) => n + t.want[r], 0);
      const balanced = credits >= 1 && credits === wantTot;
      const hint = (credits > 0 || wantTot > 0)
        ? `<span class="tbal${balanced ? ' ok' : ''}">giving ${credits} card${credits === 1 ? '' : 's'} · receiving ${wantTot}</span>`
        : `<span class="tbal">tap ▲ to give at the ratio, ▼ to receive</span>`;
      action = `${hint}<button class="btn" onclick="CATAN.tradeClear()">Clear</button><button class="btn full" ${balanced ? '' : 'disabled'} onclick="CATAN.tradeBank()">Trade with bank</button>`;
    } else {
      const gt = RES.reduce((n, r) => n + t.give[r], 0), wt = RES.reduce((n, r) => n + t.want[r], 0);
      action = `<button class="btn" onclick="CATAN.tradeClear()">Clear</button><button class="btn full" ${gt && wt ? '' : 'disabled'} onclick="CATAN.tradeSend()">Send offer</button>`;
    }
    const tabs = `<button class="ttab${bank ? '' : ' on'}" onclick="CATAN.tradeMode('players')">Players</button><button class="ttab${bank ? ' on' : ''}" onclick="CATAN.tradeMode('bank')">Bank</button>`;
    paintMenu('trade-builder', `<div class="menuscreen trade">
      <div class="trade-tabs">${tabs}</div>
      <div class="tgrid">${cols}</div>
      <div class="tactions">${action}</div>
      <button class="menuclose" onclick="CATAN.tradeClose()"><img src="assets/hud/decline.png" alt="Close"></button>
    </div>`);
  }
  // proposer's view after sending — live reactions + confirm/cancel
  function renderTradeWait(pt) {
    const others = state.players.filter((p) => p.color !== pt.from);
    const rows = others.map((p) => {
      const acc = pt.acceptedBy.includes(p.color), dec = pt.declinedBy.includes(p.color);
      const canPay = RES.every((r) => (p.resources[r] || 0) >= (pt.want[r] || 0));
      let ctrl;
      if (acc) {
        ctrl = `<span class="t-acc">accepted</span><button class="btn" onclick="CATAN.tradeConfirm('${p.color}')">Trade</button>`;
      } else if (online) {
        // online: each player responds on their own device — proposer just watches
        ctrl = dec ? '<span class="t-dec">declined</span>' : '<span class="t-pend">deciding…</span>';
      } else {
        // hotseat: the one device acts as each player in turn
        ctrl = dec
          ? `<span class="t-dec">declined</span>${canPay ? `<button class="btn ghost" onclick="CATAN.tradeAs('accept','${p.color}')">Accept</button>` : ''}`
          : `<button class="btn ghost" onclick="CATAN.tradeAs('decline','${p.color}')">Decline</button><button class="btn" ${canPay ? '' : 'disabled'} onclick="CATAN.tradeAs('accept','${p.color}')">Accept</button>`;
      }
      return `<div class="trow2"><span class="cdot" style="background:${PCOLOR[p.color]}"></span><span class="tnm">${escapeHtml(p.name)}</span>${ctrl}</div>`;
    }).join('');
    const allDeclined = others.length > 0 && others.every((p) => pt.declinedBy.includes(p.color));
    paintMenu('trade-wait', `<div class="menuscreen trade">
      <div class="menutitle">Your offer</div>
      <div class="toffer"><span>You give ${offerStr(pt.give)}</span><span class="for">for</span><span>${offerStr(pt.want)}</span></div>
      <div class="tresp">${rows}</div>
      ${allDeclined ? '<p class="muted" style="text-align:center">Everyone declined.</p>' : ''}
      <button class="btn ghost full" onclick="CATAN.tradeCancel()">Cancel offer</button>
    </div>`);
  }
  // responder's view (non-proposer) — accept / decline
  function renderTradeRespond(pt, meColor) {
    const from = state.players.find((p) => p.color === pt.from);
    const me = state.players.find((p) => p.color === meColor);
    const iAcc = pt.acceptedBy.includes(meColor), iDec = pt.declinedBy.includes(meColor);
    const canPay = RES.every((r) => (me.resources[r] || 0) >= (pt.want[r] || 0));  // I must give what they want
    let buttons;
    if (iAcc) buttons = `<p class="muted" style="text-align:center">You accepted — waiting for ${escapeHtml(from.name)} to confirm.</p><button class="btn ghost full" onclick="CATAN.tradeDecline()">Withdraw</button>`;
    else if (iDec) buttons = `<p class="muted" style="text-align:center">You declined.</p>${canPay ? `<button class="btn full" onclick="CATAN.tradeAccept()">Accept after all</button>` : ''}`;
    else buttons = `<div class="trow2"><button class="btn ghost" onclick="CATAN.tradeDecline()">Decline</button><button class="btn full" ${canPay ? '' : 'disabled'} onclick="CATAN.tradeAccept()">Accept</button></div>`;
    paintMenu('trade-respond', `<div class="menuscreen trade">
      <div class="menutitle">Trade offer</div>
      <div class="toffer"><span>${escapeHtml(from.name)} gives you ${offerStr(pt.give)}</span><span class="for">for your</span><span>${offerStr(pt.want)}</span></div>
      ${canPay ? '' : '<p class="muted" style="text-align:center">You can’t cover this.</p>'}
      <div class="tresp">${buttons}</div>
    </div>`);
  }
  // drive the pending-trade overlays off the shared state, on every render
  function syncTradeUI() {
    const pt = state && state.pendingTrade;
    if (!pt) {
      if (ui.tradeView === 'wait' || ui.tradeView === 'respond') { ui.tradeView = null; hideOverlay(); }
      return;
    }
    const meColor = online ? myColor : activeColor();
    if (pt.from === meColor) { ui.tradeView = 'wait'; renderTradeWait(pt); }
    else { ui.tradeView = 'respond'; renderTradeRespond(pt, meColor); }
  }

  function showVictory() {
    playSound('win', 0.8);
    const winner = state.players.find((p) => p.color === state.winner);
    const wi = state.players.indexOf(winner);
    const wav = (ASSETS.avatars && ASSETS.avatars[wi]) ? `<img src="${ASSETS.avatars[wi]}" alt="">` : '';
    const standings = state.players
      .map((p) => ({ p, vp: C.victoryPoints(state, p.color, true) }))
      .sort((a, b) => b.vp - a.vp)
      .map(({ p, vp }, i) => `<div class="standing${p.color === winner.color ? ' win' : ''}" style="animation-delay:${(0.5 + i * 0.12).toFixed(2)}s"><span class="nm"><span class="dot" style="background:${PCOLOR[p.color]}"></span>${escapeHtml(p.name)}</span><span class="pvp">${vp} VP</span></div>`)
      .join('');
    const crown = `<img class="crown" src="assets/hud/crown.png" alt="">`;
    showOverlay(`<div class="winwrap">
      <div class="winhead"><div class="winrays"></div>${crown}
        <div class="winava" style="background:${PCOLOR[winner.color]}">${wav}</div></div>
      <h2>${escapeHtml(winner.name)} wins!</h2>
      <div style="margin:12px 0">${standings}</div>
      ${online ? `<button class="btn full" onclick="CATAN.tableReset()">Back to lobby</button>` : `<button class="btn full" onclick="CATAN.restart()">New game</button>`}</div>`);
    spawnConfetti($('overlay'), 64);
  }
  // confetti uses the real ripped gold-star sprite, mixed with player-colour flecks
  function spawnConfetti(host, n) {
    if (!host) return;
    const colors = ['#e9c45a', '#ffd76b', '#cf3b34', '#2f6bd6', '#3da34d', '#e8c41f', '#ffffff'];
    const rnd = (a, b) => a + Math.random() * (b - a);
    for (let i = 0; i < n; i++) {
      const star = Math.random() < 0.55;
      const c = document.createElement(star ? 'img' : 'i');
      c.className = 'confetti' + (star ? ' star' : '');
      if (star) { c.src = 'assets/hud/star.png'; const sz = rnd(12, 22).toFixed(0); c.style.width = sz + 'px'; c.style.height = sz + 'px'; }
      else { c.style.background = colors[(Math.random() * colors.length) | 0]; c.style.width = rnd(6, 11).toFixed(0) + 'px'; c.style.height = rnd(8, 15).toFixed(0) + 'px'; if (Math.random() < 0.45) c.style.borderRadius = '50%'; }
      c.style.left = rnd(0, 100).toFixed(1) + 'vw';
      c.style.setProperty('--sway', rnd(-70, 70).toFixed(0) + 'px');
      c.style.animationDuration = rnd(2.4, 4.6).toFixed(2) + 's';
      c.style.animationDelay = rnd(0, 2.2).toFixed(2) + 's';
      host.appendChild(c);
    }
  }

  let toastT = null;
  function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => el.classList.remove('show'), 2200); }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  let renderedBoardKey = null;
  function render() {
    renderPanels();
    $('banner').innerHTML = banner();
    // Static terrain is built once per game; only the dynamic layer (pieces, roads,
    // robber, placement spots) is rebuilt each action — so the terrain never reloads.
    const area = $('board-area');
    if (renderedBoardKey !== state.id || !$('board') || !$('board-dyn')) {
      area.innerHTML = boardSVG('static') + boardSVG('dynamic');
      renderedBoardKey = state.id;
    } else {
      $('board-dyn').outerHTML = boardSVG('dynamic');   // replaces only the dynamic SVG
    }
    $('board-dyn').addEventListener('click', onBoardClick);
    $('board-dyn').addEventListener('pointerdown', startRobberDrag);   // drag the robber on a 7
    $('hand').innerHTML = handBar();
    // actions: in roll/main the radial menu holds them (bottom stays clear);
    // in setup / guided sub-states show the hint at the bottom.
    const tp = state.turnPhase;
    // The radial is the universal in-game menu: always available (so Leave/Exit is always
    // reachable, including off-turn and for spectators); it pulses only when it's your
    // turn to act, and the build/trade/end/dev actions only appear then.
    const radialPhase = state.phase === 'play' && tp === 'main' && isMyTurn();
    $('radialwrap').innerHTML = radialButtons();
    $('radialtab').classList.remove('hidden');
    $('radialtab').classList.toggle('pulse', radialPhase);
    $('confirmbar').classList.toggle('hidden', !ui.confirm);
    justPlaced = null;  // pop-in only plays on the render right after placement
    $('leavetab').classList.add('hidden');   // exit lives in the radial menu now
    syncTradeUI();      // show/refresh/close the pending-trade overlays off shared state
  }

  // the radial cluster: five actions arranged around a centre close button
  function radialButtons() {
    const R = 90;
    // build/trade/end/dev only on your turn (dice roll automatically); Leave is always here.
    const canAct = state.phase === 'play' && state.turnPhase === 'main' && isMyTurn();
    const acts = canAct ? [
      { k: 'build', label: 'Build', a: 90 },
      { k: 'trade', label: 'Trade', a: 0 },
      { k: 'end', label: 'End turn', a: -90 },
      { k: 'dev', label: 'Cards', a: 180 },
    ] : [];
    const items = acts.concat([{ k: 'exit', label: (online && !myColor) ? 'Stop' : 'Leave', a: canAct ? 135 : 180, emoji: '🚪' }]);
    let html = `<button class="radbtn center" onclick="CATAN.closeRadial()"><img src="assets/hud/radial/close.png" alt="close"></button>`;
    for (const it of items) {
      const x = Math.round(R * Math.cos(it.a * Math.PI / 180));
      const y = Math.round(-R * Math.sin(it.a * Math.PI / 180));
      const inner = it.emoji ? `<span class="rico">${it.emoji}</span>` : `<img src="assets/hud/radial/${it.k}.png" alt="${it.label}">`;
      const click = it.k === 'exit' ? 'CATAN.exitGame()' : `CATAN.radial('${it.k}')`;
      html += `<button class="radbtn${it.k === 'exit' ? ' exit' : ''}" style="--x:${x}px;--y:${y}px" onclick="${click}">${inner}<span class="rlbl">${it.label}</span></button>`;
    }
    return html;
  }
  function closeRadial() {
    const r = $('radialroot');
    r.classList.remove('open');
    setTimeout(() => r.classList.add('hidden'), 180);
  }

  window.CATAN = {
    roll: () => { animateDice = true; dispatch({ type: 'rollDice' }); },
    endTurn: () => dispatch({ type: 'endTurn' }),
    buyDev: () => dispatch({ type: 'buyDevCard' }),
    playKnight: () => dispatch({ type: 'playKnight' }),
    build: (mode) => { hideOverlay(); ui.mode = mode; ui.confirm = null; render(); toast(mode === 'placeCity' ? 'Tap a settlement to upgrade' : 'Tap a highlighted spot'); },
    confirmPlace: () => { const c = ui.confirm; if (!c) return; ui.confirm = null; dispatch(c.action, c.color); },
    cancelPlace: () => { ui.confirm = null; render(); },
    openDev, openTrade, openMonopoly, openYoP,
    // radial menu
    openRadial: () => { const r = $('radialroot'); r.classList.remove('hidden'); requestAnimationFrame(() => r.classList.add('open')); },
    closeRadial,
    radial: (k) => {
      closeRadial();
      if (k === 'roll') window.CATAN.roll();
      else if (k === 'build') openBuildMenu();
      else if (k === 'trade') openTrade();
      else if (k === 'dev') openDev();
      else if (k === 'end') window.CATAN.endTurn();
    },
    close: () => { hideOverlay(); render(); },
    restart: () => startScreen(),
    rig: (n) => rigNearWin(n),
    dev: (c) => { hideOverlay(); if (c === 'knight') dispatch({ type: 'playKnight' }); else if (c === 'road_building') dispatch({ type: 'playRoadBuilding' }); else if (c === 'year_of_plenty') openYoP(); else if (c === 'monopoly') openMonopoly(); },
    yop: (r) => { ui.pending.yop.push(r); $('yopsel').textContent = 'Selected: ' + ui.pending.yop.map((x) => ICON[x]).join(' '); if (ui.pending.yop.length === 2) { const t = ui.pending.yop; hideOverlay(); dispatch({ type: 'playYearOfPlenty', resources: [t[0], t[1]] }); } },
    mono: (r) => { hideOverlay(); dispatch({ type: 'playMonopoly', resource: r }); },
    tradeMode: (m) => { ui.trade.mode = m; ui.trade.bankGive = null; ui.trade.bankWant = null; renderTradeBuilder(); },
    // per resource it's give OR want, never both; clamp at the limit (don't wrap to 0)
    tGive: (r) => { const t = ui.trade, hold = activePlayer().resources[r]; t.want[r] = 0; t.give[r] = Math.min(t.give[r] + 1, hold); renderTradeBuilder(); },
    tWant: (r) => { const t = ui.trade, cap = state.bank[r]; t.give[r] = 0; t.want[r] = Math.min(t.want[r] + 1, cap); renderTradeBuilder(); },
    tBankGive: (r) => { const t = ui.trade, hold = activePlayer().resources[r], ratio = bankRatio(activeColor(), r); const max = Math.floor(hold / ratio) * ratio; t.want[r] = 0; t.give[r] = Math.min(t.give[r] + ratio, max); renderTradeBuilder(); },
    tBankWant: (r) => { const t = ui.trade; t.give[r] = 0; t.want[r] = Math.min(t.want[r] + 1, state.bank[r]); renderTradeBuilder(); },
    tradeClear: () => { ui.trade.give = zeroRes(); ui.trade.want = zeroRes(); renderTradeBuilder(); },
    tradeSend: () => { const t = ui.trade, give = {}, want = {}; RES.forEach((r) => { if (t.give[r]) give[r] = t.give[r]; if (t.want[r]) want[r] = t.want[r]; }); dispatch({ type: 'offerTrade', give, want }); },
    tradeBank: () => {
      const t = ui.trade, color = activeColor();
      const giveUnits = [], wantCards = [];
      RES.forEach((r) => { const u = Math.round(t.give[r] / bankRatio(color, r)); for (let i = 0; i < u; i++) giveUnits.push(r); });
      RES.forEach((r) => { for (let i = 0; i < t.want[r]; i++) wantCards.push(r); });
      if (!wantCards.length || giveUnits.length !== wantCards.length) return;
      ui.tradeView = null; hideOverlay();
      showBankFly(color, t.give, t.want);
      // the engine does one ratio-for-one swap per call; run one per received card
      for (let i = 0; i < wantCards.length; i++) dispatch({ type: 'bankTrade', give: giveUnits[i], want: wantCards[i] });
    },
    tradeClose: () => { ui.tradeView = null; hideOverlay(); render(); },
    tradeAccept: () => dispatch({ type: 'acceptTrade' }, online ? myColor : activeColor()),
    tradeDecline: () => dispatch({ type: 'declineTrade' }, online ? myColor : activeColor()),
    tradeAs: (kind, color) => dispatch({ type: kind === 'accept' ? 'acceptTrade' : 'declineTrade' }, color),  // hotseat: respond as a player
    tradeConfirm: (c) => dispatch({ type: 'confirmTrade', with: c }, online ? myColor : activeColor()),
    tradeCancel: () => dispatch({ type: 'cancelTrade' }),
    steal: (c) => { hideOverlay(); dispatch({ type: 'steal', victim: c }, activeColor()); },
    disc: (r, d) => { const s = ui.pending, p = state.players.find((x) => x.color === s.color), next = s.sel[r] + d, total = RES.reduce((n, x) => n + s.sel[x], 0); if (next < 0 || next > p.resources[r]) return; if (d > 0 && total >= s.need) return; s.sel[r] = next; renderDiscard(); },
    discSubmit: () => { const s = ui.pending; hideOverlay(); showDiscardFly(s.color, s.sel); dispatch({ type: 'discard', resources: s.sel }, s.color); },
    _boardSVG: () => boardSVG(),
  };

  const DEFAULT_NAMES = ['Karim', 'Sam', 'Alex', 'Jordan'];
  const SEAT_COLORS = ['red', 'blue', 'green', 'yellow'];
  // Scale the New Game card so the whole title screen always fits the viewport,
  // on any device, without scrolling or clipping.
  function fitTitle() {
    const title = $('title'); if (!title || title.classList.contains('hidden')) return;
    const body = title.querySelector('.t-body'), card = title.querySelector('.t-card');
    if (!body || !card) return;
    card.style.transform = 'none';
    // scale the card to FILL the body — up or down — bounded by both height and width
    // so it uses the landscape space instead of sitting small with dead margins.
    // leave real breathing room top+bottom so the card's last row (e.g. the lobby
    // footer) never lands at the very screen edge / iOS home-indicator zone, where taps
    // are unreliable or absorbed by the system.
    const sH = (body.clientHeight - 48) / card.offsetHeight;
    const sW = (body.clientWidth - 16) / card.offsetWidth;
    const s = Math.max(0.3, Math.min(sH, sW, 1.7));
    card.style.transform = 'scale(' + s.toFixed(3) + ')';
  }
  window.addEventListener('resize', fitTitle);
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitTitle);

  // ---- DEBUG: rig a near-win game so you can preview the victory experience ---
  // Trigger by opening the page with ?rig (e.g. index.html?rig) or calling
  // CATAN.rig() from the console. You start on YOUR turn with 9 VP — tap the
  // build-city button (🏛️) and tap your lone settlement to upgrade it and win.
  function rigNearWin(count) {
    count = Math.max(2, Math.min(4, count || 4));
    const players = Array.from({ length: count }, (_, i) => ({ color: SEAT_COLORS[i], name: DEFAULT_NAMES[i] }));
    const s = C.createGame({ id: 'rig-local', players, seed: 1337 });
    const V = s.board.vertices.length;
    // Place a building on a vertex that obeys the distance rule: the vertex must
    // be empty AND none of its neighbours may hold a building. Scan from a moving
    // cursor (stride 7) so placements spread across the board instead of clumping.
    let cursor = 0;
    const legalVertex = () => {
      for (let tries = 0; tries < V; tries++) {
        const v = ((cursor % V) + V) % V; cursor += 7;
        if (s.settlements[v]) continue;
        if (s.board.vertices[v].neighbors.some((n) => s.settlements[n])) continue;
        return v;
      }
      return -1; // board saturated (won't happen for the handful we place)
    };
    const place = (owner, type) => { const v = legalVertex(); if (v >= 0) s.settlements[v] = { type, owner }; return v; };

    // YOU (seat 0): 3 cities + 1 settlement (7 VP) + largest army (2) = 9 VP.
    const me = s.players[0];
    place(me.color, 'city'); place(me.color, 'city'); place(me.color, 'city');
    place(me.color, 'settlement');   // <- the lone settlement you'll upgrade to win
    me.citiesLeft = 1;            // 3 placed, one left for the winning upgrade
    me.settlementsLeft = 4;
    me.playedKnights = 3; me.hasLargestArmy = true; s.largestArmyOwner = me.color;
    me.devCards = ['knight', 'road_building', 'year_of_plenty', 'monopoly'];   // sample hand (no VP card, so playing a card doesn't instantly win)
    me.resources = { brick: 2, wood: 2, sheep: 2, wheat: 5, ore: 6 };   // covers the final city + spare

    // opponents: a few buildings each so the board + score panels look like a real late game
    for (let pi = 1; pi < s.players.length; pi++) {
      const c = s.players[pi].color;
      place(c, 'city'); place(c, 'settlement'); place(c, 'settlement');
      s.players[pi].resources = { brick: 1, wood: 1, sheep: 2, wheat: 1, ore: 1 };
    }

    // your turn, already rolled, in the build phase
    s.phase = 'play'; s.currentPlayerIndex = 0; s.turnPhase = 'main'; s.hasRolledThisTurn = true;
    state = s; ui = { mode: 'idle', pending: null }; resetZoom(); renderedBoardKey = null;
    $('title').classList.add('hidden'); hideOverlay(); document.body.style.background = GAME_BG; render();
    const bd = $('board'); if (bd) bd.classList.add('enter');
    toast('RIGGED — you have 9 VP. Build a city (🏛️) on your settlement to win.');
  }

  function startScreen() {
    if (ASSETS.sea) { const si = document.getElementById('seaimg'); if (si) si.style.backgroundImage = `url("${ASSETS.sea}")`; }
    hideOverlay();
    document.body.style.background = MENU_BG;   // wood canvas behind the offline title
    $('leavetab').classList.add('hidden'); $('radialtab').classList.add('hidden');
    const title = $('title'); title.classList.remove('hidden');
    let count = 4;
    const banner = ASSETS.logo
      ? `<div class="t-banner"><img src="${ASSETS.logo}" alt="CATAN"></div>`
      : `<div class="t-banner"><h2 style="color:#e9c45a;text-align:center;line-height:30vh;font-family:var(--serif)">CATAN</h2></div>`;
    const render2 = () => {
      const seats = Array.from({ length: count }, (_, i) => {
        const c = SEAT_COLORS[i];
        const medal = (ASSETS.avatars && ASSETS.avatars[i]) ? `<img src="${ASSETS.avatars[i]}" alt="">` : '';
        return `<div class="t-seat"><span class="medal">${medal}</span><span class="cdot" style="background:${PCOLOR[c]}"></span><input id="pn${i}" value="${DEFAULT_NAMES[i]}" maxlength="14"/></div>`;
      }).join('');
      title.innerHTML = `${banner}<div class="t-body"><div class="t-card">
        <h3>New Game</h3>
        <div class="seg">${[3, 4].map((n) => `<button class="${n === count ? 'on' : ''}" onclick="CATAN._setCount(${n})">${n} players</button>`).join('')}</div>
        ${seats}
        <button class="btn full" onclick="CATAN._start()">Start game (pass &amp; play)</button>
        <button class="btn wood full" onclick="CATAN.demo()">🎲 Demo — jump into a mid-game</button>
        ${AUTH.me ? `<button class="btn wood full" onclick="CATAN.showLobby()">← Back to lobby</button>`
          : (window.SUPA ? `<button class="btn wood full" onclick="CATAN.backToPlayers()">← Back to players</button>` : '')}
        <p class="muted small" style="text-align:center;margin-top:8px">Pass-and-play shares one device.</p>
      </div></div>`;
      requestAnimationFrame(fitTitle);
    };
    window.CATAN._setCount = (n) => { count = n; render2(); };
    const myName = () => { const el = $('pn0'); return (el && el.value || DEFAULT_NAMES[0]).trim(); };
    window.CATAN._start = () => {
      const players = Array.from({ length: count }, (_, i) => ({ color: SEAT_COLORS[i], name: ($('pn' + i).value || DEFAULT_NAMES[i]).trim() }));
      state = C.createGame({ id: 'local-' + Date.now(), players, seed: (Math.random() * 1e9) | 0, randomFirst: true });
      // 3·2·1 over the setup screen, then drop into the island + who-goes-first spin
      showCountdown(() => {
        ui = { mode: 'idle', pending: null }; resetZoom(); renderedBoardKey = null; title.classList.add('hidden'); hideOverlay(); document.body.style.background = GAME_BG;
        ui.spinning = true; render();
        const bd = $('board'); if (bd) bd.classList.add('enter');
        showFirstPlayerSpin(() => { afterAction(); render(); });
      });
    };
    // jump straight into a believable mid-game (skips setup) — for quick testing
    window.CATAN.demo = () => {
      const players = Array.from({ length: count }, (_, i) => ({ color: SEAT_COLORS[i], name: ($('pn' + i).value || DEFAULT_NAMES[i]).trim() }));
      const s = C.createGame({ id: 'demo-' + Date.now(), players, seed: (Math.random() * 1e9) | 0, randomFirst: true });
      const V = s.board.vertices.length;
      let cursor = (Math.random() * V) | 0;
      const legalVertex = () => {   // distance rule: empty + no neighbour built
        for (let t = 0; t < V; t++) {
          const v = ((cursor % V) + V) % V; cursor += 5 + ((Math.random() * 6) | 0);
          if (s.settlements[v]) continue;
          if (s.board.vertices[v].neighbors.some((n) => s.settlements[n])) continue;
          return v;
        }
        return -1;
      };
      const placeBuilding = (owner, type) => { const v = legalVertex(); if (v >= 0) s.settlements[v] = { type, owner }; return v; };
      const placeRoadNear = (owner, v) => { if (v < 0) return; for (const e of s.board.vertices[v].edges) { if (!s.roads[e]) { s.roads[e] = owner; return; } } };
      const ri = (a, b) => a + ((Math.random() * (b - a + 1)) | 0);
      s.players.forEach((p) => {
        const c = p.color;
        const a = placeBuilding(c, Math.random() < 0.45 ? 'city' : 'settlement');   // 1st spot (sometimes a city)
        const b = placeBuilding(c, 'settlement');                                    // 2nd spot
        placeRoadNear(c, a); placeRoadNear(c, a); placeRoadNear(c, b);               // a few roads
        p.resources = { brick: ri(0, 3), wood: ri(0, 3), sheep: ri(0, 3), wheat: ri(0, 4), ore: ri(0, 3) };
        if (Math.random() < 0.5) p.devCards = [['knight', 'road_building', 'year_of_plenty', 'monopoly'][ri(0, 3)]];
        if (Math.random() < 0.5) p.playedKnights = ri(0, 2);
      });
      // recompute supply from what's on the board so builds stay valid
      s.players.forEach((p) => {
        const mine = Object.values(s.settlements).filter((x) => x.owner === p.color);
        p.settlementsLeft = 5 - mine.filter((x) => x.type === 'settlement').length;
        p.citiesLeft = 4 - mine.filter((x) => x.type === 'city').length;
        p.roadsLeft = 15 - Object.values(s.roads).filter((o) => o === p.color).length;
      });
      try { C.updateLongestRoad(s); } catch (_) { }
      s.phase = 'play'; s.currentPlayerIndex = 0; s.turnPhase = 'main'; s.hasRolledThisTurn = true;   // your turn, ready to build
      state = s; ui = { mode: 'idle', pending: null }; resetZoom(); renderedBoardKey = null;
      title.classList.add('hidden'); hideOverlay(); document.body.style.background = GAME_BG;
      afterAction(); render();
      const bd = $('board'); if (bd) bd.classList.add('enter');
      toast('Demo — mid-game, your turn');
    };
    render2();
  }

  // ---- board zoom (pinch / drag / wheel / double-tap) ----------------------
  // Only the island (#board-area) is transformed; every HUD layer is a sibling,
  // so the corners and resource bar stay pinned. The browser's own page-zoom is
  // suppressed (touch-action:none + gesture preventDefault) so we own the gesture.
  const zoom = { s: 1, tx: 0, ty: 0, swallowClick: false };
  const MAXZ = 3;
  let zArea = null, zStage = null;
  const zPts = new Map();           // active pointers: id -> {x,y}
  let zPinch = null, zPan = null, zMoved = false, zDownTime = 0, zLastTap = 0, zLastTapX = 0, zLastTapY = 0;
  function zRect() { return (zStage || (zStage = $('app'))).getBoundingClientRect(); }
  function zApply(animate) {
    if (!zArea) return;
    zArea.style.transition = animate ? 'transform .26s ease' : 'none';
    zArea.style.transform = `translate(${zoom.tx.toFixed(2)}px,${zoom.ty.toFixed(2)}px) scale(${zoom.s.toFixed(4)})`;
  }
  function zClamp() {
    const r = zRect();
    if (zoom.s < 1) zoom.s = 1;
    // The SVG = the viewport and renders the water grid out to its edges, so the rule is
    // simply: never pan the viewport past the SVG. The rectangular water fills every
    // viewport corner at the clamp limits, so you only ever see ocean hexes — no stage.
    zoom.tx = Math.min(0, Math.max(-(zoom.s - 1) * r.width, zoom.tx));
    zoom.ty = Math.min(0, Math.max(-(zoom.s - 1) * r.height, zoom.ty));
  }
  // zoom toward a focal screen point, keeping the content under it fixed
  function zoomTo(newS, fx, fy) {
    const r = zRect();
    newS = Math.min(MAXZ, Math.max(1, newS));
    const lx = fx - r.left, ly = fy - r.top;            // focal in stage-local px
    const cx = (lx - zoom.tx) / zoom.s, cy = (ly - zoom.ty) / zoom.s; // content point under focal
    zoom.s = newS; zoom.tx = lx - newS * cx; zoom.ty = ly - newS * cy;
    zClamp(); zApply(false);
  }
  function resetZoom() { zoom.s = 1; zoom.tx = 0; zoom.ty = 0; zApply(true); if (ui.confirm) { ui.confirm = null; render(); } }
  function zMid() { const a = [...zPts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
  function zDist() { const a = [...zPts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
  function initBoardZoom() {
    zArea = $('board-area'); if (!zArea || zArea._zoomInit) return; zArea._zoomInit = true;
    zArea.addEventListener('pointerdown', (e) => {
      if (zPts.size === 0) zoom.swallowClick = false;   // fresh gesture, clear stale flag
      zPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      // NB: do NOT capture the pointer on a plain press. Capturing redirects the
      // follow-up `click` to #board-area, so it never reaches the placement handler
      // on #board (its child) — which silently broke tap/click-to-build on desktop.
      // We only capture once a real drag/pinch starts (see pointermove / 2nd pointer).
      if (zPts.size === 1) { zMoved = false; zDownTime = e.timeStamp; zPan = { x: e.clientX, y: e.clientY, tx: zoom.tx, ty: zoom.ty }; }
      else if (zPts.size === 2) {
        zPan = null; zPinch = { d: zDist(), s: zoom.s, tx: zoom.tx, ty: zoom.ty };
        for (const id of zPts.keys()) { try { zArea.setPointerCapture(id); } catch (_) { } }  // a pinch is a drag, capture is safe
      }
    });
    zArea.addEventListener('pointermove', (e) => {
      if (!zPts.has(e.pointerId)) return;
      zPts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (zPts.size >= 2 && zPinch) {
        const ratio = zDist() / (zPinch.d || 1), m = zMid();
        zoom.s = Math.min(MAXZ, Math.max(1, zPinch.s * ratio));
        const r = zRect(), lx = m.x - r.left, ly = m.y - r.top;
        const cx = (lx - zPinch.tx) / zPinch.s, cy = (ly - zPinch.ty) / zPinch.s;
        zoom.tx = lx - zoom.s * cx; zoom.ty = ly - zoom.s * cy;
        zClamp(); zApply(false); zMoved = true; e.preventDefault();
      } else if (zPts.size === 1 && zPan) {
        zoom.tx = zPan.tx + (e.clientX - zPan.x); zoom.ty = zPan.ty + (e.clientY - zPan.y);
        if (Math.abs(e.clientX - zPan.x) + Math.abs(e.clientY - zPan.y) > 6) {
          if (!zMoved) { try { zArea.setPointerCapture(e.pointerId); } catch (_) { } }  // became a drag: now capture
          zMoved = true;
        }
        zClamp(); zApply(false); e.preventDefault();
      }
    });
    const up = (e) => {
      if (!zPts.has(e.pointerId)) return;
      const wasOne = zPts.size === 1;
      zPts.delete(e.pointerId);
      if (zPts.size < 2) zPinch = null;
      if (zPts.size === 1) { const p = [...zPts.values()][0]; zPan = { x: p.x, y: p.y, tx: zoom.tx, ty: zoom.ty }; }
      if (zPts.size === 0) {
        if (zMoved) { zoom.swallowClick = true; }   // dragged/pinched -> not a placement
        else if (wasOne) {                          // a clean tap: check for double-tap
          const dt = e.timeStamp - zLastTap, near = Math.hypot(e.clientX - zLastTapX, e.clientY - zLastTapY) < 32;
          const offset = zoom.s > 1.02 || Math.abs(zoom.tx) > 1 || Math.abs(zoom.ty) > 1;
          if (dt < 300 && near && offset) { resetZoom(); zoom.swallowClick = true; zLastTap = 0; }
          else { zLastTap = e.timeStamp; zLastTapX = e.clientX; zLastTapY = e.clientY; }
        }
      }
    };
    zArea.addEventListener('pointerup', up);
    zArea.addEventListener('pointercancel', up);
    // desktop: wheel to zoom at the cursor, double-click to reset
    zArea.addEventListener('wheel', (e) => { e.preventDefault(); zoomTo(zoom.s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
    zArea.addEventListener('dblclick', (e) => { if (zoom.s > 1.02) { resetZoom(); zoom.swallowClick = true; e.preventDefault(); } });
    // kill iOS Safari's legacy page-zoom gesture even where touch-action misses
    ['gesturestart', 'gesturechange', 'gestureend'].forEach((g) =>
      document.addEventListener(g, (e) => e.preventDefault(), { passive: false }));
    window.addEventListener('resize', () => { zClamp(); zApply(false); });
  }

  // ===== online multiplayer (Supabase realtime, server-of-record = the games row) =====
  // The active player's browser applies its move with the SAME engine, then writes the
  // new state to Supabase; Realtime fans it out to the other phones. No host needs to be
  // online — Supabase holds the shared truth and is always up.
  let online = false, myColor = null;
  function enterGame(s) {
    state = s; ui = { mode: 'idle', pending: null }; resetZoom(); renderedBoardKey = null;
    const t = $('title'); if (t) t.classList.add('hidden');
    hideOverlay();
    document.body.style.background = GAME_BG;   // sea canvas behind the board
    if (isFreshSetup()) ui.spinning = true;   // ceremony in progress: hold prompts + active highlight
    render();   // show the board first (no placement / active highlight yet)
    const bd = $('board'); if (bd) bd.classList.add('enter');
    // the 3·2·1 countdown already ran over the lobby; on the island we go straight to
    // the who-goes-first spin, then begin setup
    if (isFreshSetup()) showFirstPlayerSpin(() => { afterAction(); render(); });
    else { afterAction(); render(); }
  }
  // infer what a remote player did (state diff) so spectators hear the right sound
  function soundForRemote(a, b) {
    try {
      const sett = (st) => Object.keys(st.settlements || {}).length;
      const cities = (st) => Object.values(st.settlements || {}).filter((x) => x.type === 'city').length;
      if (sett(b) > sett(a)) return playSound('settlement');
      if (cities(b) > cities(a)) return playSound('city');
      if (Object.keys(b.roads || {}).length > Object.keys(a.roads || {}).length) return playSound('road');
      if (a.robberHex !== b.robberHex) return playSound('robber');
      if ((a.devDeck || []).length > (b.devDeck || []).length) return playSound('buy');
      // a roll is handled in applyRemoteState (it shows the big dice + plays its own sound)
    } catch (_) { }
  }
  // afterAction sets the input mode for the active player; render must follow it.
  // When a roll arrives from another player, show the big center dice on every screen.
  function applyRemoteState(s) {
    const a = state;
    const rolled = !!(a && a.turnPhase === 'roll' && s.turnPhase !== 'roll' && s.dice && s.hasRolledThisTurn);
    const trade = detectTrade(a, s);
    const disc = detectDiscard(a, s);
    const robberMoved = !!(a && a.robberHex !== s.robberHex);   // thief moved -> fly it on every screen
    if (!rolled && !trade && !disc && a) soundForRemote(a, s);   // roll/trade/discard/robber have their own sound+animation
    state = s;
    if (rolled) ui.diceRevealing = true;   // suppress the corner dice during the reveal
    if (disc) ui.discardAnimating = true;  // defer the next discard prompt until this one's cards land
    if (robberMoved) ui.robberFlying = true;
    afterAction(); render();
    if (rolled) showDiceReveal(s.dice);
    if (disc) showDiscardFly(disc.color, disc.sel);   // everyone watches each player's discard; end -> afterAction
    if (robberMoved) showRobberFly(a.robberHex, s.robberHex);
    if (trade) showTradeFly(trade.a, trade.b, trade.g, trade.w);
  }
  function genCode() { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; let s = ''; for (let i = 0; i < 4; i++) s += a[(Math.random() * a.length) | 0]; return s; }

  const NET = {
    client: null, code: null, version: 0, isHost: false, started: false, channel: null, players: [],
    myId: (function () { let id; try { id = localStorage.getItem('catanId'); if (!id) { id = 'c' + Math.random().toString(36).slice(2, 10); localStorage.setItem('catanId', id); } } catch (_) { id = 'c' + Math.random().toString(36).slice(2, 10); } return id; })(),
    init() {
      if (this.client) return this.client;
      if (!window.supabase || !window.SUPA) { toast('Online not configured'); return null; }
      this.client = window.supabase.createClient(window.SUPA.url, window.SUPA.anonKey);
      return this.client;
    },
    // watch the single shared TABLE row for an active game
    subscribe() {
      const c = this.init(); if (!c) return;
      if (this.channel) { try { c.removeChannel(this.channel); } catch (_) { } }
      this.channel = c.channel('game-TABLE')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: 'code=eq.TABLE' }, (p) => { if (p.new) NET.onRow(p.new); })
        .subscribe();
      if (this.poll) clearInterval(this.poll);
      this.poll = setInterval(async () => {
        const { data } = await c.from('games').select('*').eq('code', 'TABLE').maybeSingle();
        NET.onRow(data || { phase: 'idle' });   // realtime is primary; poll is the safety net
      }, 2500);
    },
    onRow(row) {
      if (!row || !row.state || (row.phase !== 'playing' && row.phase !== 'ended')) {
        LOBBY.lastRow = null;
        if (this.started) { this.started = false; this.version = 0; online = false; myColor = null; LOBBY.toLobby(); }
        else if (LOBBY.inProgress) { LOBBY.inProgress = false; renderLobby(); }   // the game I could watch just ended
        return;   // table is idle -> stay in / return to the lobby
      }
      if (this.started && row.version <= this.version) return;   // dedup my own echo / poll repeats
      this.version = row.version;
      LOBBY.lastRow = row;
      const seat = (row.players || []).find((p) => p.playerId === (AUTH.me && AUTH.me.id));
      if (this.started) { myColor = seat ? seat.color : null; applyRemoteState(row.state); return; }   // already in -> just sync
      // not in the game yet: seated players + anyone who chose Spectate enter now;
      // idle lobby-watchers get a "Watch" button instead of being yanked in.
      const iSeated = !!seat, iSpectate = LOBBY.mode === 'spectate';
      if (iSeated || iSpectate) {
        myColor = seat ? seat.color : null; online = true;
        LOBBY.enterAs(iSeated ? 'play' : 'spectate');
        this.started = true;
        if (isFreshStart(row.state)) showCountdown(() => enterGame(row.state));   // 3·2·1 only on a real fresh start
        else enterGame(row.state);
      } else {
        // a game is running and I'm idling in the lobby -> offer Watch. Only re-render on the
        // transition; otherwise every in-game move (version bump) would rebuild the lobby and
        // make its buttons (Switch player, Watch) un-tappable mid-rebuild.
        online = true;
        if (!LOBBY.inProgress) { LOBBY.inProgress = true; renderLobby(); }
      }
    },
    async syncAction(action, actor) {
      const c = this.init(); if (!c) return;
      for (let i = 0; i < 6; i++) {
        const { data, error } = await c.from('games').select('state,version').eq('code', 'TABLE').maybeSingle();
        if (error || !data || !data.state) return;
        const r = C.applyAction(data.state, action, actor);
        if (!r.ok) { applyRemoteState(data.state); return; }
        const phase = r.state.phase === 'ended' ? 'ended' : 'playing';
        const { data: upd, error: uerr } = await c.from('games')
          .update({ state: r.state, version: data.version + 1, phase }).eq('code', 'TABLE').eq('version', data.version).select('version');
        if (uerr) { toast('Sync error'); return; }
        if (upd && upd.length) { this.version = data.version + 1; return; }
        await new Promise((res) => setTimeout(res, 70));
      }
    },
  };

  // ===== lobby: presence (who's online + ready) + explicit table formation ===
  // read a presence entry's lobby mode (back-compat with the old {ready} payload)
  function pmode(p) { return p.mode || (p.ready ? 'ready' : 'idle'); }
  const LOBBY = {
    channel: null, presence: {}, mode: 'idle', readyAt: 0, inProgress: false, lastRow: null,
    join() {
      const c = NET.init(); if (!c || !AUTH.me) return;
      NET.subscribe();   // watch for an active game
      if (this.channel) { try { c.removeChannel(this.channel); } catch (_) { } }
      this.channel = c.channel('lobby', { config: { presence: { key: AUTH.me.id } } });
      this.channel.on('presence', { event: 'sync' }, () => LOBBY.onPresence());
      this.channel.subscribe((st) => { if (st === 'SUBSCRIBED') LOBBY.track(); });
    },
    track() { if (this.channel) this.channel.track({ id: AUTH.me.id, name: AUTH.me.name, mode: this.mode, readyAt: this.readyAt }); },
    onPresence() {
      const st = this.channel.presenceState(); this.presence = {};
      Object.values(st).forEach((arr) => { const m = arr[arr.length - 1]; if (m && m.id) this.presence[m.id] = m; });
      if (!NET.started) renderLobby();
      else renderBanner();   // in-game: keep the "N watching" count live as spectators come/go
    },
    online() { return Object.values(this.presence); },
    readyList() { return this.online().filter((p) => pmode(p) === 'ready').sort((a, b) => a.readyAt - b.readyAt); },
    spectators() { return this.online().filter((p) => pmode(p) === 'spectate'); },
    setReady() { this.mode = this.mode === 'ready' ? 'idle' : 'ready'; this.readyAt = this.mode === 'ready' ? Date.now() : 0; this.track(); renderLobby(); },
    setSpectate() { this.mode = this.mode === 'spectate' ? 'idle' : 'spectate'; this.readyAt = 0; this.track(); renderLobby(); },
    enterAs(role) { this.mode = role === 'play' ? 'playing' : 'spectate'; this.readyAt = 0; this.inProgress = false; if (this.channel) this.track(); },
    toLobby() { this.mode = 'idle'; this.readyAt = 0; this.inProgress = false; if (this.channel) this.track(); showLobby(); },   // table idle -> back to lobby
    watch() { const row = this.lastRow; if (!row || !row.state) { toast('No game to watch'); return; } myColor = null; online = true; this.enterAs('spectate'); NET.started = true; NET.version = row.version; enterGame(row.state); },   // join an in-progress game as a spectator (no countdown)
    async startTable() {
      const ready = this.readyList();
      if (ready.length < 3) { toast('Need at least 3 players ready'); return; }
      if (ready[0].id !== AUTH.me.id) { toast('Only the first player to ready up can start'); return; }
      const seated = ready.slice(0, 4), n = seated.length;
      const players = seated.map((p, i) => ({ seat: i, color: SEAT_COLORS[i], name: p.name, playerId: p.id }));
      const target = n === 3 ? 13 : (n === 4 ? 11 : 10);
      let gstate;
      try { gstate = C.createGame({ id: 'table', players: players.map((p) => ({ color: p.color, name: p.name })), seed: (Math.random() * 1e9) | 0, targetPoints: target, randomFirst: true }); }
      catch (e) { toast('Start failed: ' + e.message); return; }
      const c = NET.init();
      const { error } = await c.from('games').upsert({ code: 'TABLE', phase: 'playing', players, state: gstate, target_points: target, version: 1, host_id: AUTH.me.id });
      if (error) toast('Start failed: ' + error.message);   // realtime drives everyone in
    },
    async reset() {   // end the table -> everyone back to the lobby
      const c = NET.init(); if (!c) return;
      await c.from('games').upsert({ code: 'TABLE', phase: 'idle', state: null, players: [], version: 0 });
    },
    leave() {
      const c = NET.init();
      if (c && this.channel) { try { c.removeChannel(this.channel); } catch (_) { } this.channel = null; }
      if (c && NET.channel) { try { c.removeChannel(NET.channel); } catch (_) { } NET.channel = null; }
      if (NET.poll) { clearInterval(NET.poll); NET.poll = null; }
      this.presence = {}; this.mode = 'idle'; this.readyAt = 0; this.inProgress = false; this.lastRow = null; online = false; myColor = null; NET.started = false;
    },
  };
  function rankMode(p) { const m = pmode(p); return m === 'ready' ? 3 : m === 'playing' ? 2 : m === 'spectate' ? 1 : 0; }
  function lobbyRows(list, ready) {
    if (!list.length) return `<p class="muted" style="text-align:center;margin:8px 0">Nobody online yet.</p>`;
    return list.slice().sort((a, b) => (rankMode(b) - rankMode(a)) || String(a.name).localeCompare(b.name)).map((p) => {
      const m = pmode(p), ri = ready.findIndex((r) => r.id === p.id);
      let tag;
      if (m === 'spectate') tag = `<span class="t-pend">spectating</span>`;
      else if (m === 'playing') tag = `<span class="t-pend">in game</span>`;
      else if (m === 'ready') tag = ri === 0 ? `<span class="t-acc">Host · 1st to be ready</span>` : (ri < 4 ? `<span class="t-acc">ready</span>` : `<span class="t-pend">ready · spectating (full)</span>`);
      else tag = `<span class="muted">not ready</span>`;
      return `<div class="lobrow"><span class="tnm">${escapeHtml(p.name)}${p.id === AUTH.me.id ? ' (you)' : ''}</span>${tag}</div>`;
    }).join('');
  }
  let lobbySig = null;
  function renderLobby() {
    if (NET.started || !AUTH.me) return;
    const list = LOBBY.online(), ready = LOBBY.readyList();
    // Skip the rebuild when nothing visible changed. titleCard tears down & recreates the
    // footer buttons, so a redundant rebuild (e.g. a presence ping) lands between a tap's
    // down/up and the button does nothing — looks "disabled". Only rebuild on real change.
    const sig = JSON.stringify([LOBBY.inProgress, LOBBY.mode, list.map((p) => p.id + ':' + pmode(p) + ':' + p.name + ':' + (p.readyAt || 0)).sort()]);
    const t = $('title');
    if (sig === lobbySig && t && !t.classList.contains('hidden')) return;
    lobbySig = sig;
    const rows = lobbyRows(list, ready);
    const foot = `<div class="lobby-foot"><button class="btn ghost" onclick="CATAN.lobbyLogout()">← Switch player</button><button class="btn ghost" onclick="CATAN.authChangePin()">Change PIN</button></div>`;
    if (LOBBY.inProgress) {   // a game is running -> only offer to watch it
      titleCard(`<h3>Lobby</h3>
        <p class="muted small" style="text-align:center">${escapeHtml(AUTH.me.name)} · ${list.length} online</p>
        <div class="loblist">${rows}</div>
        <button class="btn wood full" onclick="CATAN.lobbyWatch()">🔴 Game in progress · Watch</button>
        <p class="muted small" style="text-align:center;margin-top:6px">Watch, or wait for it to finish.</p>${foot}`);
      return;
    }
    const canStart = ready.length >= 3;
    const host = ready[0];   // the first player to ready up owns the Start button
    const iAmHost = host && host.id === AUTH.me.id;
    const seatN = Math.min(4, ready.length), tgt = ready.length >= 4 ? 11 : 13;
    const startBtn = !canStart
      ? `<button class="btn full" disabled>Start game (need 3 ready)</button>`
      : iAmHost
        ? `<button class="btn full" onclick="CATAN.lobbyStart()">Start game · ${seatN}p (${tgt} pts)</button>`
        : `<button class="btn full" disabled>Waiting for ${escapeHtml(host.name)} to start…</button>`;
    titleCard(`<h3>Lobby</h3>
      <p class="muted small" style="text-align:center">${escapeHtml(AUTH.me.name)} · ${list.length} online · ${ready.length} ready</p>
      <div class="loblist">${rows}</div>
      <div class="lobrow2">
        <button class="btn ${LOBBY.mode === 'ready' ? '' : 'wood'}" onclick="CATAN.lobbyReady()">${LOBBY.mode === 'ready' ? '✓ Ready' : "I'm ready"}</button>
        <button class="btn ${LOBBY.mode === 'spectate' ? '' : 'wood'}" onclick="CATAN.lobbySpectate()">${LOBBY.mode === 'spectate' ? '✓ Spectating' : '👁 Spectate'}</button>
      </div>
      ${startBtn}${foot}`);
  }
  window.CATAN.lobbyReady = () => LOBBY.setReady();
  window.CATAN.lobbySpectate = () => LOBBY.setSpectate();
  window.CATAN.lobbyWatch = () => LOBBY.watch();
  window.CATAN.lobbyStart = () => LOBBY.startTable();
  window.CATAN.exitGame = () => {
    // ensure no higher layer (radial root sits at z-31, above the overlay) eats taps
    const rr = $('radialroot'); if (rr) { rr.classList.remove('open'); rr.classList.add('hidden'); }
    const spectator = online && !myColor;   // a watcher: leaving just returns them to the lobby
    const endsForAll = online && myColor;   // a seated player leaving ends the table
    const ttl = spectator ? 'Stop watching?' : 'Leave game?';
    const sub = spectator ? 'You go back to the lobby. The game keeps going for the players.'
      : endsForAll ? 'This ends the game for everyone.' : 'You will leave this game.';
    const act = spectator ? 'Leave to lobby' : endsForAll ? 'End game for everyone' : 'Leave game';
    // big, full-width stacked targets — Cancel is the prominent safe action, leave is below
    showOverlay(`<h3>${ttl}</h3>
      <p class="muted" style="text-align:center;margin:6px 0 12px">${sub}</p>
      <button class="btn full" style="padding:16px;font-size:16px" onclick="CATAN.close()">${spectator ? 'Cancel — keep watching' : 'Cancel — keep playing'}</button>
      <button class="btn ${spectator ? 'wood' : 'end'} full" style="padding:15px;font-size:15px;margin-top:9px" onclick="CATAN.confirmExit()">${act}</button>`);
    const o = $('overlay'); o.onclick = (e) => { if (e.target === o) CATAN.close(); };   // tap outside the card to cancel
  };
  window.CATAN.confirmExit = async () => {
    hideOverlay();
    if (!online) { NET.started = false; startScreen(); return; }
    const wasSpectator = !myColor;
    NET.started = false; online = false; myColor = null; NET.version = 0;
    if (wasSpectator) { LOBBY.mode = 'idle'; LOBBY.inProgress = false; showLobby(); return; }   // watcher leaves -> lobby, game untouched
    // seated player ending the game: idle the table FIRST, then re-enter the lobby —
    // otherwise re-subscribing reads the still-'playing' row and bounces us back in.
    try { await LOBBY.reset(); } catch (_) { }
    showLobby();
  };
  window.CATAN.lobbyLogout = () => { LOBBY.leave(); AUTH.clear(); showIdentity('list'); };
  window.CATAN.backToPlayers = () => showIdentity('list');   // offline setup -> homepage (player picker)
  window.CATAN.tableReset = () => LOBBY.reset();

  // ===== identity / PIN auth (persistent player + device auto-login) =========
  const AUTH = {
    me: null,
    async rpc(fn, args) {
      const c = NET.init(); if (!c) return { ok: false, error: 'offline' };
      try { const { data, error } = await c.rpc(fn, args); if (error) return { ok: false, error: error.message }; return data; }
      catch (e) { return { ok: false, error: String(e) }; }
    },
    saved() { try { return JSON.parse(localStorage.getItem('catanAuth') || 'null'); } catch (_) { return null; } },
    save(me) { this.me = me; try { localStorage.setItem('catanAuth', JSON.stringify(me)); } catch (_) { } },
    clear() { this.me = null; try { localStorage.removeItem('catanAuth'); } catch (_) { } },
    async resume() {
      const s = this.saved(); if (!s || !s.token) return false;
      const r = await this.rpc('player_resume', { p_token: s.token });
      if (r && r.ok) { this.me = { id: r.id, name: r.name, token: s.token }; return true; }
      return false;
    },
    async login(name, pin) {
      const r = await this.rpc('player_login', { p_name: name, p_pin: pin });
      if (r && r.ok) { this.save({ id: r.id, name: r.name, token: r.token }); return { ok: true }; }
      return { ok: false, error: (r && r.error) || 'Login failed' };
    },
    async create(name, pin) {
      const r = await this.rpc('player_create', { p_name: name, p_pin: pin });
      if (r && r.ok) { this.save({ id: r.id, name: r.name, token: r.token }); return { ok: true }; }
      return { ok: false, error: (r && r.error) || 'Could not create player' };
    },
    async list() { const r = await this.rpc('player_list', {}); return Array.isArray(r) ? r : []; },
    async setPin(oldPin, newPin) { if (!this.me) return { ok: false, error: 'Not logged in' }; return await this.rpc('player_set_pin', { p_token: this.me.token, p_old: oldPin, p_new: newPin }); },
    async start() {
      if (!NET.init()) { startScreen(); return; }   // online not configured -> offline pass & play
      titleCard(`<h3>Catan</h3><p class="muted small" style="text-align:center">Connecting…</p>`);
      if (await this.resume()) showLobby(); else showIdentity();
    },
  };

  function titleCard(html) {
    const t = $('title');
    const banner = (ASSETS.logo)
      ? `<div class="t-banner"><img src="${ASSETS.logo}" alt="CATAN"></div>`
      : `<div class="t-banner"><h2 style="color:#e9c45a;text-align:center;line-height:30vh;font-family:var(--serif)">CATAN</h2></div>`;
    t.innerHTML = `${banner}<div class="t-body"><div class="t-card">${html}</div></div>`;
    t.classList.remove('hidden'); hideOverlay();
    document.body.style.background = MENU_BG;   // canvas (incl. iOS safe-area strip) matches the wood menu
    $('leavetab').classList.add('hidden'); $('radialtab').classList.add('hidden');
    requestAnimationFrame(fitTitle);
  }
  async function showIdentity(mode) {
    mode = mode || 'list';
    const names = mode === 'list' ? await AUTH.list() : [];
    if (mode === 'list') {
      const list = names.length
        ? names.map((n) => `<button class="btn full" onclick="CATAN.authPick('${encodeURIComponent(n)}')">${escapeHtml(n)}</button>`).join('')
        : `<p class="muted" style="text-align:center;margin:8px 0">No players yet — create one.</p>`;
      titleCard(`<h3>Who are you?</h3><div class="authlist">${list}</div>
        <button class="btn wood full" onclick="CATAN.authNew()">+ New player</button>
        <button class="offline-link" onclick="CATAN.playOffline()">Pass &amp; play offline</button>`);
    } else if (mode === 'new') {
      titleCard(`<h3>New player</h3>
        <input id="auName" class="authin" placeholder="Your name" maxlength="20" autocomplete="off"/>
        <input id="auPin" class="authin" type="password" inputmode="numeric" placeholder="Choose a PIN (4+ digits)" autocomplete="off"/>
        <div id="auErr" class="auerr"></div>
        <button class="btn full" onclick="CATAN.authCreate()">Create &amp; enter</button>
        <button class="btn ghost full" onclick="CATAN.authBack()">Back</button>`);
    } else if (mode.indexOf('login:') === 0) {
      const name = decodeURIComponent(mode.slice(6));
      titleCard(`<h3>${escapeHtml(name)}</h3>
        <input id="auPin" class="authin" type="password" inputmode="numeric" placeholder="Enter your PIN" autocomplete="off"/>
        <div id="auErr" class="auerr"></div>
        <button class="btn full" onclick="CATAN.authLogin('${encodeURIComponent(name)}')">Log in</button>
        <button class="btn ghost full" onclick="CATAN.authBack()">Back</button>`);
      setTimeout(() => { const el = $('auPin'); if (el) el.focus(); }, 50);
    }
  }
  function showLobby() {
    if (!AUTH.me) { showIdentity(); return; }
    lobbySig = null;   // force a fresh paint on (re-)entry to the lobby
    LOBBY.join();
    renderLobby();
  }
  window.CATAN.authPick = (n) => showIdentity('login:' + n);
  window.CATAN.authNew = () => showIdentity('new');
  window.CATAN.authBack = () => showIdentity('list');
  window.CATAN.authCreate = async () => { const r = await AUTH.create(($('auName') || {}).value, ($('auPin') || {}).value); if (r.ok) showLobby(); else { const e = $('auErr'); if (e) e.textContent = r.error; } };
  window.CATAN.authLogin = async (n) => { const r = await AUTH.login(decodeURIComponent(n), ($('auPin') || {}).value); if (r.ok) showLobby(); else { const e = $('auErr'); if (e) e.textContent = r.error; } };
  window.CATAN.authLogout = () => { LOBBY.leave(); AUTH.clear(); showIdentity('list'); };
  window.CATAN.playOffline = () => { LOBBY.leave(); startScreen(); };
  window.CATAN.showLobby = () => showLobby();
  window.CATAN.authChangePin = () => {
    titleCard(`<h3>Change PIN</h3>
      <input id="auOld" class="authin" type="password" inputmode="numeric" placeholder="Current PIN" autocomplete="off"/>
      <input id="auNew" class="authin" type="password" inputmode="numeric" placeholder="New PIN (4+ digits)" autocomplete="off"/>
      <div id="auErr" class="auerr"></div>
      <button class="btn full" onclick="CATAN.authDoChangePin()">Save</button>
      <button class="btn ghost full" onclick="CATAN.showLobby()">Back</button>`);
  };
  window.CATAN.authDoChangePin = async () => { const r = await AUTH.setPin(($('auOld') || {}).value, ($('auNew') || {}).value); if (r && r.ok) { toast('PIN changed'); showLobby(); } else { const e = $('auErr'); if (e) e.textContent = (r && r.error) || 'Failed'; } };

  function boot() {
    initBoardZoom();
    const m = location.href.match(/[?#&]rig(?:=(\d))?\b/);   // ?rig -> 4 players, ?rig=2 -> 2, etc.
    if (m) { rigNearWin(m[1] ? parseInt(m[1], 10) : 4); return; }
    AUTH.start();
  }
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
