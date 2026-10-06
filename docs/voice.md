# Spatial voice (My Park, Come Over, Watch Together)

Built 2026-10-06 (owner-approved "groundbreaking" item 3). Hear friends where they stand.

## How it works
- **Audio is P2P.** Each pair of people who can hear each other has one `RTCPeerConnection` (audio only, mono Opus ~32 kbps with FEC/DTX: `tuneOpus` + `maxBitrate`). Render carries only signaling: offer/answer/ICE/bye, a few KB per pair. Nothing is recorded or stored.
- **Server** `server/voice/relay.js`: a generic relay. `set(room, member, on)` keeps who has voice on per room (in memory; max 16 per room, 8 in Watch Together), `signal(room, from, to, msg)` relays only between two members with voice on in that room, cleans the message (`cleanSignal`: SDP ≤ 16 KB starting with `v=0`, candidate ≤ 1 KB, only known fields) and rate-limits (80 signals / 10 s per member). Rooms:
  - My Park: `p<instance>`, members are park numbers (`park:vc { on }` → `{ ok, on, ice }`, `park:sig { to, kind, data }`; events `park:vc`, `park:sig`). Leaving the park or the park closing turns voice off. ICE comes from `server/aim/ice.js` (STUN + optional TURN env vars), injectable as `createPark({ ice })`.
  - Come Over: the hangout id, members are screen-name keys (`hg:vc`, `hg:sig`); blocked pairs refused; leaving/ending/dropping the socket turns voice off.
  - Watch Together: the session id (`tg:vc { id, on }`, `tg:sig { id, to, kind, data }`).
- **Client** `client/src/utils/voice/`:
  - `spatial.js` (pure): `listenerRelative` (world → Web Audio listener space; forward = (sin yaw, cos yaw), right = (−cos yaw, sin yaw)), `distanceGain` (inverse falloff from 1.5 m, fade to silence 11 → 17 m), `pickPeers` (the nearest 6 within 25 m; a connected peer kept to 30 m and rank 8: no flapping), `courtGain` (court mode: others at 0.22), `cursorPan` (Come Over), `duckStep` (Watch Together: down in ~0.12 s, back in ~0.9 s), `talking` (RMS with hysteresis).
  - `mesh.js`: one connection per peer, "perfect negotiation" (larger id is polite), mic attached to the offer's audio transceiver for incoming calls, one ICE restart on failure, a connection you started closes 4 s after you stop wanting it.
  - `session.js`: `createVoiceSession({ space })` owns the mic (`echoCancellation/noiseSuppression/autoGainControl`, mono), `claimCallSession()` (iOS play-and-record), the graph per peer on the shared AudioContext (muted `<audio>` element feeding Chrome's WebRTC→WebAudio, analyser → gain → HRTF `PannerNode` (world; distance is our own gain, the panner only places direction) or `StereoPannerNode` (pan) → a bus on `masterOutput` (taskbar volume/mute)), a 100 ms tick (placement, peer choice, levels), mute/push-to-talk (track.enabled), `visibilitychange` (iOS stops the mic in the background → "paused", re-acquired on return). A `space` adapter per feature supplies `me`, `mode`, `join`, `send`, `listen`, `place`.
- **My Park** `park/useParkVoice.js` + `world.voicePlace()` (listener = your spot facing the camera's yaw, people by park number, court-mates during a room game, names) + `world.setVoiceTalk(nums)` (green ring on labels, `data-talk`). UI: park menu (☰) > **Voice** (+ Push to talk, per-person Mute); the mic chip (`VoiceChip`) shows only while voice is on; Hold to talk with push to talk.
- **Come Over** `utils/hangout.js` (`toggleVoice`, `voiceSession`, `setSpatialVoice`, `useHangoutVoice`): the 🎙 on the taskbar strip (click: mute; right-click or menu: off), Spatial Sound toggle in the menu, talking ring on the dots.
- **Watch Together** `together/togetherStore.js` (`useTogetherVoice`, `duck`), `Together.jsx` (🎙 Voice / ✕ at the top, "X talking" line, the player's `setVolume` dips by `duck`; `player.js` gained `volume()/setVolume()`).

## Tests
- `node --test client/src/utils/voice/voice.test.js` (5: listener math, distance gain, peer choice + hysteresis, court/pan/duck/talking, Opus SDP).
- `server/voice/test/relay.test.js` (4, in root `npm test`: signal cleaning, on/off and relay rules, caps, My Park by park number) and a voice test in `server/aim/test/hangout.test.js`.
- Browser (scratchpad `voice/vc.mjs`, vite 5228 with `VITE_SOCKET_URL=http://localhost:8028`, server 8028; Chrome with `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture=tone.wav`): two people in the same park turn Voice on from the menu, connect P2P, and Bob's per-ear level (ChannelSplitter after the panner) is measured: 2 m 0.0231 > 8 m 0.0078 > 13 m 0.0035, 20 m 0.0006 (silent); 3 m right R 0.0116 > L 0.0066, 3 m left L 0.0280 > R 0.0159, turning around swaps sides; muting Alice → 0; voice off closes everything. Come Over: Ava's pointer on the right → Ben's R 0.0272, L 0.0000; the hangout ending turns voice off.

## Limits / iPhone
- iPhone web apps stop the mic in the background (shown as "Voice paused"); headphones avoid echo (echo cancellation helps but a phone speaker next to the mic is hard).
- Cellular/strict NATs need the optional TURN env vars (docs/env-vars.md, `METERED_TURN_*` or `TURN_URLS`); without them some pairs won't connect.
- A full mesh: each person uploads one ~32 kbps stream per connected peer (6 max in the park ≈ 200 kbps up).
- Watch Together ducking needs the YouTube player's volume API (works on desktop; on iPhone, YouTube's embed ignores setVolume, so the video doesn't dip there).
