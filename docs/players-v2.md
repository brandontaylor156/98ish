# Players v2: modeled kits, skin families, teeth (2026-10-06)

The owner: "I need the actual players to look a hundred times better." This round replaced the
part of the athletes that looked worst up close and from the broadcast camera: the clothes.
Read this before touching the athletes' assets, `athlete.js`'s kit code or the builder.

## What was wrong (measured on screen, 2026-10-06)

- **Clothes grown from the body** (`outfit.js`): shells pushed out from the skin, so a tee was a
  bell around the hips with a painted hem, shorts had no hem or folds, and the procedural knit
  (`KNIT_FRAG`, 2.5 mm V's) beat against the pixel grid into a moiré on every garment, worst on
  phones. Shoes were procedural sneakers.
- **One light skin texture recolored to every tone:** dark skin was the light skin's detail
  darkened (blotchy, gray, no pigment variation).
- **Legs:** the 2026-10-04 athletic pass made thighs and calves read like a bodybuilder's.
- No teeth (a shout showed a dark hole).

Already good from the faces pass (kept): wrapped skin light with a rim, pores on High, sweat,
Kajiya-Kay hair highlight with alpha-to-coverage, eyes with a clear coat and lid shadow,
expressions as morph targets.

## Research and decision

| Option | Quality | Rig / mocap compatibility | License | Verdict |
| --- | --- | --- | --- | --- |
| **MakeHuman / MPFB2 system assets** (clothes, shoes, teeth, skins as .mhclo/.obj/maps) | real modeled garments with normal and AO maps, sized to any MakeHuman body through the same vertex references as the proxy | the same base mesh the bodies are built from: weights carry over exactly, the skeleton and bone names stay as they are | CC0 (file headers; MPFB2 `LICENSE.ASSETS.md`) | **chosen** |
| CharacterStudio / VRM avatars (M3-style) | stylized anime-ish; clothes are part of each avatar | a different skeleton (VRM humanoid): every mocap clip, retarget table, arms.js limit and motion-matching database would need a new mapping | mixed (CC0 for some packs, CC-BY / custom for others) | no: breaks the animation stack for a style that isn't ours |
| CC0 asset packs (Quaternius, Kenney, Poly Pizza) | low-poly, flat-shaded clothing baked into the bodies | Quaternius' skeleton was the old fallback; its clothes are part of the mesh | CC0 | no: a step down in realism from the MakeHuman bodies |
| Mixamo / Reallusion / paid stores | high | own rigs | not free / not redistributable | excluded by the project rules |

Decision: stay on the MakeHuman pipeline (same bodies, same skeleton, same mocap), and dress
the athletes in MakeHuman's own CC0 garments, fitted per body at build time, cut and recolored
into pickleball kits. The roster keeps its identities (same people, skin tones, hair, kit
colors and styles).

## What shipped

- **Modeled kit pieces** in every body file (`mh-m.glb`, `mh-f.glb`, and the `-hi` files), each
  its own skinned mesh on the body's own skin: `Kit_tee`, `Kit_polo` (the tee with a collar
  standing up from its neckline, in the trim color), `Kit_tank` (the tee cut at the armholes
  with straps, a scoop neck and a racer back), `Kit_shorts` (jeans cut above the knee, a binding
  round the leg openings in the trim color), `Kit_briefs` (under the pleated skirt), `Kit_shoes`
  (trainers), `Kit_socks` (crew) and `Kit_anklesocks`. Sources in `CREDITS.md`.
- **What each look wears** (`kitmap.js`): tee, polo and tank tops; shorts, or briefs under the
  skirt; crew or ankle socks; shoes always. Everything else (rash guards, jackets, crop tops,
  one-pieces, board/short/swim shorts, track pants, knee socks, gloves, wristbands, the skirt
  itself, hats, glasses) is still grown or modeled as before, so every Locker Room option works.
- **Skin families:** light (looks.js SKIN 0-1), mid (2-3), dark (4-5), each from MakeHuman's own
  young skin textures; the shader still recolors to the exact tone, but from a texture of the
  same family (`skinMaterial` `userData.setSkin`).
- **Teeth** (MakeHuman `teeth_base`), on the Head bone, moving with the face's expressions.
- **Lighter legs** (the builder's leg locals: thigh muscle 0.38 → 0.22, calf 0.5 → 0.3, thigh
  circumference −0.12, calf circumference 0.3 → 0.1).
- **No moiré** on the grown garments that remain: the knit fades out well before a stitch is a
  pixel; the fold relief is half as strong.

## The pipeline (`client/src/components/applets/pickleball/tools/`)

Run by hand when the assets change (the same command as before, documented at the top of
`build-mh-athletes.mjs`):

```
TOOLS=<scratch folder with @gltf-transform/core @gltf-transform/extensions
       @gltf-transform/functions meshoptimizer sharp ktx2-encoder>
node build-mh-athletes.mjs <src> <out dir>     # HAIR=0 keeps mh-hair.glb, LODS=med, KIT=0
```

`<src>/assets/` is the MakeHuman system assets zip flattened (every file in one folder; the
fedora and teeth-shape textures clash by name, harmlessly). The build takes about 3.5 minutes
(most of it the KTX2 encoding). It is deterministic: `mh-hair.glb` came out byte-identical.

- `players/kit.mjs` (pure, tested in `kit.test.js`): delete_verts parsing, connected pieces,
  cutting a mesh where a field crosses zero (new vertices on the cut with interpolated UVs and
  skin weights, polygons kept), boundary loops, the tank's cut field, the polo collar, image
  helpers (box blur, masked blur, print removal, height → normal, thick UV lines).
- `players/build-kit.mjs`: per body, per source garment: fit (`fitVerts` on the morphed base
  mesh), weights (`transferWeights`), the rest pose (the body's own `poseVerts`), meters; split
  into connected pieces by height (top / bottom / shoes / socks); cut (tank, shorts, men's
  briefs, ankle socks); the body vertices each piece hides (the .mhclo's `delete_verts`, nearest
  that piece, inside its cut) as a bit per piece in the body's `_KIT` attribute; the atlas.
- **The atlas** (one material, `Kit`): slots of the source garments' own UV layouts (men 2×1:
  suit, shoes; women 3×1: tee suit, jeans, shoes), 512 a slot on Medium, 1024 on High. Two maps:
  the garments' tangent-space normal maps (the shoes' made from their own shading), and a
  detail map (near-lossless WebP, riding as the glTF occlusion texture): R the cloth's shading
  times its AO with prints and logos removed (0.5 = the kit color as is; the shorts lose the
  denim fading), G the trim mask (the women's tee's own stripes and binding, a binding drawn
  along the men's tee neck and sleeves and the shorts' leg openings, the shoes' colored accents),
  B the tank's own binding. Lossy WebP's 4:2:0 color bled the masks into each other (measured:
  errors up to 212/255), hence near-lossless.
- **LODs:** LOD0 = High (`-hi` files: every triangle, 1024 atlas slots, 2048 KTX2 skins), LOD1 =
  Medium (bodies at about half, kit pieces simplified with their hems locked, 512 slots, 1024
  JPEG skins), LOD2 = Low (rig.js's simple figures, unchanged).
- **KTX2:** the High skins (all three families, both bodies) are `pl-skin-<m|f>-<family>-hi.ktx2`
  (Basis ETC1S, mipmapped, sRGB, about 450 KB each), loaded with three's `KTX2Loader` (transcoder
  in `public/assets/pickleball/basis/`, 585 KB, fetched only on High; the engine hands the
  renderer over with `setAthleteRenderer`). A 2048 skin is about 2.8 MB on the GPU as ETC2 (5.6 MB
  as ASTC/BC7) instead of 22 MB as RGBA. Until it's in, or where KTX2 fails, the body file's own
  1024 skin is drawn. KTX2 files and `.wasm` aren't precached by the service worker.
- `players.json` (written by the build, read by the game and the tests): per body the skin
  families (average tone, Medium and High files), per level of detail the meshes and their
  triangles, the bones, the textures and every file's size.

## The game side (`athlete.js`)

- `template()` takes the `Kit_*` meshes out of the scene (kept as geometry), reads the body's
  `_KIT` bits and the teeth.
- `wornOf(tpl, look)`: the modeled pieces (kitmap.js) and the grown garments that remain.
  `bodyUnder` drops the body triangles all of whose corners the worn pieces hide (High: 26.5k
  body triangles drawn as 18-20k).
- `kitGeometry`: the worn pieces merged into one skinned geometry (one more draw call per
  athlete), the twist bones' weights shared out like the body's (sleeves turn with the forearm),
  reshaped for slim/strong builds with the body's own `reshapeBody`, a part per vertex.
- `kitMaterial`: per athlete (the look's colors as uniforms: top, trim, bottoms, bottom trim,
  shoes, accent, socks), one shader program for all; the garments' normal maps at 1.6×, the
  detail map, the athletes' wrapped light and rim, a sheen at grazing angles, shoes glossier;
  polygon offset so the cloth wins over skin right under it.
- Everything that makes athletes (matches, My Park, the Locker Room's studio, Twin Replay /
  Live, the Coach's ghost) goes through `createAthlete`, so all of them wear the kits. The
  ghost clones materials (plain standard copies: a tinted see-through kit).

## Measurements (2026-10-06)

Chrome, phone emulation 390×844 at DPR 2, a doubles match on autoplay at Sunset Club
(`scratchpad/faces/players-fps.mjs`; the app's own prefs seeded with the quality, or its
React side resets the engine's quality when a match starts):

| | High fps | High 4× CPU | Medium fps | Medium 4× CPU | Low fps | Low 4× CPU |
| --- | --- | --- | --- | --- | --- | --- |
| before | 57.5 | 17.4 | 58.0 | 17.6 | 60.0 | 36.8 |
| after | 57.6 | 15.9 | 59.0 | 17.9 | 60.2 | 29.9 |

Low draws the same figures in both, so its 4× spread (29.9-36.8) is the measurement noise; High
and Medium are the same within it. Draw calls: 88 → 110 on High, 92 → 106 on Medium (the kit,
one per athlete, plus the teeth). Triangles on screen in a match: High 358k → 347k (the hidden
skin pays for the clothes), Medium 235k → 232k.

**Downloads** (the player files): Medium both bodies 0.91 MB → 1.77 MB, plus 60-75 KB per mid
or dark skin family a match uses; High adds 3.18 MB of `-hi` bodies (before: 1.59 MB), 380-520 KB
per skin family used (KTX2) and the 585 KB transcoder, once. `mh-hair.glb` (1.24 MB) unchanged.

**GPU memory** (estimated from the texture sizes, RGBA with mipmaps; decoded textures per body,
shared by every athlete on it): Medium ≈ 11.5 MB →
17 MB (m) / 20 MB (f); High ≈ 28 MB → 34 MB (m) / 45 MB (f) plus 2.8-5.6 MB per skin family in
use (before: 22 MB per 2048 RGBA skin, one family). `kit.test.js` holds the budgets.

**Load time** (cold, the athletes' files after the menu is up): Medium 1.3 s → 0.8-0.9 s, High
1.5-1.9 s both (dev server, local; the network on a phone dominates).

**Contact checks** in a High match (240 samples): the paddle's grip error 0 m, elbows never out
of range, soles between −3 cm and +43 cm (before: −1 cm and +44 cm; the same spread run to run).

## Before / after pictures

In the session scratchpad, `players/shots/` (temporary): `sheet-*.png` are side by side, before
left, after right: `face-maya`, `face-dex`, `full-dex`, `full-lena`, `full-kenji`, `full-rosa`
(the Locker Room-style close-ups), `torso-maya`, `torso-dex`, `back-dex`, `lineup-maya-dex`,
`serve-closeup`, `broadcast`, `park-walk` (My Park, Riverside, walking). Shot scripts:
`scratchpad/faces/players-shots.mjs` (studio cameras, roster looks), `players-park.mjs`,
`players-fps.mjs`, `probe.mjs` (run code in the page).

## Tests

- `kit.test.js` (8): the builder's math (delete_verts, cuts with blended UVs and weights, no
  cracks, the tank's outline, print removal, bindings, normals), which pieces every roster look
  wears and what stays grown, and the shipped assets: `players.json`, every level of detail with
  the same skeleton and bone order, every kit piece and the teeth, the body's hide bits, pieces on
  the body's own skin, size and triangle budgets, decoded texture budgets, KTX2 headers.
- All pickleball, twin and park unit suites pass; root `npm test` 571/571.

## Limits and next steps

- **Not tried on a real iPhone.** KTX2 on iOS Safari should transcode to ASTC or ETC2; check
  that the High skins arrive (faces sharpen a second after a match starts) and the frame rate on
  High. The fps numbers above are desktop Chrome emulation, not a phone GPU.
- The grown garments that remain (pleated skirt, rash guard, jacket, crop top, one-piece, other
  shorts, track pants, knee socks) still look like the old ones; the skirt especially (a flared
  cone). Next: MakeHuman has no pleated skirt; model one in the builder (pleated panels on the
  briefs' waist, cloth-sim-free, weighted to the thighs) and cut a crop top and a long-sleeve top
  from the female sport suit / male casualsuit02.
- The women's tee keeps the source design's stripes (orange in the source, the trim color in the
  game) on every kit; the men's tee has only bindings. A per-kit stripe choice belongs in the
  Locker Room.
- One shoe model for everyone (recolored); the sole is the texture's gray.
- The High body still keeps its embedded 1024 skin on the GPU after the KTX2 one arrives
  (5.6 MB per body); the kit atlases are WebP (High: 22-33 MB per body as RGBA). Next: KTX2
  (UASTC for the normal maps) for the atlases too, and dispose the fallback skin once every
  athlete has swapped.
- The polo's collar is a band, no placket or buttons.
- Faces: unchanged from the faces pass apart from the skin families and teeth. Next candidates
  from the research: iris parallax, a separate cornea, per-character eye colors (MakeHuman ships
  ten), sclera veins; hair cards per style with a depth pre-pass.
