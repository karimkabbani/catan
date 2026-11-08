const { chromium, devices } = require('playwright');
// A camera that refuses to switch off while the app is in the background (what Android Chrome can do).
// Leave the app (like switching to Instagram), come back, and compare what the badge says with what is really sent.
(async () => {
  const b = await chromium.launch();
  for (const [label, page] of [['before fix', '_rot_old.html'], ['after fix', '_rot2.html']]) {
    const ctx = await b.newContext(Object.assign({}, devices['Pixel 7'], { serviceWorkers: 'block' }));
    await ctx.route(/supabase\.co|livekit\.cloud/, (r) => r.abort());
    const p = await ctx.newPage();
    await p.goto('http://localhost:8766/' + page); await p.waitForTimeout(4000);
    const f = p.frames().find((x) => x !== p.mainFrame());
    await f.evaluate(() => {
      window._mkStream = () => { const c = document.createElement('canvas'); c.width = 160; c.height = 120; const g = c.getContext('2d'); setInterval(() => { g.fillStyle = '#567'; g.fillRect(0, 0, 160, 120); }, 100); return c.captureStream(10); };
      CATAN._gameN(3, 3 * 7919);
    });
    await p.waitForTimeout(4000);
    await f.evaluate(() => { CATAN._voice4(); CATAN._stubborn(); }); await p.waitForTimeout(1200);
    const s0 = await f.evaluate(() => CATAN._camState()); console.log('  body before:', await f.evaluate(() => document.body.className));
    await f.evaluate(() => CATAN._hide(true)); await p.waitForTimeout(800);
    const sh = await f.evaluate(() => CATAN._camState());
    await f.evaluate(() => { if (CATAN._trace) CATAN._trace(); CATAN._hide(false); }); await p.waitForTimeout(1500);
    const tr = await f.evaluate(() => window.__trace);
    const s1 = await f.evaluate(() => CATAN._camState());
    console.log('  body on return:', await f.evaluate(() => document.body.className), '| before leaving had ingame:', s0 && true);
    console.log('  forced redraw:', JSON.stringify(await f.evaluate(() => CATAN._rp ? CATAN._rp() : null)));
    console.log(`== ${label}`);
    console.log('  before leaving    :', JSON.stringify(s0));
    console.log('  while away        :', JSON.stringify(sh));
    console.log('  after coming back :', JSON.stringify(s1));
    console.log('  trace on return [LIVE.cam, really sending, badge]:', JSON.stringify(tr));
    await ctx.close();
  }
  await b.close();
})();
