# Snap to 3D (3D Viewer 98)

Turn a photo into a 3D model, keep it in `C:\My 3D`, look at it, put it in My Park, make it a desktop toy, or send it in Messenger. Code in `client/src/components/applets/viewer3d/`.

## How it works
- **Make 3D** (3D Viewer 98's button, Photos' Share menu "Make 3D...", Camera's File > "Make 3D from Last Photo..."): a dialog says the photo goes to Hugging Face, then `space.js makeFromPhoto` calls the free Space **microsoft/TRELLIS.2** (MIT code + weights) from the browser with `@gradio/client`: `start_session` → `preprocess_image` (cuts out the subject) → `image_to_3d` (seed 0, resolution 512) → `extract_glb` (decimation 30k, texture 1024) → fetch the GLB. Nothing goes through Render.
- **Bring a Creature to Life** (More options / Model menu): **VAST-AI/AniGen** (MIT; its CUBVH extension is non-commercial but runs only inside their Space): `prepare_input_for_generation` → `generate_preview` → `extract_glb` (simplify 0.95, texture 1024); the rigged GLB is `data[1]`. The viewer plays an idle clip if the model has one, otherwise sways the bones procedurally.
- **Import Model...**: `.glb`, or `.gltf` with embedded `data:` buffers. `core.js validateModel` checks the magic, glTF 2.0, the declared length and the 8 MB cap, with plain-words errors.
- **Shrinking** (`shrink.js`): over 30,000 triangles → three's `SimplifyModifier` (non-skinned meshes; never below 2%), textures redrawn smaller (`textureFor`, floor 256), re-exported as binary glTF with animations; retries with a smaller texture until under the byte cap.
- **Storage** (`store.js`): drive files of type `model3d` in `C:\My 3D` (newest 20 kept), so they ride drive sync and Delete My Account's drive step. No new per-account server store.
- **Viewer** (`scene.js`): orbit (drag/pinch), Tilt to Look (DeviceOrientation, iOS permission on tap), snapshot for Share a Picture (`shareOut`).
- **Place in My Park** (`petLayer.js`, hooked into `pickleball/park/world.js` with 3 lines): your model stands beside you and trots after you (`core.js stepPet`: walk/run toward a spot behind-left of you, rests and turns your way, pops next to you after a teleport). It never moves you. Only you see it; it isn't solid; skipped on Low quality. Setting: `98ish.park.pet` (per user via `userKey`).
- **Desktop toy**: a 220x240 3D Viewer 98 window with only the spinning canvas.
- **Send in Messenger**: shrinks to 15k triangles / 2 MB on the device, then uses Messenger's media path with a new kind `model` (`server/aim/media.js`, mime `model/gltf-binary`, 2 MB cap, title ≤ 40 chars, triangle count); same Blob budgets, expiry and erasers as pictures. The IM shows a card "🧊 title · N triangles · Open"; Open saves it to the receiver's `C:\My 3D` and opens the viewer.
- **Hugging Face token** (More options): optional, kept on this device (`98ish.hfToken`), sent only to Hugging Face. Anonymous ZeroGPU time is about 2 minutes a day per IP and each request reserves 120-180 s, so in practice a free token is needed for regular use.

## Real Space calls (2026-10-06)
- Both Spaces answer and return GLB files from `extract_glb` (checked with the API description; TRELLIS gives a Model3D file, AniGen a mesh + skeleton GLB).
- Timings from this machine: connect 1.7-2.4 s; TRELLIS `preprocess_image` done at 5.1 s; AniGen `prepare_input_for_generation` at 13.1 s.
- Generation was refused on both by the anonymous ZeroGPU quota ("You have exceeded your ZeroGPU quota (120s requested vs. 149s left). Try again in 22:25:24"; AniGen asks for 180 s). The app turns this into "Today's free 3D time on Hugging Face is used up (it comes back in about N hours). A free Hugging Face token (More options) gives you more each day." No full photo → model run has been timed yet: try with a token.

## Tests
- Unit: `node --test client/src/components/applets/viewer3d/viewer3d.test.js` (sniff/validate, caps, simplify/texture budgets, list cap, names/scale, pet following/teleport/rest, error words); `server/aim/test/history.test.js` covers the `model` media kind (refused types/sizes, upload/commit/attach, preview).
- Browser (scratchpad `snap3d/s3.mjs`; vite 5243 with `VITE_SOCKET_URL=http://localhost:8043`, server 8043 with the fake Blob on 9043 as in `docs/messenger.md`): Bob at 390x844 opens 3D Viewer 98 (Make 3D on screen), a non-model file gets an honest error, imports `critter.glb` (our own 120-triangle test model, 11 KB, made by a script: no license), Place in My Park, Send to Alice (1.2-3.3 s), Alice's card opens it in her viewer, desktop toy, then My Park at Los Cab: the critter stands beside Bob and catches up after a 5 m teleport, Bob's position untouched. All passed. In a worktree, vite needs `server.fs.allow` to include main's `client/node_modules` (the worktree links to them).
- Dev hooks: `window.__pet` (state, active) in dev builds.

## Limits / next
- No full TRELLIS/AniGen generation timed yet (quota). Needs a token run on the phone.
- The pet is local only (friends don't see it), not solid, and Bring to Life has only a procedural idle unless the Space's GLB carries clips.
- Camera has a File menu entry, not a button right after the shot.
- `park/world.js` gained 3 lines; Living Park also changed that file on main, so merge carefully.
