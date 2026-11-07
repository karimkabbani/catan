// Supabase Edge Function "voice-token": hands a logged-in Catan player a LiveKit access token.
// Deploy: Supabase dashboard > Edge Functions > Deploy a new function > Via editor, name "voice-token",
// paste this file, and turn OFF "Verify JWT" (the app sends the publishable key, which isn't a JWT; this
// function checks the player's own session token instead).
// Secrets (Edge Functions > Secrets): LIVEKIT_API_KEY, LIVEKIT_API_SECRET, LIVEKIT_URL.
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.
//
// Request:  POST { token: <player session token>, room: "trial" | "table-<CODE>" }
// Response: { ok: true, url, token, identity, name }  or  { ok: false, error }

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const b64url = (data: Uint8Array | string) => {
  const bytes = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

async function signJwt(payload: Record<string, unknown>, secret: string): Promise<string> {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${head}.${body}`)));
  return `${head}.${body}.${b64url(sig)}`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ ok: false, error: 'POST only' }, 405);

  const apiKey = Deno.env.get('LIVEKIT_API_KEY'), apiSecret = Deno.env.get('LIVEKIT_API_SECRET'), lkUrl = Deno.env.get('LIVEKIT_URL');
  const supaUrl = Deno.env.get('SUPABASE_URL'), anon = Deno.env.get('SUPABASE_ANON_KEY');
  if (!apiKey || !apiSecret || !lkUrl || !supaUrl || !anon) return json({ ok: false, error: 'Server not configured' }, 500);

  let body: { token?: string; room?: string };
  try { body = await req.json(); } catch { return json({ ok: false, error: 'Bad request' }, 400); }
  const room = String(body.room || '');
  if (!/^(trial|table-[A-Za-z0-9]{2,12})$/.test(room)) return json({ ok: false, error: 'Bad room' }, 400);
  if (!body.token) return json({ ok: false, error: 'Not logged in' }, 401);

  // Who is this? Same check the app uses for auto-login.
  const r = await fetch(`${supaUrl}/rest/v1/rpc/player_resume`, {
    method: 'POST',
    headers: { apikey: anon, Authorization: `Bearer ${anon}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_token: body.token }),
  });
  const me = r.ok ? await r.json() : null;
  if (!me || !me.ok) return json({ ok: false, error: 'Session expired' }, 401);
  // TODO (game build): for table-<CODE> rooms, also check the player is seated at or watching that table.

  const now = Math.floor(Date.now() / 1000);
  const token = await signJwt({
    iss: apiKey,
    sub: String(me.id),
    name: String(me.name),
    nbf: now - 10,
    exp: now + 6 * 3600,   // one table night
    video: { room, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: true },
  }, apiSecret);
  return json({ ok: true, url: lkUrl, token, identity: String(me.id), name: String(me.name) });
});
