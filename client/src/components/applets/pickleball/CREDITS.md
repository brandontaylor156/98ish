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

## Motion capture and motion matching (2026-10-04)

The players' legs, hips and trunk (and their arms between points and on a run) now come from
real motion capture, chosen frame by frame by motion matching (`mm/`; the procedural footwork in
`locomotion.js` stays for Low quality and as the fallback). Licenses checked on 2026-10-04.

| Source | Where | License (exact text) | What we use |
| --- | --- | --- | --- |
| 100STYLE (Ian Mason, Sebastian Starke, Taku Komura: "Real-Time Style Modelling of Human Locomotion via Feature-Wise Transformations and Local Motion Phases", 2022) | https://zenodo.org/records/8127870 (doi:10.5281/zenodo.8127870; file `100STYLE.zip`, BVH) | Creative Commons Attribution 4.0 International (the Zenodo record: `"license": {"id": "cc-by-4.0"}`; https://creativecommons.org/licenses/by/4.0/) | styles Neutral, BentKnees and Rushed (forward, backward and sideways walks and runs, idles, transitions) and StartStop (runs and side runs with stops), parts of each take (frame ranges in `tools/motion-takes.mjs`). Changed: retargeted to the game's skeleton, resampled to 30 fps, trimmed, mirrored, quantized. Credited in the About box. |
| CMU Graphics Lab Motion Capture Database | http://mocap.cs.cmu.edu (ASF/AMC files, e.g. http://mocap.cs.cmu.edu/subjects/102/102_05.amc) | the home page: "This dataset of motions is free for all uses." The FAQ: "This data is free for use in research projects. You may include this data in commercially-sold products, but you may not resell this data directly, even in converted form. If you publish results obtained using this data, we would appreciate it if you would send the citation to your published paper to jkh+mocap@cs.cmu.edu, and also would add this text to your acknowledgments section: The data used in this project was obtained from mocap.cs.cmu.edu. The database was created with funding from NSF EIA-0196217." | subject 102 (basketball: running, turns, cuts, drives), 127, 128 and 143 (runs, side steps, stops), 104, 16, 09 and 35 (starts, stops, runs), 69 (walking and turning, turning in place), 79 (the gestures "very happy" and "upset" for celebrations and frustration). Retargeted, resampled, mirrored, quantized; shipped only inside the game's motion database, never as the data itself. Acknowledged in the About box. |

Looked at and not used: Ubisoft LaFAN1 ("This dataset can be used under the Creative Commons
Attribution-NonCommercial-NoDerivatives 4.0 International Public License": no derivatives, so no
retargeting), the Bandai Namco Research motion datasets (CC BY-NC 4.0: non-commercial only),
Mixamo (Adobe's terms allow its animations inside a game but not handing out the files: "you
cannot distribute character or animation raw files", and a web game's data files can be
downloaded).

Built by `tools/build-motion.mjs` from the takes listed in `tools/motion-takes.mjs` (Node
built-ins only; it says how to rebuild): parsed (`mm/bvh.js`), retargeted to the canonical
skeleton with a rest-pose alignment per bone (`mm/skeleton.js`, `mm/retarget-src.js`), the root
extracted, the feet put on the court, the foot contacts labeled, then stored as quantized,
predicted residuals and gzipped (`mm/db.js`). Mirror images are made when the game loads it
(left and right swapped), so every move exists to both sides and for left- and right-handed
players alike.

| File | Size | Contents |
| --- | --- | --- |
| `motion.bin` | 2.92 MB | 41,790 frames at 30 fps (23 minutes): 22 bones a frame, the root and the pelvis, foot contacts |
| `motion.json` | 8 KB | the clip list (names, frame ranges, tags: neutral, ready, fast, stop, idle, gesture) |

Everything the players load: `mh-m.glb`, `mh-f.glb`, `mh-hair.glb` (1.9 MB) + `motion.bin`
(2.9 MB) + `moves.json` (0.06 MB) = about 4.9 MB, fetched in the background the first time
Pickleball opens.

## Athletic bodies (2026-10-04)

After "they look like a tube of toothpaste": realistic athletic anatomy, still MakeHuman and
still **CC0 1.0** throughout (licenses checked 2026-10-04: `LICENSE.ASSETS.md` in MPFB2, "Creative
Commons CC0 1.0 Universal"; every target and proxy file's header: "This asset was explicitly
released as CC0 in september 2020"). Nothing new from anyone else.

| Source | Where | What we use |
| --- | --- | --- |
| MakeHuman muscle topology proxies | the system assets zip above (`proxymeshes/male_muscle_13290`, `female_muscle_13442`; "Topology optimized for male muscled characters. Edgeloops are designed to include neck details, shoulders, pectoral, biceps and quadriceps") | the bodies' mesh (instead of `male_generic`/`female_generic`) |
| MPFB2 local modifier targets | https://github.com/makehumancommunity/mpfb2 `src/mpfb/data/targets/` (`torso`, `stomach`, `buttocks`, `hip`, `neck`, `head`, `arms`, `legs`) | an athlete's build: the V taper, shoulder width, lats, chest, waist, glutes, delts, arm and leg muscle, knees, calves, a shorter, thicker neck, a leaner face (weights in `tools/build-mh-athletes.mjs` `LOCALS`) |
| MPFB2 expression units | the same repository, `targets/expression/units/caucasian/` | the faces' morph targets: blink, smile, effort, shout (eye closure and slit, mouth corner puller, compression, open, brows down / inner up, nose elevation) |

Made in the builder (no third-party art): the muscle-definition normal map (baked from a more
muscular, sharpened copy of the same body), the sharper eye texture (MakeHuman's brown eye
recolored, a limbal ring and a catchlight added). Made in the game: the drape of the tops, the
pleated skirt and the crease shading, the springs that swing a skirt, a ponytail or long hair,
the breathing, weight shifts and ready bounce (`idle.js`), the blinks and expressions, the skin
and cloth lighting.

| File | Size | Contents |
| --- | --- | --- |
| `mh-m.glb` | 471 KB | the male body (Medium and phones: 13.3k triangles), the muscle normal map (1024 WebP), skin 1024 JPEG, four expression morphs on the face and brows/lashes |
| `mh-f.glb` | 439 KB | the female body (13.5k triangles), the same |
| `mh-m-hi.glb` | 814 KB | the male body with every triangle (26.6k) and a 2048 skin, for High only |
| `mh-f-hi.glb` | 778 KB | the female body (27.0k triangles), the same |
| `mh-hair.glb` | 1240 KB | the hairstyles, fitted to the new heads |

Medium (and every phone) loads about 5.1 MB in all (bodies 0.9 + hair 1.2 + motion 2.9 +
moves 0.06); High adds the detailed bodies (1.6 MB) after the game is up: about 6.7 MB.

## The ball sounds (pb11, 2026-10-04)

No audio files are shipped: the paddle hit, bounce, net, fence and paddle-tap sounds are
synthesized in the browser (`pbsound.js`). Their mix was fitted to an analysis of one CC0
field recording, used only as a measurement reference (nothing from it is in the game or
the repository):

| Recording | Source | License | Used for |
| --- | --- | --- | --- |
| "PickleBall.m4a" by fkunze (two outdoor games, Minnesota) | https://freesound.org/people/fkunze/sounds/547092/ | CC0 1.0 (https://creativecommons.org/publicdomain/zero/1.0/) | average spectra and decay times of paddle hits and bounces (`DESIGN.md`, "The sound") |

License checked on the Freesound page on 2026-10-04.

## Players v2: modeled kits, skins, teeth (2026-10-06)

The kits are now modeled garments (docs/players-v2.md), fitted to the athletes by
`tools/players/build-kit.mjs`. Everything new is from the same CC0 MakeHuman system assets zip
listed under Characters (each file's header: "This asset was explicitly released as CC0 in
september 2020"):

| Asset | Used for |
| --- | --- |
| `clothes/male_casualsuit06` (tee and jeans: OBJ, .mhclo, normal and AO maps; the diffuse only for its shading, the print removed) | the men's tee, polo (a collar added) and tank; shorts and briefs cut from the jeans |
| `clothes/female_casualsuit02` (tee and shorts) | the women's tee, polo and tank, and the briefs under a skirt |
| `clothes/female_casualsuit01` (jeans) | the women's shorts (cut above the knee) |
| `clothes/shoes05` (trainers and crew socks: OBJ, .mhclo, diffuse) | every player's shoes and socks (ankle socks cut from them) |
| `teeth/teeth_base` (OBJ, .mhclo, `teeth.png`) | the teeth |
| `skins/young_caucasian_male2`, `young_caucasian_female2` (`young_lightskinned_*_diffuse2.png`), `skins/young_african_male`, `young_african_female` (`young_darkskinned_*_diffuse.png`) | the mid and dark skin families' textures (the light one as before) |

The KTX2 transcoder in `public/assets/pickleball/basis/` is three.js's copy of Binomial's Basis
Universal transcoder (Apache 2.0, https://github.com/BinomialLLC/basis_universal), the same files
as `three/examples/jsm/libs/basis/`. The builder encodes the High skins with `ktx2-encoder`
(MIT, npm), a build-time tool only.

## Players v3: photographed faces (2026-10-07)

The athletes' faces and head skin are photographed heads from the **Microsoft Rocketbox Avatar
Library** (https://github.com/microsoft/Microsoft-Rocketbox), released under the **MIT License**:

> MIT License. Copyright (c) 2020 Microsoft. Permission is hereby granted, free of charge, to any
> person obtaining a copy of this software and associated documentation files (the "Software"), to
> deal in the Software without restriction, including without limitation the rights to use, copy,
> modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
> persons to whom the Software is furnished to do so, subject to the following conditions: The above
> copyright notice and this permission notice shall be included in all copies or substantial
> portions of the Software. THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
> IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR
> PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
> CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
> FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

Used per face (`tools/build-faces.mjs`, the list in its `FACES`): the avatar's `Export/<Name>.fbx`
and `<Name>_facial.fbx` (its head mesh, rest-pose bones and facial targets, read for the shape and
the landmarks), `Textures/<prefix>_head_color.tga`, `_head_normal.tga` and `_head_specular.tga`
(baked into our UV layout: `pl-face-<id>.jpg`, `-hi.ktx2`, `-n.jpg`, `-eye.jpg`, `-hair.jpg`,
`.bin`). Avatars: Sports_Male_01, Male_Adult_04, Male_Adult_10, Sports_Female_01,
Business_Female_01, Male_Adult_05, Male_Adult_12, Male_Adult_03, Male_Adult_07, Male_Adult_09,
Medical_Female_01, Female_Adult_11, Female_Adult_14, Sports_Female_02, Female_Adult_05. The FBX
files were converted with FBX2glTF (BSD, the `fbx2gltf` npm package; a build-time tool only).
The bodies, kits, hair cards, eyeballs' shape, teeth and expressions are still MakeHuman's (CC0,
above).
