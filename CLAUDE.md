# 98ish: notes for the next session

A Windows 98-style web desktop at https://98ish.vercel.app. The owner uses it mostly on an iPhone and shares it with his girlfriend and friends.

This file is the short guide: rules, layout, how to run/test/deploy, current status. Details per area live in `docs/` (index at the bottom). When a feature lands, put its notes in the matching `docs/` file and update "Current status" here in place; don't add dated close-out sections.

## Rules
- Never print the MongoDB connection string, passwords or any `.env` value.
- Free services only. Commit and push only when asked; the owner has authorized finishing and pushing feature rounds.
- Commit messages end with the Co-Authored-By / Claude-Session lines given in the session.
- Trademarked asks get original names and art (Word Duel, Last Card, Monster Duel, Hexlands, Shred 98, Speed Typist 98, Appward 98 as an "unofficial tribute").
- Keep the Windows 98 look. **Simplicity:** each program opens to a baseline view (the 1-3 things most people do); everything else goes under **More options »** (`shared/MoreOptions.jsx`), menus, tabs or right-click/long-press menus; the primary action stays on screen at 390x844 (`docs/shell.md`, `docs/simplicity.md`).
- Phones: no hold menus outside text fields and reading areas (`utils/touchGuard.js`; opt in with `data-selectable`, touch surfaces with `data-touch-surface`); always write both `-webkit-` and plain `user-select`/`touch-callout`.
- Game loops measure time with `utils/frameClock.js` (keep `last` across frames, `reset()` only on restart); 90s-style games use the retro kit (`utils/retro/`, `shared/retro/`). See `docs/games.md`.
- Pickleball: **nothing moves your player for you** (owner's rule; never add auto-movement or offer it as a setting).
- **Every program must be claimed by exactly one 98ish Help topic** (`applets/help/topics/`; the help unit test fails otherwise). Update Help and the privacy topics with each feature.
- **A new server module that stores anything per account must add a Delete My Account eraser step and a line to the inventory in `server/account/index.js`** (and to Help's privacy topics). See `docs/accounts-privacy.md`.
- **Storage seam:** per-user localStorage goes through `userKey()` automatically (`utils/userStorage.js`); any other store (IndexedDB) must call `userKey()`/`keyPrefix()` itself and register `onUserRemoved(fn)`. Device-wide keys are in `GLOBAL_KEYS`.
- Drive contents load lazily: use `await readContent(file)` for anything that sends, edits or copies contents; `saveNow()`/`writeAndSave()` are async.
- Atlas free tier is 512 MB and Render's outbound is 5 GB/month: every new stored or relayed thing needs caps (see the budgets in `docs/storage-sync.md`, `docs/messenger.md`, `docs/compass.md`).

## Layout
- **Client:** React 19 + Vite in `client/`, deployed by Vercel on every push to `main`.
  - Apps live in `client/src/components/applets/<app>/` and load lazily from `OS-specific/Desktop.jsx` (`lazyApp`).
  - Each app is registered in several places: `utils/programs.js` (fields `group` and optional `also: [...]` for Start menu folders, plus `online: "<id>"` for room games), `applets/dos/commands.js`, `applets/taskManager/processes.js`, `OS-specific/Helper.jsx` (Floppy tips), `utils/fs.js`, `utils/imageMapper.js`, an icon in `client/public/assets/program_icons/`, and a 98ish Help topic claiming it (`applets/help/topics/`; the help unit test fails without one).
- **Server:** `server.js` + `server/*` (Express, Socket.io, MongoDB), deployed by Render (service `srv-davi6cm7bikc73e5k5ig`) on every push.
  - Online games use the room system `server/arcade/rooms.js`, which has a guide at the top. Rules modules are in `server/arcade/games/`.
  - The client side of the room system is `client/src/components/shared/online/`.
- **Shared systems** (one line each; details in the doc named):
  - Audio: `utils/audio.js`, one AudioContext + `createBus`, follows taskbar volume/mute (`docs/shell.md`).
  - Draggable dialogs: `shared/Dialog.jsx` + `hooks/useFloating.js`; `?dragdebug=1` logs releases (`docs/shell.md`).
  - Right-click menus: `shared/ContextMenu.jsx`, `OS-specific/GlobalMenu.jsx`; iPhone app menus need `useLongPress`.
  - Phone hold-menu guard: `main.css` block + `utils/touchGuard.js` (`docs/shell.md`).
  - Touch controls: `shared/controls/`; Tetris swipe controls in `applets/tetris/` (`docs/tetris-mobile.md`).
  - 98ish phone keyboard: `shared/keyboard/` (`docs/keyboard.md`, `docs/shell.md`).
  - 98 drop-downs and date/time pickers: `shared/select/` (`SelectHost` in App.jsx); opt out with `data-native-select`.
  - User profiles `utils/users.js`, lock screen `utils/lock.js` + `OS-specific/lock/` (`docs/shell.md`).
  - Control Panel `applets/controlPanel/`, accessibility `utils/a11y.js` + `client/postcss-a11y.js` (opt a CSS file out with `/* a11y: fixed-text */`), search `utils/searchCore.js`/`search.js`/`searchIndex.js`, Help `applets/help/` (`docs/shell.md`).
  - Notification Center `utils/notifications.js` (every toast also calls `notify()`; every toast/sound asks `interrupts(app, from)` first for Do Not Disturb), Web Push `server/push/` + `utils/push.js` + `public/sw.js`, DND `utils/dnd.js`/`dndCore.js` (`docs/notifications.md`).
  - 98 Messenger: calls `applets/aim/call/` + `server/aim/calls.js`; history/pictures/voice/reactions `applets/aim/history/` + `server/aim/history.js`, `media.js`, `conversations.js` (`docs/messenger.md`).
  - Sharing with the phone: `utils/share.js` (`shareOut` straight from the tap), share target in `public/sw.js` + `OS-specific/ShareCenter.jsx`, `utils/systemClipboard.js` (`docs/sharing.md`).
  - Apps with their own stores: Address Book, Notes & Tasks (tasks are Calendar to-do events), Weather, Camera + Photos, Calendar + Clock (`docs/apps.md`).
  - Compass web browser `applets/compass/` + relay `server/web/` (`docs/compass.md`).
  - The drive (IndexedDB, `utils/fs.js`/`driveStore.js`) and file sync (`utils/driveSync.js`, `server/drive/`, Vercel Blob) (`docs/storage-sync.md`).
  - Accounts: Delete My Account (`server/account/`, `aim/DeleteAccount.jsx`, `utils/account.js`) (`docs/accounts-privacy.md`).
- **Memory notes:** `C:\Users\brand\.claude\projects\C--Users-brand-98ish\memory\` has more architecture detail per area (online rooms, pickleball, phone mode, desktop shell, and others).

## Running and testing
Full detail (push tests, call tests, per-area suites) in `docs/testing.md`; each feature doc lists its own unit tests and browser scripts.
- **Dev servers:** vite on 5199 (`cd client && npx vite --port 5199 --strictPort`), chat server `COUPLES_TEST_CLOCK=1 PORT=8000 node server.js`. Feature suites often use their own port pairs (listed in each doc).
- **Unit tests:** root `npm test` runs the server and arcade tests (471; see the flaky one under Known issues). App unit tests run by FILE path: `node --test path/to/x.test.js` (a folder path fails on Windows).
- **Browser tests:** playwright-core with system Chrome. Scripts live in the session scratchpad, which is temporary, so recreate them as needed.
  - Set localStorage `98ish.bootScreen=off` and `98ish.helper=off` (keeps Floppy and the Welcome window away).
  - Phone-emulation tests that type into forms: set `keyboard: "phone"` in `98ish.settings`, or the 98ish keyboard covers the page's buttons.
  - Tucked-away controls: press `.moreOpts-toggle`, or preset `localStorage["98ish.moreOptions"] = '{"*":true}'`.
  - The service worker (push, share target) only registers in a production build: `vite build` + `vite preview`.
  - Restart vite after edits before browser tests that `import("/src/...")` (HMR gives modules a `?t=` URL, so a test would get a second instance).
- **Discipline:**
  - Restart both servers after merging new code, so you don't test stale code.
  - Run each suite once, and investigate only failures that repeat.
  - The machine has 7.7 GB of RAM. Run at most 3 agents, one Chrome at a time, and kill leftover headless Chrome.

## Deploys and production
- Vercel deploys the client and Render the server on every push to `main`.
- Deploy checks: Render CLI `render.exe deploys list srv-davi6cm7bikc73e5k5ig -o json --confirm`; Vercel: check `https://98ish.vercel.app/sw-manifest.json` for the new chunk names.
- Env vars on `srv-davi6cm7bikc73e5k5ig`: `MONGODB_URI`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `BLOB_READ_WRITE_TOKEN`. Set through Render's REST API with the CLI's login (`~/.render/cli.yaml` api.key; `PUT /v1/services/<id>/env-vars/<KEY>`); the Render CLI has no env-var command. Never print values. Don't regenerate the VAPID keys (every device would have to turn notifications on again). Every optional variable (TURN, Compass relay switches and budgets, drive/Blob/message caps) is in `docs/env-vars.md`; production needs none of them.
- Keep-awake: `server.js` visits its own `RENDER_EXTERNAL_URL` every 10 minutes (`KEEP_AWAKE=0` turns it off); GitHub Actions `keepalive.yml` is a throttled backup.
- Compass's relay runs in "true internet" mode by default (`WEB_RELAY` unset = `on`, decided with the owner); `WEB_RELAY=allowlist` or `0` are the conservative switches. Budgets keep Render under 5 GB/month (`docs/compass.md`).

## Current status
Update this section in place. Older dated logs are in `docs/history.md`.

**As of 2026-10-05:** everything is merged to `main`, pushed and deployed (Vercel + Render on the same commit). No WIP branch; the only other local branch, `compass-review`, is long merged (safe to delete). Nothing in progress. **Almost none of the 2026-10-03/04 work has been tried on a real iPhone.**

Shipped recently (details in the docs): Delete My Account + privacy guide; file sync on by default with contents in Vercel Blob; Compass true-internet browsing; phone drop-downs, simpler screens, no iPhone hold menus, steady popup drags, keyboard fixes; Messenger history/pictures/voice/reactions/receipts; Notes & Tasks; Weather; Do Not Disturb; Tetris like the official app; five retro quick games; Pinball: Blue Screen; Pickleball 98 mocap/motion matching, athletic bodies, natural arms, Locker Room, Practice, Swipe controls, real ball sounds, My Park.

**Known issues:**
- **Flaky server test:** root `npm test` (471) fails exactly 1 test about one run in three when the machine is loaded, and passes on the rerun; which test hasn't been captured yet. Next time it fails, run `npm test > out.txt 2>&1` and grep `not ok` / `✖` for the name, then fix its timing.
- **Phone frame rate not confirmed:** Pickleball (athletes + arms + motion matching), My Park and Tetherball were only measured in Chrome phone emulation with 4x CPU throttle (Pickleball ~17-36 fps there, My Park 33-41). Needs the real iPhone.
- **Keyboard renderer crash** in headless Chrome during Speed Typist races: unresolved, likely environment-specific; investigation and next steps in `docs/keyboard-crash.md`. Ask the owner whether it happens on a real iPhone.
- Pickleball: a player can block the sideline camera for a few frames (3 of 2,227 in a test; fix: apply `clearShot` to the eased camera position or raise `camera.js` BODY.r); the drop-down bug the owner saw couldn't be reproduced (ask which screen); overheads out of reach; no Erne/ATP; park games are played at Riverside Park, not at that court. More "Left" items per feature in `docs/pickleball-log.md`.
- Smaller leftovers: the taskbar clock follows Regional Settings (12-hour on US devices; Regional Settings > Time > 24-hour brings that back); Paint's canvas scrolls a few pixels on narrow phones; in landscape the achievement toast covers the screen briefly; Pickleball AI rallies run a bit long at Pro/Legend; Quick Match doesn't auto-add computer racers.
- Nine exited test-Chrome shells (16 KB each) linger until a reboot; harmless.

**Next steps, in order:**
1. The owner's real-iPhone pass, then fix what it finds. Checklist: the 98ish keyboard (Notepad, Messenger, Run, Speed Typist, its X); startup sound and the "scrollbar on open" report; Tetris app controls/layout (board position, 1:1 drag, side taps, flick threshold, no Safari scroll/zoom/callout, tap speed); Camera (front/back, background/resume, clips) and Photos (pinch, swipe); the drive in IndexedDB ("Kept safe: Yes" from the Home Screen) and file sync both ways (conflict, delete, a photo just before locking); Delete My Account with a throwaway name + the partner's notice; Calendar sharing, reminders, iPhone Calendar subscription; push on the Home Screen app (test, IM, call, reminder, quiet hours); Messenger calls on two iPhones (Wi-Fi and cellular; if cellular fails, set the Metered TURN env vars); Messenger pictures/voice/reactions/"Read" and history after reload; shared Notes live; Weather location prompt; DND holding pushes and letting a favorite's call ring; Compass signed on; hold menus (none in games, still in text boxes); popup drags (`?dragdebug=1` if not); Pickleball frame rate, Swipe vs Classic, swipe trail, sounds, arms, Practice, My Park; the five retro quick games (Zap It!'s "Allow motion", Tetherball fps); Pinball flippers with two thumbs.
2. Name and fix the flaky server test.
3. Wave 2 essentials (owner approved the research; ask before starting): keep uploads as they are (no 30 s WAV cut, accept PDF/video), a real music + video library, Shared Albums, Snipping Tool + clipboard history.
4. Pickleball polish after the phone test: frame rate on the phone, park games on the park's own court, overhead reach / jumps, mocap celebrations, Erne/ATP.
5. Wave 3 (PDF reader + scanner, version history, desktop gadgets), then wave 4 (maps + opt-in location sharing, passkeys, small utilities, spreadsheet).

## Docs index (`docs/`)
- `shell.md`: audio, draggable dialogs, menus, phone hold-menu rules, touch controls, keyboard summary, drop-downs, user profiles, lock screen, Control Panel, accessibility, search, Help, simplicity. Read before touching shell-wide behavior or adding a program.
- `simplicity.md`: the baseline-view audit per program and remaining candidates. Read when adding options or redesigning a screen.
- `keyboard.md`: the 98ish phone keyboard's design. Read before changing `shared/keyboard/`.
- `keyboard-crash.md`: the headless-Chrome renderer crash investigation (repro `keyboard-crash-repro.mjs`). Read if the crash comes up again.
- `tetris-mobile.md`: Tetris app-style swipe controls and layout, research and numbers. Read before touching Tetris touch play.
- `notifications.md`: Notification Center, Web Push (iPhone requirements, triggers, deep links), Do Not Disturb (client + server). Read before adding a toast, push or sound.
- `messenger.md`: calls (WebRTC signaling) and Messenger history, pictures, voice, reactions, receipts with caps and tests. Read before changing 98 Messenger.
- `sharing.md`: Web Share out, share target in, clipboard. Read before adding a "Send To" or receive path.
- `apps.md`: Address Book, Notes & Tasks, Weather, Camera + Photos, Calendar + Clock (stores, servers, tests). Read before working on any of them.
- `compass.md`: Compass and its relay: routing, isolation, safeguards, budgets, Render numbers/terms, security review with the test that proves each protection. Read before any change to Compass or `server/web/`.
- `storage-sync.md`: the IndexedDB drive, persistence, file sync, the Vercel Blob bucket and its free budgets. Read before touching files, photos or sync.
- `accounts-privacy.md`: Delete My Account flow and rules, privacy help topics. Read when adding anything stored per account.
- `env-vars.md`: every optional server env var with defaults, plus production config. Read before changing server limits or deploy settings.
- `testing.md`: full testing notes (push and call test setups, per-area suites). Read before writing browser tests.
- `games.md`: game performance rules (frame clock, dynamic resolution, AA, shaders, context loss), the five quick games, the retro art kit, Pinball: Blue Screen, Chess Puzzles (Lichess CC0 data, rating, Rush/Streak) and Imposter (party word game, pass-and-play + online). Read before building or tuning a game.
- `games-new.md`: design and research for the quick games (Bomb Panic sources). Read when extending them.
- `pickleball-log.md`: Pickleball 98 feature notes (footwork, upper body, pro movement, mocap/MakeHuman, Practice, phone round, swipe trail + sounds, athletes, My Park, arms) with measurements, tests and leftovers. Read before any Pickleball work.
- `pickleball-movement.md`, `pickleball-arms.md`, `pickleball-practice.md`: research and specs behind movement, arms and Practice. Read with the matching log section.
- `casino.md`: Casino 98 (Hold'em vs computer + online, Blackjack, Roulette, Slots, Video Poker, Craps, Baccarat), the shared chip bank, rules modules and tests. Read before touching `applets/casino/` or `server/arcade/games/holdem.js`.
- `history.md`: past dated close-outs and status snapshots (2026-10-03/04) and the original iPhone checklist. Read for background on when and why something shipped.
