# LAN Party 98 and Virtual PC 98

Built 2026-10-06 (idea #9 of the research report: a real 90s LAN party between phones, and a
real PC inside 98ish). Two programs:

- **LAN Party 98** (Start > Programs > Games; `applets/lanparty/LanParty.jsx`): shareware **DOOM**
  and **Heretic** alone or on a LAN with up to 4 friends, plus the **Shockwave Arcade** for Flash
  movies. Double-clicking `C:\Games\DOOM\DOOM.EXE`, `C:\Games\HERETIC\HERETIC.EXE`, a `.swf`, or a
  `*.SAV` in `C:\Games\Saves` opens it (`utils/openItem.js`).
- **Virtual PC 98** (Accessories; `applets/lanparty/VirtualPC.jsx`): v86 booting FreeDOS from a
  floppy, a user's own disk image (kept in the window only), Save/Load State.

## How it works

- **Engines load from jsDelivr at pinned versions** (`catalog.js` `CDN`): js-dos 8.5.1 (GPL-2.0,
  unmodified), v86 0.5.470 (BSD-2), Ruffle 0.6.0 (MIT/Apache). ~40 MB of engines stay out of the
  repo and never go through Render. `engines.js` loads each once.
- **Game bundles** (`client/public/emu/games/*.jsdos`, 2.4 / 2.9 MB) are built by
  `python tools/lanparty/build_bundles.py` from the official shareware releases on /idgames
  (`doom19s.zip`, `htic_v12.zip`): each is a DEICE installer whose payload is a ZIP; the files are
  copied unmodified ("PLEASE DISTRIBUTE" / "FREELY DISTRIBUTE"). The bundle adds only
  `.jsdos/dosbox.conf`, whose autoexec calls `LAUNCH.BAT`.
- **Per launch** `DosPlayer.jsx` writes `LAUNCH.BAT` through js-dos's `initFs`
  (`catalog.js` `launchBat`/`launchLine`: `DOOM.EXE -skill 3`, or `IPXSETUP.EXE -nodes N
  [-deathmatch] -skill S` for every LAN player). js-dos's `dosboxConf` option does NOT replace a
  bundle's config, and a `DosConfig` entry in `initFs` lost to the bundle's file: hence LAUNCH.BAT.
- `workerThread: true` runs DOSBox in a Web Worker (without it a page screenshot timed out: the
  main thread was pegged).
- **Saves**: js-dos `fsChanges` hooks (`saves.js`) keep the game's changes bundle as
  `C:\Games\Saves\DOOM.SAV` (data URL, ≤ 4 MB), so saves are per user and sync like files.
- **Touch**: our `shared/controls` buttons (arrows, FIRE=Ctrl, USE=Space, RUN=Shift, STR=Alt,
  ESC, Enter, Y, a weapon cycle) call `ci.sendKeyEvent(code, down)` (GLFW key codes, `KEY`).
- **Flash**: Ruffle in its own host element (Ruffle destroys its player when the element leaves the
  page; inside a React-rendered div it died right after loading). `allowNetworking: "none"`.
  User `.swf` files (≤ 20 MB) are copied to `C:\Games\Flash`. The demo `98ish-spinner.swf` is ours
  (`tools/lanparty/make_demo_swf.py`). `.gitignore`'s `*.sw?` hid `.swf`: `!*.swf` added.
- **Virtual PC**: `new V86({ wasm_path, bios, vga_bios, fda | cdrom | hda, memory 32 MB })`;
  `catalog.js` `diskOptions` picks the drive (none = FreeDOS floppy; `.iso` = CD; ≤ 2.88 MB =
  floppy; bigger = hard disk). Save State gzips `save_state()` to `C:\Games\Saves\VIRTUALPC.V86`
  (≤ 24 MB). BIOS files and the FreeDOS floppy are in `client/public/emu/vm/`.
- `/emu/` is excluded from the service worker's precache (`vite.config.js`).

## The LAN

- js-dos runs DOSBox's IPX over **WebRTC (HumbleNet)**: the host's emulator starts an IPX server
  (`startIpxServer`) and gets a peer id from a signaling ("peer") server; joiners connect to that
  peer id (`connectIpxAddress`). **Game traffic is peer to peer**; the signaling server only hands
  out ids and passes WebRTC offers/ICE. Default peer server: js-dos's free `https://net.dos.zone`
  (`catalog.js` `PEER_SERVER`; `VITE_DOS_PEER_SERVER` points at a self-hosted WebRTC-NET
  `peer-server` binary instead: https://github.com/caiiiycuk/WebRTC-NET/releases). STUN is
  Google's; TURN isn't configured (strict NATs/cellular may fail to connect).
- **Our server** (`server/lanparty/index.js`, wired in `server/net`): a memory-only lobby. The host
  publishes `{ game, nodes, deathmatch, peerId }` under a 5-letter code (`lan:host`); buddies see it
  in `lan:list`; anyone with the code can `lan:join` (gets the peer id); the host hears
  `lan:joined`/`lan:left`; `lan:end` when the host stops or drops. Caps: 40 games, 2-4 players,
  20 requests/min per computer, 3 h. Nothing stored, so no Delete My Account step.
- Invite: the host's **Invite...** sends an IM with the code (`aim.sendIm`).

## Tests

- `node --test client/src/components/applets/lanparty/lanparty.test.js` (6: launch lines and
  clamping, the DOSBox config, the catalog (EXEs, terms, controls send real keys), file routing,
  Virtual PC disk choice, save names and data-URL round trip).
- `node --test server/lanparty/test/lanparty.test.js` (5, in root `npm test`: host/list/join and
  the host hearing it, buddy visibility and blocking, checks, end/expiry/replace, caps and rate).
- Browser (scratchpad `lan/lp.mjs [solo|phone|lan|flash|vpc]`, ports 5232/8032):
  - solo DOOM on desktop: draws 14 s after Play; into E1M1 with Enter.
  - Heretic at 390x844 touch: draws, 12 touch buttons.
  - LAN: desktop host + phone joiner, DOOM deathmatch: code in 5-8 s, host sees 2/2, HumbleNet
    connects the two emulators P2P about 8 s after joining (host log "IPXSERVER: Connect from ...", joiner "IPX: Connected
    to server"), IPXSETUP finds both nodes and the deathmatch (FRAG counter) runs on both.
  - Flash demo plays in Ruffle; Virtual PC reaches `A:\>` in 6 s.
  - Frame rate: headless Chrome here has no GPU; distinct screenshots/s was ~1-4 (a lower bound,
    screenshots themselves are slow). Needs a real phone.

## Limits

- Not tried on a real iPhone. js-dos says its v8 mobile support is "WIP".
- LAN latency wasn't measured (the data channel lives inside js-dos's WASM); the LAN test was
  two tabs on one machine. Cellular without TURN may not connect.
- Disk images inserted in Virtual PC aren't kept (by design); v86 reads keys from the page, so the
  phone **Keyboard** button may need work on iOS.
- Only two DOS games (both shareware with IPX); no js-dos IPX on Render (not needed: P2P).
