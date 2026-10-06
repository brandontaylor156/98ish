# Be Yourself: your 3D head in calls (2026-10-06)

Feature 1 of research round 2: a photoreal 3D head of you (a LAM Gaussian-splat avatar) that moves with your face in 98 Messenger calls, sent as ~1 KB/s of numbers instead of video.

## How it works
- **Your head** is one drive file, `C:\My Head\head.zip` (`FILE_TYPE.head3d`, the zip as a data URL), so it syncs with file sync (8 MB online limit = `HEAD_MAX_BYTES`), goes to the Recycle Bin, and Delete My Account's existing drive step erases it. No server route of its own. One per user profile. `utils/head/store.js`.
- **Making it** (Passwords and Users > 3D Head, `applets/passwords/HeadTab.jsx`):
  - **Import a head file...**: a LAM avatar zip (one folder with `offset.ply`, `skin.glb`, `animation.glb`, `vertex_order.json`), checked by `checkHeadFile` (zip signature, size, an `offset.ply` inside; names read with JSZip from jsDelivr).
  - **Use the sample head**: the example head from LAM_WebRender (`client/public/vendor/lam/sample-head.zip`, MIT).
  - **From a selfie...** (`utils/head/lam.js`): calls an exporter Space set in `VITE_LAM_EXPORT_SPACE` (endpoint `/export_head`: image in, avatar zip out) straight from the device with `@gradio/client`. **Not switched on yet**: the official free LAM Space (3DAIGC/LAM, Apache-2.0) only returns a rendered video (endpoints `/assert_input_image`, `/prepare_working_dir`, `/core_fn` -> image + video; checked 2026-10-06) and runs on free CPU hardware, so there's no free endpoint that returns the head file. Owner action to switch it on: duplicate LAM to a GPU Space with an `/export_head` endpoint wrapping LAM's `--h5_rendering` export, then set the env var in Vercel.
  - **Try it with my face**: the face tracker drives the preview from your camera.
- **The renderer**: `gaussian-splat-renderer-for-lam` 0.0.9-alpha.2 (MIT, built on GaussianSplats3D), vendored at `client/public/vendor/lam/lam-renderer.js` (4 MB, self-contained, loaded only when a head shows; excluded from the service-worker precache). One patch, marked "98ish patch": `options.zipName` so a `blob:` URL (a head from memory) loads; upstream insists on a URL path ending in `name.zip`. It keeps one canvas per page, so **one head is drawn at a time**. `shared/head/HeadView.jsx` feeds it 52 weights per frame (`getExpressionData`) and tilts the view for yaw/pitch/roll (the avatar itself takes only face weights).
- **The face** (`utils/head/faceTracker.js`): MediaPipe Face Landmarker (`outputFaceBlendshapes`, `outputFacialTransformationMatrixes`, VIDEO mode, GPU then CPU; library from jsDelivr, model from Google's storage, the same loader as Twin Replay). 20 fps (`rateGate`), smoothed. With no face (camera off or lost), the **voice** drives the mouth (`voiceMouth`: loudness opens the jaw, brightness widens, darkness rounds) and idle blinks keep it alive (`chooseSource`).
- **In a call** (`aim/call/ThreeDMe.jsx`, `utils/head/callLink.js`): `aim/call/engine.js` adds two **negotiated** data channels to the call's own RTCPeerConnection when it creates it (before the offer, so they're in the SDP):
  - `head-live` (id 7, unordered, no retransmits): one 59-byte packet per frame (`encodePacket`: kind, seq, source, 52 weights as bytes, yaw/pitch/roll as int8): ~1.2 KB/s.
  - `head-file` (id 8, reliable): your head once per call in 16 KB chunks (`chunkHead`/`headAssembler`, back-pressure at 1 MB buffered), then `{t:"on"}`/`{t:"off"}`.
  - 98ish's server only relays the call's signaling, as before. The friend's head is kept in memory for that call (`detachHeadChannels` on hang-up).
- **Call window**: a **3D Me** button (active calls); the friend's head covers the call screen while they have it on; "Getting X's 3D head... N%" while it arrives.

## Not done (v1 limits)
- Selfie -> head needs the exporter Space (above).
- My Park head on your avatar, the Pickleball athlete's face and voice notes as your head speaking: not done (the renderer's single canvas makes a second head on the same page impossible without forking it; the park and the call can't both show one).
- Come Over: no 3D head (the hangout has no media connection; it'd need its own data path).
- Head turns are a view tilt, not a neck rotation.

## Tests
- `node --test client/src/utils/head/headCore.test.js`: packets round-trip, clamping, seq wrap, rate gate, MediaPipe mapping and matrix angles, face -> voice -> idle fallback, head file checks, chunking out of order with duplicates, forged sizes refused.
- Browser: scratchpad `be/` scripts (two Chrome clients with fake camera/mic in a call; see the final report of the session for numbers).
