// prof.js <cfg> : same replay as bench3.js, but with the CDP profiler + Performance.getMetrics, so we see WHERE the
// time goes: script / style recalc / layout split, plus the top self-time functions. Headless, software paint:
// paint cost is invisible here, script/style/layout are real. cfgs as in bench3.js.
const { chromium, devices } = require('playwright'); const fs = require('fs');
const CFG = process.argv[2] || 'new-plain-video', GAP = 1500, TOP = +(process.argv[3] || 22);
const PAGE = { 'v214-plain': '_v214.html', 'new-plain': '_t2.html', 'new-plain-video': '_t2.html', 'new-side': '_rot2.html', 'new-side-video': '_rot2.html' }[CFG];
(async () => { const b = await chromium.launch(); const side = CFG.includes('side');
  const ctx = await b.newContext(devices[side ? 'Pixel 7' : 'Pixel 7 landscape']); await ctx.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
  const p = await ctx.newPage();
  await p.addInitScript(() => { let x = 12345; Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; });
  await p.goto('http://localhost:8766/' + PAGE); await p.waitForTimeout(3500);
  const f = side ? p.frames().find((x) => x !== p.mainFrame()) : p.mainFrame();
  const cdp = await ctx.newCDPSession(side ? f : p);
  await f.evaluate(() => { window._mkStream = (hue) => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); let k = 0; setInterval(() => { k++; g.fillStyle = `hsl(${hue},25%,${34 + (k % 8)}%)`; g.fillRect(0, 0, 320, 240); g.fillStyle = '#d8b08f'; g.beginPath(); g.ellipse(160 + (k % 10), 110, 50, 64, 0, 0, 7); g.fill(); }, 66); return c.captureStream(15); }; });
  await f.evaluate(() => CATAN._gameN(3, 3 * 7919)); await p.waitForTimeout(3500);
  await f.evaluate((rec) => { window._REC = JSON.parse(rec); CATAN._noTips && CATAN._noTips(); }, fs.readFileSync('px/rec.json', 'utf8'));
  if (CFG.includes('video')) await f.evaluate(() => { CATAN._voice4(); });
  await p.waitForTimeout(2500);
  await cdp.send('Performance.enable'); await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
  const m0 = (await cdp.send('Performance.getMetrics')).metrics.reduce((a, m) => (a[m.name] = m.value, a), {});
  await cdp.send('Profiler.start');
  const n = await f.evaluate(() => window._REC.length);
  for (let i = 0; i < n; i++) { await f.evaluate((j) => { CATAN._noTips && CATAN._noTips(); CATAN._replay(j); }, i); await p.waitForTimeout(GAP); }
  const { profile } = await cdp.send('Profiler.stop');
  const m1 = (await cdp.send('Performance.getMetrics')).metrics.reduce((a, m) => (a[m.name] = m.value, a), {});
  const d = (k) => Math.round(((m1[k] || 0) - (m0[k] || 0)) * 1000);
  console.log(`${CFG}: script ${d('ScriptDuration')} ms, style recalc ${d('RecalcStyleDuration')} ms (${Math.round(m1.RecalcStyleCount - m0.RecalcStyleCount)}x), layout ${d('LayoutDuration')} ms (${Math.round(m1.LayoutCount - m0.LayoutCount)}x), task ${d('TaskDuration')} ms over ${Math.round((m1.Timestamp - m0.Timestamp))} s`);
  // self time per function (url:line), top N
  const self = new Map(), byId = new Map(); profile.nodes.forEach((nd) => byId.set(nd.id, nd));
  const dt = profile.timeDeltas; let total = 0;
  profile.samples.forEach((id, i) => { const nd = byId.get(id), cf = nd.callFrame; const t = dt[i] || 0; total += t;
    const key = (cf.functionName || '(anon)') + ' @' + (cf.url || '').split('/').pop() + ':' + (cf.lineNumber + 1); self.set(key, (self.get(key) || 0) + t); });
  const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP);
  console.log('top self time (ms, % of sampled):'); rows.forEach(([k, v]) => console.log(`  ${String(Math.round(v / 1000)).padStart(6)}  ${(v / total * 100).toFixed(1).padStart(5)}%  ${k}`));
  await b.close(); })();
