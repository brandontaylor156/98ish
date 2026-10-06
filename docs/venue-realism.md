# Venue realism: textures, shadows and what comes next

The owner (2026-10-06): "EVEN MORE DETAIL IN the venues. Too much flat plain surfaces. TEXTURE. Research best tools for this. 3js might not be enough."

## Verdict

**three.js is not the limit; our assets and lighting were.** Every venue surface was a flat-colored Lambert material under a light rig tuned for color accuracy (a strong sky fill, a weak sun, no shadow map), so nothing had grain, nothing cast a shadow, and the eye read it as plastic. three.js already has everything the look needs: PBR materials, normal/AO maps, KTX2/Basis compressed textures, shadow maps, lightmaps, SSAO/GTAO post passes, HDRI environment lighting, and (r16x+) a production WebGPU renderer with TSL shaders and a WebGL2 fallback. Switching engines would mean rewriting Pickleball 98's renderer, physics hookups, mocap/motion-matching rig, venues, touch controls and online play, for no visual gain we can't get in three.js.

| Option | iPhone (Safari, iOS 26) | Size | Integration cost | Verdict |
|---|---|---|---|---|
| **three.js (current)** | WebGL2 everywhere; WebGPU on iOS 26 (on by default) | ~185 KB gzip (`three`), ~300 KB for `three/webgpu` | none | **keep** |
| Babylon.js 8/9 | WebGL2/WebGPU, WGSL-native core | ~1.8 MB `@babylonjs/core` (modular, less in practice) | full renderer rewrite | no gain worth a rewrite |
| PlayCanvas | WebGL2/WebGPU, editor-centric | ~1 MB+ engine | rewrite + editor workflow | no |
| Unity / Godot WebGL export | iOS Safari kills tabs at ~300-500 MB; big WASM; slow start | 10-40 MB+ | throws away the 98ish React shell integration | no (worst on iPhone) |

Sources: [WebGPU implementation status](https://github.com/gpuweb/gpuweb/wiki/Implementation-Status), [Three.js vs Babylon.js vs PlayCanvas (2026)](https://www.utsubo.com/blog/threejs-vs-babylonjs-vs-playcanvas-comparison), [Three.js vs Babylon.js (2026)](https://app.cinevva.com/guides/threejs-vs-babylonjs), [Unity WebGL on iOS Safari crashes](https://bugnet.io/blog/how-to-fix-unity-webgl-build-crashing-on-safari-ios), [Unity WebGL memory on iOS](https://discussions.unity.com/t/webgl-memory-increment-issue-and-crash-on-ios/894771?page=2).

## What shipped in the pilot (Los Cab + California SMASH; every venue benefits)

1. **Real surfaces** (`park/surfaces.js`): 13 surface kinds (asphalt, concrete, grass, stucco, clay roof tile, wood, deck planks, carpet, rubber gym floor, tile, metal, fabric/windscreen, acrylic court coat). Each is ONE 512 px RGBA WebP (R = luminance detail normalized to mean 0.5, G/B = normal XY, A = AO/cavity), built by `tools/venues/textures/build-textures.py` from **CC0 ambientCG** sets (CC0: free to redistribute; credits in `client/public/assets/venue-tex/CREDITS.txt`); the acrylic coat is generated (sand-in-paint stipple plus slow blotches for sun fade).
   - Sampled in **world space** (triplanar on walls, planar on floors) through an `onBeforeCompile` patch, so the generated geometry needs no UVs and merged meshes just work.
   - The detail **multiplies the venue's own paint**, so the photo-matched colors (fidelity workflow, ΔE checks) keep their average.
   - Floors get a second, big, slow sample (anti-tiling, and metres-wide fade patches on courts); walls get grime at their foot; detail fades out with distance (no shimmer).
   - The painted ground picks grass, asphalt or concrete detail per pixel from its own color.
   - Materials opt in with `surfaced(material, kind)` at their creation site (scenery.js, courtkit.js, build.js); room floors map from `FINISH` (wood, tile, rubber, carpet, stone, slats).
2. **Sun shadows** (build.js): the venue's sun casts real shadows (buildings, trees, stands, fence frames, benches, wait boards, rooftop units) in a 90 m box that follows the camera; 2048 px map on High, 1024 on Medium; PCF soft. See-through materials (chain-link, nets) don't cast (no solid sheets). The map is drawn again only when the box moves (camera 8 m away) or the light changes: the venue is static and people keep their blob shadows, so shadows cost almost nothing per frame.
   - **Light rebalanced for shadows:** outdoors sun 2.6 / sky 0.9 (was 1.0 / 2.25), indoors an overhead key 1.5 / sky 1.7 (was 0.6 / 2.5). The flat-surface total at midday stays about the same (≈3.1 vs 3.0), so painted colors hold, but shade now reads as shade (≈29% of full sun outdoors, close to real). Indoors, the roof/ceiling/fixtures above 3.5 m don't cast, so the floor gets contact shadows under benches, nets and boards.
   - Per-venue overrides: `light.sunShadow`, `light.skyShadow`.
3. **Quality setting:** Options > Graphics: Low / Medium / High (applies when a venue loads). **Low = the old flat look** (no textures, no shadows) for old phones; Medium/High = realism. `park.setRealism(on)` + `setSurfacesOn(on)` switch it live (dev: `__park.devSurfaces(on)`).

### Costs (measured 2026-10-06, 390x844 phone emulation, Intel UHD, loaded machine)

| | unthrottled | 4x CPU |
|---|---|---|
| Los Cab flat -> realism | 60 -> 60 fps | 34.2 -> 28.8 fps |
| SMASH flat -> realism | 60.1 -> 60 fps | 35.5 -> 35.8 fps |

- Download: 1.55 MB of textures, once per visit at most (loaded lazily, only on Medium/High; browser HTTP cache after that).
- GPU memory: 13 x ~1.4 MB (512² RGBA + mips) ≈ 18 MB, plus the shadow map (16 MB at 2048², 4 MB at 1024²). Far under the ~150 MB budget we set for iPhone.
- Shader: +1-4 texture samples on textured surfaces; the switch to shadow-enabled programs is a one-time recompile.

## Next phases (ranked by look gained per effort)

1. **KTX2/Basis textures** (`gltf-transform` / `basisu` CLI at build time, three's `KTX2Loader` with the Basis transcoder WASM): ~4x less GPU memory than WebP (ASTC/ETC2 stay compressed on the GPU), so 1024 px detail and separate roughness become affordable.
2. **HDRI environment + PBR on the courts and metals** (Poly Haven CC0 HDRIs via PMREM): sky reflections on the acrylic sheen, chrome on posts and rails, a real sky dome. Moderate cost; MeshStandard for the big surfaces only.
3. **Baked lighting** (best realism per frame): export each venue's static scene to glTF (three's GLTFExporter in Node), bake AO + lightmaps in **headless Blender** (free; `winget install BlenderFoundation.Blender` or the portable zip; Cycles on CPU works on this machine, no NVIDIA GPU: expect minutes per venue at 512-1024 px lightmaps), compress to KTX2, load as `aoMap`/`lightMap` on a second UV set (Blender's Smart UV / lightmap pack). Gives soft contact shadows everywhere, indoor bounce light and corner darkening at zero runtime cost. Blender isn't installed yet (2026-10-06).
4. **Decals:** kitchen-line wear, ball scuffs, oil stains in lots, crack sealant lines (three's `DecalGeometry`, or a small decal atlas in the surface shader keyed by world position).
5. **Foliage:** proper alpha-card trees/palms (Poly Haven / Quaternius CC0 models) instead of low-poly blobs; instanced, with LOD.
6. **Gaussian splat backdrops** (photoreal, optional): train splats from our venue tour/drone frames; render with **Spark** (World Labs, three.js, WebGL2; 1-3 M splats on iPhone, Spark 2.0 adds LOD/streaming). Training needs CUDA (gsplat/nerfstudio/Postshot): not possible on this machine (Intel UHD); a cloud GPU or the owner's own capture app would be needed. Use only for distant backdrops (the skyline beyond the fence) under playable textured geometry. Sources: [Spark](https://sparkjs.dev/), [Spark performance](https://sparkjs.dev/docs/performance/), [Spark 2.0 streaming](https://www.worldlabs.ai/blog/spark-2.0).

## Free CC0 sources

- [ambientCG](https://ambientcg.com) (CC0 PBR materials: used here), [Poly Haven](https://polyhaven.com) (CC0 textures, HDRIs, models), [Kenney](https://kenney.nl) and [Quaternius](https://quaternius.com) (CC0 low-poly models: cars, props, foliage).

## How to add or retune a surface

- New kind: add the ambientCG set to `SETS` in `build-textures.py`, rebuild (`python tools/venues/textures/build-textures.py <folder of unzipped 1K-JPG sets>`), add its numbers to `SURFACES` in `surfaces.js`, tag materials with `surfaced(mat, "<kind>")`.
- Before/after: `__park.devSurfaces(false|true)` then `__park.devShot({ cam })` (scratchpad script `realism/shots.mjs`; set the hour in the same evaluate, since the game re-applies the real clock).
