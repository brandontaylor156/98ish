# 98ish: notes for the next session

A Windows 98-style web desktop at https://98ish.vercel.app. The owner uses it mostly on an iPhone and shares it with his girlfriend and friends.

## Layout
- **Client:** React 19 + Vite in `client/`, deployed by Vercel on every push to `main`.
  - Apps live in `client/src/components/applets/<app>/` and load lazily from `OS-specific/Desktop.jsx` (`lazyApp`).
  - Each app is registered in several places: `utils/programs.js` (fields `group` and optional `also: [...]` for Start menu folders, plus `online: "<id>"` for room games), `applets/dos/commands.js`, `applets/taskManager/processes.js`, `OS-specific/Helper.jsx` (Floppy tips), `utils/fs.js`, `utils/imageMapper.js`, and an icon in `client/public/assets/program_icons/`.
- **Server:** `server.js` + `server/*` (Express, Socket.io, MongoDB), deployed by Render (service `srv-davi6cm7bikc73e5k5ig`) on every push.
  - Online games use the room system `server/arcade/rooms.js`, which has a guide at the top. Rules modules are in `server/arcade/games/`.
  - The client side of the room system is `client/src/components/shared/online/`.
- **Shared systems:**
  - **Audio** (`client/src/utils/audio.js`): one AudioContext and `createBus`, following the taskbar volume and mute.
  - **Draggable dialogs** (`shared/Dialog.jsx` + `hooks/useFloating.js`).
  - **Right-click menus** (`shared/ContextMenu.jsx`, rendered into `.os-root`) and the global right-click menu (`OS-specific/GlobalMenu.jsx`).
  - **Touch controls** (`shared/controls/`).
  - **98ish phone keyboard** (`shared/keyboard/`; design in `docs/keyboard.md`).
  - **98-style drop-downs and date/time pickers** (`shared/select/`, `SelectHost` mounted once in App.jsx): takes over every `<select>` and `input[type=date|time|datetime-local|month]` with no change at the call sites. Touch: the tap's `touchend` is cancelled (no focus, so no iOS picker) and a 98 bottom sheet opens; mouse: the `mousedown` is cancelled and a list/calendar drops down (date fields keep typing; only their button opens the calendar); keys: Alt+Down/F4/Space. Choices go through the native value setter plus `input`/`change` events, so React state updates. Opt out with `data-native-select`; `multiple`/`size>1` lists stay native. Tests: `select.test.js`, browser scripts `sel-*.mjs`.
  - **98 Messenger calls** (1:1 voice/video, WebRTC): signaling in `server/aim/calls.js` (relays only between the two people in a call; busy, ring timeout, block, drop handling), ICE servers in `server/aim/ice.js`, client in `applets/aim/call/` (`engine.js` holds the call and the peer connection outside React; `CallManager.jsx` rings, opens windows, shows toasts; `CallWindow.jsx`, `RingWindow.jsx`). Calls start from the IM window header, a buddy's right-click menu, and Us ("Video call [partner]").
  - **Notification Center** (`utils/notifications.js`, taskbar bell `OS-specific/NotifyTray.jsx` + `Notify.css`, settings `NotifySettings.jsx` (lazy), `NotifyBridge.jsx` inside the Messenger provider): every toast (IMs, missed calls, Mail, Calendar, couples, game invitations, achievements, drive sync) also calls `notify({ app, title, text, key, target })`. Items merge by `key` (an IM and its push are one item), are kept per account in localStorage (`98ish.notifications`), and `target` is plain data (`{ kind: "im", with }`, `mail`, `calendar`, `program`, `invites`, `notifications`) that NotifyBridge opens. "Mark all read" / "Clear all" sync a `seenAt` per account to the server. Start > Settings > Notifications... opens the settings.
  - **Web Push** (`server/push/`, client `utils/push.js`, handlers at the end of `client/public/sw.js`): subscriptions per account and device, categories (im, calls, calendar, couples, mail, games), quiet hours (calls can ring through), 404/410 subscriptions deleted. A push goes out only when the person is away from 98ish: signed off, connection gone, or the tab hidden (the client sends `aim:visibility`). Triggers: IMs (IMs to someone signed off who has push on are kept and delivered at sign on; MongoDB collections `pushsubs`, `pushprefs`, `pushinboxes`), calls (a signed-off buddy with push still rings by notification; the ring reaches them if they open 98ish while it rings; missed calls), Mail, game invitations, couple notices (letters, flowers, pair requests, quiz turns) and two schedules: calendar reminders on server calendars (every minute, deduplicated by tag `cal-rem-<fireKey>` with the in-app reminder) and Our Pet needing care (at most every 8 hours). Deep links: `/?open=im&with=NAME`, `?open=call&with=`, `?open=mail`, `?open=calendar&cal=&event=`, `?open=program&name=`, `?open=invites`, `?open=notifications` (they skip the boot screen and Welcome).
  - **iPhone:** Web Push works only for 98ish added to the Home Screen (iOS 16.4+), and the permission prompt has to come from a tap. In Safari the settings show an illustrated Add to Home Screen guide; once opened from the Home Screen they show "Turn on notifications". The manifest (`client/public/manifest.webmanifest`, standalone, icons 192/512/maskable, `apple-touch-icon` 180 in `index.html`) is what iOS needs.
- **Env vars (Render), all optional:**
  - `VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT` (`mailto:you@example.com`): Web Push. Generate a pair once with `npx web-push generate-vapid-keys` (never commit it; changing it later makes every device turn notifications on again). Without them push is hidden in the settings ("not set up on this server") and nothing errors. `PUSH_DEBUG=1` logs send counts.
  - Render's free tier sleeps after 15 idle minutes, so scheduled reminders and Our Pet pushes wait until something wakes the server (it then catches up 30 minutes back). A free uptime pinger (cron-job.org or UptimeRobot hitting `https://nine8ish.onrender.com/` every 10 minutes) keeps it awake; one always-on service fits in the free 750 hours a month.
  - `METERED_TURN_APP` + `METERED_TURN_API_KEY`: Metered Open Relay TURN (free account, 20 GB/month). APP is the `<app>` of `<app>.metered.live`; the server fetches credentials, so the key never reaches the browser.
  - Or `TURN_URLS` (comma-separated `turn:`/`turns:` URLs) + `TURN_USERNAME` + `TURN_CREDENTIAL` for any other TURN server.
  - With none set, calls are STUN-only (Google's public STUN): most Wi-Fi works; some cellular/strict NATs can't connect, and the call window then says why after about 30 seconds.
- **Memory notes:** `C:\Users\brand\.claude\projects\C--Users-brand-98ish\memory\` has more architecture detail per area (online rooms, pickleball, phone mode, desktop shell, and others).

## Rules
- Never print the MongoDB connection string, passwords or any `.env` value.
- Free services only. Commit and push only when asked; the owner has authorized finishing and pushing feature rounds.
- Commit messages end with the Co-Authored-By / Claude-Session lines given in the session.
- Trademarked asks get original names and art (Word Duel, Last Card, Monster Duel, Hexlands, Shred 98, Speed Typist 98, Appward 98 as an "unofficial tribute").

## Testing
- **Unit tests:**
  - Root `npm test` runs the server and arcade tests (314 passing; `server/push/test` fakes web-push).
  - The service worker's push handlers and the Notification Center store: `node --test client/src/utils/sw.test.js`.
  - App unit tests run by FILE path: `node --test path/to/x.test.js`. A folder path fails on Windows.
- **Browser tests:** playwright-core with system Chrome. Scripts live in the session scratchpad, which is temporary, so recreate them as needed.
  - Ports: vite on 5199 (`cd client && npx vite --port 5199 --strictPort`), chat server `COUPLES_TEST_CLOCK=1 PORT=8000 node server.js`.
  - Set localStorage `98ish.bootScreen=off` and `98ish.helper=off`. With `98ish.helper=off`, Floppy and the Welcome window stay away.
  - Phone-emulation tests that type into forms: set `keyboard: "phone"` in `98ish.settings`, or the 98ish keyboard covers the page's buttons.
  - Push tests (`push-*`): the service worker only registers in a production build, so `vite build` with `VITE_SOCKET_URL` and serve it with `vite preview`; start the server with test VAPID keys. Push needs a normal profile (`chromium.launchPersistentContext`; Chrome turns the Push API off in incognito contexts) and `context.grantPermissions(["notifications"])`. Headless Chrome subscribes with Google's push service and the server's sends are accepted, but delivery back to an automated browser is unreliable (it arrived in 1 of 4 runs), so tests fall back to handing the message to the service worker with CDP `ServiceWorker.deliverPushMessage`. Headless also keeps no shown notifications (`getNotifications()` is empty).
  - Call tests (`call-*`): launch Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, two contexts in one browser. `window.__call` exposes the call state (`get()`, `peer()`, `start`, `answer`, `hangUp`). Under memory pressure Chrome's fake camera sometimes isn't found by the second context; the app falls back to voice with a notice, and the tests then press Camera On.
- **Discipline:**
  - Restart both servers after merging new code, so you don't test stale code.
  - Run each suite once, and investigate only failures that repeat.
  - The machine has 7.7 GB of RAM. Run at most 3 agents, one Chrome at a time, and kill leftover headless Chrome.
- **Deploy checks:**
  - Render CLI: `render.exe deploys list srv-davi6cm7bikc73e5k5ig -o json --confirm`.
  - Vercel: check `https://98ish.vercel.app/sw-manifest.json` for the new chunk names.

## Where things stand (2026-10-03)
Shipped and live:
- **Platform:**
  - Lasso and re-grid of desktop icons; a 98ish right-click menu everywhere.
  - Draggable inner dialogs.
  - Every game under Start > Games; a Programs > Community folder.
  - Full-height drop-down arrows; gap-free submenus.
  - A shared audio engine; about 75 audit fixes; iPhone page pinning.
  - Welcome to 98ish with a 13-stop guided tour.
- **Apps:**
  - Appward 98, Shred 98, Word Duel, Last Card, Monster Duel, Hexlands, Speed Typist 98, Checkers online.
  - The Quiz Show redesign, Photo Puzzle fixes, live co-op in Sunny Acres.
  - Pickleball 98: skinned CC0 athletes, plus a redesign based on real play (one hit control, aim and tap soft / hold hard, dinks, resets, speed-ups, hand battles).
  - The 98ish phone keyboard (stays up on stray taps; only its X, Go, or the field's window going closes it; keys never stick looking pressed).
  - 98 Messenger voice/video calls, Calendar + Clock with shared calendars, Camera + Photos (all pushed; none tried on a real iPhone yet).

**Camera + Photos** (`applets/camera/`, `applets/photos/`; Accessories, also Entertainment, on the desktop):
- **Camera:** front/back/webcam via getUserMedia with clear permission/insecure/no-camera messages and a `capture` file-input fallback. Modes: Photo, Burst, Photo Strip, Video (clips download to the device; too big for the 98ish drive; on iPhone they record the plain camera without effects). 13 pixel effects + 9 frames. Photos save as JPEG (max 1280 px, about 175 KB) into `C:\My Pictures`.
- **Photos:** folder grid, viewer with zoom (buttons, wheel, pinch, double-tap) and swipe that never moves the page, rotate, crop, brightness/contrast, effects/frames with Undo until Save, slideshow with transitions, Share (wallpaper, Paint, Photo Puzzle, Mail attachment, Network Neighborhood, download), rename, delete, upload (HEIC gets a message).
- **Opening any picture now opens Photos** (not Paint); right-click > Edit opens Paint. One-copy programs brought forward now still get a `handoff` payload (App.jsx), used by Puzzle and Mail.
- The 98ish drive is about 5 MB: roughly two dozen photos fit.

**98ish Calendar + Clock** (TimeTree-style shared calendars; not yet tried on a real phone):
- **Client:** `applets/calendar/` (Accessories, also in Us). `store.js` holds calendars and events (server calendars plus "On this device" in localStorage, uploadable); `recur.js` is the date math (repeats expanded client-side in the event's own IANA zone, so DST is right; exceptions keyed by the occurrence's original date); `ics.js` writes .ics files (the server imports it for feeds); `CalendarBridge.jsx` (lazy, always mounted on the desktop) applies live `cal:*` notices, fires reminders (Reminder window, Snooze/Dismiss, `98ish.cal.reminders`), rings Clock alarms and the timer, and opens Calendar/Clock (`openCalendar()`, `?calendar=CODE` invite links). The taskbar clock still opens Date/Time Properties on a double-click; right-click or hold it for Calendar and Clock.
- **Server:** `server/calendar/` at `/api/calendar` (Messenger bearer token; non-members get 404). Personal calendar per account, an "Us" calendar per paired couple (visible only while paired), group calendars with owner/member roles, invites by screen name or 8-letter code, comments, an activity feed, and a secret per-member iCalendar feed (`/api/calendar/feed/<token>.ics`) phones can subscribe to. MongoDB collections `calendars`, `calevents`, `calcomments`, `calactivity`.
- **Reminders with 98ish closed:** Web Push (see Notification Center above) sends reminders from server calendars ("On this device" calendars only remind while 98ish is open). Also: "Add to my phone" downloads an event's .ics, and Calendar Properties > Phone gives a webcal link (turn off "Remove Alerts" on iPhone for alarms).
- **Tests:** `node --test client/src/components/applets/calendar/recur.test.js` (and `ics.test.js`); server `server/calendar/test`; browser scripts `cal-*.mjs`.

Just pushed and not yet tried on a real phone:
- **The 98ish phone keyboard** (`shared/keyboard/`, setting under Start > Settings > Keyboard). It replaces the phone keyboard on touch devices, with a title-bar button that switches to the phone keyboard for emoji, dictation and AutoFill.
- Also: a fix so Speed Typist's race box brings the keyboard up after the countdown, and vibration now only on Android.

## Open issue: renderer crash in headless Chrome (keyboard + Speed Typist race)
- **Repro:** `node docs/keyboard-crash-repro.mjs` (vite 5199 + server 8000). Phone emulation (390x844, touch, iPhone user agent): type into Run with the 98ish keyboard, start a Speed Typist race against the computer, tap the race box, tap keys. The page crashes ("Target crashed") in nearly every run, after two "The AudioContext encountered an error from the audio device or the WebAudio renderer" events and the context going `suspended`.
- **Ruled out:**
  - Memory pressure: it crashes 3/3 with memory free; page heap stays about 30 MB, DOM steady.
  - Device zoom: it crashes at scale factor 1 and 2.
  - Saved settings and the startup sound: it crashes with `startupSound: false` and with other settings only.
  - Our audio graph: one context, no live sounds, no new nodes for minutes before the crash.
  - Playwright's element taps: coordinate taps crash too.
  - Time alone: a bare page with a running AudioContext, 98ish idle with audio unlocked, and an idle race with the keyboard open all survive 6+ minutes.
- **Doesn't crash:** the realistic keyboard test (`kb-speedtype`, about 1,100 keys over 13 races, including the startup sound on) passes, and typing elsewhere is fine.
- **So far:** it needs key taps during a race in a page that has been open for several minutes. The audio-device error is probably a symptom of the page process dying, not the cause.
- **Next steps:**
  - Bisect with the race's `requestAnimationFrame`/timer work disabled.
  - Then with the keyboard's per-key work stubbed out (preview bubble, auto-capitals, selectionchange handler).
  - Capture a Chrome crash dump (`--crash-dumps-dir`) for a signature.
  - The deciding question is whether it reproduces on a real iPhone. Ask the owner.

## What's next
1. **Owner's real-iPhone check:**
   - The 98ish keyboard in Notepad, Messenger, Run, Speed Typist; the phone-keyboard switch; AutoFill.
   - The startup sound; the earlier "scrollbar on open" report.
   - Camera (front/back switch, Safari background/resume, video clips) and Photos (pinch, swipe) on the iPhone.
   - Calendar sharing with the girlfriend's account, reminders, and the iPhone Calendar subscription.
   - **Push notifications on the iPhones** (needs the VAPID env vars on Render): Add to Home Screen, sign on, bell > Settings > Turn on notifications, Send a test; then an IM, a call and a reminder with 98ish closed, and quiet hours.
   - **98 Messenger calls on two real iPhones**, ideally once on Wi-Fi and once on cellular: ring, answer, hear each other (and that the ringtone stops), camera flip, mute, lock the screen / switch apps mid-call, and whether a cellular call connects without TURN (if not, set the Metered env vars above).
2. **Recommended next features**, in this order:
   - Control Panel + accessibility (magnifier, high contrast, larger text).
   - Then: address book, a spreadsheet, a PDF viewer / print to PDF, screenshot + clipboard history, a music library, user accounts + lock screen, search everything, help center.
3. **Known leftovers:**
   - No arrow-key navigation in the Start menu.
   - Paint's canvas scrolls a few pixels on narrow phones.
   - In landscape, the achievement toast covers the screen briefly.
   - Pickleball AI rallies run a bit long at Pro/Legend.
   - Quick Match doesn't auto-add computer racers (you click Play the Computer).
