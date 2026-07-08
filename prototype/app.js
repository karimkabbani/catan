/* Catan prototype — landscape "classic look" skin.
   Rules come entirely from the tested engine (window.Catan). This file is
   rendering + input only. The tile/token/port art below is original SVG drawn
   to evoke the classic board; exact ripped assets swap in during final polish. */
(function () {
  'use strict';
  const C = window.Catan;
  const APP_VERSION = 'v106';   // shown in the corner so you can confirm the live build (bump with the SW version)
  const RES = ['brick', 'wood', 'sheep', 'wheat', 'ore'];
  const ICON = { brick: '🧱', wood: '🪵', sheep: '🐑', wheat: '🌾', ore: '🪨' };
  const PCOLOR = { red: '#cf3b34', blue: '#2f6bd6', green: '#3da34d', yellow: '#e8c41f' };
  // Document-canvas backgrounds per screen. iOS standalone paints the safe-area strip
  // (below the home indicator) with the <body> bg, which no fixed element can cover —
  // so we switch body bg to match: dark wood on menus, deep sea in-game.
  const MENU_BG = '', GAME_BG = '#0c3d68';   // '' = revert to the CSS wood-texture page canvas
  // per-device preferences (each player's own phone) — persisted in localStorage. The
  // effects of these are wired up per-setting; here we just store + expose them.
  const SETTINGS = (() => {
    const def = { music: false, sfx: true, anim: 'medium', autozoom: true };
    try { return Object.assign(def, JSON.parse(localStorage.getItem('catan-settings') || '{}')); } catch (_) { return def; }
  })();
  function saveSettings() { try { localStorage.setItem('catan-settings', JSON.stringify(SETTINGS)); } catch (_) {} }
  // Animation speed setting -> a time multiplier applied to JS-timed animations.
  function aScale() { return SETTINGS.anim === 'slow' ? 1.5 : (SETTINGS.anim === 'fast' ? 0.6 : 1); }
  function aDur(ms) { return Math.round(ms * aScale()); }
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
  function unlockAudio() { if (!actx) initAudio(); if (actx && actx.state === 'suspended') actx.resume(); startMusic(); }
  function playSound(name, vol) {
    if (!SETTINGS.sfx) return;            // Sound effects setting (music is separate)
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

  // ---- background music: the three in-game tracks looped as a playlist (iOS + Android) ----
  // mp3 (not the source .ogg) so it plays on iOS too. Browsers won't autoplay audio, so the
  // first play() must land inside a user gesture — unlockAudio (any tap) drives that.
  const MUSIC = ['ingame_01', 'ingame_02', 'ingame_03'];
  let musicEl = null, musicIdx = 0;
  function inGame() { const t = $('title'); return !!t && t.classList.contains('hidden'); }
  function ensureMusicEl() {
    if (musicEl) return musicEl;
    musicEl = new Audio();
    musicEl.id = 'bgmusic'; musicEl.volume = 0.2;
    musicEl.addEventListener('ended', () => {                 // next track, looping 01->02->03->01
      musicIdx = (musicIdx + 1) % MUSIC.length;
      musicEl.src = `assets/audio/${MUSIC[musicIdx]}.mp3`;
      musicEl.play().catch(() => {});
    });
    document.body.appendChild(musicEl);                       // (no `controls` -> renders nothing)
    return musicEl;
  }
  function startMusic() {
    if (!SETTINGS.music || !inGame()) return;
    const el = ensureMusicEl();
    if (!el.getAttribute('src')) el.src = `assets/audio/${MUSIC[musicIdx]}.mp3`;
    if (el.paused) el.play().catch(() => {});                 // succeeds within a gesture; retried on the next tap otherwise
  }
  function stopMusic() { if (musicEl) { try { musicEl.pause(); } catch (_) {} } }
  function musicSkip(dir) {                                   // ‹ › track navigation in the settings menu
    const el = ensureMusicEl();
    musicIdx = (musicIdx + dir + MUSIC.length) % MUSIC.length;
    el.src = `assets/audio/${MUSIC[musicIdx]}.mp3`;
    if (SETTINGS.music) el.play().catch(() => {});
    if (!$('overlay').classList.contains('hidden')) openSettings();   // refresh the track number
  }

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
  // The #board layers are 2x the viewport, so the viewBox is 2x too (VB_HALF below);
  // the water rect must reach the viewBox corners (±VB_HALF) plus the wide letterbox,
  // or a drag would expose the deep-ocean backdrop instead of hexes.
  const WATER_X = 26, WATER_Y = 13;
  const VB_HALF = 12.4;           // viewBox half-size (keep in sync with boardSVG + #board CSS 2x)
  let boardCx = 0, boardCy = 0;   // island/viewBox centre, set in boardSVG, used by zClamp
  let boardHalfW = 4, boardHalfH = 4;   // island half-extent (board units, from vertices) — pan clamp
  const WATER_HEXES = (() => {
    const out = [];
    for (let q = -18; q <= 18; q++) for (let r = -18; r <= 18; r++) {
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
  // seat metadata for the current online game ([{color,name,avatar,...}]); null offline.
  // Lets the board/corners use each player's uploaded photo, falling back to the seat asset.
  let gameSeats = null;
  function seatAvatarSrc(player, i) {
    const s = gameSeats && player && gameSeats.find((g) => g.color === player.color);
    return (s && s.avatar) || (ASSETS.avatars && ASSETS.avatars[i]) || '';
  }
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
    if (action.type === 'buildSettlement' || action.type === 'buildCity') {
      justPlaced = { kind: 'v', id: action.vertex };
      // the 2nd setup settlement grants one card per adjacent producing terrain — fly them in while zoomed
      let grant = null;
      if (state.phase === 'setup') {
        const b = state.players.find((p) => p.color === actor).resources, af = r.state.players.find((p) => p.color === actor).resources;
        if (RES.some((x) => (af[x] || 0) > (b[x] || 0))) {
          const items = (state.board.vertices[action.vertex].hexes || []).map((hid) => state.board.hexes[hid]).filter((hx) => hx && RES.includes(hx.terrain)).map((hx) => ({ hx, resource: hx.terrain }));
          grant = { color: actor, items };
          items.forEach((it) => lagIn(actor, it.resource, 1));   // hold each resource; the grant cards tick them up as they land
        }
      }
      cinematicPlace('v', action.vertex, true, grant);
    }
    else if (action.type === 'buildRoad') { justPlaced = { kind: 'e', id: action.edge }; cinematicPlace('e', action.edge, true); }
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
      trade = { a: pt.from, b: action.with, give: pt.give, want: pt.want };
    }
    let mono = null;
    if (action.type === 'playMonopoly') {   // capture who's losing how many BEFORE the swap
      const from = state.players.filter((p) => p.color !== actor)
        .map((p) => ({ color: p.color, n: p.resources[action.resource] })).filter((x) => x.n > 0);
      if (from.length) mono = { res: action.resource, to: actor, from };
    }
    const yop = action.type === 'playYearOfPlenty' ? { to: actor, resources: (action.resources || []) } : null;
    const fromRobber = state.robberHex;
    const preState = state;
    state = r.state;
    announceFromLog(preState.log, state.log);   // dev-card buys/plays -> top announcement (also runs for observers below)
    announceMilestones(preState, state);        // longest road / largest army changing hands
    // a bought dev card: the buyer is told WHAT they drew; everyone else just sees it fly in face-down
    const bought = action.type === 'buyDevCard'
      ? { buyer: actor, card: (state.players.find((p) => p.color === actor).newDevCards.slice(-1)[0]) } : null;
    // fly the thief across — unless I dragged it there myself (the drag was the motion)
    const robberMoved = state.robberHex !== fromRobber && !skipRobberFly;
    if (robberMoved) ui.robberFlying = true;
    // queue the server sync BEFORE afterAction — afterAction can chain a follow-up action
    // (e.g. the auto-steal after the robber moves), and the syncs must persist in that order.
    if (online) NET.syncAction(action, actor);
    // hold card counts behind the transfer flies so the numbers tick with the animation, not before it
    if (steal) { lagOut(steal.victim, steal.res, 1); lagIn(steal.thief, steal.res, 1); }
    if (trade) lagTrade(trade.a, trade.b, trade.give, trade.want);
    if (mono) { const tot = mono.from.reduce((a, f) => a + f.n, 0); mono.from.forEach((f) => lagOut(f.color, mono.res, f.n)); lagIn(mono.to, mono.res, tot); }
    if (yop) yop.resources.forEach((r) => lagIn(yop.to, r, 1));
    afterAction(); render();
    if (robberMoved) showRobberFly(fromRobber, state.robberHex);
    if (steal) showStealFly(steal.victim, steal.thief, steal.res, true);   // I'm the thief -> see the card face-up
    if (trade) showTradeFly(trade.a, trade.b, trade.give, trade.want);   // bank fly fires once from tradeBank()
    if (mono) showMonopolyFly(mono.to, mono.res, mono.from);   // monopolised cards fly in, face-up
    if (yop) showYoPFly(yop.to, yop.resources);                // year-of-plenty cards fly in, face-down
    if (bought) { if (!online || actor === myColor) showDevBought(bought.card); else showDevBuyFly(bought.buyer); }
    return true;
  }
  // is it this device's turn to act? (always true in pass-and-play)
  function isMyTurn() { return !online || (myColor && activeColor() === myColor); }
  function afterAction() {
    ui.mode = 'idle';
    if (state.phase === 'ended') { recordResult(); render(); showVictory(); return; }
    if (ui.spinning) return;   // who-goes-first spinner playing — don't render over it / prompt yet
    // Hold off on prompts while an animation plays: the dice reveal, or one player's
    // discard fly. Each animation's end re-runs afterAction to advance the sequence —
    // so the 7 reveal finishes before discards, and discards happen one at a time.
    if (ui.diceRevealing || ui.discardAnimating || ui.robberFlying) { render(); return; }
    // discards are over -> drop the "X is discarding" status on every screen (roller + watchers),
    // otherwise it covers the board and nobody can move the robber.
    if (ui.discardWait && state.turnPhase !== 'discard') { ui.discardWait = false; hideOverlay(); }
    // discards happen sequentially in turn order; promptDiscards picks who's up
    if (state.turnPhase === 'discard') { promptDiscards(); return; }
    if (!isMyTurn()) { render(); return; }   // online: spectating another player's turn
    // start of turn: if you hold a playable Knight you may play it BEFORE rolling, so ask;
    // otherwise the dice roll automatically (no manual roll).
    if (state.phase === 'play' && state.turnPhase === 'roll') {
      const me = activePlayer();
      if (!state.hasPlayedDevCardThisTurn && me.devCards.includes('knight')) {
        if (ui.knightDismissed) showRollPrompt();
        else if (!$('overlay').classList.contains('qmode')) showKnightQuestion();
        return;
      }
      doAutoRoll();
      return;
    }
    if (state.turnPhase === 'moveRobber') { ui.mode = 'moveRobber'; toast('Drag the robber onto a hex'); return; }
    if (state.turnPhase === 'steal') { promptSteal(); return; }
    if (state.turnPhase === 'placeRoad' && state.phase === 'play') { ui.mode = 'placeRoad'; return; }
    if (state.phase === 'setup') ui.mode = state.turnPhase === 'placeRoad' ? 'placeRoad' : 'placeSettlement';
  }

  // auto-roll the dice (the default start-of-turn action) with the big reveal animation
  function doAutoRoll() {
    ui.knightDismissed = false; hideRollPrompt();
    setTimeout(() => {
      if (state.turnPhase === 'roll' && isMyTurn()) {
        ui.diceRevealing = true;          // suppress the corner dice during the reveal
        dispatch({ type: 'rollDice' });
        showDiceReveal(state.dice);
      }
    }, 350);
  }
  // the "play the knight first, or roll?" question (matches the original)
  function showKnightQuestion() {
    hideRollPrompt();
    const o = $('overlay');
    o.innerHTML = `<div class="qdlg">
      <div class="qbanner">Question</div>
      <div class="qbody">
        <p class="qtext">You have a Knight Card. Do you want to play it or roll the dice?</p>
        <button class="qbtn" onclick="CATAN.qKnight()">Play Knight Card</button>
        <button class="qbtn" onclick="CATAN.qRoll()">Throw the dice</button>
        <button class="qbtn" onclick="CATAN.qMap()">Show game map</button>
      </div></div>`;
    o.classList.remove('hidden', 'menu', 'devmode', 'trademode');
    o.classList.add('qmode');
    document.body.classList.remove('trading');
    $('radialtab').classList.add('hidden');   // no left-arrow tab behind the question
  }
  // during "Show game map" the right-edge radial tab becomes an X that returns to the question
  function showRollPrompt() { const e = $('radialtab'); if (e) { e.classList.remove('hidden'); e.classList.add('xback'); } }
  function hideRollPrompt() { const e = $('radialtab'); if (e) e.classList.remove('xback'); }

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
    boardHalfW = (Math.max(...xs) - Math.min(...xs)) / 2; boardHalfH = (Math.max(...ys) - Math.min(...ys)) / 2;
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
      // badge sits just off the coast at the MIDPOINT between the two coastal points,
      // pushed straight out along the port edge's perpendicular bisector so the two
      // bridges are exactly equal length. PORT_OUT controls how far off the coast it
      // sits (smaller = closer to the island).
      const PORT_OUT = 0.5;
      const mx0 = b ? (v.x + b.x) / 2 : v.x, my0 = b ? (v.y + b.y) / 2 : v.y;
      let nx, ny;
      if (b) {                                  // perpendicular to the edge (v -> b)
        nx = -(b.y - v.y); ny = (b.x - v.x);
        const nl = Math.hypot(nx, ny) || 1; nx /= nl; ny /= nl;
        if (nx * (mx0 - cx0) + ny * (my0 - cy0) < 0) { nx = -nx; ny = -ny; }  // point seaward
      } else {                                  // lone-vertex port: push radially outward
        const dl = Math.hypot(mx0 - cx0, my0 - cy0) || 1; nx = (mx0 - cx0) / dl; ny = (my0 - cy0) / dl;
      }
      const bx = mx0 + nx * PORT_OUT, by = my0 + ny * PORT_OUT;
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
    // hide the resting robber while a dragged move awaits the ✓/✗ (the tentative one shows instead)
    if (!ui.robberFlying && !ui.robberDragging && !(ui.confirm && ui.confirm.dragged)) {
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

    // interactive targets — translucent ghost markers (like the original game),
    // each paired with an invisible hit target so transparent pixels still click.
    const color = activeColor();
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
      // a gentle gold "pick me up" pulse on the robber instead of the old dark targets over every hex
      const rb = state.board.hexes[state.robberHex];
      P.push(`<circle cx="${rb.cx}" cy="${rb.cy - 0.08}" r="0.46" fill="none" stroke="#f5d57a" stroke-width="0.06" opacity="0.8"><animate attributeName="r" values="0.42;0.6;0.42" dur="1.5s" repeatCount="indefinite"/><animate attributeName="opacity" values="0.3;0.9;0.3" dur="1.5s" repeatCount="indefinite"/></circle>`);
      for (const hx of state.board.hexes) {
        if (hx.id === state.robberHex) continue;
        P.push(`<circle class="hit" data-kind="hex" data-id="${hx.id}" cx="${hx.cx}" cy="${hx.cy}" r="0.5" fill="#fff" fill-opacity="0"/>`);   // invisible tap target — no dark overlay
      }
    }

    // tentative ROAD preview renders UNDER the buildings — a road never covers a settlement, even
    // mid-placement. (The tentative settlement/city + robber stay on top, in the confirm block below.)
    if (ui.confirm && ui.confirm.action.type === 'buildRoad') {
      const col = ui.confirm.color, [a, b] = state.board.edges[ui.confirm.action.edge].v;
      const ax = vX(a), ay = vY(a), bx = vX(b), by = vY(b);
      const mx = (ax + bx) / 2, my = (ay + by) / 2;
      const len = Math.hypot(bx - ax, by - ay), ang = Math.atan2(by - ay, bx - ax) * 180 / Math.PI;
      P.push(`<line x1="${ax}" y1="${ay}" x2="${bx}" y2="${by}" stroke="${PCOLOR[col]}" stroke-width="0.34" stroke-linecap="round"><animate attributeName="opacity" values="0.35;0.85;0.35" dur="1s" repeatCount="indefinite"/></line>`);
      if (ASSETS.roads && ASSETS.roads[col]) { const rw = len * 1.06, rh = len * 0.42; P.push(`<g transform="rotate(${ang} ${mx} ${my})"><image href="${ASSETS.roads[col]}" x="${mx - rw / 2}" y="${my - rh / 2}" width="${rw}" height="${rh}" preserveAspectRatio="xMidYMid meet" filter="url(#soft)"/></g>`); }
    }

    // buildings — drawn LAST (on top of the placement ghosts) so a settlement is never hidden by
    // the road ghosts, which in setup fan out from the settlement you just placed. Uses the ripped
    // art; the SVG shapes are a fallback when no piece asset exists.
    // when stealing from a hex with several opponents, the victims' buildings blink and
    // you pick by tapping one (the map stays visible instead of a covering prompt)
    const stealMode = state.turnPhase === 'steal' && (state.stealCandidates || []).length > 1;
    const robberVerts = stealMode ? new Set(state.board.hexes[state.robberHex].vertices) : null;
    for (const [id, b] of Object.entries(state.settlements)) {
      const x = vX(Number(id)), y = vY(Number(id)), c = PCOLOR[b.owner], s = PSTROKE[b.owner];
      const art = ASSETS.pieces && ASSETS.pieces[b.type] && ASSETS.pieces[b.type][b.owner];
      const bpop = (justPlaced && justPlaced.kind === 'v' && justPlaced.id === Number(id)) ? ' popin' : '';
      const target = stealMode && robberVerts.has(Number(id)) && state.stealCandidates.includes(b.owner);
      const cls = bpop + (target ? ' blink' : '');
      if (art) {
        P.push(`<image class="piece${cls}" href="${art}" x="${x - 0.32}" y="${y - 0.42}" width="0.64" height="0.72" preserveAspectRatio="xMidYMid meet"/>`);
      } else if (b.type === 'city') {
        P.push(`<g class="${target ? 'blink' : ''}" filter="url(#soft)"><rect x="${x - 0.28}" y="${y - 0.16}" width="0.56" height="0.4" rx="0.05" fill="${c}" stroke="${s}" stroke-width="0.05"/><polygon points="${x - 0.28},${y - 0.16} ${x},${y - 0.34} ${x + 0.06},${y - 0.34} ${x + 0.06},${y - 0.05} ${x + 0.28},${y - 0.05} ${x + 0.28},${y - 0.16}" fill="${c}" stroke="${s}" stroke-width="0.04"/><rect x="${x - 0.18}" y="${y + 0.02}" width="0.12" height="0.14" fill="${s}"/></g>`);
      } else {
        P.push(`<g class="${target ? 'blink' : ''}" filter="url(#soft)"><polygon points="${x},${y - 0.3} ${x + 0.22},${y - 0.08} ${x + 0.22},${y + 0.22} ${x - 0.22},${y + 0.22} ${x - 0.22},${y - 0.08}" fill="${c}" stroke="${s}" stroke-width="0.05"/></g>`);
      }
      if (target) P.push(`<circle class="hit" data-kind="steal" data-id="${b.owner}" cx="${x}" cy="${y}" r="0.4" fill="#fff" fill-opacity="0"/>`);
    }

    // settlement/city placement ghosts on TOP of the buildings, so a city-upgrade marker over an
    // existing settlement is visible + tappable; the city highlight pulses to draw the eye.
    if (ui.mode === 'placeSettlement' || ui.mode === 'placeCity') {
      const isCity = ui.mode === 'placeCity';
      const src = isCity ? GHOST.city : GHOST.settlement;
      const list = isCity ? legalCityVertices(color) : legalSettlementVertices(color);
      for (const id of list) {
        const x = vX(id), y = vY(id);
        P.push(`<image class="ghost${isCity ? ' blink' : ''}" href="${src}" x="${x - 0.27}" y="${y - 0.4}" width="0.54" height="0.58" preserveAspectRatio="xMidYMid meet"/>`);
        P.push(`<circle class="hit" data-kind="vertex" data-id="${id}" cx="${x}" cy="${y}" r="0.36" fill="#fff" fill-opacity="0"/>`);
      }
    }

    // tentative settlement/city/robber awaiting confirmation — on top (the road preview is above, under the buildings)
    if (ui.confirm && ui.confirm.action.type !== 'buildRoad') {
      const act = ui.confirm.action, col = ui.confirm.color;
      if (act.type === 'moveRobber') {
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
    // Scope this to the board SVG: an SVG <style> applies to the WHOLE document, and a bare
    // `.ghost` rule was silently killing every `.btn.ghost` (Switch player, Change PIN, Back
    // to players, …) the moment a board existed in the DOM.
    return `<svg id="${id}" viewBox="${minx} ${miny} ${w} ${h}" preserveAspectRatio="xMidYMid meet"><style>#${id} .ghost{pointer-events:none}</style>${P.join('')}</svg>`;
  }

  function onBoardClick(e) {
    if (zoom.swallowClick) { zoom.swallowClick = false; return; }  // a pan/pinch/double-tap, not a tap-to-place
    if (online && !isMyTurn()) return;                            // only the active player touches the board online
    const t = e.target.closest('.hit'); if (!t) return;
    const kind = t.getAttribute('data-kind');
    // steal: tapping a blinking victim building steals from that player immediately
    if (kind === 'steal') { ui.mode = 'idle'; dispatch({ type: 'steal', victim: t.getAttribute('data-id') }, activeColor()); return; }
    const id = Number(t.getAttribute('data-id')), color = activeColor();
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
      // the drop is tentative — confirm with the ✓ / ✗ (no fly on ✓; you dragged it there)
      ui.confirm = { action: { type: 'moveRobber', hex }, color: activeColor(), dragged: true };
      render();
    } else {
      render();   // dropped off-board or on the same hex -> cancel, robber stays put
    }
  }

  // ---- panels --------------------------------------------------------------
  // seats in clockwise screen order so turns visibly progress clockwise
  const SEATS = ['tl', 'tr', 'br', 'bl'];
  // Egocentric seating (like physical Catan): each device sees ITS OWN player bottom-left, and the
  // rest in turn order around the table. Relative position (0 = me) -> corner, per player count.
  const ROT_ORDER = { 2: ['bl', 'tr'], 3: ['bl', 'tl', 'tr'], 4: ['bl', 'tl', 'tr', 'br'] };
  function seatKey(i) {
    const n = (state && state.players) ? state.players.length : 0;
    const myIdx = (online && myColor && state && state.players) ? state.players.findIndex((p) => p.color === myColor) : -1;
    if (myIdx >= 0 && ROT_ORDER[n]) return ROT_ORDER[n][(i - myIdx + n) % n];
    return SEATS[i];   // offline pass-and-play / spectator: original fixed layout
  }
  // is a seated player currently connected? (their id is in lobby presence — grace-inclusive so a
  // brief background blip doesn't flicker them offline). No id (offline/hotseat) -> treat as present.
  function seatPlayerId(color) { const s = (gameSeats || []).find((x) => x && x.color === color); return s ? s.playerId : null; }
  function isPlayerOnline(color) { const id = seatPlayerId(color); if (!id) return true; return LOBBY.liveIds.has(id) || !!LOBBY.presence[id]; }
  function renderPanels() {
    state.players.forEach((p, i) => {
      const el = $('p-' + seatKey(i)); el.style.display = 'flex';
      // during the who-goes-first spinner, no corner shows .active (it would pre-reveal the result)
      el.className = 'corner ' + seatKey(i) + (!ui.spinning && p.color === activeColor() ? ' active' : '');
      // tint the panel with the player's colour
      const pc = PCOLOR[p.color];
      el.style.background = `linear-gradient(${hexA(pc, 0.92)}, ${hexA(pc, 0.62)}), var(--wood-tex)`;
      el.style.backgroundSize = 'cover';
      // you see your OWN victory-point cards in your star total; opponents stay public (VP cards are secret).
      // online -> your seat; offline pass-and-play -> whoever's turn it is sees their own.
      const vp = C.victoryPoints(state, p.color, online ? p.color === myColor : p.color === activeColor());
      const cards = RES.reduce((n, r) => n + p.resources[r], 0) - lagTot(p.color) + outTot(p.color);   // total walks with the card animation
      const dev = p.devCards.length + p.newDevCards.length;
      const road = C.longestRoadLength(state, p.color);
      const bdg = (HUD.badge) || {};
      // one stacked stat = real icon + count (emoji fallback); highlight when this
      // player holds Longest Road / Largest Army.
      const stat = (src, val, emoji, title, hot, red) =>
        `<div class="pstat${hot ? ' hot' : ''}${red ? ' over' : ''}" title="${title}">${src ? `<img src="${src}" alt="">` : emoji}<b>${val}</b></div>`;
      const avSrc = seatAvatarSrc(p, i);
      const av = avSrc ? `<img src="${avSrc}" alt="" onerror="this.outerHTML='${escapeHtml(p.name[0] || '?')}'">` : escapeHtml(p.name[0] || '?');
      const flagged = !!(state.sv && state.sv.flags && state.sv.flags.indexOf(p.color) >= 0);   // raised the white flag
      // dice appear at the active player's corner once they've rolled this turn
      const di = (!ui.diceRevealing && p.color === activeColor() && state.dice && state.phase === 'play')
        ? `<div class="pdice">${diceFaces(state.dice)}</div>` : '';
      // offerer's view: each responder's trade answer rides on their portrait (✓ / ✗ / ? counter / …).
      // Tap an accepted or countered one to review terms + confirm; a declined one isn't tappable.
      let tbadge = '';
      const ptr = state.pendingTrade;
      if (online && myColor && ptr && ptr.from === myColor && p.color !== myColor) {
        const acc = ptr.acceptedBy.includes(p.color), dec = ptr.declinedBy.includes(p.color), ctr = ptr.counters && ptr.counters[p.color];
        const cls = ctr ? 'counter' : (acc ? 'acc' : (dec ? 'dec' : 'wait'));
        const ico = ctr ? '?' : (acc ? '✓' : (dec ? '✗' : '…'));
        const tap = (acc || ctr) ? ` onclick="CATAN.tradeViewResponse('${p.color}')"` : '';
        tbadge = `<div class="tbadge ${cls}"${tap}>${ico}</div>`;
      }
      // your OWN corner gets a 💬 bubble to open quick chat (online seated players only)
      const chatBtn = (online && myColor && p.color === myColor) ? `<button class="pchat" onclick="CATAN.openQuickChat()" aria-label="Quick chat">💬</button>` : '';
      // unread dot: a new message from another player, not yet reviewed (tap their portrait to see it)
      const dot = (online && p.color !== myColor && UNREAD[p.color]) ? `<span class="pmsgdot"></span>` : '';
      // tap any online player's portrait to review their recent messages
      const tap = online ? ` onclick="CATAN.showMsgs('${p.color}')"` : '';
      // online/offline status dot on the portrait (online games only) — greys out if they left the app
      const off = online && !isPlayerOnline(p.color);
      const statusDot = online ? `<span class="pstatus ${off ? 'off' : 'on'}" title="${off ? 'Offline' : 'Online'}"></span>` : '';
      el.innerHTML = `${di}${tbadge}${chatBtn}${dot}
        <div class="pcol">${stat(bdg.res, cards, '🃏', 'Resource cards', false, cards > 7)}${stat(bdg.card, dev, '🎴', 'Development cards')}${stat(bdg.vp, vp, '⭐', 'Victory points')}${stat(bdg.army, p.playedKnights, '⚔️', 'Knights played', p.hasLargestArmy)}${stat(bdg.road, road, '🛣️', 'Longest road', p.hasLongestRoad)}</div>
        <div class="pport"${tap}><div class="pava${flagged ? ' flagged' : ''}${off ? ' offline' : ''}" style="border-color:${PCOLOR[p.color]}">${av}${statusDot}</div><div class="pname">${escapeHtml(p.name)}</div></div>${flagged ? '<span class="pflag">🏳️</span>' : ''}`;
    });
    const usedSeats = {}; state.players.forEach((_, i) => { usedSeats[seatKey(i)] = 1; });
    ['tl', 'tr', 'br', 'bl'].forEach((k) => { if (!usedSeats[k]) { const el = $('p-' + k); if (el) el.style.display = 'none'; } });
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
    // spectator: no hand of their own -> tap any player to inspect that player's resources.
    // Defaults to following whoever's up; the active player's chip carries a turn ring.
    if (online && !myColor) {
      const ap = activePlayer();
      const viewColor = (specView && state.players.some((x) => x.color === specView)) ? specView : ap.color;
      const vp = state.players.find((x) => x.color === viewColor) || ap;
      const chips = state.players.map((pl) => {
        const on = pl.color === viewColor, turn = pl.color === ap.color && state.phase !== 'ended';
        return `<button class="specpl${on ? ' on' : ''}${turn ? ' turn' : ''}" onclick="CATAN.specView('${pl.color}')">`
          + `<span class="specdot" style="background:${PCOLOR[pl.color]}"></span>${escapeHtml(pl.name)}</button>`;
      }).join('');
      const orbs = HAND_ORDER.map((r) => resOrb(r, Math.max(0, vp.resources[r]))).join('');
      return `<div class="spechand specview"><span class="speceye">👁</span><div class="specsel">${chips}</div>`
        + `<div class="specorbs">${orbs}</div><button class="specleave" onclick="CATAN.exitGame()">Leave</button></div>`;
    }
    // online: show MY hand; pass-and-play: show the active player's
    const p = (online && myColor) ? state.players.find((x) => x.color === myColor) : activePlayer();
    if (!p) return '';
    // slim, original-style: five resource orbs + counts. Each orb honours the per-resource lag so it
    // ticks up/down exactly as that resource's card animates, instead of jumping ahead of the fly.
    return HAND_ORDER.map((r) => resOrb(r, Math.max(0, p.resources[r] - lagRes(p.color, r) + outRes(p.color, r)))).join('');
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
      setTimeout(step, aDur(900));
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
    const hi = (idx) => { for (let k = 0; k < n; k++) { const el = $('p-' + seatKey(k)); if (el) el.classList.toggle('spin-on', k === idx); } };
    const clear = () => { for (let k = 0; k < n; k++) { const el = $('p-' + seatKey(k)); if (el) el.classList.remove('spin-on', 'spin-win'); } };
    function tick() {
      hi(step % n); playSound('click', 0.35); step++;
      if (step >= steps) {
        const el = $('p-' + seatKey(ti)); if (el) { el.classList.remove('spin-on'); el.classList.add('spin-win'); }
        playSound('win', 0.7); toast(state.players[ti].name + ' goes first!');   // fanfare on landing
        setTimeout(() => { clear(); ui.spinning = false; if (done) done(); }, aDur(1500));
        return;
      }
      const remaining = steps - step;
      const interval = remaining > n + 1 ? 85 : 85 + (n + 1 - remaining) * 75;   // ease-out near the end
      setTimeout(tick, interval * aScale());
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
    const seatEl = $('p-' + seatKey(pi));
    void el.offsetWidth;  // reflow so the next transition animates
    const ts = (0.55 * aScale()).toFixed(2), os = (0.4 * aScale()).toFixed(2), od = (0.2 * aScale()).toFixed(2);
    setTimeout(() => {
      const r = seatEl.getBoundingClientRect();
      el.style.transition = `left ${ts}s cubic-bezier(.4,0,.5,1), top ${ts}s cubic-bezier(.4,0,.5,1), transform ${ts}s ease, opacity ${os}s ease ${od}s`;
      el.style.left = (r.left + r.width / 2) + 'px';
      el.style.top = (r.top + r.height / 2) + 'px';
      el.style.transform = 'translate(-50%,-50%) scale(0.42)'; el.style.opacity = '0';
    }, aDur(700));
    setTimeout(() => {
      el.classList.add('hidden'); ui.diceRevealing = false;
      // hold each player's card count at the OLD value; every incoming card ticks it up as it lands
      const pm = productionMap(); ui.lag = {}; ui.out = {};
      for (const e of pm) lagIn(e.color, e.resource, e.count);
      renderCounts(); cinematicRoll(); afterAction(); render();
    }, aDur(1300));
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
    img.src = src;
    if (opts.w) img.style.width = opts.w + 'px'; if (opts.h) img.style.height = opts.h + 'px';
    const sc = aScale(), d = delay * sc, dur = (0.95 * sc).toFixed(2);
    const hits = () => {
      if (opts.sound) setTimeout(() => playSound(opts.sound, opts.vol), d);
      if (opts.onlift) setTimeout(opts.onlift, d + 60);                     // card leaves its source
      if (opts.onland) setTimeout(opts.onland, d + Math.round(880 * sc));   // ~when it reaches the panel
    };
    if (opts.arc) {
      // robber: a wrapper carries the point-to-point travel as ONE eased motion (accelerate once,
      // decelerate once — no midpoint stall), while the inner img adds the lift + size hop on top.
      const wrap = document.createElement('div');
      wrap.className = 'flywrap';
      wrap.style.left = (sx - hw) + 'px'; wrap.style.top = (sy - hh) + 'px';
      wrap.style.setProperty('--dx', (tx - sx).toFixed(1) + 'px');
      wrap.style.setProperty('--dy', (ty - sy).toFixed(1) + 'px');
      wrap.style.animation = `robbertravel ${dur}s ${Math.round(d)}ms cubic-bezier(.4,.1,.3,1) both`;
      img.style.animation = `robberhop ${dur}s ${Math.round(d)}ms ease-in-out both`;
      wrap.appendChild(img); document.body.appendChild(wrap);
      hits();
      setTimeout(() => wrap.remove(), d + 1050 * sc);
      return;
    }
    img.className = 'flyres' + (opts.card ? ' fcard' : '');
    img.style.left = (sx - hw) + 'px'; img.style.top = (sy - hh) + 'px';
    img.style.setProperty('--dx', (tx - sx).toFixed(1) + 'px');
    img.style.setProperty('--dy', (ty - sy).toFixed(1) + 'px');
    img.style.animation = `flyto ${dur}s ${Math.round(d)}ms ease both`;
    document.body.appendChild(img);
    hits();
    setTimeout(() => img.remove(), d + 1050 * sc);
  }
  function flyResource(res, sx, sy, tx, ty, delay, onland, onlift) {
    flyImage((HUD.res && HUD.res[res]) || (ASSETS.icons && ASSETS.icons[res]), sx, sy, tx, ty, delay, { sound: 'res_' + res, vol: 0.45, onland, onlift });
  }
  // Per-resource card lag. Displayed count = true − cards still flying IN + cards still flying OUT, so the
  // number walks with the animation: an arriving card ticks the receiver up as it LANDS, a departing card
  // ticks the giver down as it LIFTS. Tracked per (colour,resource) so your OWN hand orbs move one at a
  // time in step with each fly — not just the opponents' total. Set at detection (before the render) so
  // the count never flashes the new value first.
  function lagIn(color, res, n) { if (n > 0) { ui.lag = ui.lag || {}; (ui.lag[color] = ui.lag[color] || {})[res] = (ui.lag[color][res] || 0) + n; } }
  function lagOut(color, res, n) { if (n > 0) { ui.out = ui.out || {}; (ui.out[color] = ui.out[color] || {})[res] = (ui.out[color][res] || 0) + n; } }
  function landCard(color, res) { const m = ui.lag && ui.lag[color]; if (m && m[res] > 0) { m[res]--; renderCounts(); } }
  function liftCard(color, res) { const m = ui.out && ui.out[color]; if (m && m[res] > 0) { m[res]--; renderCounts(); } }
  function clearLag() { const had = (ui.lag && Object.keys(ui.lag).length) || (ui.out && Object.keys(ui.out).length); ui.lag = {}; ui.out = {}; if (had) renderCounts(); }
  function lagTrade(a, b, give, want) { RES.forEach((r) => { lagOut(a, r, give[r] || 0); lagIn(b, r, give[r] || 0); lagIn(a, r, want[r] || 0); lagOut(b, r, want[r] || 0); }); }
  function lagRes(color, res) { return (ui.lag && ui.lag[color] && ui.lag[color][res]) || 0; }
  function outRes(color, res) { return (ui.out && ui.out[color] && ui.out[color][res]) || 0; }
  function sumMap(m) { let t = 0; if (m) for (const k in m) t += m[k]; return t; }
  function lagTot(color) { return sumMap(ui.lag && ui.lag[color]); }
  function outTot(color) { return sumMap(ui.out && ui.out[color]); }
  // repaint both the corner totals AND your own per-resource hand orbs (a card just landed/lifted)
  function renderCounts() { renderPanels(); const h = $('hand'); if (h) h.innerHTML = handBar(); }
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
    const finish = () => { ui.robberFlying = false; afterAction(); render(); };
    const a = hexScreenXY(fromHex, -0.08), b = hexScreenXY(toHex, -0.08);
    if (!ASSETS.robber || !a || !b) { finish(); return; }
    const w = 0.84 * a.scale, h = 0.95 * a.scale;   // match the on-board robber size
    // everyone sees the robber lift off its hex, arc across the board, and land on the new one
    flyImage(ASSETS.robber, a.x, a.y, b.x, b.y, 0, { w, h, arc: true });
    setTimeout(finish, aDur(1000));   // the arc animates ~0.95s, then the real piece settles at the new hex
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
      const panel = $('p-' + seatKey(pi)); if (!panel) continue;
      const r = panel.getBoundingClientRect();
      const tx = r.left + r.width / 2, ty = r.top + r.height / 2;
      for (const e of map) {
        if (e.color !== color) continue;
        for (let k = 0; k < e.count; k++) {
          const pt = svg.createSVGPoint(); pt.x = e.hx.cx; pt.y = e.hx.cy;   // start dead-centre of the terrain
          const s = pt.matrixTransform(ctm);
          flyResource(e.resource, s.x, s.y, tx, ty, delay, () => landCard(color, e.resource));
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
    const panel = $('p-' + seatKey(pi));
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
        for (let k = 0; k < (sel[res] || 0); k++) { flyResource(res, sx, sy, tx, ty, delay, null, () => liftCard(color, res)); delay += STAGGER; }
      }
    }
    setTimeout(() => { ui.discardAnimating = false; afterAction(); render(); }, aDur(delay + 1050));
  }
  // a stolen card flies FACE-DOWN from the victim's corner to the thief's corner
  // (the resource is kept secret — only that something was taken is shown)
  // the buyer's reveal: a "Development Card / X Card bought." dialog (matches the original)
  function showDevBought(card) {
    const o = $('overlay');
    o.innerHTML = `<div class="qdlg">
      <div class="qbanner">Development Card</div>
      <div class="qbody">
        <p class="qtext">${DEV_TITLE[card] || 'Development'} Card bought.</p>
        <button class="devboughtok" onclick="CATAN.devBoughtOk()"><img src="assets/hud/confirm.png" alt="OK"></button>
      </div></div>`;
    o.classList.remove('hidden', 'menu', 'devmode', 'trademode');
    o.classList.add('qmode');
    document.body.classList.remove('trading');
    $('radialtab').classList.add('hidden');   // no left-arrow tab behind the dialog
  }
  // everyone else: a face-down dev card flies from the deck (island centre) to the buyer
  function showDevBuyFly(buyerColor) {
    const pi = state.players.findIndex((p) => p.color === buyerColor);
    const panel = $('p-' + seatKey(pi)); if (!panel) return;
    const r = panel.getBoundingClientRect();
    const px = r.left + r.width / 2, py = r.top + r.height / 2;
    const svg = $('board');
    const br = svg ? svg.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
    playSound('buy', 0.5);
    flyImage('assets/hud/dev-back.png', cx, cy, px, py, 0, { card: true, w: 42, h: 58 });
  }
  // year of plenty: the 2 taken cards fly FACE-DOWN from the island centre into your panel
  function showYoPFly(color, resources) {
    const pi = state.players.findIndex((p) => p.color === color);
    const panel = $('p-' + seatKey(pi)); if (!panel) return;
    const r = panel.getBoundingClientRect();
    const px = r.left + r.width / 2, py = r.top + r.height / 2;
    const svg = $('board');
    const br = svg ? svg.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
    playSound('trade', 0.5);
    let d = 0;
    (resources || []).forEach((r2) => { flyImage('assets/hud/cardback.png', cx, cy, px, py, d, { card: true, onland: () => landCard(color, r2) }); d += 170; });
  }
  // monopoly: the taken cards fly FACE-UP from every other player's panel into yours
  function showMonopolyFly(toColor, res, from) {
    const ti = state.players.findIndex((p) => p.color === toColor);
    const tp = $('p-' + seatKey(ti)); if (!tp) return;
    const tr = tp.getBoundingClientRect();
    const tx = tr.left + tr.width / 2, ty = tr.top + tr.height / 2;
    const resImg = (HUD.res && HUD.res[res]) || (ASSETS.icons && ASSETS.icons[res]);
    playSound('trade', 0.5);
    let d = 0;
    for (const f of from) {
      const fi = state.players.findIndex((p) => p.color === f.color);
      const fp = $('p-' + seatKey(fi)); if (!fp) continue;
      const fr = fp.getBoundingClientRect();
      const fx = fr.left + fr.width / 2, fy = fr.top + fr.height / 2;
      for (let i = 0; i < f.n; i++) { flyImage(resImg, fx, fy, tx, ty, d, { onlift: () => liftCard(f.color, res), onland: () => landCard(toColor, res) }); d += 110; }
    }
  }
  // The card flies victim -> thief. Pass `res` to show it FACE-UP (the thief and the victim
  // know what changed hands); omit it and a face-down cardback flies (everyone else just sees
  // "a card moved from player X"), mirroring real Catan where the steal is secret to the table.
  function showStealFly(victimColor, thiefColor, res, reveal) {
    const vi = state.players.findIndex((p) => p.color === victimColor);
    const ti = state.players.findIndex((p) => p.color === thiefColor);
    const vp = $('p-' + seatKey(vi)), tp = $('p-' + seatKey(ti));
    if (!vp || !tp) return;
    const vr = vp.getBoundingClientRect(), tr = tp.getBoundingClientRect();
    // reveal (thief/victim) shows the card face-up; everyone else sees a face-down cardback. The count
    // callbacks always use the real `res` (state is shared) so both corners + the hand tick correctly.
    const img = (reveal && res && ((HUD.res || {})[res] || (ASSETS.icons || {})[res])) || 'assets/hud/cardback.png';
    flyImage(img, vr.left + vr.width / 2, vr.top + vr.height / 2,
      tr.left + tr.width / 2, tr.top + tr.height / 2, 0, { card: true, sound: 'whoosh', vol: 0.55, onlift: () => liftCard(victimColor, res), onland: () => landCard(thiefColor, res) });
  }
  function sumObj(o) { return RES.reduce((n, r) => n + ((o && o[r]) || 0), 0); }
  // a completed trade: face-down cards fly BOTH ways between the two traders at once
  function showTradeFly(aColor, bColor, giveObj, wantObj) {
    const ia = state.players.findIndex((p) => p.color === aColor);
    const ib = state.players.findIndex((p) => p.color === bColor);
    if (ia < 0 || ib < 0) return;
    const ea = $('p-' + seatKey(ia)), eb = $('p-' + seatKey(ib));
    if (!ea || !eb) return;
    const ra = ea.getBoundingClientRect(), rb = eb.getBoundingClientRect();
    const ax = ra.left + ra.width / 2, ay = ra.top + ra.height / 2, bx = rb.left + rb.width / 2, by = rb.top + rb.height / 2;
    const STAG = 210;
    playSound('trade', 0.5);
    // face-down cardbacks (the swap is secret to the table) but each carries its real resource in the
    // count callbacks, so a -> b cards tick a down / b up per-resource, then b -> a comes back.
    let d = 0;
    RES.forEach((r) => { for (let i = 0; i < ((giveObj && giveObj[r]) || 0); i++) { flyImage('assets/hud/cardback.png', ax, ay, bx, by, d, { card: true, onlift: () => liftCard(aColor, r), onland: () => landCard(bColor, r) }); d += STAG; } });
    d += 340;   // brief pause, THEN the return cards come back (sequential, not simultaneous)
    RES.forEach((r) => { for (let i = 0; i < ((wantObj && wantObj[r]) || 0); i++) { flyImage('assets/hud/cardback.png', bx, by, ax, ay, d, { card: true, onlift: () => liftCard(bColor, r), onland: () => landCard(aColor, r) }); d += STAG; } });
  }
  // a bank/port trade: the given resources fly to the bank (board centre), then one
  // comes back. Face-up, since a bank trade is open (your own cards at a known ratio).
  function showBankFly(color, giveObj, wantObj, covered) {
    const pi = state.players.findIndex((p) => p.color === color);
    const panel = $('p-' + seatKey(pi)); if (!panel) return;
    const r = panel.getBoundingClientRect();
    const px = r.left + r.width / 2, py = r.top + r.height / 2;
    const svg = $('board');
    const br = svg ? svg.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
    const cx = br.left + br.width / 2, cy = br.top + br.height / 2;
    const res = HUD.res || {}, ic = ASSETS.icons || {};
    // observers (covered) see face-down cards so the resource type stays secret; the trader sees them face-up
    const img = (rr) => covered ? 'assets/hud/cardback.png' : (res[rr] || ic[rr]);
    const opt = covered ? { card: true } : {};
    const STAG = 120;
    playSound('trade', 0.5);
    let d = 0;
    RES.forEach((rr) => { for (let i = 0; i < (giveObj[rr] || 0); i++) { flyImage(img(rr), px, py, cx, cy, d, Object.assign({}, opt, { onlift: () => liftCard(color, rr) })); d += STAG; } });
    d += 340;   // all the given cards reach the bank, then your received cards come back
    RES.forEach((rr) => { for (let i = 0; i < (wantObj[rr] || 0); i++) { flyImage(img(rr), cx, cy, px, py, d, Object.assign({}, opt, { onland: () => landCard(color, rr) })); d += STAG; } });
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
    return acc ? { a: pt.from, b: acc, give: pt.give, want: pt.want } : null;
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
  // a robber steal, inferred from a remote state change: the player on the move gained exactly
  // one card (net) and a single opponent lost that same card. Trades net to zero, rolls/year-of-
  // plenty draw from the bank (no loser), monopoly moves many — so this pattern is steal-specific.
  function detectSteal(a, s) {
    if (!a) return null;
    const tot = (p) => RES.reduce((n, x) => n + (p.resources[x] || 0), 0);
    const thief = s.order[s.currentPlayerIndex];
    const ta = a.players.find((p) => p.color === thief), ts = s.players.find((p) => p.color === thief);
    if (!ta || !ts || tot(ts) !== tot(ta) + 1) return null;
    const res = RES.find((x) => (ts.resources[x] || 0) === (ta.resources[x] || 0) + 1);
    if (!res) return null;
    const v = a.players.find((pa) => {
      if (pa.color === thief) return false;
      const ps = s.players.find((p) => p.color === pa.color);
      return ps && tot(ps) === tot(pa) - 1 && (ps.resources[res] || 0) === (pa.resources[res] || 0) - 1;
    });
    return v ? { victim: v.color, thief, res } : null;
  }
  // a dev-card purchase, inferred from a remote state change: a player's dev-card count grew by
  // one (you only ever gain dev cards by buying; playing one removes it, end-of-turn just moves
  // new->playable with no net change). Everyone but the buyer sees a face-down card fly in.
  function detectDevBuy(a, s) {
    if (!a) return null;
    const n = (p) => p.devCards.length + p.newDevCards.length;
    for (const ps of s.players) {
      const pa = a.players.find((p) => p.color === ps.color);
      if (pa && n(ps) === n(pa) + 1) return { buyer: ps.color };
    }
    return null;
  }
  // a bank/port trade, inferred from a remote state change: exactly one player's resources
  // changed AND they both gave some and got some (a build is pure loss; a roll/year-of-plenty
  // pure gain; a steal/player-trade moves two players' cards). Reconstruct give/want from the diff.
  function detectBankTrade(a, s) {
    if (!a) return null;
    let who = null;
    for (const ps of s.players) {
      const pa = a.players.find((p) => p.color === ps.color);
      if (!pa) continue;
      if (RES.some((r) => (pa.resources[r] || 0) !== (ps.resources[r] || 0))) { if (who) return null; who = { pa, ps }; }
    }
    if (!who) return null;
    const give = {}, want = {}; let gaveAny = false, gotAny = false;
    RES.forEach((r) => {
      const d = (who.pa.resources[r] || 0) - (who.ps.resources[r] || 0);
      if (d > 0) { give[r] = d; gaveAny = true; } else if (d < 0) { want[r] = -d; gotAny = true; }
    });
    return (gaveAny && gotAny) ? { color: who.ps.color, give, want } : null;
  }
  // a new/upgraded building or a new road, from a remote state change — for the pop-in + camera on observers
  function detectPlacement(a, s) {
    if (!a) return null;
    for (const id in s.settlements) {
      if (!a.settlements[id] || a.settlements[id].type !== s.settlements[id].type) return { kind: 'v', id: Number(id) };
    }
    for (const id in s.roads) { if (!a.roads[id]) return { kind: 'e', id: Number(id) }; }
    return null;
  }
  function watchingTag() {   // "👁 N" shown to everyone in an online game when people are spectating
    if (!online) return '';
    const n = LOBBY.spectators().length;
    return n ? ` <span class="watchtag">👁 ${n}</span>` : '';
  }
  function banner() {
    if (state.phase === 'ended') return `🏆 ${escapeHtml(state.players.find((p) => p.color === state.winner).name)} wins!${watchingTag()}`;
    // a game event just happened -> show it here (it reverts to the turn indicator when the feed clears)
    if (announceCur) return `<span class="bevent">${escapeHtml(announceCur)}</span>${watchingTag()}`;
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
  function showOverlay(html) { const o = $('overlay'); o.innerHTML = `<div class="sheet">${html}</div>`; o.classList.remove('hidden', 'menu', 'devmode', 'trademode', 'qmode'); document.body.classList.remove('trading'); const rr = $('radialroot'); rr.classList.remove('open'); rr.classList.add('hidden'); $('radialtab').classList.add('hidden'); $('settingstab').classList.add('hidden'); }
  function showFullMenu(html) { const o = $('overlay'); o.innerHTML = html; o.classList.remove('hidden', 'devmode', 'trademode', 'qmode'); o.classList.add('menu'); document.body.classList.remove('trading'); }
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
  function hideOverlay() { const o = $('overlay'); o.classList.add('hidden'); o.classList.remove('menu', 'devmode', 'trademode', 'qmode'); document.body.classList.remove('trading'); o.innerHTML = ''; o.onclick = null; }
  // discard order: starting from the player AFTER the roller, around the table,
  // with the roller last (matches the original app).
  function discardOrder() {
    const n = state.players.length, ri = state.currentPlayerIndex;
    return state.players.map((p, i) => ({ p, k: ((i - ri - 1 + n) % n) })).sort((a, b) => a.k - b.k).map((x) => x.p);
  }
  function currentDiscarder() { return discardOrder().find((p) => (state.pendingDiscards[p.color] || 0) > 0); }
  function promptDiscards() {
    const cur = currentDiscarder();
    if (!cur) { ui.discardWait = false; render(); return; }   // everyone has discarded — afterAction moves on to the robber
    if (!online || cur.color === myColor) {
      ui.discardWait = false;
      ui.pending = { color: cur.color, need: state.pendingDiscards[cur.color], sel: { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 } };
      renderDiscard();
    } else {
      // online: only the current discarder is prompted; everyone else waits and watches
      ui.discardWait = true;
      showOverlay(`<h3>Discarding</h3><p class="muted" style="text-align:center;margin:10px 0"><b style="color:var(--gold)">${escapeHtml(cur.name)}</b> is discarding…</p>`);
    }
  }
  // discard (after a 7) — trade-style sheet: SWIPE a resource up into its slot to discard
  // it; the ✓ appears once you've discarded exactly the required number.
  function renderDiscard() {
    const { color, need, sel } = ui.pending;
    const p = state.players.find((x) => x.color === color);
    const res = HUD.res || {}, tr = HUD.trade || {};
    const total = RES.reduce((n, r) => n + sel[r], 0);
    const cols = HAND_ORDER.map((r) => {
      const hold = p.resources[r], d = sel[r];
      return `<div class="tcol" data-r="${r}">
        <div class="tslot give${d ? ' filled' : ''}${hold === 0 ? ' noarrow' : ''}">
          <img class="ahint" src="${tr.give || ''}" alt=""><img class="rimg" src="${res[r] || ''}" alt=""><span class="sct">${d || ''}</span></div>
        <div class="tmid"><img src="${res[r] || ''}" alt=""><span class="tcount">${hold - d}</span></div>
      </div>`;
    }).join('');
    showFullMenu(`<div class="traderoot discard">
      <div class="ttitle2">${escapeHtml(p.name)} — discard ${Math.max(0, need - total)}</div>
      <div class="tradesheet">
        <div class="tgrid">${cols}</div>
      </div>
      <button class="tconfirm${total === need ? '' : ' hidden'}" onclick="CATAN.discSubmit()"><img src="assets/hud/confirm.png" alt="Confirm"></button>
    </div>`);
    $('overlay').classList.add('trademode');
    document.body.classList.add('trading');
    setTimeout(attachDiscardSwipe, 0);
  }
  // swipe up = discard one (down = undo); updates this column + the title + ✓ in place
  function discardStep(r, dir) {
    const s = ui.pending, p = state.players.find((x) => x.color === s.color);
    const total = RES.reduce((n, x) => n + s.sel[x], 0);
    if (dir > 0) { if (s.sel[r] >= p.resources[r] || total >= s.need) return; s.sel[r]++; }
    else { if (s.sel[r] <= 0) return; s.sel[r]--; }
    playSound('buy', 0.5);   // a card slid into / out of a slot (sfx_button_down)
    const col = document.querySelector('.traderoot.discard .tcol[data-r="' + r + '"]');
    if (!col) { renderDiscard(); return; }
    const d = s.sel[r], slot = col.querySelector('.tslot.give');
    slot.classList.toggle('filled', !!d); slot.querySelector('.sct').textContent = d || '';
    col.querySelector('.tmid .tcount').textContent = p.resources[r] - d;
    const newTotal = RES.reduce((n, x) => n + s.sel[x], 0);
    const ttl = document.querySelector('.ttitle2'); if (ttl) ttl.textContent = `${p.name} — discard ${Math.max(0, s.need - newTotal)}`;
    const cf = document.querySelector('.tconfirm'); if (cf) cf.classList.toggle('hidden', newTotal !== s.need);
  }
  function attachDiscardSwipe() {
    document.querySelectorAll('.traderoot.discard .tcol').forEach((col) => {
      const r = col.dataset.r; let sy = 0, drag = false;
      col.addEventListener('pointerdown', (e) => { drag = true; sy = e.clientY; try { col.setPointerCapture(e.pointerId); } catch (_) {} });
      col.addEventListener('pointerup', (e) => {
        if (!drag) return; drag = false;
        const dy = sy - (e.clientY || sy);
        if (dy > 16) discardStep(r, 1);
        else if (dy < -16) discardStep(r, -1);
        else if (e.target.closest('.tslot')) discardStep(r, 1);
      });
      col.addEventListener('pointercancel', () => { drag = false; });
    });
  }
  function promptSteal() {
    const cands = state.stealCandidates;
    if (cands.length === 1) { dispatch({ type: 'steal', victim: cands[0] }, activeColor()); return; }
    // several opponents on the hex: keep the island visible and blink their buildings;
    // the active player taps one to steal (handled as data-kind="steal" in onBoardClick)
    ui.mode = 'steal'; hideOverlay();
    if (isMyTurn()) toast('Tap a glowing building to steal from that player');
    render();
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
  const DEV_TITLE = { knight: 'Knight', year_of_plenty: 'Year of Plenty', road_building: 'Road Building', monopoly: 'Monopoly', victory_point: 'Victory Point' };
  const DEV_RULES = {
    knight: 'When you play this Card, you move the Robber and steal a Resource from the owner of an adjacent Settlement or City.',
    year_of_plenty: 'When you play this Card, you can select 2 Resources of your choice from the bank.',
    road_building: 'When you play this Card, you can build 2 Roads free of charge.',
    monopoly: 'When you play this Card, announce 1 type of Resource. All other players must give you their entire supply of that Resource type.',
    victory_point: 'You obtain an extra Victory Point with this Card, which will remain invisible to the other players until the end of the game.',
  };
  // full-screen development-cards carousel (matches the original app)
  function openDev() {
    const p = activePlayer(), res = HUD.res || {}, face = HUD.devFace || {}, art = HUD.devArt || {};
    const ORDER = ['knight', 'year_of_plenty', 'road_building', 'monopoly', 'victory_point'];
    const played = state.hasPlayedDevCardThisTurn;
    const cnt = (list) => list.reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
    const owned = cnt(p.devCards), fresh = cnt(p.newDevCards);

    // Buy card first — owned-coloured when you can afford it
    const COSTD = { ore: 1, wheat: 1, sheep: 1 };
    const canBuy = RES.every((r) => (p.resources[r] || 0) >= (COSTD[r] || 0)) && state.devDeck.length > 0;
    const costRow = (c) => RES.filter((r) => c[r]).map((r) => `<span class="ci"><img src="${res[r] || ''}">${c[r]}</span>`).join('');
    let cards = `<div class="devcard2 buy${canBuy ? ' act' : ' dim'}" data-act="${canBuy ? 'buy' : ''}" style="background-image:url('${face.buy || ''}')" onclick="CATAN.devTap('${canBuy ? 'buy' : ''}')">
      ${canBuy && art.buy ? `<img class="dcolor" src="${art.buy}" alt="">` : ''}
      <div class="dtext">Buy Development Card</div>
      <div class="dcost2">${costRow(COSTD)}</div>
      <div class="dremain2">Dev. Cards remaining: ${state.devDeck.length}</div></div>`;

    // every card type, always shown; owned -> colour art overlay, count in the corner
    for (const c of ORDER) {
      const n = (owned[c] || 0) + (fresh[c] || 0);
      // a card you could play this turn (ignoring the once-per-turn rule). Still tappable
      // when the play is blocked (already played one / just bought it), so the tap can
      // EXPLAIN the rule rather than do nothing.
      const tappable = c !== 'victory_point' && n > 0;
      const tap = tappable ? `play:${c}` : '';
      cards += `<div class="devcard2${n > 0 ? '' : ' dim'}${tappable ? ' act' : ''}" data-act="${tap}" style="background-image:url('${face[c] || ''}')" onclick="CATAN.devTap('${tap}')">
        ${n > 0 && art[c] ? `<img class="dcolor" src="${art[c]}" alt="">` : ''}
        <div class="dtitle">${DEV_TITLE[c]}</div>
        <div class="dtext">${DEV_RULES[c]}</div>
        <div class="dcount">${n}</div></div>`;
    }

    showFullMenu(`<div class="devfull">
      <div class="devstrip" id="devstrip" onscroll="CATAN.devFocus()">${cards}</div>
      <button class="devnav left" onclick="CATAN.devScroll(-1)"><i></i></button>
      <button class="devnav right" onclick="CATAN.devScroll(1)"><i></i></button>
      <div class="devbar">${handBar()}</div>
      <button class="devclose" onclick="CATAN.close()"><img src="assets/hud/decline.png" alt="Close"></button>
      <button class="devok hidden" id="devok" data-act="" onclick="CATAN.devOk()"><img src="assets/hud/confirm.png" alt="Confirm"></button>
    </div>`);
    $('overlay').classList.add('devmode');
    setTimeout(devFocus, 40);
  }
  // find the most-centred card; mark it focused and surface the ✓ if it's actionable
  function devFocus() {
    const strip = $('devstrip'); if (!strip) return;
    const mid = strip.scrollLeft + strip.clientWidth / 2;
    let best = null, bestD = 1e9;
    const cards = strip.querySelectorAll('.devcard2');
    cards.forEach((el) => { const c = el.offsetLeft + el.offsetWidth / 2, d = Math.abs(c - mid); if (d < bestD) { bestD = d; best = el; } });
    cards.forEach((el) => el.classList.toggle('focused', el === best));
    const ok = $('devok'); if (!ok) return;
    const act = best ? best.dataset.act : '';
    ok.dataset.act = act || '';
    ok.classList.toggle('hidden', !act);
  }
  // play-confirmation panel ("Would you like to play this Development Card now?")
  function devConfirm(c) {
    const full = document.querySelector('.devfull'); if (!full || $('devconfirm')) return;
    const panel = document.createElement('div');
    panel.className = 'devconfirm'; panel.id = 'devconfirm';
    panel.innerHTML = `<div class="dcpanel">
      <div class="dcbanner">${DEV_TITLE[c]}</div>
      <div class="dcq">Would you like to play this Development Card now?</div>
      <button class="dcbtn no" onclick="CATAN.devCancelPlay()"><img src="assets/hud/decline.png" alt="No"></button>
      <button class="dcbtn yes" onclick="CATAN.dev('${c}')"><img src="assets/hud/confirm.png" alt="Yes"></button>
    </div>`;
    full.appendChild(panel);
  }
  function devAct(act) {
    if (!act) return;
    if (act === 'buy') { window.CATAN.buyDev(); }      // dispatch shows the "X Card bought." reveal
    else if (act.indexOf('play:') === 0) {
      const c = act.slice(5);
      if (state.hasPlayedDevCardThisTurn) { toast('You can only play one development card per turn'); return; }
      if (activePlayer().devCards.indexOf(c) < 0) { toast('You can’t play a development card the turn you buy it'); return; }
      devConfirm(c);
    }
  }
  // Year of Plenty — same trade/discard-style sheet, but you SWIPE 2 resources DOWN into
  // their slots to take them from the bank (the receive direction); ✓ once you've picked 2.
  function openYoP() { ui.yop = {}; renderYoP(); }
  function renderYoP() {
    const sel = ui.yop, p = activePlayer(), res = HUD.res || {}, tr = HUD.trade || {};
    const total = RES.reduce((n, r) => n + (sel[r] || 0), 0);
    const cols = HAND_ORDER.map((r) => {
      const hold = p.resources[r], d = sel[r] || 0, canTake = state.bank[r] > 0;
      return `<div class="tcol" data-r="${r}">
        <div class="tmid"><img src="${res[r] || ''}" alt=""><span class="tcount">${hold + d}</span></div>
        <div class="tslot want${d ? ' filled' : ''}${canTake ? '' : ' noarrow'}">
          <img class="ahint" src="${tr.get || ''}" alt=""><img class="rimg" src="${res[r] || ''}" alt=""><span class="sct">${d || ''}</span></div>
      </div>`;
    }).join('');
    showFullMenu(`<div class="traderoot discard">
      <div class="ttitle2">Year of Plenty — take ${Math.max(0, 2 - total)}</div>
      <div class="tradesheet"><div class="tgrid">${cols}</div></div>
      <button class="tconfirm${total === 2 ? '' : ' hidden'}" onclick="CATAN.yopSubmit()"><img src="assets/hud/confirm.png" alt="Confirm"></button>
    </div>`);
    $('overlay').classList.add('trademode');
    document.body.classList.add('trading');
    setTimeout(attachYoPSwipe, 0);
  }
  function yopStep(r, dir) {
    const sel = ui.yop, p = activePlayer();
    const total = RES.reduce((n, x) => n + (sel[x] || 0), 0);
    if (dir > 0) { if ((sel[r] || 0) >= state.bank[r] || total >= 2) return; sel[r] = (sel[r] || 0) + 1; }
    else { if ((sel[r] || 0) <= 0) return; sel[r]--; }
    playSound('buy', 0.5);   // a card slid into / out of a slot (sfx_button_down)
    const col = document.querySelector('.traderoot .tcol[data-r="' + r + '"]');
    if (!col) { renderYoP(); return; }
    const d = sel[r] || 0, slot = col.querySelector('.tslot.want');
    slot.classList.toggle('filled', !!d); slot.querySelector('.sct').textContent = d || '';
    col.querySelector('.tmid .tcount').textContent = p.resources[r] + d;
    const newTotal = RES.reduce((n, x) => n + (sel[x] || 0), 0);
    const ttl = document.querySelector('.ttitle2'); if (ttl) ttl.textContent = `Year of Plenty — take ${Math.max(0, 2 - newTotal)}`;
    const cf = document.querySelector('.tconfirm'); if (cf) cf.classList.toggle('hidden', newTotal !== 2);
  }
  function attachYoPSwipe() {
    document.querySelectorAll('.traderoot .tcol').forEach((col) => {
      const r = col.dataset.r; let sy = 0, drag = false;
      col.addEventListener('pointerdown', (e) => { drag = true; sy = e.clientY; try { col.setPointerCapture(e.pointerId); } catch (_) {} });
      col.addEventListener('pointerup', (e) => {
        if (!drag) return; drag = false;
        const dy = sy - (e.clientY || sy);
        if (dy < -16) yopStep(r, 1);          // swipe DOWN = take one from the bank
        else if (dy > 16) yopStep(r, -1);     // swipe UP = put it back
        else if (e.target.closest('.tslot')) yopStep(r, 1);
      });
      col.addEventListener('pointercancel', () => { drag = false; });
    });
  }
  function openMonopoly() {
    showOverlay(`<h3>Monopoly</h3><div class="grid">${RES.map((r) => `<button class="btn wood" onclick="CATAN.mono('${r}')">${resIc(r)} ${r}</button>`).join('')}</div><button class="btn ghost full" onclick="CATAN.close()">Cancel</button>`);
  }
  // per-device settings (music / sfx / animation speed / auto-zoom). Toggles persist here;
  // each setting's actual effect is wired separately.
  function openSettings() {
    const sw = (key) => `<button class="swtch${SETTINGS[key] ? ' on' : ''}" role="switch" aria-checked="${!!SETTINGS[key]}" onclick="CATAN.setToggle('${key}')"><span class="knob"></span></button>`;
    const toggle = (key, label) => `<div class="setrow"><span class="setlbl">${label}</span>${sw(key)}</div>`;
    const speeds = [['slow', 'Slow'], ['medium', 'Medium'], ['fast', 'Fast']];
    const seg = `<div class="setrow"><span class="setlbl">Animation speed</span>
      <div class="setseg">${speeds.map(([v, t]) => `<button class="${SETTINGS.anim === v ? 'on' : ''}" onclick="CATAN.setAnim('${v}')">${t}</button>`).join('')}</div></div>`;
    // music row carries the on/off toggle plus ‹ track › navigation when it's on
    const musicRow = `<div class="setrow"><span class="setlbl">Music</span>
      <div class="setctl">${SETTINGS.music ? `<button class="trknav" onclick="CATAN.musicPrev()" aria-label="Previous track">‹</button><span class="trknum">${musicIdx + 1}/${MUSIC.length}</span><button class="trknav" onclick="CATAN.musicNext()" aria-label="Next track">›</button>` : ''}${sw('music')}</div></div>`;
    showOverlay(`<div class="settingsmenu">
      <h3>Settings</h3>
      ${musicRow}
      ${toggle('sfx', 'Sound effects')}
      ${seg}
      ${toggle('autozoom', 'Auto-zoom')}
      <button class="btn full" onclick="CATAN.close()">Done</button>
    </div>`);
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
    ui.trade = { mode: 'players', actor: activeColor(), give: zeroRes(), want: zeroRes() };
    ui.tradeView = 'builder';
    renderTradeBuilder();
  }
  function zeroRes() { return { brick: 0, wood: 0, sheep: 0, wheat: 0, ore: 0 }; }
  // the player driving the swipe sheet: the offerer in the builder, or the responder in the counter sheet
  function tActorColor() { return (ui.trade && ui.trade.actor) || activeColor(); }
  function tActorPlayer() { return state.players.find((p) => p.color === tActorColor()) || activePlayer(); }
  function tBankMode() { return ui.trade && ui.trade.mode === 'bank'; }
  // a single signed "net" per resource: >0 = you give (bank: in ratio bundles), <0 = you want
  function tNetOf(r) { const t = ui.trade; if (t.give[r]) return tBankMode() ? Math.round(t.give[r] / bankRatio(tActorColor(), r)) : t.give[r]; if (t.want[r]) return -t.want[r]; return 0; }
  function tSetNet(r, net) {
    const t = ui.trade, hold = tActorPlayer().resources[r];
    if (tBankMode()) {
      const ratio = bankRatio(tActorColor(), r), maxGive = Math.floor(hold / ratio), cap = state.bank[r];
      net = Math.max(-cap, Math.min(maxGive, net));
      t.give[r] = net > 0 ? net * ratio : 0; t.want[r] = net < 0 ? -net : 0;
    } else {
      // give capped by the actor's hand; receive capped by the counterparty (the offerer in a counter, else the bank)
      let recvCap = state.bank[r];
      if (t.mode === 'respond') { const from = state.players.find((p) => p.color === t.offerFrom); recvCap = from ? (from.resources[r] || 0) : 0; }
      net = Math.max(-recvCap, Math.min(hold, net));
      t.give[r] = Math.max(0, net); t.want[r] = Math.max(0, -net);
    }
  }
  function tradeValid() {
    const t = ui.trade, color = tActorColor();
    if (tBankMode()) {
      const credits = RES.reduce((n, r) => n + t.give[r] / bankRatio(color, r), 0);
      const wantTot = RES.reduce((n, r) => n + t.want[r], 0);
      return credits >= 1 && credits === wantTot;
    }
    const gt = RES.reduce((n, r) => n + t.give[r], 0), wt = RES.reduce((n, r) => n + t.want[r], 0);
    return gt > 0 && wt > 0;
  }
  function tradeRespondMode() { return !!(ui.trade && ui.trade.mode === 'respond'); }
  function tradeRespValid() {   // the responder must give and receive something, and be able to pay what they give
    const me = tActorPlayer(), t = ui.trade;
    return RES.some((r) => t.give[r]) && RES.some((r) => t.want[r]) && RES.every((r) => (me.resources[r] || 0) >= (t.give[r] || 0));
  }
  // one give/want placeholder slot. BOTH the arrow hint and the resource icon are always
  // in the DOM; the `filled` class shows/hides them via CSS. So a swipe never creates or
  // destroys any element (no image reload / flash) — it only flips a class + a number.
  function tradeSlotHTML(r, n, kind) {
    const res = HUD.res || {}, tr = HUD.trade || {};
    return `<div class="tslot ${kind}${n ? ' filled' : ''}">
      <img class="ahint" src="${(kind === 'give' ? tr.give : tr.get) || ''}" alt="">
      <img class="rimg" src="${res[r] || ''}" alt="">
      <span class="sct">${n || ''}</span></div>`;
  }
  // a single step (swipe/tap): flip the `filled` class + set the count on this column's
  // two slots, and toggle the ✓ — nothing else in the DOM is touched, so the board, the
  // targets and every other resource stay perfectly still.
  function tradeStep(r, dir) {
    const before = tNetOf(r);
    tSetNet(r, before + dir);
    if (tNetOf(r) !== before) playSound('buy', 0.5);   // a card slid into / out of a slot (sfx_button_down)
    const col = document.querySelector('.traderoot .tcol[data-r="' + r + '"]');
    if (!col) { renderTradeBuilder(); return; }
    const g = ui.trade.give[r], w = ui.trade.want[r];
    const setSlot = (sel, n) => { const s = col.querySelector(sel); if (!s) return; s.classList.toggle('filled', !!n); s.querySelector('.sct').textContent = n || ''; };
    setSlot('.tslot.give', g);
    setSlot('.tslot.want', w);
    // middle count = what you'd hold if this trade goes through (gave some, received some)
    const mid = col.querySelector('.tmid .tcount'); if (mid) mid.textContent = tActorPlayer().resources[r] - g + w;
    const cf = document.querySelector('.tconfirm'); if (cf) cf.classList.toggle('hidden', !tradeRespondMode() ? !tradeValid() : !tradeRespValid());
  }
  // switch Players <-> Bank IN PLACE (don't rebuild the sheet, which would replay the
  // slide-up animation): just retitle, move the highlight, show/hide ratios, clear the offer.
  function tradeSetMode(m) {
    if (ui.trade.mode === m) return;
    ui.trade.mode = m; ui.trade.give = zeroRes(); ui.trade.want = zeroRes();
    const bank = m === 'bank';
    const root = document.querySelector('.traderoot');
    if (!root) { renderTradeBuilder(); return; }
    const title = root.querySelector('.ttitle2'); if (title) title.textContent = bank ? 'Bank' : 'Players';
    root.querySelectorAll('.ttarget').forEach((el) => el.classList.toggle('on', el.classList.contains('chest') ? bank : !bank));
    const sheet = root.querySelector('.tradesheet'); if (sheet) sheet.classList.toggle('bank', bank);
    root.querySelectorAll('.tcol').forEach((col) => {
      col.querySelectorAll('.tslot').forEach((s) => { s.classList.remove('filled'); s.querySelector('.sct').textContent = ''; });
      const mid = col.querySelector('.tmid .tcount'); if (mid) mid.textContent = activePlayer().resources[col.dataset.r];
    });
    const cf = root.querySelector('.tconfirm'); if (cf) cf.classList.toggle('hidden', !tradeValid());
  }
  // trade table (matches the original): targets up top (other players + the bank chest),
  // then a row of resources you SWIPE up to give / down to receive, and a check-mark
  // that appears only when the offer is valid.
  function renderTradeBuilder() {
    const t = ui.trade, p = activePlayer(), color = activeColor(), res = HUD.res || {}, tr = HUD.trade || {};
    const bank = tBankMode();
    const others = state.players.filter((x) => x.color !== color);
    const avatar = (pl) => seatAvatarSrc(pl, state.players.indexOf(pl));
    const targets = others.map((pl) => `<div class="ttarget${bank ? '' : ' on'}" onclick="CATAN.tradeMode('players')">
        <div class="tav" style="border-color:${PCOLOR[pl.color]}"><img src="${avatar(pl)}" alt="" onerror="this.style.display='none'"></div></div>`).join('')
      + `<div class="ttarget chest${bank ? ' on' : ''}" onclick="CATAN.tradeMode('bank')"><img class="tchest" src="${tr.bank || ''}" alt=""></div>`;
    // 3 rows per resource: give placeholder (top) · your hand (middle) · want placeholder (bottom)
    const cols = HAND_ORDER.map((r) => {
      const hold = p.resources[r], ratio = bankRatio(color, r), g = t.give[r], w = t.want[r];
      return `<div class="tcol" data-r="${r}">
        ${tradeSlotHTML(r, g, 'give')}
        <div class="tmid"><img src="${res[r] || ''}" alt=""><span class="tcount">${hold - g + w}</span></div>
        ${tradeSlotHTML(r, w, 'want')}
        <div class="tratio">${ratio}:1</div>
      </div>`;
    }).join('');
    const valid = tradeValid();
    showFullMenu(`<div class="traderoot">
      <div class="ttitle2">${bank ? 'Bank' : 'Players'}</div>
      <div class="tradesheet${bank ? ' bank' : ''}">
        <div class="ttargets">${targets}</div>
        <div class="tgrid">${cols}</div>
      </div>
      <button class="tclose" onclick="CATAN.tradeClose()"><img src="assets/hud/decline.png" alt="Cancel"></button>
      <button class="tconfirm${valid ? '' : ' hidden'}" onclick="CATAN.tradeConfirmTrade()"><img src="assets/hud/confirm.png" alt="Confirm"></button>
    </div>`);
    $('overlay').classList.add('trademode');
    document.body.classList.add('trading');     // hide the in-game HUD so the board shows clean above the sheet
    setTimeout(attachTradeSwipe, 0);
  }
  // each swipe up = give +1, swipe down = want +1 (single increment); slots are tappable too
  function attachTradeSwipe() {
    document.querySelectorAll('.traderoot .tcol').forEach((col) => {
      if (col._swipeOn) return; col._swipeOn = true;   // attach once per element — never stack listeners (each stacked one = an extra +1)
      const r = col.dataset.r; let sy = 0, drag = false;
      col.addEventListener('pointerdown', (e) => { drag = true; sy = e.clientY; try { col.setPointerCapture(e.pointerId); } catch (_) {} });
      col.addEventListener('pointerup', (e) => {
        if (!drag) return; drag = false;
        const dy = sy - (e.clientY || sy);
        if (dy > 16) tradeStep(r, 1);
        else if (dy < -16) tradeStep(r, -1);
        else if (e.target.closest('.tslot.give')) tradeStep(r, 1);
        else if (e.target.closest('.tslot.want')) tradeStep(r, -1);
      });
      col.addEventListener('pointercancel', () => { drag = false; });
    });
  }
  // proposer's view after sending — live reactions + confirm/cancel
  function renderTradeWait(pt) {
    // online: the board stays visible, each responder's answer rides on their corner portrait, and a slim
    // bar carries the offer + New offer / Cancel. Tapping an accepted/countered corner selects it here.
    if (online) { hideOverlay(); ui.tradeView = 'wait'; showTradePrompt(pt); return; }
    // offline hotseat: one device answers as each player -> keep the list
    const others = state.players.filter((p) => p.color !== pt.from);
    const rows = others.map((p) => {
      const acc = pt.acceptedBy.includes(p.color), dec = pt.declinedBy.includes(p.color), ctr = pt.counters && pt.counters[p.color];
      const canPay = RES.every((r) => (p.resources[r] || 0) >= (pt.want[r] || 0));
      let ctrl;
      if (ctr) {   // they countered: confirm on THEIR terms (offerer's frame: give ctr.give, get ctr.want)
        ctrl = `<span class="t-cnt">${offerStr(ctr.give)}<span class="for">→</span>${offerStr(ctr.want)}</span><button class="btn" onclick="CATAN.tradeConfirm('${p.color}')">Trade</button>`;
      } else if (acc) {
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
      <div class="trow2 tfoot"><button class="btn ghost" onclick="CATAN.tradeReoffer()">New offer</button><button class="btn ghost" onclick="CATAN.tradeCancel()">Cancel</button></div>
    </div>`);
  }
  // slim offerer bar (online). Default: the offer + New offer / Cancel. When a responder's corner is
  // tapped (ui.tradeSel), it shows THAT player's terms + a Trade (confirm) button.
  function showTradePrompt(pt) {
    let bar = $('tradeprompt');
    if (!bar) { bar = document.createElement('div'); bar.id = 'tradeprompt'; ($('app') || document.body).appendChild(bar); }
    const sel = ui.tradeSel, ctrSel = sel && pt.counters && pt.counters[sel], accSel = sel && pt.acceptedBy.includes(sel);
    if (sel && !ctrSel && !accSel) ui.tradeSel = null;   // that response is gone (withdrawn) -> back to default
    if (ui.tradeSel && (ctrSel || accSel)) {
      const p = state.players.find((x) => x.color === ui.tradeSel), terms = ctrSel || { give: pt.give, want: pt.want };
      bar.innerHTML = `<div class="tpoffer"><b>${escapeHtml(p.name)}</b> ${ctrSel ? 'counters' : 'accepts'} — you give ${offerStr(terms.give)} <span class="for">for</span> ${offerStr(terms.want)}</div>
        <div class="tpbtns"><button class="btn ghost" onclick="CATAN.tradeViewResponse(null)">Back</button><button class="btn" onclick="CATAN.tradeConfirm('${ui.tradeSel}')">Trade</button></div>`;
    } else {
      const others = state.players.filter((p) => p.color !== pt.from);
      const allDec = others.length > 0 && others.every((p) => pt.declinedBy.includes(p.color));
      bar.innerHTML = `<div class="tpoffer">You give ${offerStr(pt.give)} <span class="for">for</span> ${offerStr(pt.want)}</div>
        <div class="tpmsg">${allDec ? 'Everyone declined.' : 'Tap a ✓ or ? on a corner to trade.'}</div>
        <div class="tpbtns"><button class="btn ghost" onclick="CATAN.tradeReoffer()">New offer</button><button class="btn ghost" onclick="CATAN.tradeCancel()">Cancel</button></div>`;
    }
    bar.style.display = 'flex';
  }
  function hideTradePrompt() { const bar = $('tradeprompt'); if (bar) bar.style.display = 'none'; }
  // responder's view (non-proposer): the offer under the offerer's face + your resources on the same
  // swipe sheet as the builder. Leave it as-is -> Accept; drag any resource -> it becomes a counter.
  function renderTradeRespond(pt, meColor) {
    const from = state.players.find((p) => p.color === pt.from), me = state.players.find((p) => p.color === meColor);
    const iAcc = pt.acceptedBy.includes(meColor), iDec = pt.declinedBy.includes(meColor), myCounter = pt.counters && pt.counters[meColor];
    const canCover = RES.every((r) => (me.resources[r] || 0) >= (pt.want[r] || 0));   // you must be able to give what's asked
    // No sheet when: auto-declining this turn, you can't cover the ask, or you already responded. In the
    // first two cases auto-decline so the offerer isn't left waiting; otherwise just step aside and wait.
    if (ui.autoDeclineIdx === state.currentPlayerIndex || !canCover) {
      if (!iDec && !iAcc && !myCounter) dispatch({ type: 'declineTrade' }, meColor);
      hideOverlay(); return;
    }
    if (iAcc || iDec || myCounter) { hideOverlay(); return; }   // you've responded -> wait for the offerer
    ui.tradeView = 'respond';
    // pre-fill the swipe sheet from the responder's frame: they GIVE the offerer's `want`, RECEIVE the `give`
    const key = pt.from + ':' + JSON.stringify(pt.give) + '|' + JSON.stringify(pt.want);
    if (!ui.trade || ui.trade.mode !== 'respond' || ui.trade.offerKey !== key) {
      ui.trade = { mode: 'respond', actor: meColor, offerFrom: pt.from, offerKey: key,
        give: { ...zeroRes(), ...pt.want }, want: { ...zeroRes(), ...pt.give } };
    }
    if (ui.respondKey === key && $('overlay').querySelector('.traderoot.respond')) { return; }   // sheet already up (same offer) — leave its listeners alone
    ui.respondKey = key;
    const res = HUD.res || {};
    const cols = HAND_ORDER.map((r) => {
      const hold = me.resources[r], g = ui.trade.give[r], w = ui.trade.want[r];
      return `<div class="tcol" data-r="${r}">${tradeSlotHTML(r, g, 'give')}<div class="tmid"><img src="${res[r] || ''}" alt=""><span class="tcount">${hold - g + w}</span></div>${tradeSlotHTML(r, w, 'want')}</div>`;
    }).join('');
    const valid = tradeRespValid();
    const avatar = seatAvatarSrc(from, state.players.indexOf(from));
    showFullMenu(`<div class="traderoot respond">
      <div class="tofferhead">
        <div class="tav" style="border-color:${PCOLOR[pt.from]}"><img src="${avatar}" alt="" onerror="this.style.display='none'"></div>
        <div class="tofferline"><b>${escapeHtml(from.name)}</b> gives ${offerStr(pt.give)} <span class="for">for</span> ${offerStr(pt.want)}</div>
      </div>
      <div class="tradesheet"><div class="tgrid">${cols}</div></div>
      <div class="trespbtns">
        <button class="tautodecline" onclick="CATAN.tradeAutoDecline()" title="Auto-decline every trade this turn"><img class="tadg" src="${(HUD.trade || {}).get || ''}" alt=""><img class="tadv" src="${(HUD.trade || {}).give || ''}" alt=""></button>
        <button class="tclose" onclick="CATAN.tradeRespDecline()"><img src="assets/hud/decline.png" alt="Decline"></button>
      </div>
      <button class="tconfirm${valid ? '' : ' hidden'}" onclick="CATAN.tradeRespSend()"><img src="assets/hud/confirm.png" alt="Send"></button>
    </div>`);
    $('overlay').classList.add('trademode');
    document.body.classList.add('trading');
    setTimeout(attachTradeSwipe, 0);
  }
  // drive the pending-trade overlays off the shared state, on every render
  function syncTradeUI() {
    // "auto-decline this turn" only lasts the offerer's turn — drop it once the turn advances
    if (state && ui.autoDeclineIdx != null && ui.autoDeclineIdx !== state.currentPlayerIndex) ui.autoDeclineIdx = null;
    const pt = state && state.pendingTrade;
    if (!pt) {
      ui.respondKey = null; ui.tradeSel = null; hideTradePrompt();
      if (ui.tradeView === 'wait' || ui.tradeView === 'respond') { ui.tradeView = null; hideOverlay(); }
      return;
    }
    const meColor = online ? myColor : activeColor();
    if (pt.from === meColor) { ui.tradeView = 'wait'; renderTradeWait(pt); }
    else { ui.tradeView = 'respond'; renderTradeRespond(pt, meColor); }
  }

  function showVictory() {
    playSound('win', 0.8);
    STATS.loaded = false;   // a game just ended -> every client refetches stats on the next lobby visit
    const winner = state.players.find((p) => p.color === state.winner);
    const wi = state.players.indexOf(winner);
    const wavSrc = seatAvatarSrc(winner, wi);
    const wav = wavSrc ? `<img src="${wavSrc}" alt="">` : '';
    const rows = state.players
      .map((p) => ({ p, vp: C.victoryPoints(state, p.color, true) }))
      .sort((a, b) => b.vp - a.vp);
    // Domination: the winner held every rival under 10 points (all VP revealed at game end)
    const domination = rows.length > 1 && rows.every((s) => s.p.color === winner.color || s.vp < 10);
    const standings = rows
      .map(({ p, vp }, i) => `<div class="standing${p.color === winner.color ? ' win' : ''}" style="animation-delay:${(0.5 + i * 0.12).toFixed(2)}s"><span class="nm"><span class="dot" style="background:${PCOLOR[p.color]}"></span>${escapeHtml(p.name)}</span><span class="pvp">${vp} VP</span></div>`)
      .join('');
    const crown = `<img class="crown" src="assets/hud/crown.png" alt="">`;
    const domBadge = domination ? `<div class="dombadge">DOMINATION<span>every rival held under 10</span></div>` : '';
    showOverlay(`<div class="winwrap${domination ? ' domination' : ''}">
      <div class="winhead"><div class="winrays"></div>${crown}
        <div class="winava" style="background:${PCOLOR[winner.color]}">${wav}</div></div>
      <h2>${escapeHtml(winner.name)} wins!</h2>
      ${domBadge}
      <div style="margin:12px 0">${standings}</div>
      ${online
        ? `${myColor ? `<button class="btn full" style="margin-bottom:9px" onclick="CATAN.rematch()">🔁 Rematch — same players</button>` : ''}<button class="btn ${myColor ? 'wood ' : ''}full" onclick="CATAN.tableReset()">Back to lobby</button>`
        : `<button class="btn full" onclick="CATAN.restart()">New game</button>`}</div>`);
    spawnConfetti($('overlay'), domination ? 120 : 64);
    if (domination) setTimeout(() => playSound('win', 0.55), 500);   // a second flourish for the blowout
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
  // ---- game-event feed: shows what just happened IN the top banner (in place of "X — your turn"),
  //      reverting to the turn indicator when the queue empties. Driven off the engine's state.log
  //      (+ owner diffs for longest road / largest army), so it fires the same for actor & observers.
  let announceT = null, announceQ = [], announceCur = null;
  function announce(msg) { if (!msg) return; announceQ.push(msg); if (!announceCur) nextAnnounce(); }
  function nextAnnounce() {
    if (!announceQ.length) { announceCur = null; renderBanner(); return; }
    announceCur = announceQ.shift(); renderBanner();
    clearTimeout(announceT); announceT = setTimeout(nextAnnounce, 2400);
  }
  // longest road / largest army aren't in the engine log -> announce them off an owner diff
  function announceMilestones(a, s) {
    if (!a || !s) return;
    const nm = (c) => { const p = (s.players || []).find((x) => x.color === c); return p ? p.name : null; };
    if (s.longestRoadOwner && s.longestRoadOwner !== a.longestRoadOwner) { const n = nm(s.longestRoadOwner); if (n) announce(`${n} now holds the Longest Road 🛣️`); }
    if (s.largestArmyOwner && s.largestArmyOwner !== a.largestArmyOwner) { const n = nm(s.largestArmyOwner); if (n) announce(`${n} now holds the Largest Army ⚔️`); }
  }
  // Map a raw engine log line to a feed message, or null to stay silent (setup, the "7 activates"
  // line, wins — those have their own on-screen feedback).
  function eventMsg(line) {
    if (!line) return null;
    let m;
    if ((m = line.match(/^(.*) rolled (\d+)\.$/))) return `${m[1]} rolled ${m[2]} 🎲`;
    if (/ built a road\.$/.test(line)) return line.replace(/\.$/, ' 🛤️');
    if (/ built a settlement\.$/.test(line)) return line.replace(/\.$/, ' 🏠');
    if (/ upgraded to a city\.$/.test(line)) return line.replace(/ upgraded to a city\.$/, ' built a city 🏛️');
    if (/ bought a development card\.$/.test(line)) return line.replace(/ bought a development card\.$/, ' bought a dev card 🎴');
    if (/ played a knight\.$/.test(line)) return line.replace(/ played a knight\.$/, ' played a Knight ⚔️');
    if (/ played Road Building\.$/.test(line)) return line.replace(/\.$/, ' 🛣️');
    if (/ played Year of Plenty\.$/.test(line)) return line.replace(/\.$/, ' 🌾');
    if ((m = line.match(/^(.*) monopolised (\w+) \(\+(\d+)\)\.$/))) return `${m[1]} played Monopoly — took ${m[3]} ${m[2]} 💰`;
    if ((m = line.match(/^(.*) stole a card from (.+)\.$/))) return `${m[1]} robbed ${m[2]} 🃏`;
    if ((m = line.match(/^(.*) traded with (.+)\.$/))) return `${m[1]} traded with ${m[2]} 🤝`;
    return null;
  }
  function announceFromLog(oldLog, newLog) {
    if (!newLog || !newLog.length) return;
    const start = (oldLog && oldLog.length) ? oldLog.length : 0;
    for (let i = start; i < newLog.length; i++) { const msg = eventMsg(newLog[i]); if (msg) announce(msg); }
  }
  function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }
  // a player's round face: their uploaded photo if any, else their initial on a tinted disc
  function faceHTML(name, dataUrl, extra) {
    const cls = 'face' + (extra ? ' ' + extra : '');
    if (dataUrl) return `<span class="${cls}"><img src="${dataUrl}" alt=""></span>`;
    return `<span class="${cls} init">${escapeHtml((String(name || '?').trim()[0] || '?')).toUpperCase()}</span>`;
  }
  // ---- broadcast messages: quick chat every online player sees -------
  // Default quick-chat presets, used until a player saves their own (managed in-game or from profile).
  const DEFAULT_QUICK_MSGS = ['yalla', 'nice move', 'wtf', 'hek sarit?', 'GG', 'haha'];
  const BC_COOLDOWN = 1500;   // min gap between messages (anti-spam) — replaces the old 3-per-game cap
  let lastBcAt = 0, bctoastT = null;
  function bcReady() { return online && myColor && (Date.now() - lastBcAt >= BC_COOLDOWN); }
  // the quick-chat picker: your presets as one-tap chips + a custom typed message + edit
  function openQuickChat() {
    if (!online || !myColor) return;
    const chips = AUTH.quickList().map((m, i) => `<button class="qcchip" onclick="CATAN.quickSendIdx(${i})">${escapeHtml(m)}</button>`).join('');
    showOverlay(`<h3>Quick chat</h3>
      <div class="qcgrid">${chips}</div>
      <div class="trow2"><button class="btn wood" onclick="CATAN.openCustomMsg()">✏️ Type…</button><button class="btn ghost" onclick="CATAN.manageQuick('game')">⚙️ Edit</button></div>
      <div class="qcdiv"></div>
      <button id="qcmic" class="qcmic">🎤 <span>Tap to record a voice note</span></button>
      <button class="btn ghost full" onclick="CATAN.close()">Close</button>`);
    const o = $('overlay'); if (o) o.onclick = (e) => { if (e.target === o) CATAN.close(); };
    attachMic();
  }
  // Tap to record -> a recording panel with Send / Cancel (robust on iOS; press-and-hold there is
  //   fragile because the button gets replaced mid-hold, so the release never lands).
  let recTicker = null;
  function attachMic() {
    const mic = $('qcmic'); if (!mic) return;
    mic.addEventListener('click', () => { if (!VOICE.recording) startRecUI(); });
  }
  async function startRecUI() {
    const ok = await VOICE.start();
    if (!ok) return;
    const sh = document.querySelector('#overlay .sheet'); if (!sh) return;
    const o = $('overlay'); if (o) o.onclick = null;   // no tap-outside-to-close while recording — use Send/Cancel
    sh.innerHTML = `<div class="vrec"><div class="vrecdot"></div><div class="vrectime" id="vrectime">0:00</div>
      <div class="vrecbtns"><button class="btn" onclick="CATAN.recStop()">⏹ Send</button><button class="btn ghost" onclick="CATAN.recCancel()">Cancel</button></div>
      <div class="vrechint">Recording… tap Send when done (max 10s)</div></div>`;
    if (recTicker) clearInterval(recTicker);
    recTicker = setInterval(() => { const s = Math.min(10, Math.floor((Date.now() - VOICE.startT) / 1000)); const tt = $('vrectime'); if (tt) tt.textContent = '0:' + String(s).padStart(2, '0'); }, 150);
    VOICE.onauto = () => finishRec(false);   // hit 10s -> auto-send
  }
  function finishRec(cancel) {
    if (recTicker) { clearInterval(recTicker); recTicker = null; }
    const rec = VOICE.stop(cancel);
    hideOverlay(); render();
    if (rec) sendVoice(rec);
  }
  function openBroadcast() {
    if (!online || !myColor) return;
    showOverlay(`<h3>Quick message</h3>
      <input id="bcInput" class="authin" maxlength="50" placeholder="Say something…" autocomplete="off">
      <div class="trow2"><button class="btn ghost" onclick="CATAN.close()">Cancel</button><button class="btn" onclick="CATAN.sendBroadcast()">Send</button></div>`);
    const el = $('bcInput'); if (el) el.focus();   // synchronous -> iOS keyboard opens within the tap
  }
  // send a preset chip straight away
  function quickSend(text) {
    hideOverlay(); render();
    sendBroadcastText(text);
  }
  function sendBroadcastMsg() {
    const el = $('bcInput'); const text = (el && el.value || '').trim().slice(0, 50);
    hideOverlay(); render();
    sendBroadcastText(text);
  }
  function sendBroadcastText(text) {
    text = (text || '').trim().slice(0, 50);
    if (!text || !online || !myColor) return;
    if (Date.now() - lastBcAt < BC_COOLDOWN) { toast('Easy — one sec'); return; }
    lastBcAt = Date.now();
    const msg = { name: AUTH.me.name, avatar: AUTH.me.avatar || null, text, table: LOBBY.table || null, code: NET.code || LOBBY.table || null, color: myColor || null };
    LOBBY.sendBroadcast(msg);
    showBroadcast(msg);   // local echo — broadcast doesn't deliver back to the sender
  }
  // ---- voice notes -------------------------------------------------------------------------
  // Recorded via Web Audio (NOT MediaRecorder, whose webm/opus won't play on iOS) and encoded to
  // WAV — universally playable on iOS/Android/desktop. Uploaded to a game-scoped Storage folder,
  // the URL broadcast over the same channel as text, purged when the game ends.
  const VOICE_MAX_MS = 10000, VOICE_RATE = 16000;
  function downsampleTo(buf, inRate, outRate) {
    if (outRate >= inRate) return buf;
    const ratio = inRate / outRate, outLen = Math.round(buf.length / ratio), out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const start = Math.floor(i * ratio), end = Math.min(buf.length, Math.floor((i + 1) * ratio));
      let sum = 0, n = 0; for (let j = start; j < end; j++) { sum += buf[j]; n++; }
      out[i] = n ? sum / n : 0;
    }
    return out;
  }
  function encodeWav(samples, rate) {
    const n = samples.length, ab = new ArrayBuffer(44 + n * 2), v = new DataView(ab);
    const wr = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    wr(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); wr(8, 'WAVE'); wr(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    wr(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44; for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, samples[i])); v.setInt16(o, s < 0 ? s * 0x8000 : s * 0x7fff, true); o += 2; }
    return new Blob([ab], { type: 'audio/wav' });
  }
  const VOICE = {
    ctx: null, stream: null, proc: null, source: null, chunks: [], inRate: 48000, recording: false, startT: 0, timer: null,
    async start() {
      if (this.recording) return false;
      // Create the AudioContext + kick off getUserMedia synchronously (both must run inside the
      // user gesture on iOS), then await them.
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Voice not supported here'); return false; }
      this.ctx = new Ctx();
      const resumeP = this.ctx.resume().catch(() => { });
      let stream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch (e) { try { this.ctx.close(); } catch (_) { } this.ctx = null; toast('Microphone access needed'); return false; }
      await resumeP;
      // iOS often re-suspends the context across the permission prompt — resume again so onaudioprocess fires
      if (this.ctx.state === 'suspended') { try { await this.ctx.resume(); } catch (_) { } }
      this.stream = stream;
      this.inRate = this.ctx.sampleRate; this.source = this.ctx.createMediaStreamSource(stream);
      this.proc = this.ctx.createScriptProcessor(4096, 1, 1); this.chunks = []; this.recording = true; this.startT = Date.now();
      this.proc.onaudioprocess = (e) => { if (this.recording) this.chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      this.source.connect(this.proc); this.proc.connect(this.ctx.destination);
      this.timer = setTimeout(() => { if (VOICE.recording && VOICE.onauto) VOICE.onauto(); }, VOICE_MAX_MS);
      return true;
    },
    _teardown() {
      clearTimeout(this.timer);
      try { this.proc && (this.proc.onaudioprocess = null, this.proc.disconnect()); } catch (_) { }
      try { this.source && this.source.disconnect(); } catch (_) { }
      try { this.stream && this.stream.getTracks().forEach((t) => t.stop()); } catch (_) { }
      try { this.ctx && this.ctx.close(); } catch (_) { }
      this.proc = this.source = this.stream = this.ctx = null;
    },
    stop(cancel) {
      if (!this.recording) return null;
      this.recording = false;
      const dur = Math.min(VOICE_MAX_MS, Date.now() - this.startT), inRate = this.inRate, chunks = this.chunks;
      this.chunks = []; this._teardown();
      if (cancel || dur < 500) return null;   // cancelled or too short -> discard
      let len = 0; chunks.forEach((c) => len += c.length);
      const flat = new Float32Array(len); let o = 0; chunks.forEach((c) => { flat.set(c, o); o += c.length; });
      return { blob: encodeWav(downsampleTo(flat, inRate, VOICE_RATE), VOICE_RATE), dur: Math.max(1, Math.round(dur / 1000)) };
    },
  };
  async function sendVoice(rec) {
    if (!rec || !online || !myColor) return;
    if (Date.now() - lastBcAt < BC_COOLDOWN) { toast('Easy — one sec'); return; }
    lastBcAt = Date.now();
    const c = NET.init(); const code = LOBBY.table || NET.code;
    if (!c || !code) return;
    const path = code + '/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.wav';
    toast('Sending voice…');
    const up = await c.storage.from('voice').upload(path, rec.blob, { contentType: 'audio/wav', upsert: false });
    if (up.error) { toast('Voice failed'); return; }
    const url = c.storage.from('voice').getPublicUrl(path).data.publicUrl;
    const msg = { type: 'voice', url, dur: rec.dur, name: AUTH.me.name, avatar: AUTH.me.avatar || null, table: LOBBY.table || null, code: code || null, color: myColor || null };
    LOBBY.sendBroadcast(msg);
    showBroadcast(msg);   // local echo — sender sees their own note bubble
  }
  // delete all of a game's voice clips (called when the game ends)
  async function purgeVoice(code) {
    if (!code) return; const c = NET.init(); if (!c) return;
    try {
      const { data } = await c.storage.from('voice').list(code, { limit: 200 });
      if (data && data.length) await c.storage.from('voice').remove(data.map((f) => code + '/' + f.name));
    } catch (_) { }
  }
  // best-effort sweep of orphaned clips from games that never cleaned up (throttled, on lobby entry)
  let voiceSweptAt = 0;
  async function sweepOldVoice() {
    const now = Date.now(); if (now - voiceSweptAt < 36e5) return; voiceSweptAt = now;   // at most hourly
    const c = NET.init(); if (!c) return;
    try {
      const { data: folders } = await c.storage.from('voice').list('', { limit: 200 });
      for (const f of (folders || [])) {
        if (f.id) continue;   // a real file at root (shouldn't happen) — skip; folders have id null
        const { data: files } = await c.storage.from('voice').list(f.name, { limit: 200 });
        const stale = (files || []).filter((x) => x.created_at && (now - new Date(x.created_at).getTime()) > 3 * 36e5).map((x) => f.name + '/' + x.name);
        if (stale.length) await c.storage.from('voice').remove(stale);
      }
      // also drop chat rows from games that never cleaned up (older than ~3h)
      await c.from('messages').delete().lt('created_at', new Date(now - 3 * 36e5).toISOString());
    } catch (_) { }
  }
  // ---- per-player message history: the last few messages (text + voice) each player sent this
  //      game, re-openable by tapping their corner portrait. Cleared on game entry (enterGame).
  const MSG_KEEP = 30;   // keep a generous history per player; the popover scrolls
  let MSGLOG = {};   // color -> [{...msg, ts}] (oldest first, capped)
  let UNREAD = {};   // color -> true while a new message hasn't been reviewed (drives the corner dot)
  function clearMsgLog() { MSGLOG = {}; UNREAD = {}; }
  function logMsg(msg) {
    if (!msg || !msg.color) return;
    const arr = (MSGLOG[msg.color] = MSGLOG[msg.color] || []);
    arr.push(Object.assign({ ts: Date.now() }, msg));
    if (arr.length > MSG_KEEP) arr.splice(0, arr.length - MSG_KEEP);
    if (online && state && msg.color !== myColor) { UNREAD[msg.color] = true; renderPanels(); }   // dot for others' new messages
  }
  // relative "sent time" for the history rows (snapshot when the popover opens)
  function relTime(ts) {
    if (!ts) return '';
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 45) return 'just now';
    const m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    return Math.round(m / 60) + ' hr ago';
  }
  // open a small popover of a player's recent messages, anchored to their corner
  function showMsgHistory(color) {
    const old = document.getElementById('msghist'); if (old) old.remove();
    UNREAD[color] = false;
    const log = (MSGLOG[color] || []).slice().reverse();   // newest first
    const seat = state ? state.players.findIndex((p) => p.color === color) : -1;
    const pos = seat >= 0 ? seatKey(seat) : null;
    const corner = pos ? $('p-' + pos) : null;
    const pl = state && state.players.find((p) => p.color === color);
    const rows = log.length ? log.map((m) => { const t = `<span class="mhtime">${relTime(m.ts)}</span>`; return m.type === 'voice'
      ? `<div class="mhrow"><button class="bcplay mhplay" data-url="${escapeHtml(m.url)}">▶</button><span class="mhtxt">🎤 0:${String(m.dur || 1).padStart(2, '0')}</span>${t}</div>`
      : `<div class="mhrow"><span class="mhtxt">${escapeHtml(String(m.text).slice(0, 50))}</span>${t}</div>`; }).join('')
      : `<div class="mhrow muted">No messages yet</div>`;
    const b = document.createElement('div');
    b.id = 'msghist';
    b.innerHTML = `<button class="bcclose" aria-label="Close">×</button><div class="mhhead">${escapeHtml((pl && pl.name) || '')}</div>${rows}`;
    document.body.appendChild(b);
    // anchor near the corner (fall back to centred if no corner, e.g. offline)
    if (corner) {
      const top = pos[0] === 't', left = pos[1] === 'l', cr = corner.getBoundingClientRect(), gap = 8;
      if (top) b.style.top = (cr.bottom + gap) + 'px'; else b.style.bottom = (window.innerHeight - cr.top + gap) + 'px';
      if (left) b.style.left = Math.max(6, cr.left) + 'px'; else b.style.right = Math.max(6, window.innerWidth - cr.right) + 'px';
    } else { b.style.top = '50%'; b.style.left = '50%'; b.style.transform = 'translate(-50%,-50%)'; }
    b.querySelectorAll('.mhplay').forEach((btn) => wireVoicePlay(btn, btn.getAttribute('data-url')));
    const kill = () => { b.remove(); document.removeEventListener('pointerdown', outside, true); };
    const outside = (e) => { if (!b.contains(e.target)) kill(); };
    b.querySelector('.bcclose').onclick = kill;
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);   // tap outside to dismiss
    renderPanels();   // refresh to drop the unread dot
  }
  function showBroadcast(msg) {
    if (!msg || (!msg.text && msg.type !== 'voice')) return;
    logMsg(msg);   // keep it in the per-player history (tap a portrait to review)
    playSound('click', 0.4);
    // anchor a chat bubble to the speaker's corner when we're in the game view; else a banner
    const inGameView = $('title') && $('title').classList.contains('hidden');
    const seat = (inGameView && state && state.players && msg.color) ? state.players.findIndex((p) => p.color === msg.color) : -1;
    const pos = seat >= 0 ? seatKey(seat) : null;   // 'tl' | 'tr' | 'br' | 'bl'
    const corner = pos ? $('p-' + pos) : null;
    if (corner && corner.style.display !== 'none') showBroadcastBubble(msg, corner, pos);
    else showBroadcastBanner(msg);
  }
  // a speech bubble that hangs off the speaker's corner avatar, pointing back at it:
  //   top corners -> below + tail up;  bottom corners -> above + tail down;
  //   tail aligned under the avatar, bubble extending toward screen centre.
  function showBroadcastBubble(msg, corner, pos) {
    const top = pos[0] === 't', left = pos[1] === 'l';
    const cr = corner.getBoundingClientRect();
    const avEl = corner.querySelector('.pavawrap') || corner.querySelector('.pava') || corner;
    const ar = avEl.getBoundingClientRect(), avCx = ar.left + ar.width / 2;
    const id = 'bcb-' + (msg.color || msg.name);
    const old = document.getElementById(id); if (old) old.remove();   // one bubble per speaker
    const b = document.createElement('div');
    b.id = id;
    const isVoice = msg.type === 'voice';
    b.className = 'bcbubble ' + (top ? 'b-top' : 'b-bot') + ' ' + (left ? 'b-left' : 'b-right') + (isVoice ? ' bcvoice' : '');
    b.innerHTML = isVoice
      ? `<button class="bcclose" aria-label="Close">×</button><button class="bcplay" aria-label="Play">▶</button><span class="bctext">🎤 0:${String(msg.dur || 1).padStart(2, '0')}</span>`
      : `<button class="bcclose" aria-label="Close">×</button><span class="bctext">${escapeHtml(String(msg.text).slice(0, 50))}</span>`;
    document.body.appendChild(b);
    const gap = 8, tail = 20;   // tail sits ~20px from the bubble's near edge
    if (top) b.style.top = (cr.bottom + gap) + 'px'; else b.style.bottom = (window.innerHeight - cr.top + gap) + 'px';
    if (left) b.style.left = Math.max(6, avCx - tail) + 'px';
    else b.style.right = Math.max(6, window.innerWidth - avCx - tail) + 'px';
    const kill = () => { b.classList.add('out'); setTimeout(() => b.remove(), 200); };
    const t = setTimeout(kill, isVoice ? 13000 : 7000);   // voice lingers longer so there's time to tap play
    b.querySelector('.bcclose').onclick = () => { clearTimeout(t); b.remove(); };
    if (isVoice) wireVoicePlay(b.querySelector('.bcplay'), msg.url);
    requestAnimationFrame(() => b.classList.add('in'));
  }
  // hook a ▶/⏸ play toggle to a voice clip (preloads so the first tap is snappy)
  function wireVoicePlay(btn, url) {
    if (!btn) return;
    const audio = new Audio(url); audio.preload = 'auto';
    audio.onended = () => { btn.textContent = '▶'; };
    btn.onclick = (e) => {
      e.stopPropagation();
      if (audio.paused) { audio.play().then(() => { btn.textContent = '⏸'; }).catch(() => toast('Playback failed')); }
      else { audio.pause(); btn.textContent = '▶'; }
    };
  }
  // fallback when not in the game view (e.g. sitting in the table lobby): a top banner
  function showBroadcastBanner(msg) {
    const el = $('bctoast'); if (!el) return;
    const isVoice = msg.type === 'voice';
    el.innerHTML = `${faceHTML(msg.name, msg.avatar, 'sm')}<span class="bcname">${escapeHtml(msg.name)}</span>` +
      (isVoice ? `<button class="bcplay" aria-label="Play">▶</button><span class="bctext">🎤 0:${String(msg.dur || 1).padStart(2, '0')}</span>` : `<span class="bctext">${escapeHtml(String(msg.text).slice(0, 50))}</span>`);
    el.classList.add('show');
    if (isVoice) wireVoicePlay(el.querySelector('.bcplay'), msg.url);
    clearTimeout(bctoastT); bctoastT = setTimeout(() => el.classList.remove('show'), isVoice ? 9000 : 5000);
  }
  // ---- manage quick-chat presets (add / edit / delete) — reachable in-game or from Manage Profile.
  //      `qmReturn` remembers where to go on Done; `qmDraft` is the working list (saved on each change).
  let qmReturn = 'game', qmDraft = null;
  function manageQuickMsgs(from) {
    if (!AUTH.me) { showLobby(); return; }
    qmReturn = from || qmReturn;
    if (!qmDraft) qmDraft = AUTH.quickList().slice();
    const rows = qmDraft.length
      ? qmDraft.map((m, i) => `<div class="qmrow"><input class="qmedit authin" maxlength="50" value="${escapeHtml(m)}" oninput="CATAN.quickEdit(${i}, this.value)"><button class="qmdel" onclick="CATAN.quickDel(${i})" aria-label="Delete">✕</button></div>`).join('')
      : `<p class="muted small" style="text-align:center;padding:6px 0">No messages yet — add a few.</p>`;
    const body = `<p class="muted small" style="text-align:center;margin:0 0 8px">Tap to edit. These are your one-tap chat presets.</p>
      <div class="qmlist">${rows}</div>
      <div class="qmadd"><input id="qmNew" class="authin" maxlength="50" placeholder="Add a message…" autocomplete="off"><button class="btn wood" onclick="CATAN.quickAdd()">Add</button></div>`;
    // From the profile (a menu screen at z-40) the overlay (z-30) would be hidden behind it — so render
    // a full menu card there. In-game (title hidden) an overlay is correct.
    if (qmReturn === 'profile') {
      titleCard(`<div class="lobhead"><button class="lobback" onclick="CATAN.manageProfile()" title="Back">←</button><h3>💬 Quick messages</h3></div>
        ${body}<button class="btn full" style="margin-top:12px" onclick="CATAN.quickDone('profile')">Done</button>`);
    } else {
      showOverlay(`<h3>Quick messages</h3>${body}<button class="btn full" style="margin-top:10px" onclick="CATAN.quickDone('game')">Done</button>`);
    }
  }
  function persistQuick() { AUTH.setQuickMsgs(qmDraft).then((r) => { if (r && !r.ok) toast(r.error || 'Save failed'); }); }
  // ---- white flag (concede) — coordinated through the GAME ROW (version-guarded). Each
  //      player raises their own flag whenever they like, and can lower it again while the
  //      game is live. The moment everyone-but-one has a flag up, the lone player still
  //      standing wins. Flags live in state.sv = { flags:[colors] }, replicated to all. ---
  function seatedColors() { return state ? state.players.map((p) => p.color) : []; }
  function leaderColor(s) {
    return s.players.map((p) => ({ c: p.color, vp: C.victoryPoints(s, p.color, true) }))
      .sort((a, b) => b.vp - a.vp)[0].c;
  }
  function flagsOf(s) { return (s && s.sv && s.sv.flags) ? s.sv.flags : []; }
  function iAmFlagged() { return online && myColor && flagsOf(state).indexOf(myColor) >= 0; }
  // version-guarded read-modify-write on the game row (mirrors NET.syncAction).
  async function svUpdate(mutate) {
    const c = NET.init(); if (!c || !NET.code) return;
    for (let i = 0; i < 6; i++) {
      const { data, error } = await c.from('games').select('state,version').eq('code', NET.code).maybeSingle();
      if (error || !data || !data.state) return;
      const s2 = JSON.parse(JSON.stringify(data.state));
      if (mutate(s2) === false) return;
      const phase = s2.phase === 'ended' ? 'ended' : 'playing';
      const { data: upd } = await c.from('games')
        .update({ state: s2, version: data.version + 1, phase }).eq('code', NET.code).eq('version', data.version).select('version');
      if (upd && upd.length) { NET.version = data.version + 1; return; }
      await new Promise((r) => setTimeout(r, 80));
    }
  }
  function raiseFlag() {
    if (!online || !myColor || !state || state.players.length < 2 || iAmFlagged()) return;
    state.sv = state.sv || { flags: [] }; if (!state.sv.flags) state.sv.flags = [];
    state.sv.flags.push(myColor); render();                                  // local echo (my own write comes back deduped)
    svUpdate((s) => { s.sv = s.sv || { flags: [] }; if (!s.sv.flags) s.sv.flags = []; if (s.sv.flags.indexOf(myColor) < 0) s.sv.flags.push(myColor); });
  }
  function lowerFlag() {
    if (state && state.sv && state.sv.flags) { state.sv.flags = state.sv.flags.filter((c) => c !== myColor); if (!state.sv.flags.length) delete state.sv; render(); }
    svUpdate((s) => { if (s.sv && s.sv.flags) { s.sv.flags = s.sv.flags.filter((c) => c !== myColor); if (!s.sv.flags.length) delete s.sv; } });
  }
  // everyone-but-one conceded -> the lone player still standing wins. Single writer = winner.
  let svEndTimer = null;
  function endByFlags(winner) {
    if (ui.svEnding) return; ui.svEnding = true;
    // apply locally too — the winner's own row write echoes back deduped, so otherwise the
    // winner would never see their own victory.
    if (state) { state.winner = winner; state.phase = 'ended'; delete state.sv; recordResult(); render(); showVictory(); }
    svUpdate((s) => { s.winner = winner; s.phase = 'ended'; delete s.sv; });
    if (svEndTimer) clearTimeout(svEndTimer);
    svEndTimer = setTimeout(() => { svEndTimer = null; try { LOBBY.reset(); } catch (_) {} }, 9000);   // brief victory, then back to lobby (a Rematch tap cancels this)
  }
  // a seated player quits mid-game (via Leave -> confirm). The leader among those still in wins;
  // the quitter takes a recorded penalty (a loss). We push the ended state through the game row so
  // every client records it the normal way (dedup-safe), then the quitter leaves the table.
  async function endByQuit() {
    if (!online || !myColor || !state || state.phase !== 'play') return false;
    const others = state.players.filter((p) => p.color !== myColor);
    if (!others.length) return false;   // nobody to hand the win to -> caller falls back to plain abandon
    const winner = others
      .map((p) => ({ c: p.color, vp: C.victoryPoints(state, p.color, true) }))
      .sort((a, b) => b.vp - a.vp)[0].c;
    const q = myColor;
    ui.svEnding = true;
    state.winner = winner; state.phase = 'ended'; state.quitBy = q; delete state.sv;
    recordResult();   // record locally too, so the result lands even if the state push is slow
    await svUpdate((s) => { s.winner = winner; s.phase = 'ended'; s.quitBy = q; delete s.sv; });
    return true;
  }
  // checked from afterAction on every state change: trigger the win when only one stands
  function syncSurrenderUI() {
    if (!online || !myColor || ui.svEnding || !state || !state.sv) return;
    const seats = seatedColors(); if (seats.length < 2) return;
    const flags = flagsOf(state).filter((c) => seats.indexOf(c) >= 0);
    if (flags.length < seats.length - 1) return;                            // more than one still standing
    const standing = seats.filter((c) => flags.indexOf(c) < 0);
    const winner = standing.length ? standing[0] : leaderColor(state);      // all flagged (rare race) -> leader takes it
    if (winner === myColor) endByFlags(winner);
  }
  // toast the table when a white flag goes up or down (diff old vs new shared state)
  function flagToast(a, s) {
    if (!a || !s) return;
    const fa = flagsOf(a), fs = flagsOf(s);
    const nm = (c) => { const p = (s.players || []).find((x) => x.color === c); return p ? p.name : 'A player'; };
    const raised = fs.filter((c) => fa.indexOf(c) < 0), lowered = fa.filter((c) => fs.indexOf(c) < 0);
    if (raised.length) toast('🏳️ ' + raised.map(nm).join(', ') + (raised.length > 1 ? ' want to surrender — raised white flags' : ' wants to surrender — raised the white flag'));
    else if (lowered.length) toast(lowered.map(nm).join(', ') + (lowered.length > 1 ? ' are back in' : ' is back in'));
  }

  let renderedBoardKey = null;
  function render() {
    const tt = $('title');
    if (tt && !tt.classList.contains('hidden')) return;   // a menu/lobby is up -> never paint the board under it
    document.body.classList.add('ingame');   // board is showing -> portrait now forces the rotate gate
    document.body.classList.toggle('spectating', !!(online && !myColor));   // drives the spectator chrome
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
    // Resolve the trade / surrender overlays FIRST: hideTab (below) keys off whether an overlay is
    // open, so a just-completed trade must close its overlay before we decide the radial tab's
    // visibility — otherwise the radial entry point stays hidden after every trade.
    syncTradeUI();      // show/refresh/close the pending-trade overlays off shared state
    syncSurrenderUI();  // show/refresh/close the surrender vote off shared state
    // hide the radial tab during forced, uninterruptible steps (placing the robber, the
    // ✓/✗ confirm, picking a steal victim) and behind any open dialog/menu
    // picking a spot for an OPTIONAL build (Build menu, turnPhase 'main') — not forced placements
    // (setup, road-building card) where there's nothing to cancel. Drives the lone-✗ cancel affordance.
    const placing = state.phase === 'play' && state.turnPhase === 'main'
      && (ui.mode === 'placeSettlement' || ui.mode === 'placeCity' || ui.mode === 'placeRoad');
    const hideTab = !!ui.confirm || placing || ui.mode === 'moveRobber' || ui.mode === 'steal' || !$('overlay').classList.contains('hidden');
    $('radialtab').classList.toggle('hidden', hideTab);
    // the settings gear only appears while the radial menu is open (and rides above it)
    $('settingstab').classList.toggle('hidden', hideTab || !$('radialroot').classList.contains('open'));
    $('radialtab').classList.toggle('pulse', radialPhase && !hideTab);
    // ✓/✗ once a spot is chosen; a lone ✗ while still choosing (so you can back out of the build)
    $('confirmbar').classList.toggle('hidden', !ui.confirm && !placing);
    $('cfm-yes').classList.toggle('hidden', !ui.confirm);
    justPlaced = null;  // pop-in only plays on the render right after placement
    $('leavetab').classList.add('hidden');   // exit lives in the radial menu now
    // the "show game map" roll prompt only belongs in your own pre-roll phase
    if (!(state.phase === 'play' && tp === 'roll' && isMyTurn())) hideRollPrompt();
    startMusic();       // keep the playlist going in-game (no-op if off / already playing)
  }

  // the radial cluster: five actions arranged around a centre close button
  function radialButtons() {
    const R = 72;   // tighter orbit (~20% smaller menu)
    // build/trade/end/dev only on your turn (dice roll automatically); Leave is always here.
    const canAct = state.phase === 'play' && state.turnPhase === 'main' && isMyTurn();
    const exit = { k: 'exit', label: (online && !myColor) ? 'Stop' : 'Leave', emoji: '🚪' };
    const items = (canAct ? [
      { k: 'build', label: 'Build' },
      { k: 'trade', label: 'Trade' },
      { k: 'end', label: 'End turn' },
      exit,
      { k: 'dev', label: 'Cards' },
    ] : [exit]).slice();
    // (quick chat moved out of the radial -> the 💬 bubble on your own corner portrait)
    // spread the items evenly around the circle, first one at the top
    const n = items.length;
    let html = `<button class="radbtn center" onclick="CATAN.closeRadial()"><img src="assets/hud/radial/close.png" alt="close"></button>`;
    items.forEach((it, i) => {
      const a = 90 - i * (360 / n);
      const x = Math.round(R * Math.cos(a * Math.PI / 180));
      const y = Math.round(-R * Math.sin(a * Math.PI / 180));
      const inner = it.emoji ? `<span class="rico">${it.emoji}</span>` : `<img src="assets/hud/radial/${it.k}.png" alt="${it.label}">`;
      const click = it.k === 'exit' ? 'CATAN.exitGame()' : `CATAN.radial('${it.k}')`;
      html += `<button class="radbtn${it.emoji ? ' framed' : ''}" style="--x:${x}px;--y:${y}px" onclick="${click}">${inner}</button>`;
    });
    return html;
  }
  function closeRadial() {
    const r = $('radialroot');
    r.classList.remove('open');
    $('settingstab').classList.add('hidden');   // gear lives with the radial
    setTimeout(() => r.classList.add('hidden'), 180);
  }

  window.CATAN = {
    roll: () => { animateDice = true; dispatch({ type: 'rollDice' }); },
    // start-of-turn "Question" dialog: play the knight first, just roll, or peek at the map
    qKnight: () => { ui.knightDismissed = false; hideRollPrompt(); hideOverlay(); dispatch({ type: 'playKnight' }); },
    qRoll: () => { hideOverlay(); doAutoRoll(); },
    qMap: () => { ui.knightDismissed = true; hideOverlay(); render(); showRollPrompt(); },
    qReopen: () => { ui.knightDismissed = false; hideRollPrompt(); showKnightQuestion(); },
    devBoughtOk: () => { hideOverlay(); render(); },
    endTurn: () => dispatch({ type: 'endTurn' }),
    buyDev: () => dispatch({ type: 'buyDevCard' }),
    playKnight: () => dispatch({ type: 'playKnight' }),
    build: (mode) => { hideOverlay(); ui.mode = mode; ui.confirm = null; render(); if (mode === 'placeCity') toast('Tap a settlement to upgrade'); else if (mode === 'placeSettlement') toast('Tap a highlighted spot'); },
    confirmPlace: () => { const c = ui.confirm; if (!c) return; ui.confirm = null; skipRobberFly = !!c.dragged; dispatch(c.action, c.color); skipRobberFly = false; },
    cancelPlace: () => {
      if (ui.confirm) { ui.confirm = null; render(); }   // a spot was chosen -> back to choosing
      else { ui.mode = 'idle'; render(); }                // still choosing -> abort the build, back to the board
    },
    openDev, openTrade, openMonopoly, openYoP,
    openSettings,
    setToggle: (key) => { SETTINGS[key] = !SETTINGS[key]; saveSettings(); openSettings(); if (key === 'music') { if (SETTINGS.music) startMusic(); else stopMusic(); } },
    musicNext: () => musicSkip(1),
    musicPrev: () => musicSkip(-1),
    setAnim: (v) => { SETTINGS.anim = v; saveSettings(); openSettings(); },
    // radial menu
    openRadial: () => {
      if (ui.knightDismissed) { window.CATAN.qReopen(); return; }   // X tab during Show game map → back to the question
      const r = $('radialroot'); r.classList.remove('hidden'); requestAnimationFrame(() => r.classList.add('open'));
      $('settingstab').classList.remove('hidden');   // the settings gear appears with the radial
    },
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
    // dev-cards carousel
    devTap: (act) => devAct(act),
    devOk: () => devAct(($('devok') || {}).dataset ? $('devok').dataset.act : ''),
    devFocus: () => devFocus(),
    devScroll: (dir) => { const s = $('devstrip'); if (!s) return; const card = s.querySelector('.devcard2'); const stride = card ? card.offsetWidth + 18 : 200; s.scrollBy({ left: dir * stride, behavior: 'smooth' }); },
    devCancelPlay: () => { const el = $('devconfirm'); if (el) el.remove(); },
    yopSubmit: () => { const sel = ui.yop || {}, picks = []; RES.forEach((r) => { for (let i = 0; i < (sel[r] || 0); i++) picks.push(r); }); if (picks.length !== 2) return; hideOverlay(); dispatch({ type: 'playYearOfPlenty', resources: [picks[0], picks[1]] }); },
    mono: (r) => { hideOverlay(); dispatch({ type: 'playMonopoly', resource: r }); },
    // switch target (players <-> bank) in place — no sheet rebuild / re-animation
    tradeMode: (m) => tradeSetMode(m),
    // one step toward give (dir +1) or want (dir -1) on a resource; swipe does the same
    tStep: (r, dir) => tradeStep(r, dir),
    tradeConfirmTrade: () => { if (!tradeValid()) return; if (tBankMode()) window.CATAN.tradeBank(); else window.CATAN.tradeSend(); },
    tradeSend: () => { const t = ui.trade, give = {}, want = {}; RES.forEach((r) => { if (t.give[r]) give[r] = t.give[r]; if (t.want[r]) want[r] = t.want[r]; }); dispatch({ type: 'offerTrade', give, want }); },
    tradeBank: () => {
      const t = ui.trade, color = activeColor();
      const giveUnits = [], wantCards = [];
      RES.forEach((r) => { const u = Math.round(t.give[r] / bankRatio(color, r)); for (let i = 0; i < u; i++) giveUnits.push(r); });
      RES.forEach((r) => { for (let i = 0; i < t.want[r]; i++) wantCards.push(r); });
      if (!wantCards.length || giveUnits.length !== wantCards.length) return;
      ui.tradeView = null; hideOverlay();
      // the engine does one ratio-for-one swap per call; run one per received card. Apply FIRST (same
      // synchronous tick, so the new count never paints), THEN hold the count and fly so it ticks down/up.
      for (let i = 0; i < wantCards.length; i++) dispatch({ type: 'bankTrade', give: giveUnits[i], want: wantCards[i] });
      RES.forEach((r) => { lagOut(color, r, t.give[r] || 0); lagIn(color, r, t.want[r] || 0); }); renderCounts();
      showBankFly(color, t.give, t.want);
    },
    tradeClose: () => { ui.tradeView = null; hideOverlay(); render(); },
    tradeAccept: () => dispatch({ type: 'acceptTrade' }, online ? myColor : activeColor()),
    tradeDecline: () => dispatch({ type: 'declineTrade' }, online ? myColor : activeColor()),
    tradeAs: (kind, color) => dispatch({ type: kind === 'accept' ? 'acceptTrade' : 'declineTrade' }, color),  // hotseat: respond as a player
    tradeConfirm: (c) => { ui.tradeSel = null; dispatch({ type: 'confirmTrade', with: c }, online ? myColor : activeColor()); },
    tradeViewResponse: (c) => { ui.tradeSel = c; render(); },   // offerer taps a corner to review/confirm that response
    tradeCancel: () => dispatch({ type: 'cancelTrade' }),
    // responder ✓: unchanged from the offer -> accept; adjusted -> counter (offerer's frame: give = my
    // receive = ui.trade.want; want = my give = ui.trade.give)
    tradeRespSend: () => {
      const t = ui.trade, pt = state.pendingTrade; if (!t || !pt) return;
      const give = {}, want = {};
      RES.forEach((r) => { if (t.want[r]) give[r] = t.want[r]; if (t.give[r]) want[r] = t.give[r]; });
      const unchanged = RES.every((r) => (give[r] || 0) === (pt.give[r] || 0) && (want[r] || 0) === (pt.want[r] || 0));
      dispatch(unchanged ? { type: 'acceptTrade' } : { type: 'counterTrade', give, want }, online ? myColor : activeColor());
    },
    tradeRespDecline: () => dispatch({ type: 'declineTrade' }, online ? myColor : activeColor()),
    tradeAutoDecline: () => { ui.autoDeclineIdx = state.currentPlayerIndex; dispatch({ type: 'declineTrade' }, online ? myColor : activeColor()); },
    tradeReoffer: () => { dispatch({ type: 'cancelTrade' }); openTrade(); },   // drop the offer + reopen the builder
    steal: (c) => { hideOverlay(); dispatch({ type: 'steal', victim: c }, activeColor()); },
    disc: (r, d) => { const s = ui.pending, p = state.players.find((x) => x.color === s.color), next = s.sel[r] + d, total = RES.reduce((n, x) => n + s.sel[x], 0); if (next < 0 || next > p.resources[r]) return; if (d > 0 && total >= s.need) return; s.sel[r] = next; renderDiscard(); },
    discSubmit: () => { const s = ui.pending; hideOverlay(); RES.forEach((r) => lagOut(s.color, r, s.sel[r] || 0)); showDiscardFly(s.color, s.sel); dispatch({ type: 'discard', resources: s.sel }, s.color); },
    _boardSVG: () => boardSVG(),
  };

  const DEFAULT_NAMES = ['Karim', 'Sam', 'Alex', 'Jordan'];
  const SEAT_COLORS = ['red', 'blue', 'green', 'yellow'];
  // win target by player count — mirrors the engine's targetForCount (2p is a 15-pt house rule)
  function targetForN(n) { return n === 2 ? 15 : n === 3 ? 13 : n === 4 ? 11 : 10; }
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
  // Recompute the fit several times after a (re)launch: the web font and the iOS PWA
  // viewport both settle a beat AFTER first paint. If we only measured once on the first
  // frame we'd sometimes catch a too-small card / too-tall viewport and over-scale to the
  // 1.7x cap (the "launches zoomed-in, needs a refresh" bug). Re-measuring on fonts-ready,
  // window load, and a couple of short delays self-corrects without a manual refresh.
  function scheduleFit() {
    requestAnimationFrame(fitTitle);
    setTimeout(fitTitle, 120);
    setTimeout(fitTitle, 400);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitTitle).catch(() => {});
  }
  window.addEventListener('resize', fitTitle);
  window.addEventListener('load', scheduleFit);
  window.addEventListener('pageshow', scheduleFit);            // PWA resume / bfcache restore
  window.addEventListener('orientationchange', () => setTimeout(fitTitle, 80));
  if (window.visualViewport) window.visualViewport.addEventListener('resize', fitTitle);
  // A direct landscape launch fires no resize/orientationchange, so the early fits run
  // against an unsettled viewport (card scaled too small -> wood shows below it). Watch
  // the title box and re-fit the moment iOS settles it to the real viewport size.
  if (window.ResizeObserver) { try { new ResizeObserver(() => fitTitle()).observe($('title')); } catch (_) {} }

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
    $('leavetab').classList.add('hidden'); $('radialtab').classList.add('hidden'); $('settingstab').classList.add('hidden');
    const title = $('title'); title.classList.remove('hidden'); stopMusic(); document.body.classList.remove('ingame');   // pre-game: portrait allowed
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
      title.innerHTML = `${banner}<div class="t-body"><div class="t-card newgame">
        <button class="demobtn" onclick="CATAN.demo()" title="Jump into a mid-game (testing)">🎲 Demo</button>
        <h3>New Game</h3>
        <div class="seg">${[2, 3, 4].map((n) => `<button class="${n === count ? 'on' : ''}" onclick="CATAN._setCount(${n})">${n} players</button>`).join('')}</div>
        <div class="t-seats">${seats}</div>
        <button class="btn full" onclick="CATAN._start()">Start game</button>
        ${AUTH.me ? `<button class="btn ghost full" data-nav="lobby">← Back to lobby</button>`
          : (window.SUPA ? `<button class="btn ghost full" data-nav="players">← Back to players</button>` : '')}
      </div></div>`;
      scheduleFit();
    };
    window.CATAN._setCount = (n) => { count = n; render2(); };
    const myName = () => { const el = $('pn0'); return (el && el.value || DEFAULT_NAMES[0]).trim(); };
    window.CATAN._start = () => {
      gameSeats = null;   // offline pass & play uses the default seat avatars
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
      gameSeats = null;
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
        // everyone holds a Knight so the start-of-turn "play knight or roll?" question shows
        p.devCards = ['knight'];
        if (Math.random() < 0.5) p.devCards.push(['road_building', 'year_of_plenty', 'monopoly'][ri(0, 2)]);
        if (Math.random() < 0.5) p.playedKnights = ri(0, 2);
      });
      // the first-to-play player gets 2 of every dev card so all the flows are testable
      const first = s.players.find((p) => p.color === s.order[0]);
      if (first) {
        first.devCards = ['knight', 'knight', 'year_of_plenty', 'year_of_plenty', 'road_building', 'road_building', 'monopoly', 'monopoly', 'victory_point', 'victory_point'];
        // set the first player up to trigger EVERY announcement quickly:
        first.resources = { brick: 6, wood: 6, sheep: 5, wheat: 5, ore: 5 };   // plenty to buy dev cards + build roads
        first.playedKnights = 2;                                                // one more Knight -> Largest Army 🎉
        // give them a clean length-4 road chain so building one more road wins the Longest Road
        const firstC = first.color;
        Object.keys(s.roads).forEach((e) => { if (s.roads[e] === firstC) delete s.roads[e]; });   // clear their scattered demo roads
        const fv = +Object.keys(s.settlements).find((v) => s.settlements[v].owner === firstC);
        if (fv >= 0) {
          let v = fv, made = 0, guard = 0; const seen = new Set([fv]);
          while (made < 4 && guard++ < 40) {
            let picked = -1, nextV = -1;
            for (const e of s.board.vertices[v].edges) {
              if (s.roads[e] != null) continue;
              const vs = s.board.edges[e].v, other = vs[0] === v ? vs[1] : vs[0];
              if (seen.has(other) || s.settlements[other]) continue;   // simple path, don't route through a building
              picked = e; nextV = other; break;
            }
            if (picked < 0) break;
            s.roads[picked] = firstC; seen.add(nextV); v = nextV; made++;
          }
        }
      }
      // recompute supply from what's on the board so builds stay valid
      s.players.forEach((p) => {
        const mine = Object.values(s.settlements).filter((x) => x.owner === p.color);
        p.settlementsLeft = 5 - mine.filter((x) => x.type === 'settlement').length;
        p.citiesLeft = 4 - mine.filter((x) => x.type === 'city').length;
        p.roadsLeft = 15 - Object.values(s.roads).filter((o) => o === p.color).length;
      });
      try { C.updateLongestRoad(s); } catch (_) { }
      // start at the roll phase (not yet rolled) so the Knight question fires right away
      s.phase = 'play'; s.currentPlayerIndex = 0; s.turnPhase = 'roll'; s.hasRolledThisTurn = false; s.hasPlayedDevCardThisTurn = false;
      state = s; ui = { mode: 'idle', pending: null }; resetZoom(); renderedBoardKey = null;
      title.classList.add('hidden'); hideOverlay(); document.body.style.background = GAME_BG;
      afterAction(); render();
      const bd = $('board'); if (bd) bd.classList.add('enter');
      toast('Demo: roll, then buy/play dev cards, play a Knight for Largest Army, or build 1 road for Longest Road — watch the top banner');
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
    const r = zRect(), W = r.width, H = r.height;
    if (zoom.s < 1) zoom.s = 1;
    const s = zoom.s;
    // The #board layers span local [-0.5·W, 1.5·W] × [-0.5·H, 1.5·H] (2x, centred).
    // translate(t)·scale(s) maps that edge to t ∓ 0.5·s·W / t + 1.5·s·W, so keeping the
    // viewport fully over water means t ∈ [W(1−1.5s), 0.5·s·W] (and likewise vertically).
    // That structural range is exactly "half the island off" at s=1, and opens up as you
    // pinch in — so you can always drag but never expose the bare ocean backdrop.
    const txLo = W * (1 - 1.5 * s), txHi = 0.5 * s * W;
    const tyLo = H * (1 - 1.5 * s), tyHi = 0.5 * s * H;
    // Vertical: full structural slack — up to half the island can slide off the top/bottom.
    zoom.ty = Math.min(tyHi, Math.max(tyLo, zoom.ty));
    // Horizontal: keep the whole island (+ its port badges) on screen at the default zoom,
    // a touch stricter than just-touching. Relax by the pinch overscroll so a zoomed-in
    // board can still be dragged side to side.
    const base = Math.min(W, H) / VB_HALF;              // px per board unit at s = 1
    const islandHalfPx = (boardHalfW + 1.0) * base;     // +1 unit of slack for the ports
    const txCap = Math.max(0, (W / 2 - islandHalfPx) * 0.8) + Math.max(0, s - 1) * W;
    zoom.tx = Math.min(Math.min(txHi, txCap), Math.max(Math.max(txLo, -txCap), zoom.tx));
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

  // ---- cinematic auto-zoom: pan the camera to where the action is, hold, ease back home ----
  // Gated per-device on SETTINGS.autozoom; any manual pan/pinch/wheel supersedes a running tour.
  const CINE_Z_HEX = 2.2, CINE_Z_SPOT = 2.7, CINE_MS = 1100;   // slow, smooth glide
  let cineToken = 0, cineRunning = false;
  function cineSleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function cineApply(ms) {
    if (!zArea) return;
    zArea.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,.05,.55,.95)';   // gentle ease-in-out
    zArea.style.transform = `translate(${zoom.tx.toFixed(2)}px,${zoom.ty.toFixed(2)}px) scale(${zoom.s.toFixed(4)})`;
  }
  // identity-space content coords (stage px at zoom=1) of any SVG point, robust to the current transform
  function svgContentPoint(sx, sy) {
    const svg = $('board'); if (!svg || !svg.getScreenCTM) return null;
    const m = svg.getScreenCTM(); if (!m) return null;
    const pt = svg.createSVGPoint(); pt.x = sx; pt.y = sy;
    const s = pt.matrixTransform(m), r = zRect();
    return { x: (s.x - r.left - zoom.tx) / zoom.s, y: (s.y - r.top - zoom.ty) / zoom.s };
  }
  function hexContent(id) { const h = state.board.hexes[id]; return h ? svgContentPoint(h.cx, h.cy) : null; }
  function vertContent(id) { return svgContentPoint(vX(id), vY(id)); }
  function edgeContent(id) { const e = state.board.edges[id]; if (!e) return null; const v = e.v; return svgContentPoint((vX(v[0]) + vX(v[1])) / 2, (vY(v[0]) + vY(v[1])) / 2); }
  function cameraTo(c, scale, ms) {
    if (!c) return;
    const r = zRect();
    zoom.s = Math.min(MAXZ, Math.max(1, scale));
    zoom.tx = r.width / 2 - zoom.s * c.x; zoom.ty = r.height / 2 - zoom.s * c.y;
    zClamp(); cineApply(aDur(ms));   // aDur so the glide scales with anim-speed, matching the fly delays
  }
  function cameraHome(ms) { zoom.s = 1; zoom.tx = 0; zoom.ty = 0; cineApply(aDur(ms)); }
  // translate only — keep the current zoom scale (a true pan). At full-board view this is a no-op.
  function cameraPanTo(c, ms) { if (!c) return; const r = zRect(); zoom.tx = r.width / 2 - zoom.s * c.x; zoom.ty = r.height / 2 - zoom.s * c.y; zClamp(); cineApply(aDur(ms)); }
  function cancelCine() { if (cineRunning) { cineToken++; cineRunning = false; clearLag(); } }   // a manual gesture takes over; snap counts to true totals
  // run an async camera sequence; a newer sequence or a manual gesture (both bump cineToken) supersedes it
  async function runCine(seq, opts) {
    if (!SETTINGS.autozoom || !zArea) return;
    const my = ++cineToken; cineRunning = true;
    const alive = () => my === cineToken;
    try { await seq(alive); } catch (_) { }
    if (alive()) { if (!(opts && opts.stay)) cameraHome(CINE_MS); cineRunning = false; }   // glide back out unless asked to hold the frame
  }
  // fly one producing hex's resources to the owners' panels (used as the roll tour lands on each hex)
  // base[hexId] = the hex's identity-space centre (captured before the tour zoomed). We derive the
  // on-screen start from the zoom TARGET (zoom.s/tx/ty) rather than the live transform, so the cards
  // always launch from the terrain's settled centre even if read mid-glide.
  function flyHexProduction(group, base) {
    const c = base[group.hx.id]; if (!c) return;
    const r = zRect();
    const sx = r.left + zoom.tx + zoom.s * c.x, sy = r.top + zoom.ty + zoom.s * c.y;
    let delay = 0;
    for (const e of group.entries) {
      const pi = state.players.findIndex((p) => p.color === e.color);
      const panel = $('p-' + seatKey(pi)); if (!panel) continue;
      const pr = panel.getBoundingClientRect(), tx = pr.left + pr.width / 2, ty = pr.top + pr.height / 2;
      for (let k = 0; k < e.count; k++) { flyResource(e.resource, sx, sy, tx, ty, delay, () => landCard(e.color, e.resource)); delay += 230; }
    }
  }
  // roll: tour each producing hex in turn, flying its cards as the camera lands; else fly everything at once
  function cinematicRoll() {
    const map = productionMap();
    if (!SETTINGS.autozoom || !zArea || !map.length) { showResourceFly(); return; }
    const byHex = new Map();
    for (const e of map) { const g = byHex.get(e.hx.id) || { hx: e.hx, entries: [] }; g.entries.push(e); byHex.set(e.hx.id, g); }
    const groups = [...byHex.values()];
    const base = {};   // capture each producing hex's identity-space centre BEFORE the tour moves the camera
    for (const g of groups) base[g.hx.id] = hexContent(g.hx.id);
    runCine(async (alive) => {
      for (const g of groups) {
        if (!alive()) return;
        cameraTo(hexContent(g.hx.id), CINE_Z_HEX, CINE_MS);
        await cineSleep(aDur(CINE_MS + 80)); if (!alive()) return;   // let the glide settle before the cards fly
        flyHexProduction(g, base);
        await cineSleep(aDur(950)); if (!alive()) return;            // linger while the cards land, then glide to the next
      }
    });
  }
  function cinematicHex(id) { runCine(async () => { cameraTo(hexContent(id), CINE_Z_HEX, CINE_MS); await cineSleep(aDur(CINE_MS + 80)); }); }
  // 2nd setup settlement: one card flies in from each adjacent producing terrain, one at a time
  function flySettlementGrant(grant) {
    const svg = $('board'); if (!svg || !svg.getScreenCTM || !grant.items.length) return; const ctm = svg.getScreenCTM(); if (!ctm) return;
    const pi = state.players.findIndex((p) => p.color === grant.color);
    const panel = $('p-' + seatKey(pi)); if (!panel) return;
    const r = panel.getBoundingClientRect(), tx = r.left + r.width / 2, ty = r.top + r.height / 2;
    let delay = 0;
    for (const it of grant.items) {
      const pt = svg.createSVGPoint(); pt.x = it.hx.cx; pt.y = it.hx.cy;
      const sc = pt.matrixTransform(ctm); flyResource(it.resource, sc.x, sc.y, tx, ty, delay, () => landCard(grant.color, it.resource)); delay += aDur(430);   // sequence, one terrain at a time
    }
  }
  function cinematicPlace(kind, id, mine, grant) {
    const c = kind === 'e' ? edgeContent(id) : vertContent(id);
    const setup = state && state.phase === 'setup';
    // SETUP: a settlement and its road share ONE zoom-in — for the placer AND observers with auto-zoom
    // on. Zoom in on the settlement and HOLD (no zoom-out); glide back out only once the road lands.
    if (setup) {
      if (kind === 'e') { cancelCine(); cameraHome(CINE_MS); return; }   // road down -> now glide home
      // settlement: hold. Don't cancelCine on the placer — that would wipe the grant-card lag set in
      // dispatch; a fresh runCine already supersedes any prior tour via its token.
      runCine(async (alive) => {
        cameraTo(c, CINE_Z_SPOT, CINE_MS);
        await cineSleep(aDur(CINE_MS + 80)); if (!alive()) return;
        if (mine && grant && grant.items && grant.items.length) { flySettlementGrant(grant); await cineSleep(aDur(grant.items.length * 430 + 450)); }   // starting cards stream in during the hold
      }, { stay: true });
      return;
    }
    // MAIN GAME: zoom in on the new piece, linger, then glide out — placer (brief) and observers (longer),
    // gated on SETTINGS.autozoom via runCine so anyone with auto-zoom off stays put.
    cancelCine();
    runCine(async (alive) => {
      cameraTo(c, CINE_Z_SPOT, CINE_MS);
      await cineSleep(aDur(CINE_MS + (mine ? 80 : 650))); if (!alive()) return;
    });
  }

  function zMid() { const a = [...zPts.values()]; return { x: (a[0].x + a[1].x) / 2, y: (a[0].y + a[1].y) / 2 }; }
  function zDist() { const a = [...zPts.values()]; return Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); }
  function initBoardZoom() {
    zArea = $('board-area'); if (!zArea || zArea._zoomInit) return; zArea._zoomInit = true;
    zArea.addEventListener('pointerdown', (e) => {
      cancelCine();   // a touch on the board means the player wants control — drop any running auto-zoom
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
    zArea.addEventListener('wheel', (e) => { e.preventDefault(); cancelCine(); zoomTo(zoom.s * Math.exp(-e.deltaY * 0.0015), e.clientX, e.clientY); }, { passive: false });
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
  let specView = null;   // spectators: which player's resources to show in the hand bar (null = follow whoever's up)
  function enterGame(s) {
    state = s; ui = { mode: 'idle', pending: null }; resetZoom(); renderedBoardKey = null; specView = null;
    lastBcAt = 0; clearMsgLog();   // reset chat cooldown + per-player message history on entry
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
    flagToast(a, s);   // someone raised/lowered a white flag -> tell the table
    announceFromLog(a && a.log, s.log);   // dev-card buys/plays -> top announcement on observers' screens
    announceMilestones(a, s);             // longest road / largest army changing hands
    const rolled = !!(a && a.turnPhase === 'roll' && s.turnPhase !== 'roll' && s.dice && s.hasRolledThisTurn);
    const trade = detectTrade(a, s);
    const disc = detectDiscard(a, s);
    const robberMoved = !!(a && a.robberHex !== s.robberHex);   // thief moved -> fly it on every screen
    const stolen = (!rolled && !trade && !disc) ? detectSteal(a, s) : null;   // card flies victim->thief on every screen
    const devBuy = detectDevBuy(a, s);   // a face-down dev card flies to the buyer on every other screen
    const bankTrade = (!rolled && !trade && !disc) ? detectBankTrade(a, s) : null;   // face-down cards fly to/from the bank
    const placed = detectPlacement(a, s);   // a building/road went down -> pop-in + camera on observers too
    if (!rolled && !trade && !disc && a) soundForRemote(a, s);   // roll/trade/discard/robber have their own sound+animation
    state = s;
    if (rolled) ui.diceRevealing = true;   // suppress the corner dice during the reveal
    if (disc) ui.discardAnimating = true;  // defer the next discard prompt until this one's cards land
    if (robberMoved) ui.robberFlying = true;
    if (placed) justPlaced = placed;       // observers get the pop-in too
    // hold card counts behind the transfer flies so the numbers tick with the animation
    if (stolen) { lagOut(stolen.victim, stolen.res, 1); lagIn(stolen.thief, stolen.res, 1); }
    if (trade) lagTrade(trade.a, trade.b, trade.give, trade.want);
    if (bankTrade) RES.forEach((r) => { lagOut(bankTrade.color, r, (bankTrade.give && bankTrade.give[r]) || 0); lagIn(bankTrade.color, r, (bankTrade.want && bankTrade.want[r]) || 0); });
    if (disc) RES.forEach((r) => lagOut(disc.color, r, (disc.sel && disc.sel[r]) || 0));
    afterAction(); render();
    if (rolled) showDiceReveal(s.dice);
    if (disc) showDiscardFly(disc.color, disc.sel);   // everyone watches each player's discard; end -> afterAction
    if (robberMoved) showRobberFly(a.robberHex, s.robberHex);
    if (trade) showTradeFly(trade.a, trade.b, trade.give, trade.want);
    if (stolen) {
      // only the thief and the victim see WHICH card; everyone else sees a face-down card move
      const reveal = myColor === stolen.victim || myColor === stolen.thief;
      const fly = () => showStealFly(stolen.victim, stolen.thief, reveal ? stolen.res : null);
      robberMoved ? setTimeout(fly, aDur(450)) : fly();   // let the robber land first if both happened at once
    }
    if (devBuy) showDevBuyFly(devBuy.buyer);   // the buyer themselves already saw it face-up via their own dispatch
    if (bankTrade) showBankFly(bankTrade.color, bankTrade.give, bankTrade.want, true);   // covered: the trader saw it face-up
    if (placed && !robberMoved && !rolled) cinematicPlace(placed.kind, placed.id, false);   // observer: gentle pan to the new piece
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
    // watch the row for THIS table's game (this.code). No-op while browsing (no table).
    lastMsgId: 0,
    subscribe() {
      const c = this.init(); if (!c || !this.code) return;
      const code = this.code;
      if (this.channel) { try { c.removeChannel(this.channel); } catch (_) { } }
      this.channel = c.channel('game-' + code)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: 'code=eq.' + code }, (p) => { if (p.new) NET.onRow(p.new); })
        .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'messages', filter: 'code=eq.' + code }, (p) => { if (p.new) NET.onMsg(p.new); })   // chat, fast path
        .subscribe();
      // only show messages from now on (not the whole history) — start the cursor at the current max id
      c.from('messages').select('id').eq('code', code).order('id', { ascending: false }).limit(1)
        .then(({ data }) => { NET.lastMsgId = (data && data[0]) ? data[0].id : 0; });
      if (this.poll) clearInterval(this.poll);
      this.poll = setInterval(async () => {
        if (!NET.code) return;
        const { data } = await c.from('games').select('*').eq('code', NET.code).maybeSingle();
        NET.onRow(data || { phase: 'idle' });   // realtime is primary; poll is the safety net
        // chat: poll new messages (the reliable fallback when realtime drops, esp. on iOS/PWA)
        const { data: msgs } = await c.from('messages').select('*').eq('code', NET.code).gt('id', NET.lastMsgId).order('id', { ascending: true }).limit(50);
        if (msgs && msgs.length) msgs.forEach((m) => NET.onMsg(m));
      }, 2500);
    },
    // a chat message arrived (via realtime or poll) — dedup by monotonic id, skip my own echo
    onMsg(row) {
      if (!row || !row.id || row.id <= this.lastMsgId) return;
      this.lastMsgId = row.id;
      if (row.color && row.color === myColor) return;   // mine — already shown locally on send
      showBroadcast({ type: row.type || 'text', text: row.body, url: row.url, dur: row.dur, name: row.name, avatar: row.avatar, color: row.color, code: row.code });
    },
    unsubscribeGame() {
      const c = this.init();
      if (c && this.channel) { try { c.removeChannel(this.channel); } catch (_) { } this.channel = null; }
      if (this.poll) { clearInterval(this.poll); this.poll = null; }
    },
    onRow(row) {
      if (!row || !row.state || (row.phase !== 'playing' && row.phase !== 'ended')) {
        LOBBY.lastRow = null;
        // if the game went idle while still in progress (someone left / it was abandoned), it did NOT
        // complete -> nothing was recorded. Tell whoever's still here so it's clear it doesn't count.
        const abandoned = this.started && state && state.phase !== 'ended';
        if (this.started) { this.started = false; this.version = 0; online = false; myColor = null; LOBBY.toLobby(); }
        else if (LOBBY.inProgress) { LOBBY.inProgress = false; renderLobby(); }   // the game I could watch just ended
        if (abandoned) toast('Game abandoned — not recorded');
        return;   // table is idle -> stay in / return to the lobby
      }
      if (this.started && row.version <= this.version) return;   // dedup my own echo / poll repeats
      this.version = row.version;
      LOBBY.lastRow = row;
      gameSeats = row.players || null;   // carries each seat's uploaded avatar for the board/corners
      const seat = (row.players || []).find((p) => p.playerId === (AUTH.me && AUTH.me.id));
      if (this.started) {
        myColor = seat ? seat.color : null;
        // a fresh game arriving while we're on an ended one = a rematch -> replay the 3·2·1 intro for everyone
        if (isFreshStart(row.state) && state && state.phase === 'ended') { ui.svEnding = false; showCountdown(() => enterGame(row.state)); return; }
        applyRemoteState(row.state); return;   // already in -> just sync
      }
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
    // Serialize syncs: chained actions (e.g. moveRobber -> auto-steal) must hit the server
    // in order, or the second reads a state where it's invalid, "reverts", and the move is lost.
    _syncQ: Promise.resolve(),
    syncAction(action, actor) {
      this._syncQ = this._syncQ.then(() => this._doSync(action, actor)).catch(() => { });
      return this._syncQ;
    },
    async _doSync(action, actor) {
      const c = this.init(); if (!c) return;
      for (let i = 0; i < 6; i++) {
        const { data, error } = await c.from('games').select('state,version').eq('code', this.code).maybeSingle();
        if (error || !data || !data.state) return;
        const r = C.applyAction(data.state, action, actor);
        if (!r.ok) { applyRemoteState(data.state); return; }
        if (data.state.sv && r.state.phase !== 'ended') r.state.sv = data.state.sv;   // keep a live surrender vote across moves
        const phase = r.state.phase === 'ended' ? 'ended' : 'playing';
        const { data: upd, error: uerr } = await c.from('games')
          .update({ state: r.state, version: data.version + 1, phase }).eq('code', this.code).eq('version', data.version).select('version');
        if (uerr) { toast('Sync error'); return; }
        if (upd && upd.length) { this.version = data.version + 1; return; }
        await new Promise((res) => setTimeout(res, 70));
      }
    },
  };

  // ===== lobby: presence (who's online + ready) + explicit table formation ===
  // read a presence entry's lobby mode (back-compat with the old {ready} payload)
  function pmode(p) { return p.mode || (p.ready ? 'ready' : 'idle'); }
  const PRESENCE_GRACE = 22000;   // keep a briefly-vanished member visible this long (rides out phone sleep/background)
  const LOBBY = {
    channel: null, presence: {}, mode: 'idle', readyAt: 0, inProgress: false, lastRow: null, table: null, created: null, targetPoints: null,
    lastSeen: {},          // id -> last time seen live (ms) — powers the grace window
    lastPayload: {},       // id -> last-known presence payload (kept so a grace member keeps its name/avatar)
    liveIds: new Set(),    // ids present RIGHT NOW (no grace) — used for AFK/skip detection
    join() {
      const c = NET.init(); if (!c || !AUTH.me) return;
      if (this.table) { NET.code = this.table; NET.subscribe(); }   // re-watch our table's game if we're sitting at one
      else NET.unsubscribeGame();                                   // browsing the table list -> no game watch
      if (this.channel) { try { c.removeChannel(this.channel); } catch (_) { } }
      this.channel = c.channel('lobby', { config: { presence: { key: AUTH.me.id } } });
      this.channel.on('presence', { event: 'sync' }, () => LOBBY.onPresence());
      this.channel.on('broadcast', { event: 'msg' }, (e) => {
        const p = e && e.payload; if (!p) return;
        // match on the GAME CODE (robust: LOBBY.table can be null in-game, but NET.code is set),
        // falling back to the old table field for older senders.
        const pc = p.code || p.table || null, mine = NET.code || LOBBY.table || null;
        try { console.log('[bcast rx]', { kind: p.type || 'text', from: p.name, pc, mine, match: !!(pc && mine && pc === mine) }); } catch (_) { }
        if (pc && mine && pc === mine) showBroadcast(p);
      });
      this.channel.subscribe((st) => { if (st === 'SUBSCRIBED') LOBBY.track(); });
      startHeartbeat();
      sweepOldVoice();   // best-effort cleanup of orphaned voice clips (throttled hourly)
    },
    // `created` = the code I created via "New game", so everyone can see who owns/hosts each table
    track() { if (this.channel) this.channel.track({ id: AUTH.me.id, name: AUTH.me.name, avatar: AUTH.me.avatar || null, mode: this.mode, readyAt: this.readyAt, table: this.table || null, created: this.created || null, target: this.targetPoints || null }); },
    creatorOf(code) { return this.online().find((p) => (p.table || null) === code && p.created === code) || null; },
    gameName(code) { const c = this.creatorOf(code); return c ? c.name + "'s Game" : 'Game'; },
    // enter / switch tables (a table is a presence grouping keyed by a game code)
    enterTable(code) { this.table = code; NET.code = code; this.mode = 'idle'; this.readyAt = 0; this.inProgress = false; this.targetPoints = null; NET.subscribe(); this.track(); lobbySig = null; renderLobby(); },
    leaveTable() { this.table = null; NET.code = null; this.mode = 'idle'; this.readyAt = 0; this.inProgress = false; this.targetPoints = null; NET.unsubscribeGame(); this.track(); lobbySig = null; renderLobby(); },
    // Chat rides a polled table (like the game state), NOT realtime broadcast — so it survives
    // iOS/PWA WebSocket drops. Insert a row; every client picks it up via postgres_changes + poll.
    sendBroadcast(msg) {
      const c = NET.init(); const code = msg.code || NET.code || this.table;
      if (!c || !code) return;
      c.from('messages').insert({
        code, color: msg.color || null, name: msg.name || null, avatar: msg.avatar || null,
        type: msg.type || 'text', body: msg.text || null, url: msg.url || null, dur: msg.dur || null,
        sender: (AUTH.me && AUTH.me.id) || null,
      }).then(({ error }) => { if (error) toast('Message failed'); });
    },
    onPresence() {
      const st = this.channel.presenceState();
      const now = Date.now();
      const live = {}; this.liveIds = new Set();
      Object.values(st).forEach((arr) => { const m = arr[arr.length - 1]; if (m && m.id) { live[m.id] = m; this.liveIds.add(m.id); this.lastSeen[m.id] = now; this.lastPayload[m.id] = m; } });
      // Grace window: a member who just dropped from presence (phone slept/backgrounded) stays in
      // the roster, dimmed, for PRESENCE_GRACE ms — so the list doesn't reshuffle on every blip.
      this.presence = Object.assign({}, live);
      Object.keys(this.lastSeen).forEach((id) => {
        if (live[id]) return;
        if (now - this.lastSeen[id] < PRESENCE_GRACE) { const m = this.lastPayload[id]; if (m) this.presence[id] = Object.assign({}, m, { away: true }); }
        else { delete this.lastSeen[id]; delete this.lastPayload[id]; }
      });
      if (!NET.started) renderLobby();
      else { renderBanner(); if (state) renderPanels(); }   // in-game: refresh watch count + per-player online/offline dots
    },
    // drop grace members whose window has expired; returns true if the roster changed
    sweepStale() {
      const now = Date.now(); let changed = false;
      Object.keys(this.presence).forEach((id) => {
        if (this.liveIds.has(id)) return;
        if (now - (this.lastSeen[id] || 0) >= PRESENCE_GRACE) { delete this.presence[id]; delete this.lastSeen[id]; changed = true; }
      });
      if (changed) { if (!NET.started) { lobbySig = null; renderLobby(); } else { renderBanner(); if (state) renderPanels(); } }
      return changed;
    },
    online() { return Object.values(this.presence); },
    tableMembers() { return this.online().filter((p) => (p.table || null) === this.table); },   // who's at MY table
    readyList() { return this.tableMembers().filter((p) => pmode(p) === 'ready').sort((a, b) => a.readyAt - b.readyAt); },
    spectators() { return this.tableMembers().filter((p) => pmode(p) === 'spectate'); },
    setReady() { this.mode = this.mode === 'ready' ? 'idle' : 'ready'; this.readyAt = this.mode === 'ready' ? Date.now() : 0; this.track(); renderLobby(); },
    setSpectate() { this.mode = this.mode === 'spectate' ? 'idle' : 'spectate'; this.readyAt = 0; this.track(); renderLobby(); },
    enterAs(role) { this.mode = role === 'play' ? 'playing' : 'spectate'; this.readyAt = 0; this.inProgress = false; if (this.channel) this.track(); },
    toLobby() { this.mode = 'idle'; this.readyAt = 0; this.inProgress = false; if (this.channel) this.track(); showLobby(); },   // table idle -> back to lobby
    watch() { const row = this.lastRow; if (!row || !row.state) { toast('No game to watch'); return; } myColor = null; online = true; this.enterAs('spectate'); NET.started = true; NET.version = row.version; enterGame(row.state); },   // join an in-progress game as a spectator (no countdown)
    async startTable() {
      const ready = this.readyList();
      if (ready.length < 2) { toast('Need at least 2 players ready'); return; }
      const host = this.creatorOf(this.table) || ready[0];   // the game's creator starts it (fallback: first ready, if creator left)
      if (!host || host.id !== AUTH.me.id) { toast('Only the game creator can start'); return; }
      if (!ready.some((r) => r.id === host.id)) { toast('Ready up before starting'); return; }
      const seated = ready.slice(0, 4), n = seated.length;
      const players = seated.map((p, i) => ({ seat: i, color: SEAT_COLORS[i], name: p.name, playerId: p.id, avatar: p.avatar || null }));
      const playerN = Math.min(4, this.tableMembers().filter((m) => pmode(m) !== 'spectate').length) || n;
      const target = (this.targetPoints != null ? this.targetPoints : targetForN(playerN));   // host's chosen win target, else the count default
      let gstate;
      try { gstate = C.createGame({ id: 'table', players: players.map((p) => ({ color: p.color, name: p.name })), seed: (Math.random() * 1e9) | 0, targetPoints: target, randomFirst: true }); }
      catch (e) { toast('Start failed: ' + e.message); return; }
      const c = NET.init();
      const { error } = await c.from('games').upsert({ code: NET.code, phase: 'playing', players, state: gstate, target_points: target, version: 1, host_id: AUTH.me.id });
      if (error) toast('Start failed: ' + error.message);   // realtime drives everyone in
    },
    async reset() {   // end this table's game -> its members back to the table lobby
      const c = NET.init(); if (!c || !NET.code) return;
      const code = NET.code;
      await c.from('games').upsert({ code, phase: 'idle', state: null, players: [], version: 0 });
      purgeVoice(code);   // the game's over -> drop its voice clips
      try { c.from('messages').delete().eq('code', code); } catch (_) { }   // ...and its chat
    },
    // rematch: start a fresh game with the SAME seated players + win target, straight from the
    // victory screen. Version-guarded so two people tapping it doesn't spawn two games.
    async rematch() {
      const c = NET.init(); if (!c || !NET.code) return;
      if (svEndTimer) { clearTimeout(svEndTimer); svEndTimer = null; }   // cancel the surrender auto-return-to-lobby
      const seats = (gameSeats || []).filter((s) => s && s.color);
      if (seats.length < 2) { toast('Need the same players to rematch'); return; }
      const players = seats.map((p, i) => ({ seat: i, color: SEAT_COLORS[i], name: p.name, playerId: p.playerId || null, avatar: p.avatar || null }));
      const target = (state && state.targetPoints) || targetForN(players.length);
      let gstate;
      try { gstate = C.createGame({ id: 'table', players: players.map((p) => ({ color: p.color, name: p.name })), seed: (Math.random() * 1e9) | 0, targetPoints: target, randomFirst: true }); }
      catch (e) { toast('Rematch failed: ' + e.message); return; }
      const prevV = NET.version || 1;
      const { data, error } = await c.from('games')
        .update({ phase: 'playing', players, state: gstate, target_points: target, version: prevV + 1 })
        .eq('code', NET.code).eq('version', prevV).select('version');
      if (error) { toast('Rematch failed: ' + error.message); return; }
      if (!data || !data.length) toast('Starting rematch…');   // someone else already tapped it — their write drives us in
    },
    leave() {
      const c = NET.init();
      if (c && this.channel) { try { c.removeChannel(this.channel); } catch (_) { } this.channel = null; }
      if (c && NET.channel) { try { c.removeChannel(NET.channel); } catch (_) { } NET.channel = null; }
      if (NET.poll) { clearInterval(NET.poll); NET.poll = null; }
      stopHeartbeat();
      this.presence = {}; this.lastSeen = {}; this.lastPayload = {}; this.liveIds = new Set();
      this.mode = 'idle'; this.readyAt = 0; this.inProgress = false; this.lastRow = null; this.table = null; online = false; myColor = null; NET.started = false; NET.code = null;
    },
  };
  // A single 3s heartbeat while connected: expire stale presence-grace entries.
  let heartbeat = null;
  function startHeartbeat() { if (heartbeat) return; heartbeat = setInterval(() => { try { LOBBY.sweepStale(); } catch (_) { } }, 3000); }
  function stopHeartbeat() { if (heartbeat) { clearInterval(heartbeat); heartbeat = null; } }
  // On wake (tab visible / window focus / network back), republish our presence right away so a
  // phone that slept doesn't linger as "away" on everyone else's screen, and refresh what we see.
  function onWake() {
    if (document.hidden) return;
    try { LOBBY.track(); } catch (_) { }
    if (NET.started) renderBanner(); else { lobbySig = null; renderLobby(); }
  }
  document.addEventListener('visibilitychange', onWake);
  window.addEventListener('focus', onWake);
  window.addEventListener('online', onWake);
  function rankMode(p) { const m = pmode(p); return m === 'ready' ? 3 : m === 'playing' ? 2 : m === 'spectate' ? 1 : 0; }
  function lobbyRows(list, ready, creatorId) {
    if (!list.length) return `<p class="muted" style="text-align:center;margin:8px 0">Nobody online yet.</p>`;
    return list.slice().sort((a, b) => (rankMode(b) - rankMode(a)) || String(a.name).localeCompare(b.name)).map((p) => {
      const m = pmode(p), ri = ready.findIndex((r) => r.id === p.id), isHost = creatorId && p.id === creatorId;
      let tag;
      if (p.away) tag = `<span class="t-pend">away…</span>`;   // briefly dropped from presence (phone asleep) — grace window
      else if (m === 'spectate') tag = `<span class="t-pend">spectating</span>`;
      else if (m === 'playing') tag = `<span class="t-pend">in game</span>`;
      else if (m === 'ready') tag = ri >= 4 ? `<span class="t-pend">ready · spectating (full)</span>` : `<span class="t-acc">${isHost ? 'Host · ready' : 'ready'}</span>`;
      else tag = isHost ? `<span class="t-acc">Host · not ready</span>` : `<span class="muted">not ready</span>`;
      return `<div class="lobrow${p.away ? ' away' : ''}"><span class="tnm">${faceHTML(p.name, p.avatar, 'sm')}<span>${escapeHtml(p.name)}${p.id === AUTH.me.id ? ' (you)' : ''}</span></span>${tag}</div>`;
    }).join('');
  }
  let lobbySig = null;
  // Menu navigation (Switch player / Change PIN / Back to players / Back to lobby) fires on
  // pointerup via a capture-phase delegate on document. pointerup (not click) so a re-render
  // landing between press and release can't swallow it, and because some mobile browsers drop
  // the synthetic click on these screen-switching buttons while pointerup always lands.
  document.addEventListener('pointerup', (e) => {
    const b = e.target && e.target.closest && e.target.closest('[data-nav]');
    if (!b) return;
    const a = b.getAttribute('data-nav');
    if (a === 'logout') CATAN.lobbyLogout();
    else if (a === 'changepin') CATAN.authChangePin();
    else if (a === 'players') CATAN.backToPlayers();
    else if (a === 'lobby') CATAN.showLobby();
    else if (a === 'profile') CATAN.manageProfile();
    else if (a === 'profback') CATAN.manageProfile();
    else if (a === 'stats') CATAN.openStats();
    else if (a === 'back') CATAN.lobbyBack();
  }, true);
  // ---- Stats — real data from public.game_results (one row written per finished game) ----
  // In-memory game shape: { date:'Jun 29', ym:'2026-06', standings:[{n,pts,lr,la}] } (index 0 = winner).
  const MONTH_FULL = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July', Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
  const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function pkey(s) { return s.id || s.n; }   // player identity key: persistent id if present, else the name
  const STATS = {
    games: [], loaded: false, loading: null, nameMap: {},
    // fetch finished games from the DB (cached; a new result clears `loaded` to force a refetch)
    load(force) {
      if (STATS.loading) return STATS.loading;
      if (STATS.loaded && !force) return Promise.resolve();
      const c = NET.init();
      if (!c) { STATS.loaded = true; STATS.games = []; return Promise.resolve(); }
      STATS.loading = c.from('game_results').select('standings,finished_at').order('finished_at', { ascending: false }).limit(1000).then(
        ({ data, error }) => {
          STATS.loading = null; STATS.loaded = true;
          STATS.games = ((!error && data) ? data : []).filter((r) => Array.isArray(r.standings) && r.standings.length).map((r) => {
            const d = new Date(r.finished_at), mo = d.getMonth();
            return { date: MONTH_ABBR[mo] + ' ' + d.getDate() + ', ' + d.getFullYear(), ym: d.getFullYear() + '-' + String(mo + 1).padStart(2, '0'),
              standings: r.standings.map((s) => ({ id: s.id || null, n: s.name, pts: s.pts, lr: s.lr ? 1 : 0, la: s.la ? 1 : 0, pen: s.penalty ? 1 : 0 })) };
          });
          // Resolve the LATEST display name per identity key (games are newest-first, so the first
          // name seen for a key wins). Keying on the persistent player id means a rename never
          // splits a player's history — their old games and new games stay one row.
          STATS.nameMap = {};
          STATS.games.forEach((g) => g.standings.forEach((s) => { const k = pkey(s); if (!STATS.nameMap[k]) STATS.nameMap[k] = s.n; }));
        },
        () => { STATS.loading = null; STATS.loaded = true; STATS.games = []; });
      return STATS.loading;
    },
    nameFor(k) { return (STATS.nameMap && STATS.nameMap[k]) || k; },
    seasonLabel(ym) { if (!ym) return ''; const p = ym.split('-'); const lbl = MONTH_FULL[MONTH_ABBR[(+p[1]) - 1]]; return (+p[0] === new Date().getFullYear()) ? lbl : lbl + ' ' + p[0]; },
    // compact label for the season strip: "Jul" in the current year, "Jul '25" otherwise
    seasonPill(ym) { const p = ym.split('-'); const mo = MONTH_ABBR[(+p[1]) - 1]; return (+p[0] === new Date().getFullYear()) ? mo : mo + " '" + String(p[0]).slice(2); },
    seasons() { const u = [...new Set(STATS.games.map((g) => g.ym))]; u.sort(); return u; },
    curSeason() { const s = STATS.seasons(); return s[s.length - 1]; },
    years() { return [...new Set(STATS.games.map((g) => +g.ym.split('-')[0]))].sort((a, b) => b - a); },   // desc
    monthsIn(year) { return STATS.seasons().filter((ym) => +ym.split('-')[0] === year).sort().reverse(); },   // yms in a year, newest first
    latestMonthIn(year) { return STATS.monthsIn(year)[0]; },
    monthShort(ym) { return MONTH_ABBR[(+ym.split('-')[1]) - 1]; },   // "Jul" (the year is shown separately in the year row)
    filter(season) { return season === 'all' ? STATS.games : STATS.games.filter((g) => g.ym === season); },
    board(games) {
      const m = {}, get = (k) => (m[k] = m[k] || { key: k, gp: 0, w: 0, exp: 0, ps: 0, lr: 0, la: 0, pen: 0 });
      games.forEach((g) => {
        const N = g.standings.length;
        g.standings.forEach((s, i) => { const p = get(pkey(s)); p.gp++; p.exp += 1 / N; p.ps += i + 1; if (i === 0) p.w++; if (s.lr) p.lr++; if (s.la) p.la++; if (s.pen) p.pen++; });
      });
      return Object.values(m).map((p) => ({ key: p.key, name: STATS.nameFor(p.key), gp: p.gp, w: p.w, lr: p.lr, la: p.la, pen: p.pen, winpct: Math.round((100 * p.w) / p.gp), wae: p.w - p.exp, avg: p.ps / p.gp }))
        .sort((a, b) => b.wae - a.wae || b.w - a.w || a.avg - b.avg);
    },
    streak(key) {
      const gs = STATS.games.filter((g) => g.standings.some((s) => pkey(s) === key)).slice().reverse();   // oldest -> newest
      let best = 0, run = 0; gs.forEach((g) => { if (pkey(g.standings[0]) === key) { run++; if (run > best) best = run; } else run = 0; });
      return { cur: run, best };
    },
    h2h(key) {
      const h = {};
      STATS.games.forEach((g) => { const me = g.standings.findIndex((s) => pkey(s) === key); if (me < 0) return;
        g.standings.forEach((s, i) => { const ok = pkey(s); if (ok === key) return; const o = (h[ok] = h[ok] || { w: 0, l: 0, name: STATS.nameFor(ok) }); if (me < i) o.w++; else o.l++; }); });
      return h;
    },
    detail(key) { const a = STATS.board(STATS.games).find((p) => p.key === key); return a ? { ...a, ...STATS.streak(key), h2h: STATS.h2h(key) } : null; },
  };
  // Write one row when a game ends. Every seated client attempts it; a board-fingerprint game_id
  // (identical on every device, stable across reconnects) dedups so exactly one row lands.
  let lastRecorded = null;
  function recordResult() {
    if (!online || !NET.code || !NET.client || !state || state.phase !== 'ended' || !state.winner) return;
    const seatId = {};   // color -> persistent player id, from the game's seat map (rename-proof stats key)
    (gameSeats || []).forEach((s) => { if (s && s.color) seatId[s.color] = s.playerId || null; });
    // the actual winner is ALWAYS place 1 — a surrender winner may not be the VP leader; the rest rank by VP.
    // A mid-game quitter (state.quitBy) is forced to last place and carries a penalty flag.
    const win = state.winner;
    const quitter = state.quitBy || null;
    const rows = state.players.map((p) => ({ p, vp: C.victoryPoints(state, p.color, true) }))
      .sort((a, b) => {
        const aq = a.p.color === quitter, bq = b.p.color === quitter;   // the quitter always ranks last
        if (aq !== bq) return aq ? 1 : -1;
        const aw = a.p.color === win, bw = b.p.color === win;           // winner first
        if (aw !== bw) return aw ? -1 : 1;
        return b.vp - a.vp;                                             // everyone else by victory points
      });
    const standings = rows.map(({ p, vp }, i) => {
      const s = { id: seatId[p.color] || null, name: p.name, color: p.color, pts: vp, place: i + 1, lr: p.hasLongestRoad ? 1 : 0, la: p.hasLargestArmy ? 1 : 0 };
      if (p.color === quitter) s.penalty = 1;   // quit mid-game -> flagged (shown in the Penalties column)
      return s;
    });
    const fp = ((state.board && state.board.hexes) || []).map((h) => ((h.terrain || '?')[0]) + (h.token || '')).join('');
    const gameId = (NET.code || '?') + ':' + fp + (quitter ? ':q' : '');   // a quit end is a distinct record
    if (lastRecorded === gameId) return;
    lastRecorded = gameId;
    NET.client.from('game_results').upsert(
      { game_id: gameId, code: NET.code, player_count: state.players.length, standings },
      { onConflict: 'game_id', ignoreDuplicates: true }
    ).then(({ error }) => { if (error) console.warn('stats save failed:', error.message); else STATS.loaded = false; });
  }
  const ROAD_ICO = (ASSETS.pieces && ASSETS.pieces['road-eastwest'] && (ASSETS.pieces['road-eastwest'].yellow || ASSETS.pieces['road-eastwest'].red)) || '';
  let statsSeason = null;   // null = current season, 'all' = all-time
  let statsCount = null;    // null = all table sizes; 2 | 3 | 4 = only that many players
  function recentRowsHTML(games, limit) {
    const gs = limit ? games.slice(0, limit) : games;
    return gs.map((g) => {
      const others = g.standings.slice(1).map((s) => escapeHtml(s.n)).join(', ');
      return `<div class="rgrow"><span class="rgwin">🏆 ${escapeHtml(g.standings[0].n)}</span>` +
        `<span class="rgfield">${others}</span><span class="rgdate">${g.standings.length}p · ${g.date}</span></div>`;
    }).join('');
  }
  function statsScreen() {
    const back = `<div class="lobhead"><button class="lobback" onclick="CATAN.showLobby()" title="Back to lobby">←</button><h3>🏆 Stats</h3></div>`;
    if (!STATS.loaded) { titleCard(`${back}<p class="muted" style="text-align:center;padding:26px 0">Loading…</p>`); STATS.load().then(() => statsScreen()); return; }
    if (!STATS.games.length) { titleCard(`${back}<p class="muted" style="text-align:center;padding:22px 8px;line-height:1.5">No games recorded yet.<br>Finish an online game and it'll show up here.</p>`); return; }
    // statsSeason: 'all' = all-time · null = default (latest month) · else a specific 'YYYY-MM'
    const isAll = statsSeason === 'all';
    let season = isAll ? 'all' : (statsSeason || STATS.curSeason());
    if (!isAll && !STATS.seasons().includes(season)) season = STATS.curSeason();   // selected month emptied out -> fall back
    const seasonGames = STATS.filter(season);
    // secondary filter: only games with this many players. Only offer sizes that actually occur.
    const sizes = [...new Set(STATS.games.map((g) => g.standings.length))].sort();
    if (statsCount && !sizes.includes(statsCount)) statsCount = null;   // size vanished (e.g. all deleted) -> reset
    const games = statsCount ? seasonGames.filter((g) => g.standings.length === statsCount) : seasonGames;
    const board = STATS.board(games);
    const selLbl = isAll ? '' : STATS.seasonLabel(season);   // label for the currently-selected month
    // Season selector — scales to many months/years, pills run chronologically LEFT→RIGHT
    // (oldest first, newest last); the strip auto-scrolls to keep the active (newest) pill in view.
    //   • one year of data -> a single row: All-time + a pill per month
    //   • multiple years   -> a YEAR row (All-time + a pill per year) plus, unless All-time,
    //                         a MONTH row for the selected year (≤12 pills).
    const years = STATS.years().slice().reverse();   // ascending (oldest -> newest)
    let seasonSeg;
    if (years.length <= 1) {
      seasonSeg = `<div class="seg stseg stseasonseg"><button class="${isAll ? 'on' : ''}" onclick="CATAN.statsSeason('all')">All-time</button>` +
        STATS.seasons().map((ym) => `<button class="${!isAll && season === ym ? 'on' : ''}" onclick="CATAN.statsSeason('${ym}')">${STATS.seasonPill(ym)}</button>`).join('') + `</div>`;
    } else {
      const selYear = isAll ? years[years.length - 1] : +season.split('-')[0];
      const yearRow = `<div class="seg stseg stseasonseg"><button class="${isAll ? 'on' : ''}" onclick="CATAN.statsSeason('all')">All-time</button>` +
        years.map((y) => `<button class="${!isAll && selYear === y ? 'on' : ''}" onclick="CATAN.statsYear(${y})">${y}</button>`).join('') + `</div>`;
      const monthRow = isAll ? '' : `<div class="seg stseg stseasonseg stmonthrow">` +
        STATS.monthsIn(selYear).slice().reverse().map((ym) => `<button class="${season === ym ? 'on' : ''}" onclick="CATAN.statsSeason('${ym}')">${STATS.monthShort(ym)}</button>`).join('') + `</div>`;
      seasonSeg = yearRow + monthRow;
    }
    const countSeg = sizes.length > 1
      ? `<div class="seg stseg stcountseg"><button class="${!statsCount ? 'on' : ''}" onclick="CATAN.statsCount(null)">All sizes</button>${sizes.map((n) => `<button class="${statsCount === n ? 'on' : ''}" onclick="CATAN.statsCount(${n})">${n}p</button>`).join('')}</div>`
      : '';
    const head = `<tr><th>#</th><th>Player</th><th title="Games played">GP</th><th title="Wins">W</th><th title="Win rate">Win%</th><th title="Quits — a quit mid-game counts as a loss">Pen</th><th title="Wins above expected — accounts for table size">WAE</th></tr>`;
    const rows = board.map((p, i) => {
      const wae = (p.wae >= 0 ? '+' : '') + p.wae.toFixed(1);
      return `<tr onclick="CATAN.statsPlayer('${encodeURIComponent(p.key)}')"><td class="str">${i + 1}</td>` +
        `<td class="stn">${escapeHtml(p.name)}</td><td>${p.gp}</td><td class="stw">${p.w}</td><td>${p.winpct}%</td>` +
        `<td class="${p.pen ? 'stpen' : 'stz'}">${p.pen || '—'}</td>` +
        `<td class="${p.wae >= 0 ? 'stpos' : 'stneg'}">${wae}</td></tr>`;
    }).join('');
    const sizeLbl = statsCount ? ' · ' + statsCount + 'p' : '';
    const body = games.length
      ? `<div class="sttbl-wrap"><table class="sttbl"><thead>${head}</thead><tbody>${rows}</tbody></table></div>
         <div class="stnote">WAE = wins above expected: your wins minus what pure luck gives at each table size. Tap a player for detail.</div>
         <h4 class="stsub">Games${selLbl ? ' · ' + selLbl : ''}${sizeLbl}</h4>
         <div class="rglist tall">${recentRowsHTML(games)}</div>`
      : `<p class="muted" style="text-align:center;padding:22px 8px">No ${statsCount ? statsCount + '-player ' : ''}games ${isAll ? 'recorded' : 'in ' + selLbl} yet.</p>`;
    titleCard(`${back}
      ${seasonSeg}
      ${countSeg}
      ${body}`);
    // Keep the active pill visible: scroll each strip horizontally ONLY if the selected pill sits
    // off (or under) an edge, and only just enough to bring it in — no jarring jump for a pill
    // that's already on screen. (Runs on open and after every selection, since we re-render.)
    requestAnimationFrame(() => document.querySelectorAll('.stseasonseg').forEach((seg) => {
      const on = seg.querySelector('button.on'); if (!on) return;
      const sr = seg.getBoundingClientRect(), br = on.getBoundingClientRect(), pad = 12;
      if (br.right > sr.right - pad) seg.scrollLeft += br.right - sr.right + pad;        // off the right edge -> reveal
      else if (br.left < sr.left + pad) seg.scrollLeft -= sr.left + pad - br.left;       // off the left edge -> reveal
    }));
  }
  function statsPlayerScreen(key) {
    const d = STATS.detail(key);
    if (!d) { statsScreen(); return; }
    const wae = (d.wae >= 0 ? '+' : '') + d.wae.toFixed(1);
    const chips = [['Games', d.gp], ['Wins', d.w], ['Win%', d.winpct + '%'], ['WAE', wae], ['Avg place', d.avg.toFixed(1)], ['Streak', d.cur + ' · best ' + d.best]];
    const chipHTML = chips.map((c) => `<div class="stchip"><span class="stcv">${c[1]}</span><span class="stcl">${c[0]}</span></div>`).join('');
    const h2hHTML = Object.keys(d.h2h).map((ok) => { const r = d.h2h[ok], lead = r.w > r.l ? 'stpos' : (r.w < r.l ? 'stneg' : '');
      return `<div class="h2hrow"><span class="h2hn">vs ${escapeHtml(r.name)}</span><span class="h2hr ${lead}">${r.w}–${r.l}</span></div>`; }).join('');
    const roadIco = ROAD_ICO ? `<img src="${ROAD_ICO}" class="stbonico" alt="">` : '🛤';
    titleCard(`<div class="lobhead"><button class="lobback" onclick="CATAN.openStats()" title="Back to stats">←</button><h3>${escapeHtml(d.name)}</h3></div>
      <div class="stchips">${chipHTML}</div>
      <h4 class="stsub">Head to head</h4>
      <div class="h2hlist">${h2hHTML}</div>
      <h4 class="stsub">Bonuses held</h4>
      <div class="stbon"><span>${roadIco} Longest Road ×${d.lr}</span><span><span class="stbonemo">⚔</span> Largest Army ×${d.la}</span></div>`);
  }
  // Build the static lobby frame (title + dyn slot + footer) ONCE per entry. Only an
  // explicit showLobby() ever calls this; background ticks never rebuild the frame.
  function lobbyShell() {
    // back arrow (top-left, goes back one level) + subtle right-hand tools (avatar -> profile, stats)
    const back = `<button class="lobback" id="lobback" data-nav="back" title="Back">←</button>`;
    const tools = `<div class="lobtools">` +
      `<button class="lobtool lobav" data-nav="profile" title="Manage profile">${faceHTML(AUTH.me.name, AUTH.me.avatar, 'sm')}</button>` +
      `<button class="lobtool" data-nav="stats" title="Stats & leaderboard">🏆</button></div>`;
    titleCard(`<div class="lobhead">${back}<h3 id="lob-title">Lobby</h3>${tools}</div><div id="lobby-dyn"></div>`);
    lobbySig = null;
  }
  function renderLobby() {
    if (NET.started || !AUTH.me) return;
    document.body.classList.remove('ingame');   // lobby is a menu -> the rotate gate must never cover it
    const dynEl = $('lobby-dyn'), t = $('title');
    if (!dynEl || !t || t.classList.contains('hidden')) return;   // not the visible screen -> never clobber it
    const all = LOBBY.online();
    // sig over the whole presence (table memberships + modes) so any change re-renders
    const sig = JSON.stringify([LOBBY.table, LOBBY.inProgress, LOBBY.mode, LOBBY.targetPoints,
      all.map((p) => p.id + ':' + (p.table || '') + ':' + pmode(p) + ':' + p.name + ':' + (p.readyAt || 0) + ':' + (p.target || '') + ':' + (p.created || '') + ':' + (p.away ? 'a' : '')).sort()]);
    if (sig === lobbySig) return;
    lobbySig = sig;
    dynEl.innerHTML = LOBBY.table ? atTableHTML(all) : tableListHTML(all);   // footer frame untouched
    const tt = $('lob-title'); if (tt) tt.textContent = LOBBY.table ? LOBBY.gameName(LOBBY.table) : 'Lobby';   // "<creator>'s Game" at a table
    const bk = $('lobback'); if (bk) bk.title = LOBBY.table ? 'Back to games' : 'Switch player';   // back arrow goes back one level
    scheduleFit();   // content height just changed (players joined/readied) -> rescale now + across font-load/frames so the card never overflows
  }
  // browsing: a list of active tables to join, plus "New table"
  function tableListHTML(all) {
    const me = escapeHtml(AUTH.me.name);
    const tables = {};
    all.forEach((p) => { if (p.table) (tables[p.table] = tables[p.table] || []).push(p); });
    const codes = Object.keys(tables).sort();
    const browsing = all.filter((p) => !p.table).length;
    const rows = codes.length ? codes.map((code) => {
      const m = tables[code], inGame = m.some((p) => pmode(p) === 'playing');
      const creator = m.find((p) => p.created === code);
      const gname = creator ? escapeHtml(creator.name) + "'s Game" : 'Game';
      const names = m.map((p) => escapeHtml(p.name)).join(', ');
      return `<button class="tablerow" onclick="CATAN.joinTable('${code}')"><span class="trow-main"><span class="tgname">${gname}</span><span class="tgwho">${names || 'Empty'}</span></span>` +
        `<span class="${inGame ? 't-pend' : 't-acc'}">${inGame ? '🔴 watch' : m.length + ' here'}</span></button>`;
    }).join('') : `<p class="muted" style="text-align:center;margin:12px 0">No games yet — start one.</p>`;
    return `<p class="muted small" style="text-align:center">${me} · ${all.length} online${browsing ? ' · ' + browsing + ' browsing' : ''}</p>
      <div class="loblist">${rows}</div>
      <button class="btn wood full" onclick="CATAN.newTable()">+ New game</button>
      <div class="rgsec">
        <div class="rghead"><span>Recent games</span><button class="rglink" data-nav="stats">Full stats →</button></div>
        <div class="rglist">${STATS.games.length ? recentRowsHTML(STATS.games, 8) : `<p class="muted small" style="text-align:center;padding:8px 0">${STATS.loaded ? 'No games recorded yet.' : 'Loading…'}</p>`}</div>
      </div>`;
  }
  // sitting at a table: the ready/spectate/start lobby, scoped to this table's members
  function atTableHTML(all) {
    const members = all.filter((p) => (p.table || null) === LOBBY.table);
    const ready = LOBBY.readyList();
    const creator = members.find((p) => p.created === LOBBY.table);
    const rows = lobbyRows(members, ready, creator ? creator.id : null);
    // no in-card "back to games" button — the top-left ← in the header handles leaving
    if (LOBBY.inProgress) {
      return `<p class="muted small" style="text-align:center">${members.length} here</p>
        <div class="loblist">${rows}</div>
        <button class="btn wood full" onclick="CATAN.lobbyWatch()">🔴 Game in progress · Watch</button>`;
    }
    // the game's CREATOR starts it (fallback: first-ready, if the creator has left the table)
    const host = creator || ready[0], iAmHost = host && host.id === AUTH.me.id;
    const hostReady = host && ready.some((r) => r.id === host.id);
    const seatN = Math.min(4, ready.length);
    // the win target follows PLAYERS AT THE TABLE (spectators excluded), so it updates as people join — not only once they ready up
    const playerN = Math.min(4, members.filter((m) => pmode(m) !== 'spectate').length) || seatN;
    const chosen = iAmHost ? LOBBY.targetPoints : (creator ? creator.target : null);
    // host's pick if set; else the count default for 2+ players (2p15 · 3p13 · 4p11); else the general 13
    const tgt = (chosen != null ? chosen : (playerN >= 2 ? targetForN(playerN) : 13));
    const hostName = escapeHtml((host && host.name) || 'the host');
    const startBtn = iAmHost
      ? (ready.length < 2 ? `<button class="btn full" disabled>Start · need 2 ready</button>`
        : !hostReady ? `<button class="btn full" disabled>Ready up to start</button>`
          : `<button class="btn full" onclick="CATAN.lobbyStart()">Start · ${seatN}p (${tgt} pts)</button>`)
      : `<button class="btn full" disabled>${ready.length < 2 ? 'Waiting for players…' : 'Waiting for ' + hostName + ' to start…'}</button>`;
    const targetRow = iAmHost
      ? `<div class="lobtgt"><span class="lobtgt-lbl">Win at <b id="tgt-val">${tgt}</b> pts</span><input class="lobtgt-slider" type="range" min="9" max="15" step="1" value="${tgt}" oninput="var e=document.getElementById('tgt-val');if(e)e.textContent=this.value" onchange="CATAN.lobbyTarget(this.value)"></div>`
      : `<div class="lobtgt muted">Win at ${tgt} pts</div>`;
    return `<p class="muted small" style="text-align:center">${members.length} here · ${ready.length} ready</p>
      <div class="loblist">${rows}</div>
      ${targetRow}
      <div class="lobrow2">
        <button class="btn ${LOBBY.mode === 'ready' ? '' : 'wood'}" onclick="CATAN.lobbyReady()">${LOBBY.mode === 'ready' ? '✓ Ready' : "I'm ready"}</button>
        <button class="btn ${LOBBY.mode === 'spectate' ? '' : 'wood'}" onclick="CATAN.lobbySpectate()">${LOBBY.mode === 'spectate' ? '✓ Spectating' : '👁 Spectate'}</button>
      </div>
      ${startBtn}`;
  }
  window.CATAN.openStats = () => statsScreen();
  window.CATAN.statsSeason = (s) => { statsSeason = s; statsScreen(); };
  window.CATAN.statsYear = (y) => { statsSeason = STATS.latestMonthIn(y) || 'all'; statsScreen(); };   // pick a year -> its most recent month
  window.CATAN.statsCount = (n) => { statsCount = n; statsScreen(); };
  window.CATAN.statsPlayer = (n) => statsPlayerScreen(decodeURIComponent(n));
  window.CATAN.lobbyBack = () => { if (LOBBY.table) CATAN.leaveTable(); else CATAN.lobbyLogout(); };
  window.CATAN.newTable = () => { const code = genCode(); LOBBY.created = code; LOBBY.enterTable(code); };
  window.CATAN.lobbyTarget = (v) => { LOBBY.targetPoints = Math.max(9, Math.min(15, parseInt(v, 10) || 13)); LOBBY.track(); lobbySig = null; renderLobby(); };
  window.CATAN.joinTable = (code) => LOBBY.enterTable(code);
  window.CATAN.leaveTable = () => LOBBY.leaveTable();
  window.CATAN.lobbyReady = () => LOBBY.setReady();
  window.CATAN.lobbySpectate = () => LOBBY.setSpectate();
  window.CATAN.lobbyWatch = () => LOBBY.watch();
  window.CATAN.lobbyStart = () => LOBBY.startTable();
  // hoisted helpers registered here, after window.CATAN exists, so onclick="CATAN.x()" works
  window.CATAN.sendBroadcast = sendBroadcastMsg;
  window.CATAN.openQuickChat = () => openQuickChat();
  // spectator taps a player chip -> view their resources; tapping the active one again returns to follow-the-turn
  window.CATAN.specView = (color) => { specView = (specView === color) ? null : color; renderCounts(); };
  window.CATAN.quickSendIdx = (i) => { const t = AUTH.quickList()[i]; if (t) quickSend(t); };
  window.CATAN.recStop = () => finishRec(false);
  window.CATAN.recCancel = () => finishRec(true);
  window.CATAN.showMsgs = (color) => showMsgHistory(color);
  window.CATAN.openCustomMsg = () => openBroadcast();
  window.CATAN.manageQuick = (from) => manageQuickMsgs(from);
  window.CATAN.quickEdit = (i, v) => { if (qmDraft && i < qmDraft.length) qmDraft[i] = String(v).slice(0, 50); };
  window.CATAN.quickDel = (i) => { if (qmDraft) { qmDraft.splice(i, 1); persistQuick(); manageQuickMsgs(); } };
  window.CATAN.quickAdd = () => { const el = $('qmNew'); const v = (el && el.value || '').trim().slice(0, 50); if (!v) return; if (!qmDraft) qmDraft = []; if (qmDraft.length >= 16) { toast('Max 16 messages'); return; } qmDraft.push(v); persistQuick(); manageQuickMsgs(); };
  window.CATAN.quickDone = (from) => { persistQuick(); qmDraft = null; if (from === 'profile') manageProfile(); else { hideOverlay(); render(); } };
  window.CATAN.raiseFlag = () => { hideOverlay(); raiseFlag(); };
  window.CATAN.lowerFlag = () => { hideOverlay(); lowerFlag(); };
  window.CATAN.exitGame = () => {
    // ensure no higher layer (radial root sits at z-31, above the overlay) eats taps
    const rr = $('radialroot'); if (rr) { rr.classList.remove('open'); rr.classList.add('hidden'); }
    const spectator = online && !myColor;   // a watcher: leaving just returns them to the lobby
    const endsForAll = online && myColor;   // a seated player leaving ends the table
    // quitting a LIVE game (not one that's already ended) costs a penalty; a finished game leaves cleanly
    const midGame = endsForAll && state && state.phase === 'play' && state.players.length > 1;
    const ttl = spectator ? 'Stop watching?' : midGame ? 'Quit the game?' : 'Leave game?';
    const sub = spectator ? 'You go back to the lobby. The game keeps going for the players.'
      : midGame ? 'Quitting ends the game for everyone. You take a penalty — it counts as a loss — and the win goes to whoever is leading.'
      : endsForAll ? 'This ends the game for everyone.' : 'You will leave this game.';
    const act = spectator ? 'Leave to lobby' : midGame ? 'Quit — take the penalty' : endsForAll ? 'End game' : 'Leave game';
    // big, full-width stacked targets — Cancel is the prominent safe action, leave is below
    // seated online players can raise/lower a white flag (concede). Last one standing wins.
    const canFlag = endsForAll && state && state.players.length > 1;
    const voteBtn = !canFlag ? '' : (iAmFlagged()
      ? `<button class="btn wood full" style="padding:14px;font-size:15px;margin-top:9px" onclick="CATAN.lowerFlag()">⬇ Lower white flag — keep fighting</button>`
      : `<button class="btn wood full" style="padding:14px;font-size:15px;margin-top:9px" onclick="CATAN.raiseFlag()">🏳️ Raise white flag — give up</button>`);
    showOverlay(`<h3>${ttl}</h3>
      <p class="muted" style="text-align:center;margin:6px 0 12px">${sub}</p>
      <button class="btn full" style="padding:16px;font-size:16px" onclick="CATAN.close()">${spectator ? 'Cancel — keep watching' : 'Cancel — keep playing'}</button>
      ${voteBtn}
      <button class="btn ${spectator ? 'wood' : 'end'} full" style="padding:15px;font-size:15px;margin-top:9px" onclick="CATAN.confirmExit()">${act}</button>`);
    const o = $('overlay'); o.onclick = (e) => { if (e.target === o) CATAN.close(); };   // tap outside the card to cancel
  };
  window.CATAN.confirmExit = async () => {
    hideOverlay();
    if (!online) { NET.started = false; startScreen(); return; }
    const wasSpectator = !myColor;
    // seated player quitting a LIVE game: hand the win to the leader + take a penalty, then leave the
    // table WITHOUT wiping the game row, so the others receive the ended state and record it too.
    if (!wasSpectator && state && state.phase === 'play' && state.players.length > 1) {
      let quit = false;
      try { quit = await endByQuit(); } catch (_) { }
      if (quit) { NET.started = false; online = false; myColor = null; NET.version = 0; exitGameUI(); LOBBY.leaveTable(); return; }
    }
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
  window.CATAN.rematch = () => LOBBY.rematch();

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
      if (r && r.ok) { this.me = { id: r.id, name: r.name, token: s.token, avatar: r.avatar || null, quickMsgs: Array.isArray(r.quick_msgs) ? r.quick_msgs : null }; return true; }
      return false;
    },
    async login(name, pin) {
      const r = await this.rpc('player_login', { p_name: name, p_pin: pin });
      if (r && r.ok) { this.save({ id: r.id, name: r.name, token: r.token, avatar: r.avatar || null, quickMsgs: Array.isArray(r.quick_msgs) ? r.quick_msgs : null }); return { ok: true }; }
      return { ok: false, error: (r && r.error) || 'Login failed' };
    },
    async create(name, pin) {
      const r = await this.rpc('player_create', { p_name: name, p_pin: pin });
      if (r && r.ok) { this.save({ id: r.id, name: r.name, token: r.token, avatar: null, quickMsgs: null }); return { ok: true }; }
      return { ok: false, error: (r && r.error) || 'Could not create player' };
    },
    // a player's quick-chat presets — their saved list, or the shared defaults until they customise
    quickList() { const m = this.me && this.me.quickMsgs; return (Array.isArray(m) && m.length) ? m : DEFAULT_QUICK_MSGS.slice(); },
    async setQuickMsgs(arr) {
      if (!this.me) return { ok: false, error: 'Not logged in' };
      const clean = (arr || []).map((s) => String(s).trim().slice(0, 50)).filter(Boolean).slice(0, 16);
      const r = await this.rpc('player_set_quick_msgs', { p_token: this.me.token, p_msgs: clean });
      if (r && r.ok) { this.me.quickMsgs = clean; this.save(this.me); }
      return r;
    },
    // returns [{name, avatar}] (older server returned bare name strings — normalise both)
    async list() { const r = await this.rpc('player_list', {}); return Array.isArray(r) ? r.map((p) => typeof p === 'string' ? { name: p, avatar: null } : p) : []; },
    async setPin(oldPin, newPin) { if (!this.me) return { ok: false, error: 'Not logged in' }; return await this.rpc('player_set_pin', { p_token: this.me.token, p_old: oldPin, p_new: newPin }); },
    async setName(name) {
      if (!this.me) return { ok: false, error: 'Not logged in' };
      const r = await this.rpc('player_set_name', { p_token: this.me.token, p_name: name });
      if (r && r.ok) { this.me.name = r.name; this.save(this.me); }
      return r;
    },
    async setAvatar(dataUrl) {
      if (!this.me) return { ok: false, error: 'Not logged in' };
      const r = await this.rpc('player_set_avatar', { p_token: this.me.token, p_avatar: dataUrl });
      if (r && r.ok) { this.me.avatar = dataUrl || null; this.save(this.me); }
      return r;
    },
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
    t.classList.remove('hidden'); hideOverlay(); stopMusic(); document.body.classList.remove('ingame');   // pre-game: portrait allowed
    document.body.style.background = MENU_BG;   // canvas (incl. iOS safe-area strip) matches the wood menu
    $('leavetab').classList.add('hidden'); $('radialtab').classList.add('hidden'); $('settingstab').classList.add('hidden');
    scheduleFit();
  }
  async function showIdentity(mode) {
    mode = mode || 'list';
    const names = mode === 'list' ? await AUTH.list() : [];
    if (mode === 'list') {
      const list = names.length
        ? names.map((n) => `<button class="btn full authrow" onclick="CATAN.authPick('${encodeURIComponent(n.name)}')">${faceHTML(n.name, n.avatar)}<span class="anm">${escapeHtml(n.name)}</span></button>`).join('')
        : `<p class="muted" style="text-align:center;margin:8px 0">No players yet — create one.</p>`;
      const recent = STATS.games.length ? recentRowsHTML(STATS.games, 8) : `<p class="muted small" style="text-align:center;padding:8px 0">${STATS.loaded ? 'No games recorded yet.' : 'Loading…'}</p>`;
      titleCard(`<div class="lobhead"><h3>Login</h3><div class="lobtools"><button class="lobtool" data-nav="stats" title="Stats & leaderboard">🏆</button></div></div>
        <div class="authlist">${list}</div>
        <button class="btn wood full" onclick="CATAN.authNew()">+ New player</button>
        <button class="offline-link" onclick="CATAN.playOffline()">Pass &amp; play offline</button>
        <div class="rgsec"><div class="rghead"><span>Recent games</span><button class="rglink" data-nav="stats">Full stats →</button></div>
          <div class="rglist" id="login-recent">${recent}</div></div>`);
      STATS.load().then(() => { const el = $('login-recent'); if (el) el.innerHTML = STATS.games.length ? recentRowsHTML(STATS.games, 8) : `<p class="muted small" style="text-align:center;padding:8px 0">No games recorded yet.</p>`; });
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
      // focus SYNCHRONOUSLY, still inside the name-tap gesture, so iOS opens the keyboard
      const el = $('auPin'); if (el) el.focus();
    }
  }
  // Returning to a menu (esp. after spectating a live game): tear down every game-layer
  // element so nothing lingers over the lobby — a stray fly/countdown layer, the rotate
  // gate, or a half-open radial can all make the footer look dead.
  function exitGameUI() {
    ['leavetab', 'radialtab', 'settingstab', 'dicereveal', 'toast', 'confirmbar', 'countdown'].forEach((id) => { const e = $(id); if (e) e.classList.add('hidden'); });
    const rr = $('radialroot'); if (rr) { rr.classList.remove('open'); rr.classList.add('hidden'); }
    document.querySelectorAll('.flyres, .robberdrag').forEach((el) => el.remove());
    document.body.classList.remove('ingame', 'trading');
    hideOverlay();
  }
  function showLobby() {
    if (!AUTH.me) { showIdentity(); return; }
    exitGameUI();      // clear any lingering game layer before the lobby paints
    lobbyShell();      // build the frame (title + footer + empty dyn slot) once
    LOBBY.join();
    renderLobby();     // fill the dynamic half
    STATS.load().then(() => { if (!NET.started && !LOBBY.table && $('lobby-dyn')) { lobbySig = null; renderLobby(); } });   // fill the recent-games strip once results load
    purgeStaleGames();   // auto-clean abandoned/idle games whenever someone opens the lobby
    lastRecorded = null;   // a fresh lobby visit re-arms the one-shot result writer for the next game
  }
  // throttled housekeeping: ask the server to drop idle/abandoned games (see server/cleanup.sql)
  let lastPurge = 0;
  function purgeStaleGames() {
    const now = Date.now();
    if (now - lastPurge < 300000) return;   // at most once per 5 min per device
    lastPurge = now;
    const c = NET.client; if (!c) return;
    c.rpc('purge_stale_games').then(({ error }) => { if (error) console.warn('purge failed:', error.message); }, () => {});
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
      <button class="btn ghost full" data-nav="profback">Back</button>`);
  };
  window.CATAN.authDoChangePin = async () => { const r = await AUTH.setPin(($('auOld') || {}).value, ($('auNew') || {}).value); if (r && r.ok) { toast('PIN changed'); manageProfile(); } else { const e = $('auErr'); if (e) e.textContent = (r && r.error) || 'Failed'; } };

  // ===== Manage Profile: photo (cropper) + nickname + change PIN ==================
  function manageProfile() {
    const me = AUTH.me; if (!me) { showLobby(); return; }
    titleCard(`<h3>Manage Profile</h3>
      <div class="profhead">
        <button class="profpic" onclick="CATAN.pickAvatar()" aria-label="Change photo">${faceHTML(me.name, me.avatar, 'lg')}<span class="profcam">📷</span></button>
        <div class="profhbtns">
          <button class="btn wood" onclick="CATAN.pickAvatar()">${me.avatar ? 'Change photo' : 'Add photo'}</button>
          ${me.avatar ? `<button class="btn ghost" onclick="CATAN.clearAvatar()">Remove</button>` : ''}
        </div>
      </div>
      <label class="proflbl">Nickname</label>
      <div class="profname">
        <input id="profName" class="authin" maxlength="20" value="${escapeHtml(me.name)}" autocomplete="off"/>
        <button class="btn" onclick="CATAN.saveName()">Save</button>
      </div>
      <div id="profErr" class="auerr"></div>
      <button class="btn full" onclick="CATAN.manageQuick('profile')">💬 Quick messages</button>
      <button class="btn full" data-nav="changepin">Change PIN</button>
      <button class="btn ghost full" data-nav="lobby">← Back to lobby</button>`);
  }
  window.CATAN.manageProfile = () => manageProfile();
  window.CATAN.saveName = async () => {
    const el = $('profName'); const v = (el && el.value || '').trim();
    if (v === AUTH.me.name) { manageProfile(); return; }
    const r = await AUTH.setName(v);
    if (r && r.ok) { LOBBY.track(); toast('Nickname updated'); manageProfile(); }
    else { const e = $('profErr'); if (e) e.textContent = (r && r.error) || 'Could not rename'; }
  };
  window.CATAN.clearAvatar = async () => { const r = await AUTH.setAvatar(null); if (r && r.ok) { LOBBY.track(); manageProfile(); } else toast((r && r.error) || 'Failed'); };

  // --- photo picker -> cropper -------------------------------------------------
  let cropImg = null, cropState = null, cropUrl = null;
  function freeCropUrl() { if (cropUrl) { try { URL.revokeObjectURL(cropUrl); } catch (_) {} cropUrl = null; } }
  window.CATAN.pickAvatar = () => {
    let inp = $('avatarFile');
    if (!inp) { inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.id = 'avatarFile'; inp.style.display = 'none'; inp.addEventListener('change', onAvatarFile); document.body.appendChild(inp); }
    inp.value = ''; inp.click();
  };
  function onAvatarFile(e) {
    const f = e.target.files && e.target.files[0]; if (!f) return;
    freeCropUrl();
    cropUrl = URL.createObjectURL(f);   // kept alive until the cropper closes (revoking early left a dead src)
    const img = new Image();
    img.onload = () => openCropper(img);
    img.onerror = () => { freeCropUrl(); toast("Couldn't read that image"); };
    img.src = cropUrl;   // <img> decodes HEIC on iOS where createImageBitmap can't
  }
  function openCropper(img) {
    cropImg = img;
    const ov = $('cropper');
    ov.classList.remove('hidden');
    const frame = ov.querySelector('.cropframe');
    const CB = Math.min(frame.clientWidth, frame.clientHeight);
    const base = Math.max(CB / img.naturalWidth, CB / img.naturalHeight);   // cover
    cropState = { CB, base, z: 1, tx: 0, ty: 0, iw: img.naturalWidth, ih: img.naturalHeight };
    const el = ov.querySelector('.cropimg');
    el.src = img.src;
    clampCrop(); applyCrop();
    bindCropGestures(ov);
  }
  function clampCrop() {
    const s = cropState, scale = s.base * s.z;
    const halfW = (s.iw * scale - s.CB) / 2, halfH = (s.ih * scale - s.CB) / 2;   // max pan so image still covers
    s.tx = Math.max(-halfW, Math.min(halfW, s.tx));
    s.ty = Math.max(-halfH, Math.min(halfH, s.ty));
  }
  function applyCrop() {
    const s = cropState, ov = $('cropper'), el = ov.querySelector('.cropimg');
    el.style.transform = `translate(-50%,-50%) translate(${s.tx}px,${s.ty}px) scale(${(s.base * s.z).toFixed(4)})`;
  }
  function bindCropGestures(ov) {
    if (ov._bound) return; ov._bound = true;
    const pts = new Map(); let pinch = null, pan = null;
    const stage = ov.querySelector('.cropframe');
    stage.addEventListener('pointerdown', (e) => { pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); stage.setPointerCapture(e.pointerId);
      if (pts.size === 1) pan = { x: e.clientX, y: e.clientY, tx: cropState.tx, ty: cropState.ty };
      else if (pts.size === 2) { const a = [...pts.values()]; pinch = { d: Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y), z: cropState.z }; pan = null; } });
    stage.addEventListener('pointermove', (e) => { if (!pts.has(e.pointerId)) return; pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size >= 2 && pinch) { const a = [...pts.values()], d = Math.hypot(a[0].x - a[1].x, a[0].y - a[1].y); cropState.z = Math.max(1, Math.min(5, pinch.z * d / (pinch.d || 1))); clampCrop(); applyCrop(); }
      else if (pan) { cropState.tx = pan.tx + (e.clientX - pan.x); cropState.ty = pan.ty + (e.clientY - pan.y); clampCrop(); applyCrop(); } });
    const up = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (pts.size === 1) { const p = [...pts.values()][0]; pan = { x: p.x, y: p.y, tx: cropState.tx, ty: cropState.ty }; } };
    stage.addEventListener('pointerup', up); stage.addEventListener('pointercancel', up);
    stage.addEventListener('wheel', (e) => { e.preventDefault(); cropState.z = Math.max(1, Math.min(5, cropState.z * Math.exp(-e.deltaY * 0.0015))); clampCrop(); applyCrop(); }, { passive: false });
    ov.querySelector('.cropzoom').addEventListener('input', (e) => { cropState.z = 1 + Number(e.target.value) / 100 * 4; clampCrop(); applyCrop(); });
  }
  window.CATAN.cropCancel = () => { $('cropper').classList.add('hidden'); cropImg = null; freeCropUrl(); };
  window.CATAN.cropConfirm = async () => {
    const s = cropState, OUT = 256, scale = s.base * s.z;
    const sw = s.CB / scale, sh = s.CB / scale;                          // source square in image px
    const sx = s.iw / 2 - s.tx / scale - sw / 2, sy = s.ih / 2 - s.ty / scale - sh / 2;
    const cv = document.createElement('canvas'); cv.width = OUT; cv.height = OUT;
    const ctx = cv.getContext('2d');
    ctx.drawImage(cropImg, sx, sy, sw, sh, 0, 0, OUT, OUT);
    let data = cv.toDataURL('image/jpeg', 0.72);
    if (data.length > 90000) data = cv.toDataURL('image/jpeg', 0.5);      // keep it light for the DB + presence
    $('cropper').classList.add('hidden'); cropImg = null; freeCropUrl();
    const btn = document.querySelector('.profpic'); if (btn) btn.style.opacity = '0.5';
    const r = await AUTH.setAvatar(data);
    if (r && r.ok) { LOBBY.track(); manageProfile(); } else { manageProfile(); toast((r && r.error) || 'Upload failed'); }
  };

  function boot() {
    const v = document.getElementById('ver'); if (v) v.textContent = APP_VERSION;   // version stamp (login/lobby)
    const rv = document.getElementById('radialver'); if (rv) rv.textContent = APP_VERSION;   // in-game: shown in the radial menu
    initBoardZoom();
    const m = location.href.match(/[?#&]rig(?:=(\d))?\b/);   // ?rig -> 4 players, ?rig=2 -> 2, etc.
    if (m) { rigNearWin(m[1] ? parseInt(m[1], 10) : 4); return; }
    AUTH.start();
  }
  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
