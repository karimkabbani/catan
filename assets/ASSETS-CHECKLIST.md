# Asset checklist

**Status (2026-06-17): populated from the official Catan iOS app.** The slots below
are filled with sprites ripped from `Catan 4.8.2.ipa` (decoded PVR atlases, sliced
via `source material catan ipa/Catan_assets/tools/slice_for_webapp.py`). Terrain art
is the **Mayfair** style. Player colours are **red / blue / green / yellow** to match
the authentic piece art (the app ships no white/orange pieces).

To re-rip or swap styles, re-run the slicer (change `TILE_STYLE` for kosmos/retro).
You can still hand-crop replacements with `tile-cropper.html`; anything missing falls
back to the renderer's drawn art. All slots are wired in — no code changes needed.

## The full set (42 images)

| # | Asset | Count | Drop into | Filenames | Good source screenshot |
|---|-------|-------|-----------|-----------|------------------------|
| 1 | Terrain tiles | 6 | `assets/tiles/` | `wood, brick, sheep, wheat, ore, desert` .png | IMG_8245–8249, 8230, 8243 — pick a hex with little on it |
| 2 | Number tokens | 10 | `assets/tokens/` | `2,3,4,5,6,8,9,10,11,12` .png (no 7) | **Using drawn discs.** The ripped `VALUE_CHIP` sprites are bare number glyphs (and 6/8 are full red discs), inconsistent with each other — the renderer's drawn cream discs look cleaner, so tokens are intentionally left empty. |
| 3 | Ports / bridges | 6 | `assets/ports/` | `generic` (3:1), `brick, wood, sheep, wheat, ore` (2:1) .png | IMG_8230, 8236, 8243 — the dock/bridge icons on the coast |
| 4 | Resource icons | 5 | `assets/icons/` | `brick, wood, sheep, wheat, ore` .png | bottom resource bar, or the building menu IMG_8242 |
| 5 | Pieces (settlement) | 4 | `assets/pieces/` | `settlement-red, settlement-blue, settlement-green, settlement-yellow` .png | settlements on the board in each colour |
| 6 | Pieces (city) | 4 | `assets/pieces/` | `city-red, city-blue, city-green, city-yellow` .png | cities on the board in each colour |
| 7 | Player avatars | 4 | `assets/avatars/` | `p1, p2, p3, p4` .png | the player-select screens IMG_8239, 8240 |
| 8 | Robber | 1 | `assets/` | `robber.png` | IMG_8246, 8247 — the grey hooded figure |
| 9 | Sea / water | 1 | `assets/` | `sea.png` | a clean patch of the blue water in any board shot |
| 10 | Logo | 1 | `assets/` | `logo.png` | the home screen IMG_8218 (CATAN title) |

## Notes

- **Tokens:** the image should be the whole disc (number + pips). It's drawn on top
  of the hex, centred on the number spot.
- **Ports:** there are four 3:1 ports (all use `generic.png`) and five 2:1 ports
  (one per resource). The "bridge" is part of this image — frame the dock + the
  little resource/ratio badge together.
- **Pieces:** colours are red, blue, white, orange (player 1→4 in seating order).
  If you can't find a clean shot of, say, a white city, just skip it — that one
  falls back to the drawn piece while the others use your art.
- **Sea:** a seamless-ish water tile works best; it's stretched to cover the
  background behind the island.

## Things the UI does NOT use yet (so don't bother cropping unless we add them)

Dice faces, individual development-card faces, resource-card faces, and the wooden
panel/button textures are currently drawn or styled with CSS rather than images. If
you want any of those swapped to real art later, tell me and I'll add slots for them
the same way. Roads are drawn as coloured lines (rotating a road image along every
edge is fiddly) — also easy to revisit if you want it.

## Sound

Sound effects and music are a separate pass (Phase 4 audio). When you're ready,
the cleanest path is short individual clips (dice roll, build, robber, trade, win)
in an `assets/audio/` folder, which I'll wire to the matching actions.
