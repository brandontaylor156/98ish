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
strands' own light and dark) and covers it with skin for "Shaved". (Shaving a photographed
beard was tried and left blotches: a photo face keeps its own facial hair; the Beard option adds
MakeHuman's beard cards only to faces without one.) Short styles (short, buzz, pixie, shaved)
are the photo's own hair, unless the photographed head had modeled hair (an afro, a bun: its
scalp is far from ours, `ownHair: false`): then every style uses the hair cards, over a scalp
painted in the photo's hair color. Longer styles add the MakeHuman hair cards on top. The eyes get
the photographed iris; the brow cards are dropped (the photo has brows), the lashes stay.

Levels of detail: Medium (phones) uses the 1024 atlas as KTX2 (about 0.7 MB of GPU memory, against
5.3 MB as a JPEG, so a park full of different faces fits a phone) and no detail map; High and
Ultra the 2048 KTX2 and the detail map. Where KTX2 fails, the 1024 JPEG. Low draws the simple
figures (no faces).

The faces (`FACES` in build-faces.mjs; Locker Room order): men m01 Sports_Male_01, m02
Male_Adult_04, m03 Male_Adult_10, m04 Male_Adult_05, m05 Male_Adult_12, m06 Male_Adult_03, m07
Male_Adult_07, m08 Male_Adult_09; women f01 Sports_Female_01, f02 Business_Female_01, f03
Medical_Female_01, f04 Female_Adult_11, f05 Female_Adult_14, f06 Sports_Female_02, f07
Female_Adult_05. The roster wears them (looks.js `face`; their skin is the face's own tone,
`characterLook`); My Park's regulars get a random face of their body (`parkLook`). Rocketbox has
about 100 more adults and professionals; adding one is a line in `FACES` and a rebuild.

## 4. Ultra quality

Settings > Graphics and Options > Graphics have **Ultra** (for a strong computer): High plus
- the venue's sky (the venue kit's HDRI) lighting the athletes' skin and kits (`gearEnv`, 0.3 and
  0.25), so they take the place's color instead of looking pasted in;
- a post chain in matches (`park/post.js` with `ao: true`): three's GTAOPass ambient occlusion
  (contact shadows under arms, chins, collars, between the legs and under the feet), a soft
  bloom, 4x MSAA and a mild vignette, through one tone curve; never on a phone screen;
- motion matching searched every 0.066 s instead of 0.1.
Venues, My Park and everything else build as on High (`subQuality`).

## 5. Movement (this round)

Measured first (Node, a pro doubles match animated with motion matching, scratchpad
`v3/match-metrics.mjs`): contact error median 2.5 cm (p90 9.7), planted-foot slide p99 5.4 mm,
split step landing 13 ms before the other side's contact (the hop is 0.13 s up: the metric's
end-of-hop 225 ms minus that), kitchen ready stance knees 57 degrees, feet 0.58 m apart, trunk
23 degrees forward. These match docs/pickleball-movement.md's spec. What didn't: under motion
matching the **hips never took part in a stroke** (only the chest turned over the captured hips),
and the unit turn reached only about 15 degrees in match drives.

Changes:
- **Kinetic chain** (`anim.js`): the captured hips now turn with a stroke on their own spring
  (about a quarter of the chest's turn in the take-back, so the shoulders coil against the hips;
  60% and faster in the forward swing, so the hips fire first), and the knees are solved again to
  the pinned feet. The procedural path (Low, loading) gets the same split.
- **Earlier, fuller unit turn**: the shoulders' coil follows a stroke at 24/s (was 14), and the
  compact take-back for a late ball turns 0.45 rad (was 0.3).


Measured after (same match, same seed; Node): contact 2.5 cm median (unchanged), slide p99
5.4 mm, joint-accel p99 7.33 cm/frame² (main 7.36), split landing unchanged. In the studio drive
(`v3/coil.mjs`) the stroke's coil now reaches about 39 degrees at the end of the take-back with
the hips held at about 7 (hip-shoulder separation about 30 degrees), and the hips fire first in
the forward swing (17 degrees, then back through the ball). The whole-match "drive separation"
metric hardly moves (12.9 vs 14.8 degrees), because in match play most drives are late and
compact (the take-back has no time); it's visible in the studio and on the serve.

Not done this round (next): mocap-driven strokes (no free licensed sports stroke capture
exists: see section 2), a real Erne/ATP, the head held still at contact (median 13.9 cm of head
travel in the last 0.1 s: the trunk's turn carries it), arms from the capture.

## 6. Measurements

### Frame rate (Chrome, a pro doubles match on autoplay at Sunset Club, after a warm-up)

Headless Chrome on this machine (software-ish GPU, two other agents running): treat ±30% as noise
(docs/pickleball-log.md says the same of earlier rounds). "before" = main (cbb819a) served from a
copy, "after" = this branch; runs back to back.

| | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| phone 390×844, before | 38.1 fps (7.1 at 4× CPU) | 26.7 (8.4) | 25.3 (5.8) | – |
| phone 390×844, after | 33.6 (6.9) | 26.6 (10.0) | 23.1 (4.6) | 21.8 (3.5) (no post on a phone) |
| desktop 1280×720, before | 29.7 | 17.7 | 20.1 | – |
| desktop 1280×720, after | 26.6 | 19.0 | 19.3 | 7.2 |

Low, Medium and High are the same within the noise: photo faces cost no frame time (same
triangles, one texture swap; draw calls 102-113 vs 110). Ultra's post chain (GTAO + bloom +
MSAA at full resolution) is heavy on this machine's GPU: it's meant for a real desktop GPU and is
never used on phones. Not yet measured on a real iPhone or a real GPU.

### Downloads and memory

- Per face, Medium: the 1024 KTX2 atlas (≈125-145 KB), eye, hair mask, shape (≈80 KB) and, for
  "own" hair, the cards (KTX2 ≈100-200 KB + geometry 15-40 KB) and shell texture (≈30 KB): about
  0.35-0.5 MB. High adds the 2048 KTX2 (≈400-500 KB) and the detail map (≈50-75 KB).
- All 15 faces on disk: about 18 MB, fetched only for the faces on screen (a match: four), never
  precached by the service worker.
- GPU: a Medium face atlas ≈0.7 MB (ETC1S→ETC2/ASTC), High ≈2.8 MB, instead of 22 MB for a 2048
  RGBA texture.

### Screenshots and video (session scratchpad `v3/shots/`, temporary)

- `compare/*.jpg`: before (main) left, after right, for `phone-*` (390×844) and `desktop-*`
  (1280×720): `broadcast`, `kitchen` and `kitchen-tv` (a dink exchange), `serve`, `face-*`
  (Dex, Maya, Lena, Kenji), `locker-*` (Dex, Rosa), `park` (My Park, Riverside).
- `cmp-ultra/*.jpg`: High left, Ultra right.
- `look/roster2-34.jpg`: all ten roster players' faces at 3/4.
- `locker/locker-sheet.jpg`: the Locker Room on a phone (Face picker open, a new face picked).
- Rally video: `after/rally.webm` (behind the player), `after/rally-tv.webm` (TV high);
  before: `beforemain/rally.webm`, `before/rally-tv.webm`; frame sheets `*/rally-sheet.jpg`.
- Movement filmstrips: `film/beforemain-*.jpg` vs `film/afterclose-*.jpg` (drive, backhand,
  serve, overhead, dink, lunge; 8 frames each, close 3/4 camera).

## 7. Honest assessment

- **Faces** are the big visible change: real photographed skin, brows, stubble, lips, irises,
  and the photographed hair and its volume, instead of MakeHuman's painted faces. From the
  broadcast camera players now read as different, real people. Up close they are a decade-old
  game's quality (Rocketbox heads are about 2,000 vertices with 2048 textures), not 2K's: the
  jaw/neck seam is soft, some foreheads show a slightly flat transition into the cap or hair,
  and two faces come from adults, not athletes.
- **Bodies, kits and shoes** are unchanged from v2 (MakeHuman CC0 garments).
- **Movement**: the stroke now has a proper kinetic chain in the studio and the serve; match
  play looks much as before because the motion matching, foot planting and stroke timing were
  already the strongest part. No new mocap: none with a usable license exists for free.
- **Ultra** looks better on a desktop (contact shadows, the venue's light on skin) but is too
  heavy for this test machine; real GPUs only.
- Everything is unverified on a real iPhone.

## 8. Paid options for the owner (nothing bought)

| Option | Price (2026) | What it would add | License note |
| --- | --- | --- | --- |
| **MetaHuman** (Epic) | free under $1M/yr revenue | film-quality faces, bodies, strand hair with card LODs | needs a Windows PC with UE 5.6+, 32 GB RAM, a modern GPU, and an Epic account; then export FBX LODs and retarget (a few days' work) |
| Character Creator 4 (Reallusion) | ≈$299 + content packs | photoreal heads (Headshot from a photo), clothes, export | default content OK in games; store content needs export licenses |
| ActorCore mocap | ≈$2-12 a clip, packs to ≈$200 | studio mocap (no pickleball; some sports) | royalty-free in games when bought |
| Move.ai (markerless mocap from video) | from ≈$16/month; API ≈$0.01-0.04 a second | real pickleball strokes captured from our own filmed players | our own capture: no third-party license issue |
| Rokoko Vision / Smartsuit | free tier (video), suits ≈$2,500+ | own pickleball mocap | ours |
| Renderpeople / 3D Scan Store scans | ≈$30-150 a head | true photogrammetry heads | game use allowed; raw files may not be redistributed (a web game ships them: check) |

The biggest single jump for the money: **record real pickleball strokes** (Move.ai from a phone
video of a good player, or a Rokoko suit) and feed them to the motion-matching database; and,
if the owner can borrow a capable PC for a day, **MetaHuman** heads at web LODs.

## 9. Where things are / next steps

- Branch `worktree-agent-a8fb631feefa6217f`, not merged. Unit tests: pickleball 202 + park,
  twin, practice, help suites all pass; root `npm test` 571/571; `vite build` succeeds.
- Rebuild faces: `tools/build-faces.mjs` (header has the steps; a face takes 2-8 minutes, the
  full set about an hour on this machine). The Rocketbox downloads and FBX2glTF conversion were
  done with a scratch script (`v3/scripts/rbfetch.mjs`); the build expects `<rb>/<Name>/`.
- Next: more faces (100+ Rocketbox adults left); a face-specific neck blend (the seam); hair
  cards' anisotropic highlight under the shell; mocap strokes (see 8); Erne/ATP; the real
  iPhone pass (Medium on the phone with four different faces; KTX2 on iOS).
