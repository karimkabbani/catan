const { chromium, devices } = require('playwright');
const LAND = process.argv[2] === 'land';
(async () => { const b = await chromium.launch(); const ctx = await b.newContext(devices[LAND ? 'Pixel 7 landscape' : 'Pixel 7']); await ctx.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
  const p = await ctx.newPage(); await p.goto('http://localhost:8766/_rot.html'); await p.waitForTimeout(4000);
  const f = p.frames().find((x) => x !== p.mainFrame());
  await f.evaluate(() => { window._mkStream = () => document.createElement('canvas').captureStream(1); CATAN._login(); }); await p.waitForTimeout(1500);
  await f.evaluate(() => { CATAN._proom(); CATAN.practiceStart(true); }); await p.waitForTimeout(5000);
  await f.evaluate(() => { const c = document.getElementById('coach'); if (c) c.remove(); CATAN.close && CATAN.close(); CATAN._autome && 0; });
  await f.evaluate(() => { PRACTICE_PAUSE = 1; }).catch(() => {});
  console.log('7 rolled:', JSON.stringify(await f.evaluate(() => CATAN._seven()))); await p.waitForTimeout(2500);
  const [from, to] = await f.evaluate(() => { const s = CATAN._dragState(); const all = [...Array(19).keys()].filter((h) => h !== s.robber); return [CATAN._hexXY(s.robber), CATAN._hexXY(all[3])]; });
  const T = await p.evaluate(() => document.getElementById('app').style.transform);
  const toHost = LAND ? ((q) => q) : (([x, y]) => [412 - y, x]);   // frame turned 90deg, translate(412px,0)
  console.log('frame', T, 'robber at frame', from.map(Math.round), '-> host', toHost(from).map(Math.round));
  const cdp = await ctx.newCDPSession(p); const tp = (t, pt) => cdp.send('Input.dispatchTouchEvent', { type: t, touchPoints: t === 'touchEnd' ? [] : [{ x: pt[0], y: pt[1] }] });
  await f.evaluate(() => { window._ev = {}; ['pointerdown','pointermove','pointerup','pointercancel','touchstart','touchmove','touchend','touchcancel'].forEach((t) => document.addEventListener(t, (e) => { window._ev[t] = (window._ev[t] || 0) + 1; if (t === 'pointermove') window._lastMove = [Math.round(e.clientX), Math.round(e.clientY)]; }, true)); });
  await tp('touchStart', toHost(from)); await p.waitForTimeout(150);
  for (let i = 1; i <= 8; i++) { const fx = from[0] + (to[0] - from[0]) * i / 8, fy = from[1] + (to[1] - from[1]) * i / 8; await tp('touchMove', toHost([fx, fy])); await p.waitForTimeout(40); }
  console.log('mid-drag:', JSON.stringify(await f.evaluate(() => { const s = CATAN._dragState(); const im = document.querySelector('.robberdrag'); if (im) { const r = im.getBoundingClientRect(); s.imgAt = [Math.round(r.left), Math.round(r.top)]; } return s; })), 'finger(frame) at', to.map(Math.round));
  await p.screenshot({ path: 'px/drag-mid.png' });
  await tp('touchEnd'); await p.waitForTimeout(600);
  console.log('after lift:', JSON.stringify(await f.evaluate(() => CATAN._dragState())));
  console.log('events the game received:', JSON.stringify(await f.evaluate(() => [window._ev, window._lastMove])));
  await p.screenshot({ path: 'px/drag-after.png' });
  await b.close(); })();
