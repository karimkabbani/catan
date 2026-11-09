// frame.js: the sideways host (rotate.html). Fakes an iPhone's portrait insets (62 top / 34 bottom) on the host page and
// checks: lobby (unturned) = frame fills the screen and the app lays out against those insets (tab bar at the very
// bottom); in a game (turned) = frame inset inside the safe area and the app's own insets zero (item 66).
const { chromium, devices } = require('playwright');
(async () => { const b = await chromium.launch(); const ctx = await b.newContext(Object.assign({}, devices['iPhone 15'], { serviceWorkers: 'block' })); await ctx.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.addInitScript(() => { if (window.top === window) document.addEventListener('DOMContentLoaded', () => { const st = document.createElement('style'); st.textContent = '#probe{padding:62px 0px 34px 0px !important}'; document.head.appendChild(st); }); });
  await p.goto('http://localhost:8766/_rot.html'); await p.waitForTimeout(2500);
  const f = p.frames().find((x) => x !== p.mainFrame()); f.page().on('pageerror', (e) => errs.push(e.message));
  await f.evaluate(() => CATAN._login()); await p.waitForTimeout(1500);
  const R = []; const ok = (n, pass, d) => R.push((pass ? 'PASS ' : 'FAIL ') + n + (d ? '  (' + d + ')' : ''));
  const host = () => p.evaluate(() => { const r = document.getElementById('app').getBoundingClientRect(); return { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height), W: innerWidth, H: innerHeight, t: document.getElementById('app').style.transform }; });
  const app = () => f.evaluate(() => { const cs = getComputedStyle(document.documentElement); const tabs = document.querySelector('.lvtabs'); const tr = tabs && tabs.getBoundingClientRect(); return { sab: cs.getPropertyValue('--sa-b').trim(), sat: cs.getPropertyValue('--sa-t').trim(), tabsBottom: tr && Math.round(tr.bottom), H: innerHeight, framed: document.documentElement.classList.contains('framed'), cut: document.body.className.match(/cut-\w/g) }; });
  const h1 = await host(), a1 = await app();
  ok('lobby: frame fills the whole screen', h1.x === 0 && h1.y === 0 && h1.w === h1.W && h1.h === h1.H, JSON.stringify(h1));
  ok('lobby: app uses the host insets (62 top / 34 bottom)', a1.sat === '62px' && a1.sab === '34px', JSON.stringify(a1));
  ok('lobby: tab bar sits on the bottom edge of the screen', a1.tabsBottom === a1.H && a1.H === h1.H, `tabs bottom ${a1.tabsBottom} / app ${a1.H} / screen ${h1.H}`);
  await f.evaluate(() => { CATAN._proom(); CATAN.practiceStart(true); }); await p.waitForTimeout(4000);
  const h2 = await host(), a2 = await app();
  ok('game: frame turned and kept inside the safe area', h2.t.includes('rotate') && h2.y === 62 && h2.h === h2.H - 62 - 34, JSON.stringify(h2));
  ok('game: app insets zero while turned', a2.sat === '0px' && a2.sab === '0px', JSON.stringify(a2));
  const corner = await f.evaluate(() => { const c = document.querySelector('.corner.bl').getBoundingClientRect(); return { left: Math.round(c.left), bottomGap: Math.round(innerHeight - c.bottom) }; });
  ok('game: bottom-left corner hugs the frame edges (item 66)', corner.left <= 10 && corner.bottomGap <= 12, JSON.stringify(corner));
  await f.evaluate(() => CATAN.practiceToRoom()); await p.waitForTimeout(2500);
  const h3 = await host(), a3 = await app();
  ok('back in the lobby: full screen + host insets again', h3.x === 0 && h3.y === 0 && h3.h === h3.H && a3.sab === '34px' && a3.tabsBottom === a3.H, JSON.stringify({ h3, a3 }));
  R.forEach((x) => console.log('  ' + x)); if (errs.length) console.log('  page errors:', errs.slice(0, 4));
  await b.close(); })();
