/* Catan service worker — precache the app shell + all art so repeat launches are
   instant and fully offline. Code files use network-first (so updates land when
   online); static assets use cache-first (so they never reload). Bump VERSION
   whenever an existing asset's bytes change. */
const VERSION = 'catan-v28';
const NET_FIRST = ['index.html', 'app.js', 'catan-engine.js', 'supabase-config.js'];
const PRECACHE = ["./","index.html","app.js","catan-engine.js","supabase-config.js","manifest.webmanifest","icon-192.png","icon-512.png","icon-167.png","apple-touch-icon.png","assets/audio/button_down.mp3","assets/audio/button_up.mp3","assets/audio/city.mp3","assets/audio/dice_finished.mp3","assets/audio/dice_roll.mp3","assets/audio/fanfare.mp3","assets/audio/knight.mp3","assets/audio/res_brick.mp3","assets/audio/res_grain.mp3","assets/audio/res_lumber.mp3","assets/audio/res_ore.mp3","assets/audio/res_wool.mp3","assets/audio/road.mp3","assets/audio/robber.mp3","assets/audio/trade.mp3","assets/audio/village.mp3","assets/audio/whoosh.mp3","assets/avatars/.keep","assets/avatars/p1.png","assets/avatars/p2.png","assets/avatars/p3.png","assets/avatars/p4.png","assets/fonts/fertigo_pro-webfont.ttf","assets/fonts/fertigo_pro-webfont.woff","assets/fonts/fertigoproregular.ttf","assets/hud/badge-army.png","assets/hud/badge-card.png","assets/hud/badge-res.png","assets/hud/badge-road.png","assets/hud/badge-vp.png","assets/hud/bar.png","assets/hud/build-city.png","assets/hud/build-knight.png","assets/hud/build-road.png","assets/hud/build-settlement.png","assets/hud/candidate-city.png","assets/hud/candidate-road.png","assets/hud/candidate-settlement.png","assets/hud/cardback.png","assets/hud/confirm.png","assets/hud/crown.png","assets/hud/decline.png","assets/hud/dev-back.png","assets/hud/dev-bg.png","assets/hud/dev-buy.png","assets/hud/dev-face-buy.png","assets/hud/dev-face-knight.png","assets/hud/dev-face-monopoly.png","assets/hud/dev-face-plenty.png","assets/hud/dev-face-road.png","assets/hud/dev-face-vp.png","assets/hud/dev-knight.png","assets/hud/dev-monopoly.png","assets/hud/dev-plenty.png","assets/hud/dev-road.png","assets/hud/dev-vp.png","assets/hud/dice-1.png","assets/hud/dice-2.png","assets/hud/dice-3.png","assets/hud/dice-4.png","assets/hud/dice-5.png","assets/hud/dice-6.png","assets/hud/orb.png","assets/hud/radial/open.png","assets/hud/radial/build.png","assets/hud/radial/close.png","assets/hud/radial/dev.png","assets/hud/radial/end.png","assets/hud/radial/roll.png","assets/hud/radial/trade.png","assets/hud/res-brick.png","assets/hud/res-ore.png","assets/hud/res-sheep.png","assets/hud/res-wheat.png","assets/hud/res-wood.png","assets/hud/star.png","assets/hud/victory-star.png","assets/hud/wood.png","assets/hud/trade/bank.png","assets/hud/trade/arrow-give.png","assets/hud/trade/arrow-get.png","assets/icons/.keep","assets/icons/app-master.png","assets/icons/brick.png","assets/icons/ore.png","assets/icons/sheep.png","assets/icons/wheat.png","assets/icons/wood.png","assets/logo.png","assets/pieces/.keep","assets/pieces/city-blue.png","assets/pieces/city-green.png","assets/pieces/city-red.png","assets/pieces/city-yellow.png","assets/pieces/road-eastwest-blue.png","assets/pieces/road-eastwest-green.png","assets/pieces/road-eastwest-red.png","assets/pieces/road-eastwest-yellow.png","assets/pieces/road-northeast-blue.png","assets/pieces/road-northeast-green.png","assets/pieces/road-northeast-red.png","assets/pieces/road-northeast-yellow.png","assets/pieces/road-northwest-blue.png","assets/pieces/road-northwest-green.png","assets/pieces/road-northwest-red.png","assets/pieces/road-northwest-yellow.png","assets/pieces/settlement-blue.png","assets/pieces/settlement-green.png","assets/pieces/settlement-red.png","assets/pieces/settlement-yellow.png","assets/ports/.keep","assets/ports/brick.png","assets/ports/bridge.png","assets/ports/generic.png","assets/ports/harbor.png","assets/ports/ore.png","assets/ports/sheep.png","assets/ports/wheat.png","assets/ports/wood.png","assets/robber.png","assets/sea.png","assets/tiles/.keep","assets/tiles/brick.png","assets/tiles/desert.png","assets/tiles/ore.png","assets/tiles/sheep.png","assets/tiles/water.png","assets/tiles/wheat.png","assets/tiles/wood.png","assets/tokens/.keep","assets/tokens/10.png","assets/tokens/11.png","assets/tokens/12.png","assets/tokens/2.png","assets/tokens/3.png","assets/tokens/4.png","assets/tokens/5.png","assets/tokens/6.png","assets/tokens/8.png","assets/tokens/9.png"];

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await Promise.allSettled(PRECACHE.map((u) => cache.add(new Request(u, { cache: 'reload' }))));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;                       // never touch writes (Supabase POST/PATCH)
  const url = new URL(req.url);
  if (url.origin !== location.origin) {
    if (url.hostname.indexOf('supabase.co') >= 0) return; // realtime + REST: always live
    e.respondWith(cacheFirst(req));                       // CDN libs (supabase-js) -> cache
    return;
  }
  const name = url.pathname.split('/').pop() || 'index.html';
  if (req.mode === 'navigate' || NET_FIRST.indexOf(name) >= 0) e.respondWith(networkFirst(req));
  else e.respondWith(cacheFirst(req));                    // all art/audio/fonts -> instant from cache
});

async function cacheFirst(req) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(req, { ignoreSearch: true });
  if (hit) return hit;
  try { const res = await fetch(req); if (res && res.ok) cache.put(req, res.clone()); return res; }
  catch (_) { return hit || Response.error(); }
}
async function networkFirst(req) {
  const cache = await caches.open(VERSION);
  // cache:'reload' bypasses the browser HTTP cache so code updates land immediately (GitHub
  // Pages serves with max-age=600, which otherwise hands back stale app.js/index.html).
  try { const res = await fetch(req, { cache: 'reload' }); if (res && res.ok) cache.put(req, res.clone()); return res; }
  catch (_) { return (await cache.match(req, { ignoreSearch: true })) || (await cache.match('index.html')) || Response.error(); }
}
