const { chromium, devices } = require('playwright'); const fs = require('fs');
const CFG = process.argv[2], RUN = +process.argv[3] || 1, GAP = 1500;
// cfg = <build>-<plain|side>[-video][-nohas][-nopulse][-nofilter][-willchange]; build v214 -> _v214.html, anything else -> the current code
const PAGE = CFG.startsWith('v214') ? '_v214.html' : CFG.includes('side') ? '_rot2.html' : '_t2.html';
(async () => { const b = await chromium.launch(); const side = CFG.includes('side');
  const ctx = await b.newContext(devices[side ? 'Pixel 7' : 'Pixel 7 landscape']); await ctx.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
  const p = await ctx.newPage(); const cdp = await ctx.newCDPSession(p);
  await p.addInitScript(() => { let x = 12345; Math.random = () => { x = (x * 16807) % 2147483647; return x / 2147483647; }; });
  await p.goto('http://localhost:8766/' + PAGE); await p.waitForTimeout(3500);
  const f = side ? p.frames().find((x) => x !== p.mainFrame()) : p.mainFrame();
  await f.evaluate(() => { window._mkStream = (hue) => { const c = document.createElement('canvas'); c.width = 320; c.height = 240; const g = c.getContext('2d'); let k = 0; setInterval(() => { k++; g.fillStyle = `hsl(${hue},25%,${34 + (k % 8)}%)`; g.fillRect(0, 0, 320, 240); g.fillStyle = '#d8b08f'; g.beginPath(); g.ellipse(160 + (k % 10), 110, 50, 64, 0, 0, 7); g.fill(); }, 66); return c.captureStream(15); }; });
  await f.evaluate(() => CATAN._gameN(3, 3 * 7919)); await p.waitForTimeout(3500);
  await f.evaluate((rec) => { window._REC = JSON.parse(rec); CATAN._noTips && CATAN._noTips(); }, fs.readFileSync('px/rec.json', 'utf8'));
  if (CFG.includes('video')) await f.evaluate(() => { CATAN._voice4(); });
  if (CFG.includes('nohas')) console.log('has-rules removed:', await f.evaluate(() => { let n = 0; for (const sh of document.styleSheets) { let rs; try { rs = sh.cssRules; } catch (e) { continue; } for (let i = rs.length - 1; i >= 0; i--) { const walk = (list, del) => { for (let j = list.length - 1; j >= 0; j--) { const r = list[j]; if (r.cssRules && !r.selectorText) walk(r.cssRules, (k) => r.deleteRule(k)); else if (r.selectorText && r.selectorText.includes(':has(')) { del(j); n++; } } }; walk([rs[i]], () => { sh.deleteRule(i); }); } } return n; }));
  if (CFG.includes('nopulse')) await f.addStyleTag({ content: '.corner.active, .corner.active::after{animation:none!important}' });
  if (CFG.includes('nofilter')) await f.addStyleTag({ content: '.corner:not(.active){filter:none!important}' });   // what the dim filter costs with video inside
  if (CFG.includes('willchange')) await f.addStyleTag({ content: '.corner{will-change:transform}' });   // corners as their own layers
  const rot = side ? await p.evaluate(() => document.getElementById('app').style.transform) : '';
  if (side && !rot.includes('rotate')) { console.log(CFG + ',' + RUN + ',NOT-TURNED'); await b.close(); return; }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await p.waitForTimeout(2500);
  await f.evaluate(() => { window._lt = []; window._po = new PerformanceObserver((l) => l.getEntries().forEach((e) => window._lt.push(e.duration))); window._po.observe({ entryTypes: ['longtask'] }); window._fr = []; let last = performance.now(); window._stop = false; (function k(t) { window._fr.push(t - last); last = t; if (!window._stop) requestAnimationFrame(k); })(last); });
  const n = await f.evaluate(() => window._REC.length);
  for (let i = 0; i < n; i++) { await f.evaluate((j) => { CATAN._noTips && CATAN._noTips(); CATAN._replay(j); }, i); await p.waitForTimeout(GAP); }
  const r = await f.evaluate(() => { window._stop = true; window._po.disconnect(); const fr = window._fr.slice(1), lt = window._lt; const secs = fr.reduce((a, x) => a + x, 0) / 1000; return { fps: Math.round(fr.length / secs), jank: Math.round(fr.filter((d) => d > 33.4).length / fr.length * 100), stalls: lt.length, ms: Math.round(lt.reduce((a, x) => a + x, 0)), worst: Math.round(Math.max(0, ...lt)) }; });
  console.log([CFG, RUN, r.fps, r.jank, r.stalls, r.ms, r.worst].join(','));
  await b.close(); })();
