# Players v3: photo faces, realistic shading and pro movement (2026-10-07)

The owner: "I want ultra realistic people/movement/pickleball playing as far as how the top PPA
pros actually play ... compete with NBA 2K27 graphics and motion and realism." Not stylized
(a stylized start was stopped on 2026-10-07; never steer toward cartoon looks). This round owns
how the athletes **look** and how their bodies **move**; ball physics and the AI's shot choice
belong to a separate agent. Read this with `docs/players-v2.md` (kits, skins, LODs),
`docs/pickleball-log.md` (athletes, arms, motion matching) and `docs/pickleball-arms.md`.

## 1. Research: how 2K / EA build athletes, and what a phone browser can do

| Technique (console sports games) | What it gives | WebGL2 on an iPhone | Desktop High/Ultra | Here |
| --- | --- | --- | --- | --- |
| **Scanned heads** (photogrammetry rigs, 100+ cameras; 2K scans every NBA player) | real face shape and skin color | the geometry is cheap (a 5-10k triangle head); the cost is the textures | same | **yes**: photo-textured heads from Microsoft Rocketbox (MIT) carried onto our topology (section 3) |
| **PBR skin with subsurface scattering** (screen-space SSS or pre-integrated skin) | soft light through skin, red shadow edges, no "plastic" | screen-space SSS needs a separate diffuse buffer and a blur pass: too costly on a phone; *wrapped diffuse* (already in) is the cheap version | pre-integrated curvature SSS fits | wrapped light kept; photo albedo + specular map + pores (section 4) |
| **Detail normals** (pores, fine wrinkles, tiled micro normals) | skin that isn't smooth plastic up close | one more texture sample: fine | fine | the photo's own normal map baked into our UVs + procedural pores (High) |
| **Specular / roughness maps** (oily T-zone, matte cheeks) | believable highlights | fine | fine | the photo's specular map drives roughness |
| **Strand or card hair** with Marschner/Kajiya-Kay shading | hair that reads as hair | cards + alpha-to-coverage + an anisotropic highlight: fine; strands: no | cards | painted hair from the photo + MakeHuman hair cards with Kajiya-Kay (existing) |
| **Eye shader** (cornea refraction, iris parallax, wet layer, AO under lids) | eyes that look alive | a clear coat + lid shadow (existing) is fine; refraction needs extra passes | could add parallax | photographed iris on our eyeballs (section 3), existing wet/lid shading |
| **Facial rigs** (FACS, hundreds of blendshapes or joints) | speech, effort, emotion | a handful of morph targets is fine (we have blink/smile/effort/shout) | same | kept |
| **Cloth** (simulated or baked) | folds, sway | sim: no; normal-mapped modeled garments + springs: yes (v2) | same | v2 kits kept |
| **Motion capture + motion matching** (thousands of clips per sport, matched every few frames) | natural locomotion, transitions | our motion matching runs in a worker over 23 min of mocap (since 2026-10-04) | same | kept and extended (section 5) |
| **IK foot planting, procedural layers** (look-at, leaning, hit reactions) | no sliding, contact with the world | cheap | cheap | existing foot locks + new layers (section 5) |
| **Physically based lighting** (HDR IBL, shadow maps, AO) | the athlete belongs in the venue | IBL + one shadow map: fine at Medium; contact shadows cheap | add SSAO/bloom | the venue kit's HDRI + shadows (venue-realism.md); skin now lit by it on Ultra |

What 2K-level actually requires that a phone browser can't do: 4K/8K textures per player, 50-100k
triangle heads with 700+ blendshapes, strand hair, screen-space SSS and a full post stack at
60 fps, thousands of sport-specific mocap clips recorded with real players. The honest target
for WebGL on an iPhone: a believable photographed face and skin at match distance and in close-ups,
lighting that sits the player in the venue, and movement that reads like a real player's.

## 2. Free asset sources (license checks, 2026-10-07)

| Source | What | License for a web game | Verdict |
| --- | --- | --- | --- |
| **Microsoft Rocketbox** (github.com/microsoft/Microsoft-Rocketbox) | 115 rigged avatars, photo-textured heads (2048 color/normal/specular), facial blendshapes (ARKit, FACS, visemes), 3 LODs; adults of many ethnicities, 6 "Sports" avatars; 417 animations (idles, cheers, claps, talking; no sports strokes) | **MIT** (since Dec 2020): use, modify, redistribute, commercial OK; keep the copyright notice | **used**: the photo faces |
| MakeHuman / MPFB2 | bodies, skins, clothes, hair, expressions | CC0 | kept: the bodies, kits and hair (v2) |
| **MetaHuman** (Epic) | the most realistic free digital humans | Since June 2025 (UE 5.6) MetaHumans may be used in other engines and sold; free under $1M revenue a year (Unreal EULA); not for training AI | **owner decision**: free, but the export needs Unreal Engine 5.6+ on a capable Windows PC (16-32 GB RAM, a modern GPU) and an Epic account: this machine (7.7 GB) can't run it. Path: MetaHuman Creator in UE → export FBX (LOD3-5 for the web: 10-30k triangles) → our retarget to the 65-bone skeleton |
| Mixamo (Adobe) | auto-rigged characters, 2000+ animations incl. some tennis swings | free with an Adobe account; may be used in games, but the raw files may not be redistributed; a web game ships its files (gray area) | not used (needs the owner's Adobe login; redistribution risk) |
| Ready Player Me | stylized avatars | **shut down 31 Jan 2026** (Netflix acquisition) | gone |
| CC0 scans / textures (Polyhaven, ambientCG) | surfaces, HDRIs; no people | CC0 | HDRIs already used for venues |
| three.js's Lee Perry-Smith head (Infinite Realities) | one scanned head with maps | CC BY 3.0 | one face only: not used |
| **CMU mocap** | 2,600 clips, few sports | free for any use | used (since 10-04) |
| **100STYLE** | 100 locomotion styles | CC BY 4.0 | used (since 10-04) |
| Rokoko free library | 150 clips | free for commercial use, needs a Rokoko account to download | not used (login); no racket sports |
| Bandai Namco Research motion sets | 3,000+ clips, daily/fighting/dance | **CC BY-NC 4.0** (non-commercial) | not used: non-commercial |
| AMASS / SMPL-X, Human3.6M | huge research sets | **non-commercial research only** | not used |
| LAFAN1 (Ubisoft) | locomotion | CC BY-NC-ND 4.0 | not used |
| TennisDB / 3DTennisDS (Lublin Univ. of Technology) | Vicon C3D of forehands, backhands, volleys with racket markers | no license stated; asks for citation | **analysis only** (timing and joint ranges as numbers), never shipped |
| Our own pose tracking (Twin Replay) on public pro footage | pose sequences | footage is copyrighted; measuring motion as numbers is fine, shipping the video isn't | analysis only |

## 3. Photo faces (Rocketbox heads on our topology)

Why this route: MakeHuman faces were "plain up close" (docs/players-v2.md); Rocketbox's heads
are photographed (2048 color, normal and specular maps per head, many ethnicities) but sit on a
different, low-poly topology (1,775 vertices) and a 3ds Max Biped skeleton. Swapping bodies would
have broken every kit, hairstyle, retarget table and mocap clip. Instead the **face is carried
onto our own head** at build time, so the runtime still draws the same MakeHuman athlete.

`tools/build-faces.mjs` (math in `tools/players/faces.mjs`, tested in `faces.test.js`), per face:

1. **Read** the avatar's `_facial` FBX (converted to glb by FBX2glTF): the head primitive, its
   rest-pose bones, its 175 facial targets (unnamed in the glb; the jaw-open and smile ones are
   found geometrically: `classifyTargets`). Its UV islands decide what is skin (the face, scalp
   and neck islands), the eyeballs, and what to ignore (teeth, tongue, modeled buns).
2. **Landmarks, the same rules on both heads** (`faceLandmarks`): eye centers (our eyeball
   meshes' centers; theirs 11.5 mm behind the cornea), the mouth corners (where the smile target
   moves most), the stomion (between what stays and what drops when the jaw opens), each lip's
   front point, nose tip, chin, under-chin, brow ridges.
3. **Rigid fit**: a weighted similarity transform (Horn's quaternion method + scale) puts the
   photographed head on ours. Typical gaps after it: eyes 5 mm, mouth corners 5-7 mm, nose/lips
   4-11 mm (these are real differences between two people's faces).
4. **Shape**: a thin-plate spline bends our face so the landmarks meet, then 14 rounds of
   closest-point fitting with a smoothed displacement field (a non-rigid ICP; the facing test
   rejects back faces; each vertex stays within 1 cm of the spline's guess so nostrils and the
   mouth's inside are never dragged onto an outer surface; the mouth's inside and the lips' seam
   ride along with their neighbors so the mouth stays closed). Only the **front of the face**
   moves (`faceWeight`): the cranium, ears and neck keep our shape, so every hairstyle and hat
   still fits. Eyes move rigidly to the photo's eye centers, the lashes and teeth with the face.
5. **Bake** (2048, then 1024 for Medium): every texel of our skin atlas finds its point on the
   fitted surface, the closest point on the photographed head, and takes its color; the rest of
   the body keeps MakeHuman's skin from the nearest family, tone-matched to the photo's cheeks and
   neck (per-channel gain in linear light), blending in down the neck (`photoWeight`). The
   source's islands are grown into their background first and ours after, so filtering at a UV
   seam never shows a line. Also baked: the photo's **normal map** (its tangent space -> object
   space -> ours, glTF convention) and **specular** (the detail map `-n.jpg`), the **iris** onto
   our eyeball (by angle off the eye's axis, so the iris keeps its real size), and a **hair mask**
   (`-hair.jpg`: R the hair painted on the scalp, G facial hair; where the photo differs from its
   own skin in lightness or hue, inside the regions hair grows) with the photo's hair tone.
6. **Write** `pl-face-<id>.jpg` (1024), `-hi.ktx2` (2048, ETC1S), `-n.jpg`, `-eye.jpg`,
   `-hair.jpg`, `.bin` (the shape: per level of detail the moved Body vertices' offsets and
   normals, eyes', lashes' and teeth's shifts; format in `faceshape.js`), `faces.json`, and the
   app's `faceList.js` (ids, bodies, natural skin and hair tones, beard amount).

The game side (`athlete.js`): a look's `face` (Locker Room > Body > Face; "Classic" is the
modeled face). `createAthlete` waits for the face's shape and first texture (about 270 KB on
Medium) and builds the athlete again when they're in (like the High body swap). The Body's
positions and normals get the face's offsets in its own variant (shared by everyone with that
face and build; kits and grown garments shared with the build). The skin material's photo mode
draws the photo as photographed (no recoloring; only a gentle tint if the look's skin tone
differs from the photo's: lightness fully, hue halfway), the detail map adds the photo's relief to
the muscle normal map and drives roughness from its specular (oily nose and forehead, matte
cheeks), and the hair mask recolors the painted hair to the look's hair color (keeping the
strands' own light and dark), covers it with skin for "Shaved", and shaves facial hair off a look
without a beard. Short styles (short, buzz, pixie) are the photo's own hair; longer ones add the
MakeHuman hair cards on top. The eyes get the photographed iris; the brow cards are dropped (the
photo has brows), the lashes stay.
