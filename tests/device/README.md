# Device tests (Android Pixel 7 / iPhone emulation in headless Chrome)

Written 2026-11-09 while chasing Lapen's Pixel 7 bugs. No KVM in the cloud sandbox, so no real Android emulator:
these use Playwright's Chromium with device profiles (`devices['Pixel 7']`, `devices['iPhone 15']`), real CDP
touch events (`Input.dispatchTouchEvent`) and `Emulation.setCPUThrottlingRate` 4x. They do NOT replace a real phone
(real camera/LiveKit, real GPU, Safari's WebKit engine).

## Build the test pages (never ship these)
`./make-pages.sh` does all of this (build, hook injection, the v214 baseline page from commit aa9ab15). By hand, from
`prototype/`: `node build.mjs`, then inject the hooks into a COPY of `catan-standalone.html`:
- `_t.html`  = standalone with `window.CATAN = {` replaced by `hookP.txt + hookX.txt` (practice-table hooks)
- `_t2.html` = same, but `hookAll.txt` (has `_gameN`, `_voice`, `_spec`) with hookP/hookX merged in
- `_rot.html` / `_rot2.html` = `rotate.html` with `frame.src = 'index.html'` changed to `_t.html` / `_t2.html`
The hook files reference app.js internals (state, LIVE, PRACTICE, render...), so they only work in the same IIFE.
Serve `prototype/` on port 8766 (`python3 -m http.server 8766`), run scripts with `NODE_PATH=$(npm root -g) node <script>`.
Delete every `_*.html` afterwards.

## Scripts
- `sweep.js side|plain [flip] [iphone]`: 10 touch checks (pinch, pan, menu, emoji tray open/send/scroll/flip, emoji throw,
  robber drag + confirm). Expect 10/10 in all three modes, on the Pixel 7 and with `iphone` (Playwright's iPhone 15
  profile: 393x659 at 3x, Safari user agent, so the app's iOS branches run; the engine is still Chromium, not WebKit).
- `drag2.js [land]`: the robber-drag repro alone (Lapen's "robber in the sea").
- `rec.js` + `bench3.js <cfg> <run>`: record 26 bot moves once, replay the SAME moves into each build and measure fps,
  dropped frames (>33 ms), long tasks (>50 ms) and main-thread busy ms (CDP TaskDuration: the steadiest column). cfg =
  `<v214|new>-<plain|side>[-video][-streams][-nohas][-nopulse][-nofilter][-willchange]`: video = 4 fake cameras shown,
  streams = the 4 fake cameras running but not shown (harness overhead to subtract), the rest inject a CSS variant.
  `./runbench.sh out.csv cfg...` runs 3 of each sequentially (parallel runs skew each other badly: two sets ran side by
  side once and both slowed 2x), `node med.js out.csv` prints the medians.
- `prof.js <cfg>`: the same replay under the CDP profiler: script / style recalc / layout split and the top self-time
  functions. No CPU throttle here. 2026-11-09 finding: without video the new code's script is +0.1 s and style/layout
  unchanged vs v214 over the 40 s replay; the stall metric (2.2 vs 4.1 s) exaggerates because the same work lands in fewer,
  longer tasks. With 4 videos: +1.5 s script (about half of it the harness's own fake cameras) and +1.4 s native paint.
- `badge2.js`: camera stub that refuses to switch off while hidden; checks the badge tells the truth after returning.
- `handfit.js`: bottom bar stays between the bottom corners at 932/874/812/667/568 wide.

## Gotchas found
- Signing in on an unframed page hops to rotate.html (sideways redirect): use `_gameN` for plain-page runs.
- The app reloads when it hears no server for 40 s on wake, and on a service-worker takeover: block service workers
  (`serviceWorkers: 'block'`) and set `NET.heardAt` in tests.
- First-time tips (luck tour) cover the screen: call `CATAN._noTips()`.
- Headless paints in software: fps/dropped-frame numbers are directional only, +-2 fps between identical runs; the busy ms
  column and long-task totals are steadier. Paint-side changes (the gold pulse, the dim filter, layer promotion) barely show
  here: of the three only `will-change` on the corners measured (40 -> 43 fps). Real GPUs differ: only phones tell.
