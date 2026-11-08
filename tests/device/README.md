# Device tests (Android Pixel 7 / iPhone emulation in headless Chrome)

Written 2026-11-09 while chasing Lapen's Pixel 7 bugs. No KVM in the cloud sandbox, so no real Android emulator:
these use Playwright's Chromium with device profiles (`devices['Pixel 7']`, `devices['iPhone 15']`), real CDP
touch events (`Input.dispatchTouchEvent`) and `Emulation.setCPUThrottlingRate` 4x. They do NOT replace a real phone
(real camera/LiveKit, real GPU, Safari's WebKit engine).

## Build the test pages (never ship these)
From `prototype/`: `node build.mjs`, then inject the hooks into a COPY of `catan-standalone.html`:
- `_t.html`  = standalone with `window.CATAN = {` replaced by `hookP.txt + hookX.txt` (practice-table hooks)
- `_t2.html` = same, but `hookAll.txt` (has `_gameN`, `_voice`, `_spec`) with hookP/hookX merged in
- `_rot.html` / `_rot2.html` = `rotate.html` with `frame.src = 'index.html'` changed to `_t.html` / `_t2.html`
The hook files reference app.js internals (state, LIVE, PRACTICE, render...), so they only work in the same IIFE.
Serve `prototype/` on port 8766 (`python3 -m http.server 8766`), run scripts with `NODE_PATH=$(npm root -g) node <script>`.
Delete every `_*.html` afterwards.

## Scripts
- `sweep.js side|plain [flip]`: 10 touch checks (pinch, pan, menu, emoji tray open/send/scroll/flip, emoji throw,
  robber drag + confirm). Expect 10/10 in all three modes.
- `drag2.js [land]`: the robber-drag repro alone (Lapen's "robber in the sea").
- `rec.js` + `bench3.js <cfg> <run>`: record 26 bot moves once, replay the SAME moves into each build and measure fps,
  dropped frames (>33 ms) and long tasks (>50 ms). cfgs: v214-plain (needs a `_v214.html` built from commit aa9ab15),
  new-plain, new-plain-video, new-side, new-side-video, new-side-video-nopulse. Run sequentially (parallel runs skew).
- `badge2.js`: camera stub that refuses to switch off while hidden; checks the badge tells the truth after returning.
- `handfit.js`: bottom bar stays between the bottom corners at 932/874/812/667/568 wide.

## Gotchas found
- Signing in on an unframed page hops to rotate.html (sideways redirect): use `_gameN` for plain-page runs.
- The app reloads when it hears no server for 40 s on wake, and on a service-worker takeover: block service workers
  (`serviceWorkers: 'block'`) and set `NET.heardAt` in tests.
- First-time tips (luck tour) cover the screen: call `CATAN._noTips()`.
- Headless paints in software: fps/dropped-frame numbers are directional only; long-task totals are reliable.
