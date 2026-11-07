# Voice & video at the table: requirements (draft, 2026-11-07)

Status: **in discussion, nothing built.** Karim: "we are still thinking and refining, don't build anything
in code, just mocks and refine the reqs." Mocks: canvas "Catan: Voice & video"
https://claude.ai/artifact/DjkXUjLaeYMZzcH4tpz9QX (rows "Take 2" P1-P3 and "Take 3" T1-T6 are current; the
VO/VI rows above them are superseded).

## 1. Why
- The group plays remotely and is not usually on a WhatsApp/FaceTime call while playing. Talk today is the
  walkie-talkie (v210+): push-to-talk, ~1 s delay, one sentence at a time, 15 s max.
- Goal: the table feels like sitting together. Live voice (~0.2-0.3 s, people can talk over each other),
  optional live faces, for the whole table night: room, game, victory screen, rematches, cups.

## 2. Decisions so far
| # | Decision | Source |
|---|---|---|
| D1 | Real call (WebRTC via a hosted service), not faster walkie clips | Karim 2026-11-07 |
| D2 | Everyone hears everyone automatically. "Joining" only means being heard or seen | Karim |
| D3 | Controls live on your own picture: tap it, choose Audio (mic) or Video (camera + mic). No floating 🎤 / 📹 buttons | Karim, mock P1 |
| D4 | On your picture: red mic badge (tap = mute/unmute), red camera badge (tap = camera off/on) | mock P2, P3 |
| D5 | The call spans the whole table: from sitting in a room, through every game, victory screens, rematches and cup games, until you leave the table | Karim |
| D6 | Asked once (first time at a table after release): Audio / Video / Just listen. Remembered as your default after that | Karim, mock T1, T2 |
| D7 | Mic always comes back OFF after the phone was locked or the app backgrounded (no surprise broadcast) | design |
| D8 | "Mute X for me": tap another player's picture. Announced to the whole table: "Karim muted Kay" (and "unmuted") | Karim, mock T3, T4 |
| D9 | Victory screen: corners grow ~1.5×, videos live, card untouched. No big video view anywhere else | Karim, mock T5 |
| D10 | Spectators get everything players get (hear, talk, video, mute-for-me) | Karim, mock T6 |
| D11 | Music is NOT paused or ducked when people talk ("people like their music") | Karim |
| D12 | Walkie-talkie stays only as the fallback when the call can't connect | design, mock VO4 |

## 3. Requirements

### 3.1 Connection
- R1. On entering a table room (seated or watching), the phone joins that table's call as a listener. No
  permission prompt is shown for listening.
- R2. The call identity is the table, not the game: it survives game start, game end, rematch and the next cup
  game without reconnecting.
- R3. Leaving the table (back to lobby, closing the app) leaves the call.
- R4. Backgrounding/locking: the phone drops out of the call (iOS forces this for web apps). On return it rejoins
  within ~2 s, mic and camera OFF, with a note "Voice back on · your mic is off" (mock VO3). Others see
  "voice paused" on that corner meanwhile.
- R5. If the call can't connect (service down, quota reached, no data), audio falls back to the walkie and a
  once-per-table note says so. Retry in the background; switch back silently when the call returns.

### 3.2 Your controls
- R6. First time at a table after release: a sheet "Talk to the table? Audio / Video / Just listen", with "We'll
  remember this" (mock T1). Answer stored per player (device + profile).
- R7. Later tables: the remembered choice is applied when you sit down, with a fading note "You're on audio · tap
  your picture to change" (mock T2). Video default turns the camera on only after that note shows.
- R8. Tap your own picture: if off the call, the two-choice card (mock P1); if on it, switches Mic / Camera and
  "Leave the call" = back to listening (mock P2). Works in the room (seat), on the board (corner), and for
  spectators (their picture in the spectator bar).
- R9. Red mic badge on your picture while your mic is on; one tap mutes (badge turns grey, crossed). Red camera
  badge while your camera is on; one tap turns it off.
- R10. iPhone side effect while YOUR mic is on: music plays at call volume, AirPods drop to call quality. Accepted
  (D11). Mention it once in the first-time sheet? (open question Q3).

### 3.3 What everyone sees
- R11. Speaking: the picture glows yellow, brightness follows loudness (all corners, room seats, watcher circles).
- R12. Mic on: red mic badge. Muted by self: grey crossed mic. Camera on: the picture IS the live video + red camera badge.
- R13. Watchers: a small row beside the top banner on every phone (eye + their circles); glow when talking; video
  in the circle if on camera (mock T6). In the room: "Also here: Lapen (watching)" with the same badges (mock T2).
- R14. Victory screen: all four corners grow ~1.5× while the card is up; winner gets a gold ring + crown; back to
  normal on leaving the screen or on rematch (mock T5).

### 3.4 Mute for me
- R15. Tap another player's or watcher's picture: card "Mute Kay for me" (mock T3). Only your phone stops playing Kay.
- R16. Announced to the table (including Kay) in the commentary spot: "Karim muted Kay" / "Karim unmuted Kay" (mock T4).
- R17. While active: on the muter's phone Kay's corner shows a grey speaker badge "muted for you" (tap = unmute);
  on Kay's phone, Karim's corner shows "has you muted".
- R18. Persists for the table session; cleared when either leaves the table. Not persisted across nights (Q4).

### 3.5 Video specifics
- R19. Sent small: ~200×200, ~15 fps, the service's simulcast/auto-quality on. Voice has priority on bad networks
  (video freezes to the last frame or drops to the photo before audio degrades).
- R20. No enlarge-on-tap. The only bigger view is the victory corners (R14).

## 4. Non-goals (for now)
- Recording, replay of calls, transcripts.
- AI noise removal beyond the browser's built-in noise suppression (LiveKit/Daily offer it; not in free tiers as far
  as checked).
- Sound positioned by corner direction.
- Push-to-talk (the walkie stays only as fallback).
- Native app. The background-mic limit (R4) is accepted.

## 5. Vendor and cost (checked 2026-11-07; vendor sites were blocked from this session, numbers are from vendor
## docs found by search and third-party summaries: re-check on signup)

Usage model, assuming roughly 70% audio-only / 30% on video for the per-minute prices (minutes = every connected person, listeners included, for the whole table night):

| Scenario | Nights / month | Hours / night | People connected | Minutes / month |
|---|---|---|---|---|
| Light | 4 | 2.5 | 4.5 | ~2,700 |
| Regular | 8 | 2.5 | 4.5 | ~5,400 |
| Heavy (cups, spectators) | 12 | 3 | 5 | ~10,800 |

Video data at ~200 px: roughly 1 GB per 4-player hour with everyone on camera; audio ~0.1 GB.

| Service | Free | Beyond free | Light | Regular | Heavy |
|---|---|---|---|---|---|
| LiveKit Cloud | 5,000 min + ~50 GB, hard cap (calls fail at the cap) | Ship plan $50/mo: 150k min, 250 GB | $0 | cap hit → $50/mo | $50/mo |
| Daily | 10,000 min/mo | pay as you go: ~$0.001/min audio, ~$0.004/min video | $0 | $0 | ~$2/mo |
| Cloudflare RealtimeKit | free while in beta | after GA ~$0.0005/min audio, $0.002/min video, no free tier listed | ~$3 | ~$5 | ~$10 |

Recommendation (moderate confidence): **Daily** first, LiveKit second. Table-long listening (D5) plus spectators
(D10) roughly doubles minutes versus game-only voice, which pushes "regular" use past LiveKit's free cap and onto a
$50/month plan, while Daily stays free or a few dollars. Both have solid browser SDKs and handle iOS; the voice module
is isolated, so switching later is a day's work. Before committing: a one-day spike with the chosen SDK on two
iPhones + one Android over 4G (lock/unlock, join mid-game, two talking at once, clap test for delay).
Still to verify on signup: whether Daily's free tier needs a card, its current overage prices, LiveKit's exact cap
behaviour.

Server side either way: one small Supabase Edge Function that checks the caller is at that table and hands out a
call token (the service's secret stays server-side).

## 6. Open questions
- Q1. Video default (D6/R7): if someone's remembered choice is Video, turn the camera on automatically at the next
  table, or always start them on Audio with video one tap away? (Proposal: audio, camera one tap away.)
- Q2. Can a watcher be muted-for-me by players during their turn without it feeling hostile? (Same rule as players.)
- Q3. Mention the iPhone call-volume / AirPods effect in the first-time sheet, or leave it?
- Q4. Should "mute for me" carry over to the next night? (Proposal: no.)
- Q5. Phone with no camera permission granted: the Video choice asks for camera permission at that moment; if
  refused, fall back to Audio with a note.
- Q6. Old app versions at the same table can't hear the call. Show "update to hear voice" on their phones, and a
  marker on their corner for everyone else?

## 7. Acceptance checks (when built)
- Two iPhones + one Android, 4G and wifi. Clap test under ~0.3 s.
- Lock/unlock: rejoin ≤2 s, mic off, "voice paused" shown to others meanwhile.
- Room → game → victory → rematch → cup game 2 with no audio drop.
- Mute-for-me announced on all phones, badges correct on both sides, cleared on leave.
- Quota/outage simulated: walkie fallback within a few seconds, call returns silently.
- 2-hour session with two people on video: battery and heat noted on an older iPhone.
