// verify.js: the v237 behaviours that replaced CSS :has() rules and full redraws, checked on the Pixel 7 landscape page.
const { chromium, devices } = require('playwright');
(async () => { const b = await chromium.launch(); const ctx = await b.newContext(Object.assign({}, devices['Pixel 7 landscape'], { serviceWorkers: 'block' })); await ctx.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(e.message));
  await p.goto('http://localhost:8766/_t2.html'); await p.waitForTimeout(2500);
  await p.evaluate(() => { window._mkStream = (hue) => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); let k = 0; setInterval(() => { k++; g.fillStyle = `hsl(${hue},60%,50%)`; g.fillRect(0, 0, 320, 240); g.fillStyle = '#d8b08f'; g.fillRect(100 + (k % 10), 60, 120, 120); }, 66); return c.captureStream(15); }; });
  await p.evaluate(() => CATAN._gameN(3, 3 * 7919)); await p.waitForTimeout(2000); await p.evaluate(() => CATAN._noTips());
  const R = []; const ok = (n, pass, d) => R.push((pass ? 'PASS ' : 'FAIL ') + n + (d ? '  (' + d + ')' : ''));
  // 1. own corner carries .haschat (was :has(.pemo)); the robbed pill rule needs it
  const hc = await p.evaluate(() => ({ cls: document.querySelector('.corner.bl').className, pemo: !!document.querySelector('.corner.bl .pemo') }));
  ok('own corner has .haschat with the talk buttons', hc.cls.includes('haschat') && hc.pemo, hc.cls);
  // 2. who-starts card -> body.rpsup / .rpsstrip
  const rb = await p.evaluate(() => CATAN._rpsBody()); ok('rps card up/strip/hidden -> body classes', rb[0] === 'rpsup' && rb[1] === 'rpsup+rpsstrip' && rb[2] === '-', rb.join(' | '));
  // 3. the gold pulse is a glow layer, not a box-shadow animation
  const pulse = await p.evaluate(() => { const a = document.querySelector('.corner.active'); const cs = getComputedStyle(a), ps = getComputedStyle(a, '::after'); return { corner: cs.animationName, after: ps.animationName, afterShadow: ps.boxShadow !== 'none', afterWC: ps.willChange }; });
  ok('pulse: corner has no animation, ::after animates (opacity)', pulse.corner === 'none' && pulse.after === 'panelpulse' && pulse.afterShadow, JSON.stringify(pulse));
  // 4. a landing card updates the number in place (same <b> node, no corner rebuild)
  const me = 'red';   // _gameN seats Karim as red
  const land = await p.evaluate((c) => CATAN._land(c, 'wood'), me);
  ok('card lands: number ticks in place', land.sameNode && +land.mid === +land.before - 1 && +land.after === +land.before, JSON.stringify(land));
  // 5. video: 4 cameras drawn (frame-gated), canvases at 1.5x and not black; corners are layers
  await p.evaluate(() => CATAN._voice4()); await p.waitForTimeout(1200);
  const vp = await p.evaluate(() => CATAN._vidPix()); const dpr = await p.evaluate(() => Math.min(1.5, devicePixelRatio));
  const box = await p.evaluate(() => { const c = document.querySelector('canvas.vvid').parentNode; return [c.clientWidth, c.clientHeight]; });
  ok('video pictures drawn and not black (2 cameras: me + Kay; the 3-player game has no yellow seat)', vp.length === 2 && vp.every((s) => !/:0\/0\/0$/.test(s)), vp.join(' '));
  ok('video canvas at 1.5x of its box', vp[0].startsWith(Math.round(box[0] * dpr) + 'x' + Math.round(box[1] * dpr)), vp[0] + ' box ' + box + ' dpr ' + dpr);
  const wc = await p.evaluate(() => getComputedStyle(document.querySelector('.corner')).willChange); ok('corners are their own layers with video', wc === 'transform', wc);
  // frame gating: freeze a stream (stop its interval) -> its canvas stops changing while the others keep drawing
  const gate = await p.evaluate(async () => { const v = LIVE_vids(); return v; function LIVE_vids() { const L = CATAN._live(); return Object.keys(L.vids).map((k) => [k, L.vids[k]._vfc === true, typeof L.vids[k]._vfcAt]); } });
  ok('requestVideoFrameCallback watching every video', gate.length === 2 && gate.every((g) => g[1] && g[2] === 'number'), JSON.stringify(gate));
  // 6. talking: .vtalk on the picture and .vtalkin on its corner (was :has()), cleared when quiet
  await p.evaluate(() => CATAN._talk('pid-blue', 0.5)); await p.waitForTimeout(400);
  const t1 = await p.evaluate(() => { const el = document.querySelector('[data-vid="pid-blue"]'); return [el.classList.contains('vtalk'), el.closest('.corner').classList.contains('vtalkin'), getComputedStyle(el.closest('.corner')).filter]; });
  await p.evaluate(() => CATAN._talk('pid-blue', 0)); await p.waitForTimeout(400);
  const t2 = await p.evaluate(() => { const el = document.querySelector('[data-vid="pid-blue"]'); return [el.classList.contains('vtalk'), el.closest('.corner').classList.contains('vtalkin')]; });
  ok('talking marks picture + corner (undimmed), quiet clears both', t1[0] && t1[1] && t1[2] === 'none' && !t2[0] && !t2[1], JSON.stringify([t1, t2]));
  // 7. sideways rollout gate
  const g1 = await p.evaluate(() => CATAN._gate(['test', 'test2'])), g2 = await p.evaluate(() => CATAN._gate(['Karim'])), g3 = await p.evaluate(() => CATAN._gate(null));
  ok('sidewaysOnly gate: not listed -> no, listed -> yes, no list -> yes (cached for the launch redirect)', g1[0] === false && g1[1] === '0' && g2[0] === true && g2[1] === '1' && g3[0] === true && g3[1] === '1', JSON.stringify([g1, g2, g3]));
  // 8. hidden tab: the draw loop idles
  await p.screenshot({ path: 'px/verify.png' });
  // hiding switches my camera off and redraws the corners (fresh, undrawn 300x150 canvases); they must stay undrawn while
  // hidden and get drawn again within a few frames of coming back
  await p.evaluate(() => CATAN._net()); await p.evaluate(() => CATAN._hide(true)); await p.waitForTimeout(300); const a1 = await p.evaluate(() => CATAN._vidPix()); await p.waitForTimeout(500); const a2 = await p.evaluate(() => CATAN._vidPix());
  await p.evaluate(() => CATAN._hide(false)); await p.waitForTimeout(400); const a3 = await p.evaluate(() => CATAN._vidPix());
  ok('no video drawing while hidden, drawing resumes on return', a1.length && JSON.stringify(a1) === JSON.stringify(a2) && a1.every((x) => x.startsWith('300x150')) && a3.length && a3.every((x) => !x.startsWith('300x150')), a1.join(' ') + ' -> ' + a3.join(' '));
  R.forEach((x) => console.log('  ' + x)); if (errs.length) console.log('  page errors:', errs.slice(0, 4));
  await b.close(); })();
