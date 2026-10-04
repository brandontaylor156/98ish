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
