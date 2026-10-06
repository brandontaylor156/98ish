# History: close-out logs and older status snapshots
Dated logs moved from CLAUDE.md on 2026-10-05. CLAUDE.md's "Current status" is now the one place updated in place.

## Session close-out (2026-10-04, night)
Everything below is merged to `main`, pushed, and deployed (Vercel production + Render live on the same commit). No agents, dev servers or test runs are running; no half-done work exists (no WIP branch). The only other local branch is `compass-review`, fully merged long ago (safe to delete). None of today's work has been tried on a real iPhone.

**Done today (2026-10-04):**
- Accounts and storage: Delete My Account (server + device), the privacy guide, file sync on by default (one-time "Turn on file sync?" for devices that had it off), synced file contents in Vercel Blob (store `98ish-drive`, private, budgets in MongoDB), photos ~400 KB.
- Compass: true internet for signed-on users (relay "on" by default), guests on the allowlist + direct/archived copies, isolation tested with hostile pages, persisted counters, the monthly meter of all server traffic.
- Platform: phone drop-downs as real lists under the field, simpler screens everywhere ("More options", two rounds, `docs/simplicity.md`), no iPhone hold menus outside text fields and reading areas (`utils/touchGuard.js`), popups that drag smoothly and stay put, keyboard fixes (no phone-keyboard switch, a proper X, Enter labels, chat layouts while typing, Speed Typist keyboard up by itself), the games' first performance wave (real-time frame clock, faster taps, AA, shadows, shader pre-compile).
- Wave 1 essentials: 98 Messenger history/pictures/voice/reactions/read receipts, Notes & Tasks, Weather, Do Not Disturb.
- Games: Tetris like the official app (controls + layout), five quick games (Boom Frenzy, Color Match, Echo Pads, Zap It!, Tetherball) redrawn in retro pixel art with a shared kit, Pinball: Blue Screen.
- Pickleball 98: motion capture + motion matching, realistic athletic bodies, natural arms, pro movement + handedness, Locker Room, Practice (lessons, ball machine, drills), controls (Swipe/Classic, pad left/right, swipe trail, one banner slot, camera fixes, ball in hand), real ball sounds, My Park.

**In progress:** nothing.

**Known issues:**
- **Flaky server test:** root `npm test` (471) fails exactly 1 test about one run in three when the machine is loaded, and passes on the rerun; which test hasn't been captured yet (the output was only summarised). Next time it fails, run `npm test > out.txt 2>&1` and grep `not ok` / `✖` for the name, then fix its timing.
- **Phone frame rate not confirmed:** Pickleball (athletes + arms + motion matching), My Park and Tetherball were only measured in Chrome phone emulation with 4x CPU throttle, often while other jobs loaded the machine (Pickleball ~17-36 fps there, My Park 33-41). Needs the real iPhone.
- **Keyboard renderer crash** in headless Chrome during Speed Typist races: see "Open issue" below; unresolved, likely environment-specific, needs the real iPhone to decide.
- Pickleball: a player can block the sideline camera for a few frames (3 of 2,227 in a test); the drop-down bug the owner saw couldn't be reproduced (ask which screen); overheads out of reach; no Erne/ATP; park games are played at Riverside Park, not at that court.
- Nine exited test-Chrome shells (16 KB each, "no running instance") linger until a reboot; harmless.

**Next steps, in order:**
1. The owner's real-iPhone pass (checklist in "What's next" below), then fix what it finds.
2. Name and fix the flaky server test.
3. Wave 2 essentials (owner approved the research; ask before starting): keep uploads as they are (no 30 s WAV cut, accept PDF/video), a real music + video library, Shared Albums, Snipping Tool + clipboard history.
4. Pickleball polish after the phone test: frame rate on the phone, park games on the park's own court, overhead reach / jumps, mocap celebrations, Erne/ATP.
5. Wave 3 (PDF reader + scanner, version history, desktop gadgets), then wave 4 (maps + opt-in location sharing, passkeys, small utilities, spreadsheet).

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
  - Quick games (2026-10-04, not yet tried on a real phone): Boom Frenzy, Color Match, Echo Pads, Zap It!, Tetherball (see "Quick games").
  - The Quiz Show redesign, Photo Puzzle fixes, live co-op in Sunny Acres.
  - Pickleball 98: skinned CC0 athletes, plus a redesign based on real play (one hit control, aim and tap soft / hold hard, dinks, resets, speed-ups, hand battles).
  - The 98ish phone keyboard (stays up on stray taps; only its X, Go, or the field's window going closes it; keys never stick looking pressed).
  - 98 Messenger voice/video calls, Calendar + Clock with shared calendars, Camera + Photos (all pushed; none tried on a real iPhone yet).

Just pushed and not yet tried on a real phone:
- **The 98ish phone keyboard** (`shared/keyboard/`, setting under Start > Settings > Keyboard). It replaces the phone keyboard on touch devices. There's NO in-keyboard switch to the phone keyboard (the owner removed it: once switched there was no way back); the setting chooses. Was: a title-bar button that switched to the phone keyboard for emoji, dictation and AutoFill.
- Also: a fix so Speed Typist's race box brings the keyboard up after the countdown, and vibration now only on Android.

## What's next
1. **Owner's real-iPhone check:**
   - The 98ish keyboard in Notepad, Messenger, Run, Speed Typist; the X (a 98-proportioned 15x13 button with a wide touch area).
   - The startup sound; the earlier "scrollbar on open" report.
   - Tetris "Like the Tetris app" controls and layout: does the board sit where it does in the app (not too high), does a drag feel 1:1 (Drag speed 100%), do side taps rotate the way the app does, is the swipe-down threshold right (no accidental hard drops at the end of a slide, no missed flicks), does Safari ever scroll/zoom or show a callout, and does a tap feel quick enough (it rotates on lift).
   - Camera (front/back switch, Safari background/resume, video clips) and Photos (pinch, swipe) on the iPhone.
   - The drive's move to IndexedDB on the iPhone (every photo still there; Properties shows "Kept safe: Yes" when added to the home screen), and file sync between the phone and a computer (a photo each way, a conflict, a delete).
   - Sync now turns itself on at the first sign-on (one notice): check both iPhones' photos reach the account (Backup shows online usage), and that a photo taken right before locking the phone still uploads.
   - Delete My Account with a throwaway screen name (never the real ones): the confirmation on the phone, then the partner's "pairing ended" notice.
   - Calendar sharing with the girlfriend's account, reminders, and the iPhone Calendar subscription.
   - **Push notifications on the iPhones** (needs the VAPID env vars on Render): Add to Home Screen, sign on, bell > Settings > Turn on notifications, Send a test; then an IM, a call and a reminder with 98ish closed, and quiet hours.
   - **98 Messenger calls on two real iPhones**, ideally once on Wi-Fi and once on cellular: ring, answer, hear each other (and that the ringtone stops), camera flip, mute, lock the screen / switch apps mid-call, and whether a cellular call connects without TURN (if not, set the Metered env vars above).
2. **Recommended next features**, in this order:
   - (Done: Control Panel + accessibility, Address Book + search everything. Not yet tried on a real iPhone.)
   - (Done: 98ish Help, the help center. Its topics describe 98ish as of 2026-10-03; update them with each feature.)
   - (Done: Notes & Tasks, wave 1 item 2. Not yet tried on a real iPhone.)
   - (Done: Weather and Do Not Disturb. Not yet tried on a real iPhone: "Use My Location" permission prompt, the tray icon, and DND holding pushes / letting a favorite's call ring.)
   - (Done 2026-10-04: Messenger history/media/reactions/receipts, Notes & Tasks, Weather, Do Not Disturb = wave 1.)
   - Next: wave 2 (see "Session close-out" next steps): keep uploads as they are, music + video library, Shared Albums, Snipping Tool + clipboard history; then waves 3 and 4.
4. **Also check on the iPhone (added 2026-10-04):** Messenger pictures/voice/reactions/"Read" between the two phones and history after the app reloads; Notes shared live; Weather location prompt; Do Not Disturb holding pushes and letting a favorite's call ring; Compass signed-on browsing; the hold menu (no magnifier/Save Image in games, still there in text boxes); popup drags stay put (if not, open Safari with `?dragdebug=1` and screenshot the log); Pickleball: frame rate, Swipe vs Classic feel, the swipe trail, the new sounds, the arms, Practice lessons, My Park; Tetris; the five retro quick games (Zap It!'s "Allow motion", Tetherball frame rate); Pinball flippers with two thumbs.
3. **Known leftovers:**
   - The taskbar clock now follows Regional Settings, so on a US device it reads "10:32 PM" (it was always 24-hour); Regional Settings > Time > 24-hour brings that back.
   - Paint's canvas scrolls a few pixels on narrow phones.
   - In landscape, the achievement toast covers the screen briefly.
   - Pickleball AI rallies run a bit long at Pro/Legend.
   - Quick Match doesn't auto-add computer racers (you click Play the Computer).
