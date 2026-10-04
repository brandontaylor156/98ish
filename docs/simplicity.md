# Simplicity: a baseline view in every program

The owner, after using 98ish on an iPhone: "I love the flexibility of the system but a lot of it is so overwhelming. I want the same exact capabilities but I want SIMPLICITY at the same time somehow, for the person who is simply trying to get a baseline view of each program."

## Principles

1. **A baseline view.** Each program opens with the 1 to 3 things most people do there, in big clear controls: a title, a day, a time and Save for a new event; Play and Play Online for a game; the shutter and the flip button in Camera.
2. **Nothing is removed.** Every other option stays reachable, one tap away:
   - a **More options »** disclosure that shows a one-line summary of what's set inside ("On this device · Doesn't repeat · Reminder 15 minutes before · Auto color"), so people can tell whether they need it without opening it;
   - the program's menus (File, Edit, Options...), which keep everything as before;
   - secondary tabs (period-correct Win98 property sheets);
   - right-click / long-press menus.
3. **Sensible defaults** make the baseline enough: the default calendar, the default reminder, Marathon, 3 opponents on Normal.
4. **Remembered.** Whether someone opened a More options is remembered per program part and per user (`utils/disclosure.js`, one localStorage key `98ish.moreOptions`, per user through the storage seam). Someone who always sets reminders opens it once.
5. **Same structure on every screen.** A computer may show a little more (Camera's effects panel and the online lobby's "Play with friends" start open on a computer), but the structure is the same.
6. **Windows 98 look.** The disclosure is a small Win98 "Advanced »" button on a computer and a full-width row on a phone. Labels: **More options »** / **Fewer options «**; in games **More modes »** and **Options »**.
7. **The primary action is always visible.** Save / OK / Send / Start Game never scroll away: sheet footers stay outside the scroller, and long forms use `PrimaryBar` (sticky at the bottom, above the iPhone home bar).
8. **Game launchers share one pattern**: a big Play (the mode most people play, or "X again" after a game), Play Online, then More modes and Options.
9. **No wasted space on phones.** Title screens start near the top (`clamp(14px, 7vh, 72px)`), not floating mid-screen.

## The shared pieces

- `client/src/utils/disclosure.js`: `useDisclosure(id, fallback)` -> `[open, setOpen]` (remembered; components with the same id stay in sync), `isOpen(id)`, `rememberOpen(id, open)`, `summarize(...parts)` (joins the set parts with " · "). `{"*": true}` in `98ish.moreOptions` opens every disclosure nobody chose for: older browser tests preset it to find controls where they used to be. Unit test: `node --test client/src/utils/disclosure.test.js`.
- `client/src/components/shared/MoreOptions.jsx` (+ `Simple.css`): `<MoreOptions id="calendar.event" summary="..." label="More options" lessLabel="Fewer options" forceOpen={problemInside} inline defaultOpen>`. A real `<button aria-expanded aria-controls>` (Enter/Space/Tab work), the summary linked by `aria-describedby` (tapping it opens too), the body a `role="group"` that is `hidden` while closed (still in the DOM, so form state is kept). `forceOpen` shows it when a problem inside needs seeing. `inline` drops the phone full-width row (toolbars, short rows).
- `client/src/components/shared/PrimaryBar.jsx`: `<PrimaryBar align="end|stretch">` a sticky bottom row for the main action, with the safe-area inset on phones. Put it last inside the scrolling box.
- `client/src/components/shared/GameStart.jsx`: `<GameStart id title play={{label, sub, onClick}} online={{onClick, label, sub}} modes={[...]} options={...} optionsSummary>`, the launcher pattern (Tetris uses it; Word Duel, Last Card, Hexlands, Speed Typist and Pickleball follow the same order with their own art).
- `KeepSafe` ("Your files are only on this device"): one line with **Keep safe »** where it can be closed; the whole text and Sign On / Backup open from there (Control Panel > Storage still shows it in full).

## Audit (2026-10-04)

Every program in `programs.js` (except the My Projects web apps) was opened at iPhone size (390x844, DPR 3, touch, iPhone user agent) and at 1280x800, and its first screen counted: visible controls (buttons, fields, drop-downs, checkboxes, tabs, links) inside the window, below its title bar, and the characters of text. Board games count their board squares (Battleship, Chess, Reversi), and Paint, Calculator and Date/Time count their palettes, keys and day grids: those are the program itself, not clutter. Script: `simple-audit.mjs` (scratchpad), ranking `simple-rank.mjs`. Sorted by overwhelm (phone controls + checkboxes + text/100, plus half of the desktop's).

| # | Program | Phone controls | Desktop controls | Phone text (chars) | After: phone / desktop controls |
|---|---|---|---|---|---|
| 1 | Battleship | 114 | 114 | 240 | (board squares) |
| 2 | Internet Explorer | 43 | 71 | 2514 |  |
| 3 | Chess | 72 | 72 | 140 | (board squares) |
| 4 | Reversi | 69 | 69 | 105 | (board squares) |
| 5 | HomePage Studio | 50 | 64 | 795 |  |
| 6 | Date/Time Properties | 45 | 45 | 345 | (day grid) |
| 7 | 98ish Help | 31 | 52 | 627 |  |
| 8 | Doodle Together | 39 | 52 | 120 | (palette) |
| 9 | Paint | 39 | 50 | 50 | (tools and palette) |
| 10 | Add/Remove Programs | 24 | 37 | 968 |  |
| 11 | Display Properties | 28 | 29 | 365 | **27 / 28** (text 350) |
| 12 | Calendar | 11 | 62 | 281 | 11 / 62 (main view kept; New Event below) |
| 13 | Calculator | 30 | 30 | 103 | (keys) |
| 14 | Camera | 17 | 39 | 369 | **12 / 34** |
| 15 | WordPad | 21 | 27 | 240 |  |
| 16 | Word Duel | 16 | 16 | 613 | **6 / 6** (text 266) |
| 17 | Media Player | 22 | 22 | 352 |  |
| 18 | Sounds | 18 | 18 | 323 |  |
| 19 | Dream House | 14 | 42 | 74 |  |
| 20 | Compass | 17 | 32 | 186 | (already a baseline browser) |
| 21 | Keyboard Properties | 12 | 12 | 491 | **8 / 8** (text 418) |
| 22 | Clock | 10 | 10 | 1301 | (world clocks: content) |
| 23 | Desktop Themes | 12 | 12 | 468 |  |
| 24 | Control Panel | 20 | 20 | 291 | **10 / 10** (6 common icons) |
| 25 | Photos | 17 | 17 | 567 | **14 / 14** (text 310) |
| 26 | Accessibility Options | 12 | 12 | 414 |  |
| 27 | Lovebirds Quiz Show | 13 | 13 | 671 |  |
| 28 | Backup | 8 | 8 | 675 | **5 / 5** (text 525) |
| 29 | My Computer | 17 | 17 | 188 |  |
| 30 | Power Management | 8 | 8 | 663 |  |
| 31 | Storage | 8 | 8 | 1014 | 9 / 9 (text 895: the breakdown is tucked) |
| 32 | Character Map | 5 | 6 | 972 |  |
| 33 | Fonts | 15 | 15 | 204 |  |
| 34 | Monster Duel | 9 | 9 | 772 |  |
| 35 | Pickleball 98 | 13 | 13 | 367 | **11 / 11** (text 272) |
| 36 | YouTube '98 | 13 | 13 | 284 |  |
| 37 | Find | 10 | 13 | 243 |  |
| 38 | Regional Settings | 7 | 7 | 655 |  |
| 39 | Passwords | 9 | 9 | 342 |  |
| 40 | Last Card | 10 | 10 | 328 | **6 / 6** |
| 41 | Hexlands | 10 | 10 | 328 | **6 / 6** |
| 42 | Welcome to 98ish | 8 | 10 | 316 |  |
| 43 | Mouse | 9 | 11 | 236 |  |
| 44 | Checkers (online lobby, shared by every online game) | 8 | 8 | 514 | **6 / 9** (rooms open on a computer) |
| 45 | Speed Typist 98 | 9 | 9 | 369 | **6 / 6** |
| 46 | Internet Options | 9 | 9 | 364 |  |
| 47 | Address Book | 4 | 18 | 267 | 4 / 18 (list kept; card and editor below) |
| 48 | Tetris | 8 | 7 | 232 | **4 / 4** |
| 49 | Task Manager | 10 | 10 | 170 |  |
| 50 | Sound Recorder | 10 | 10 | 93 |  |
| 51 | Shred 98 | 8 | 8 | 186 |  |
| 52 | Hearts | 4 | 4 | 481 |  |
| 53 | Network Neighborhood | 5 | 5 | 277 |  |
| 54 | Sunny Acres | 7 | 7 | 177 |  |
| 55 | WinPopup | 7 | 7 | 167 |  |
| 56 | Appward 98 | 5 | 5 | 265 |  |
| 57 | Photo Puzzle | 5 | 5 | 285 |  |
| 58 | 98 Messenger (sign-on screen) | 5 | 5 | 132 | IM window below |
| 59 | Minesweeper | 7 | 5 | 51 |  |
| 60 | System Properties | 4 | 4 | 276 |  |
| 61 | SPECTRA | 4 | 3 | 281 |  |
| 62 | Pinball | 6 | 3 | 104 |  |
| 63 | Magnifier | 2 | 3 | 234 |  |
| 64 | Downhill | 6 | 3 | 69 |  |
| 65 | Notepad | 5 | 5 | 41 |  |
| 66 | Recycle Bin | 4 | 4 | 94 |  |
| 67 | Block Ten | 3 | 3 | 43 |  |
| 68 | Windows Update | 1 | 1 | 221 |  |
| 69 | 98ish Mail (signed out) | 1 | 1 | 167 | New Message below |
| 70 | Solitaire | 2 | 2 | 46 |  |
| 71 | FreeCell | 2 | 2 | 45 |  |
| 72 | Love Letters | 1 | 1 | 134 |  |
| 73 | Our Story | 1 | 1 | 128 |  |
| 74 | Our Pet | 1 | 1 | 124 |  |
| 75 | Us | 1 | 1 | 123 |  |
| 76 | MS-DOS Prompt | 0 | 0 | 110 |  |
| 77 | Hover | 0 | 0 | 17 |  |

The screens one tap in, where most of the overwhelm was (`simple-sub.mjs`; controls on the first screen):

| Screen | Before (phone / desktop) | After (phone / desktop) |
|---|---|---|
| Calendar: New Event | 26 / 29 | **7 / 7** |
| Address Book: New Contact | 20 / 20 | **18 / 18** (Phone and E-mail now on the first tab) |
| Photos: a picture | 20 / 20 | **12 / 12** |
| 98 Messenger: an IM window | 13 / 13 | **4 / 4** |
| 98ish Mail: New Message | 8 / 8 | **6 / 6** |

## What moved where

- **Calendar, New / Edit Event** (`calendar/EventEditor.jsx`): baseline = Title, Day, Time (start to end), Save/Cancel. More options (id `calendar.event`; memos `calendar.memo`) = Calendar, All day, end on another day (shown in the baseline when an event already spans days), Repeat (and Custom), Reminders, Color, Place, Notes, Checklist, to-do, Who's going; summary like "On this device · Doesn't repeat · Reminder 15 minutes before · Auto color". A repeat problem opens it. Memos: Title, Notes, Checklist; Calendar and Color under More. The main view (toolbar, Month/Week/Day/List/Memos tabs) was reviewed and kept: on a phone it's already four buttons and five tabs.
- **Tetris** (`tetris/components/Menu.jsx`, via `shared/GameStart.jsx`): big **Play** (Marathon, or "Sprint 40L again" after a Sprint) + **Play Tetris Online**; **More modes »** (Sprint 40L, Ultra 2:00, Survival, each with its best); **Options »** (On-screen controls, Customize controls..., Game chat; summary "On-screen controls on · Game chat on"). The phone title screen starts near the top with bigger letters.
- **Word Duel**: Daily Word (big) + Play Online; **More modes »**: Practice, Absurd, Speed Rush, Multi-board, Hard Mode, Custom Game..., Statistics and the 4-7 letters choice. Custom Game's **Start Game** sticks to the bottom (`PrimaryBar`).
- **Last Card / Hexlands**: Play the Computer (with its summary line) + Play Online; **More options »**: opponents stepper, difficulty, the opponents' faces, House Rules... / How to Play / Settings.... House Rules' **Deal!** and Hexlands Settings' **Start game** stick to the bottom.
- **Speed Typist 98**: Race the Computer (big) + Play Online; **More modes »**: Race Your Ghost, Daily Prompt, Practice Drills, Statistics.
- **Pickleball 98** (`pickleball/menus.jsx` only, menu screen): Quick Match first, Play Online; **More modes »**: World Tour, Practice & Tutorial, 2 Players. The small row (Players, Locker Room, Settings, Controls, Rules) stays. No animation or rig files touched.
- **Every online lobby** (`shared/online/PlayOnline.jsx`): Quick Match and Play the Computer; **Play with friends »** (id `online.rooms`, shared by every game): Create Room, Join with Code, Invite Someone. Open by default on a computer, closed on a phone. Join links (`?join=`) and invitations skip the lobby as before.
- **Camera**: baseline = the picture, the shutter, the flip button and the last-photo thumbnail. **More options »** (inline, id `camera.more`, summary "Photo · Timer off · Normal"): the Photo/Burst/Photo Strip/Video tabs, the timer and the Effects button. The menus (Mode, Effects, Frames, Options) are unchanged. The effects panel still starts open on a computer.
- **Photos**: browsing shows Upload, Slideshow, Camera (Up only inside a sub-folder; Wallpaper and Delete only once a picture is picked). A picture shows Pictures, Back, Next, **Edit »**, Slideshow, Share, Delete; Edit (id `photos.edit`) shows Out/Fit/In, rotate, Crop, Adjust, Effects and Undo; it stays open while a tool is in use or there are unsaved edits. Save appears when there are edits. The Edit menu and keys are unchanged.
- **KeepSafe note** (Photos, Camera): one line "Only on this device." + **Keep safe »** + ×.
- **98 Messenger, IM window**: transcript, message box, Send, call buttons. **Aa** (id `messenger.format`) shows the format bar (font, size, B/I/U, color); **More »** (id `messenger.im`) shows Warn, Block, Add Buddy, Get Info, Games. Chat rooms share the composer and its Aa. The Buddy List (4 buttons) was already a baseline.
- **98ish Mail, New Message**: Send, Cancel, To, Subject, the message. **More options »** (id `mail.compose`, summary "From x · No Cc · No attachments"): From, Cc, Attach, Save (draft). A message with a Cc (Reply All, a draft) opens with it showing. New menu items Message > Send / Attach File... / Save Draft.
- **Control Panel**: opens to the common settings (Display, Sounds, Notifications, Accessibility Options, Passwords, Storage), with **Show all Control Panel options (17) »** and the names of the rest below it; View > Show All Options. Remembered in the existing `98ish.cpl.view`. Arrow keys move through what's shown.
- **Display Properties**: Background tab = wallpaper list (taller on phones) + Browse...; **More »** = Display (Stretch/Center/Tile) and Themes....
- **Backup**: Sync with 98 Messenger first (on/off, signed-on line, Sync Now or Sign On...); **Sync options »** = the folder choices, online space and meter, Delete Online Files. Back up to your computer: Back Up Now; **Restore from a backup »** = Restore....
- **Address Book**: New/Properties' Name tab = picture, First, Last, **Phone**, **E-mail** (the first entries of the Phone & E-mail tab's lists); **More options »** = Favorite, Nickname, Company, Screen name, 98ish Mail. Other tabs unchanged. A contact card shows Send IM, Call, Send Mail, Properties; **More »** = Video Call, Invite to Calendar..., Favorite, Delete.
- **Keyboard Properties**: **While typing »** tucks the five typing checkboxes (summary of what's on).
- **Storage**: **What uses it »** tucks the local storage breakdown and the per-database sizes.
- **Help**: new topic `more-options` ("More options » (simple screens)"); steps updated in calendar, camera, photos, address-book, messenger, mail, online-play, tetris, pickleball, checkers, last-card, word-duel, speed-typist, hexlands, display, themes, control-panel, storage, file-sync, backup and troubleshooting.

## Testing

- `node --test client/src/utils/disclosure.test.js`.
- Browser (scratchpad): `simple-calendar.mjs` (New Event: baseline, everything reachable by label, Save on screen at 390x844 closed and open, remembered across editors and reloads, keyboard), `simple-apps.mjs [phone|desktop] [filter]` (Tetris, Word Duel, Last Card, Hexlands, Speed Typist, Pickleball, Checkers lobby, Camera, Photos + KeepSafe, Control Panel, Backup, Display, Address Book, Messenger IM, Mail compose), `simple-audit.mjs`, `simple-sub.mjs`.
- Older suites that look for a control that's now tucked away: preset `localStorage["98ish.moreOptions"] = '{"*":true}'` in their init script (a person who opened everything), or press the `.moreOpts-toggle` first. Known ones: `cal-remind` (Add a reminder), `ab-e2e` (Nickname), the Tetris suites that expect four mode buttons (`au2-r-tf-solo`, `au2-r-tetris-touch`), the Messenger suites that use `.aimFormatBar` at once (`ab-r-call-r-aim-e2e`), and phone suites that tap Create Room / Join with Code in an online lobby.

## Remaining candidates (next rounds)

In audit order, the ones with real clutter (not boards, keys or palettes):
- **Internet Explorer**: the start page's text (2,500 chars) and the toolbar on phones.
- **HomePage Studio**: 50+ controls on a phone; a baseline of "Edit my page / Publish" with the editor's panels tucked.
- **98ish Help** on a computer: Contents/Index/Search/Favorites tabs plus the toolbar.
- **Add/Remove Programs**: a long list with two checkboxes per program; a search box and "Show programs hidden from..." first.
- **WordPad**: the format bar could hide behind Aa like the IM window.
- **Media Player**: shuffle/repeat/volume could go under More; the playlist already scrolls.
- **Sounds**, **Desktop Themes**, **Power Management**, **Regional Settings**: Win98 sheets; tuck the second group of each.
- **Lovebirds Quiz Show** and **Monster Duel** title screens: the launcher pattern (Monster Duel's Card Packs badge should stay visible).
- **Dream House** (42 controls on a computer), **Find** (the search options), **Clock** (fine as is).
- **Start menu on phones**: a "frequent programs" section was considered and left out; the search box already gets people there fastest.
