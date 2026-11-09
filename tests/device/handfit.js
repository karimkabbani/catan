const { chromium } = require('playwright');
(async () => { const b = await chromium.launch();
  for (const [w, h] of [[932, 430], [874, 402], [812, 375], [667, 375], [568, 320]]) {
    const p = await b.newPage({ viewport: { width: w, height: h } }); await p.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
    await p.goto('http://localhost:8766/_t2.html'); await p.waitForTimeout(1500);
    await p.evaluate(() => { window._mkStream = () => document.createElement('canvas').captureStream(1); CATAN._gameN(4, 4 * 7919); }); await p.waitForTimeout(4500);
    await p.evaluate(() => CATAN._voice4()); await p.waitForTimeout(2500);
    const r = await p.evaluate(() => { const hd = document.getElementById('hand').getBoundingClientRect(); let L = 0, R = innerWidth;
      document.querySelectorAll('.corner.bl, .corner.br').forEach((c) => [c, c.querySelector('.pluck')].forEach((e) => { if (!e) return; const q = e.getBoundingClientRect(); if (c.classList.contains('bl')) L = Math.max(L, q.right); else R = Math.min(R, q.left); }));
      const kids = [...document.getElementById('hand').children]; const overflow = document.getElementById('hand').scrollWidth > document.getElementById('hand').clientWidth + 1;
      return { bar: [Math.round(hd.left), Math.round(hd.right)], L: Math.round(L), R: Math.round(R), gap: document.getElementById('hand').style.gap, overflow }; });
    console.log(w + 'x' + h, JSON.stringify(r), 'clear:', r.bar[0] >= r.L && r.bar[1] <= r.R && !r.overflow);
    await p.close();
  }
  await b.close(); })();
