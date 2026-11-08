const { chromium, devices } = require('playwright');
// sweep.js side|plain [flip] [iphone]: side = phone upright in the sideways frame | plain = landscape, no frame.
// Default phone is the Pixel 7 (Android Chrome); 'iphone' uses Playwright's iPhone 15 profile (viewport 393x659 / 3x,
// Safari user agent, so the app's iOS code paths run) in Chromium: WebKit itself is not installed here.
const ARGS = process.argv.slice(2), MODE = ARGS[0] || 'side', FLIP = ARGS.includes('flip'), IPHONE = ARGS.includes('iphone');
const PHONE = IPHONE ? 'iPhone 15' : 'Pixel 7';
(async () => { const b = await chromium.launch();
  const ctx = await b.newContext(devices[MODE === 'side' ? PHONE : PHONE + ' landscape']); await ctx.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
  const p = await ctx.newPage(); const errs = [];
  if (FLIP) await p.addInitScript(() => { try { localStorage.setItem('catanSideFlip', '1'); } catch (e) { } });
  await p.goto(MODE === 'side' ? 'http://localhost:8766/_rot.html' : 'http://localhost:8766/_t2.html'); await p.waitForTimeout(3500);
  const f = MODE === 'side' ? p.frames().find((x) => x !== p.mainFrame()) : p.mainFrame();
  f.page().on('pageerror', (e) => errs.push(e.message));
  await f.evaluate(() => { window._mkStream = () => document.createElement('canvas').captureStream(1); });
  if (MODE === 'side') { await f.evaluate(() => CATAN._login()); await p.waitForTimeout(800); await f.evaluate(() => { CATAN._proom(); CATAN.practiceStart(true); }); }
  else await f.evaluate(() => CATAN._gameN(3, 3 * 7919));   // straight into a game: no sign-in hop to the sideways page
  await p.waitForTimeout(5000);
  if (MODE !== 'side' && !p.url().endsWith('_t.html')) { console.log('control page hopped to', p.url()); }
  await f.evaluate(() => { const c = document.getElementById('coach'); if (c) c.remove(); CATAN.close && CATAN.close(); CATAN._noTips(); CATAN._noBots(); CATAN._myMain(); CATAN._noTips(); });
  await p.waitForTimeout(1500);
  const T = MODE === 'side' ? await p.evaluate(() => document.getElementById('app').style.transform) : '';
  const W0 = MODE === 'side' ? await p.evaluate(() => innerWidth) : 0, H0 = MODE === 'side' ? await p.evaluate(() => innerHeight) : 0;
  const toHost = MODE === 'side' ? (FLIP ? (([x, y]) => [y, H0 - x]) : (([x, y]) => [W0 - y, x])) : ((q) => q);
  const cdp = await ctx.newCDPSession(p);
  const touch = (type, pts) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: pts.map((q, i) => { const h = toHost(q); return { x: h[0], y: h[1], id: i }; }) });
  const centre = (sel) => f.evaluate((s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return r.width ? [r.left + r.width / 2, r.top + r.height / 2] : null; }, sel);
  const tap = async (pt) => { await touch('touchStart', [pt]); await p.waitForTimeout(60); await touch('touchEnd', []); await p.waitForTimeout(500); };
  const drag = async (a, z, steps = 10, holdMs = 0) => { await touch('touchStart', [a]); await p.waitForTimeout(holdMs || 60); for (let i = 1; i <= steps; i++) { await touch('touchMove', [[a[0] + (z[0] - a[0]) * i / steps, a[1] + (z[1] - a[1]) * i / steps]]); await p.waitForTimeout(30); } await touch('touchEnd', []); await p.waitForTimeout(600); };
  const R = [];
  const ok = (name, pass, detail) => { R.push((pass ? 'PASS ' : 'FAIL ') + name + (detail ? '  (' + detail + ')' : '')); };
  // 1. pinch to zoom the board
  const bc = await centre('#board-area');
  await touch('touchStart', [[bc[0] - 40, bc[1]], [bc[0] + 40, bc[1]]]); await p.waitForTimeout(60);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', [[bc[0] - 40 - i * 12, bc[1]], [bc[0] + 40 + i * 12, bc[1]]]); await p.waitForTimeout(30); }
  await touch('touchEnd', []); await p.waitForTimeout(500);
  const z1 = await f.evaluate(() => CATAN._z()); ok('pinch zooms the board', z1.s > 1.3, 'scale ' + z1.s);
  // 2. one-finger pan
  await drag([bc[0], bc[1]], [bc[0] + 90, bc[1] + 50]);
  const z2 = await f.evaluate(() => CATAN._z()); ok('one-finger pan moves the board', Math.abs(z2.tx - z1.tx) > 30 || Math.abs(z2.ty - z1.ty) > 20, `moved ${z2.tx - z1.tx},${z2.ty - z1.ty}`);
  await f.evaluate(() => CATAN._zreset()); await p.waitForTimeout(400);
  // 3. tap the round menu button
  const rt = await centre('#radialtab'); if (rt) await tap(rt);
  const rOpen = await f.evaluate(() => { const r = document.getElementById('radialroot'); return !!r && !r.classList.contains('hidden'); }); ok('tap opens the round menu', rOpen, rt ? '' : 'button not found');
  if (rOpen) { await tap([20, 20]); await f.evaluate(() => CATAN.closeRadial && CATAN.closeRadial()); }
  await p.waitForTimeout(400);
  // 4. emoji tray: tap 😀 button, tap an emoji to send
  const eb = await centre('.corner.bl .pemo'); if (eb) await tap(eb);
  const trayOpen = await f.evaluate(() => CATAN._trayMode()); ok('tap 😀 opens the emoji tray', trayOpen === 'emo', 'mode ' + trayOpen);
  const before = await f.evaluate(() => document.querySelectorAll('.emofloat, .bcbubble, .emoburst, [class*="emo"]').length);
  const e1 = await centre('#emotray .etbig .emobtn'); if (e1) await tap(e1);
  const after = await f.evaluate(() => document.querySelectorAll('.emofloat, .bcbubble, .emoburst, [class*="emo"]').length);
  ok('tap an emoji sends it', after > before, `${before}->${after}`);
  // 4b. drag up inside the tray scrolls the emojis
  { const g = await f.evaluate(() => { const e = document.querySelector('#emotray .etbig'); const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height * 0.8, r.top + r.height * 0.2]; });
    const s0 = await f.evaluate(() => CATAN._etScroll()); await drag([g[0], g[1]], [g[0], g[2]], 8);
    const s1 = await f.evaluate(() => CATAN._etScroll()); ok('drag up in the tray scrolls the emojis', s1 && s1[0] > s0[0], `scrollTop ${s0 && s0[0]}->${s1 && s1[0]} of ${s1 && s1[1]}`);
    await f.evaluate(() => { const e = document.querySelector('#emotray .etbig'); if (e) e.scrollTop = 0; }); }
  // 5. swipe sideways in the tray flips to texts
  await f.evaluate(() => { if (!document.getElementById('emotray')) CATAN.openTray && CATAN.openTray('emo'); });
  if (!(await f.evaluate(() => CATAN._trayMode()))) { const eb2 = await centre('.corner.bl .pemo'); if (eb2) await tap(eb2); }
  const tr = await f.evaluate(() => { const r = document.getElementById('emotray').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; });
  await drag([tr[0] + tr[2] * 0.75, tr[1] + tr[3] * 0.5], [tr[0] + tr[2] * 0.2, tr[1] + tr[3] * 0.5], 8);
  const m2 = await f.evaluate(() => CATAN._trayMode()); ok('swipe in the tray flips to texts', m2 === 'txt', 'mode ' + m2);
  // 6. hold an emoji and throw it at a player
  if (m2 === 'txt') await drag([tr[0] + tr[2] * 0.2, tr[1] + tr[3] * 0.5], [tr[0] + tr[2] * 0.8, tr[1] + tr[3] * 0.5], 8);
  const e2 = await centre('#emotray .etbig .emobtn'); const opp = await centre('.corner.tr .pava') || await centre('.corner.tl .pava');
  const thrB = await f.evaluate(() => document.querySelectorAll('.emothrow, .emosplat').length);
  if (e2 && opp) await drag(e2, opp, 12, 420);
  await p.waitForTimeout(300);
  const thr = await f.evaluate(() => ({ n: document.querySelectorAll('.emothrow, .emosplat').length, ghosts: document.querySelectorAll('.emoghost').length }));
  ok('hold + drag an emoji onto a player throws it', thr.n > thrB && thr.ghosts === 0, JSON.stringify(thr));
  await f.evaluate(() => { const t = document.getElementById('emotray'); if (t) t.remove(); });
  // 7. robber drag on a 7
  await f.evaluate(() => CATAN._seven()); await p.waitForTimeout(2200); await f.evaluate(() => CATAN._noTips());
  const [from, to] = await f.evaluate(() => { const s = CATAN._dragState(); const all = [...Array(19).keys()].filter((h) => h !== s.robber); return [CATAN._hexXY(s.robber), CATAN._hexXY(all[4])]; });
  await drag(from, to, 10);
  const ds = await f.evaluate(() => CATAN._dragState()); ok('drag the robber to another hex', !ds.dragging && ds.imgs === 0 && ds.confirm && ds.confirm.type === 'moveRobber', JSON.stringify(ds.confirm));
  // 8. confirm with the tick
  const tick = await centre('#confirmbar .yes, #confirmbar button, .cfm.yes, [onclick*="confirmYes"]');
  if (tick) await tap(tick);
  const moved = await f.evaluate(() => CATAN._dragState()); ok('tap ✓ places the robber', moved.robber === (ds.confirm && ds.confirm.hex), `robber on ${moved.robber}`);
  console.log(`== ${PHONE}, ${MODE === 'side' ? (FLIP ? 'sideways frame FLIPPED' : 'sideways frame (upright)') : 'landscape, plain page (control)'} ${T}`); R.forEach((x) => console.log('  ' + x));
  if (errs.length) console.log('  page errors:', errs.slice(0, 4));
  await p.screenshot({ path: `px/sweep-${PHONE.replace(/ /g, '')}-${MODE}${FLIP ? '-flip' : ''}.png` });
  await b.close(); })();
