# Pickleball 98: third-party assets

Everything in `client/public/assets/pickleball/` comes from these two free packs by
Quaternius, both **CC0 1.0 Universal (public domain)**: no attribution required, free for
commercial use. We credit them anyway (About Pickleball 98, and here).

| Pack | Source | License | What we use |
| --- | --- | --- | --- |
| Universal Base Characters (Standard, free) | https://quaternius.itch.io/universal-base-characters (also https://quaternius.com) | CC0 1.0 (`License_Standard.txt` in the zip; https://creativecommons.org/publicdomain/zero/1.0/) | the male and female base bodies (65-bone humanoid rig, eyes, eyebrows, skin textures) and the hairstyles |
| Universal Animation Library (Standard, free) | https://quaternius.itch.io/universal-animation-library | CC0 1.0 (`License.txt` in the zip) | Idle_Loop, Jog_Fwd_Loop, Sprint_Loop, Walk_Loop, Crouch_Idle_Loop, Dance_Loop (body bones only, as small additive layers) |

Licenses checked on both itch.io pages and in the downloaded zips on 2026-10-03.

Files (built by `tools/build-athletes.mjs`, which says how to rebuild them):

| File | Size | Contents |
| --- | --- | --- |
| `athlete-m.glb` | 315 KB | male body, simplified to about half its triangles, textures shrunk, meshopt-compressed |
| `athlete-f.glb` | 311 KB | female body, the same |
| `hair.glb` | 186 KB | every hairstyle and the beard as rigid meshes on the Head bone |
| `moves.json` | 60 KB | six clips sampled at 30 fps, quaternions packed as int16 |

Made in the game (no third-party art): the clothes (grown from the body's own surface,
`outfit.js`), sneakers, hats, glasses, the paddle and its print (`athlete.js`), and every
stroke, footwork and mood pose (`anim.js`).

## Footwork and the Locker Room (2026-10-04)

No new files were downloaded. The footwork (`locomotion.js`) takes its swing paths and clip
timings from the same CC0 Universal Animation Library clips already in `moves.json`
(Walk_Loop, Jog_Fwd_Loop, Sprint_Loop): `tools/gait-curves.mjs` measures where each clip's
feet land, how long they stay down and the path a stepping foot takes; the shuffles and
backpedals are made in the game. Mixamo was not used (its terms don't allow handing the
animation files out in a web app).

Made in the game (no third-party art): every Locker Room garment (rash guard, track jacket,
sports top, one-piece swimsuit, short shorts, board shorts, swim shorts, track pants, knee
socks, gloves, wristbands; all grown from the CC0 bodies in `outfit.js`), the slim and strong
builds (`reshapeBody`), the beanie and sport shades, the paddle designs, and the Sandy Point
(beach) and Frost Hollow (winter) venues.

## Upper body (2026-10-04)

No new files were downloaded. The strokes, the ready position, the arm IK and the head are all
made in the game (`strokes.js`, `upper.js`, `anim.js`); the existing CC0 clips still only add
breathing and the run's bounce (now kept off the paddle side's shoulder while it holds the
ready position). Mixamo was not used.

## Pro movement and left-handers (2026-10-04)

No new files were downloaded and no motion capture was used (none of the reference players' movement is available under a usable license; Mixamo was not used). The ready position, split step, kitchen footwork, crossovers, lunges, dinks, drives, the two-handed backhand and left-handed play are procedural, from published coaching material and analyses listed with links in `docs/pickleball-movement.md` (`pro.js`, `anim.js`, `strokes.js`, `locomotion.js`). The in-game styles have made-up names; no real player is named in the game.

## Characters (2026-10-04, MakeHuman)

The players' bodies are now MakeHuman bodies (the Quaternius bodies above stay as a fallback
if these files can't load). Everything used is **CC0 1.0 Universal (public domain)**; credited
anyway. Licenses checked on 2026-10-04.

| Source | Where | License (exact text) | What we use |
| --- | --- | --- | --- |
| MakeHuman system assets (`makehuman_system_assets_cc0.zip`) | https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html (file: https://files.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip) | the page: "License: CC0"; each file's header: "This asset was explicitly released as CC0 in september 2020. The license text for CC0 can be found in the root of this repository." (copyright holders at the release: Data Collection AB, Joel Palmius, Jonas Hauquier); `packs/makehuman_system_assets.json`: `"license": "CC0"` | the topology proxies `male_generic` and `female_generic`, the skin textures `young_lightskinned_male/female_diffuse.png`, the low-poly eyes and `brown_eye.png`, eyebrows `eyebrow002` and `eyebrow005`, `eyelashes01`, hair `short01`-`short04`, `bob02`, `ponytail01`, `long01`, `braid01`, `afro01` |
| MPFB2 data (MakeHuman for Blender) | https://github.com/makehumancommunity/mpfb2 (`src/mpfb/data`) | `LICENSE.ASSETS.md`: "Creative Commons CC0 1.0 Universal" (the full CC0 1.0 legal code); `base.obj`'s header: "This asset was explicitly released as CC0 in september 2020."; `weights.game_engine.json`: `"license": "CC0"` | the base mesh `3dobjs/base.obj`, the macro targets (`targets/macrodetails`: race/gender/age, universal muscle/weight, ideal proportions, height), the game-engine skeleton `rigs/standard/rig.game_engine.json` and `weights.game_engine.json` |
| MakeHuman FAQ on models made with it | https://static.makehumancommunity.org/makehuman/faq/can_i_sell_models_created_with_makehuman.html | exported models are CC0: "You can copy, modify, distribute and perform the work, even for commercial purposes, all without asking permission." | (the bodies we build are such models) |

Built by `tools/build-mh-athletes.mjs` (its math in `tools/mh-core.mjs`, tested in
`mhcore.test.js`), which says how to rebuild them: an athletic young man and woman from the
macro targets, the joints from the base mesh's joint cubes, the proxy fitted and its skin
weights carried over, the arms turned straight out and the legs straight down (the rest pose
the clothes expect), the face down to under the chin moved by the Head bone alone, simplified
to about half.

| File | Size | Contents |
| --- | --- | --- |
| `mh-m.glb` | 344 KB | the male body (13.7k triangles, 65 bones named as before), eyes, brows and lashes (one atlas), skin 1024 JPEG |
| `mh-f.glb` | 352 KB | the female body (13.9k triangles), the same |
| `mh-hair.glb` | 1239 KB | nine MakeHuman hairstyles fitted to each body (in the Head bone's space; WebP textures grayed for tinting, alpha cut-out), and three grown in the builder from each body's own scalp and jaw: a buzz cut, slicked-back hair with a bun, a beard |

Made in the builder (no third-party art): the buzz cut, the slicked hair and bun, the beard and
their strand textures. The clothes are still grown from the body (`outfit.js`); their hems,
necklines and trim stripes are now cut exactly along the garment's outline (`clipBody`, and
the trim's inner edge) instead of stepping along the mesh's triangles.
