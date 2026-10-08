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

| # | Program | Phone controls | Desktop controls | Phone text (chars) | After: phone / desktop controls | Round 2: phone / desktop |
|---|---|---|---|---|---|---|
| 1 | Battleship | 114 | 114 | 240 | (board squares) | 114 / 114 |
| 2 | Internet Explorer | 43 | 71 | 2514 |  | **24 / 35** (start page: Year, address, 6 sites; More sites ») |
| 3 | Chess | 72 | 72 | 140 | (board squares) | 72 / 72 |
| 4 | Reversi | 69 | 69 | 105 | (board squares) | 69 / 69 |
| 5 | HomePage Studio | 50 | 64 | 795 |  | **20 / 28** (block tools on the picked block; More blocks ») |
| 6 | Date/Time Properties | 45 | 45 | 345 | (day grid) | 45 / 45 |
| 7 | 98ish Help | 31 | 52 | 627 |  | **19 / 36** (closed books; Forward when usable) |
| 8 | Doodle Together | 39 | 52 | 120 | (palette) | 39 / 52 |
| 9 | Paint | 39 | 50 | 50 | (tools and palette) | 39 / 50 |
| 10 | Add/Remove Programs | 24 | 37 | 968 |  | 24 / 37 (Find box; the list is content) |
| 11 | Display Properties | 28 | 29 | 365 | **27 / 28** (text 350) | 27 / 28 |
| 12 | Calendar | 11 | 62 | 281 | 11 / 62 (main view kept; New Event below) | 11 / 62 |
| 13 | Calculator | 30 | 30 | 103 | (keys) | 30 / 30 |
| 14 | Camera | 17 | 39 | 369 | **12 / 34** | 12 / 34 |
| 15 | WordPad | 21 | 27 | 240 |  | **13 / 18** (format bar behind Aa) |
| 16 | Word Duel | 16 | 16 | 613 | **6 / 6** (text 266) | 6 / 6 |
| 17 | Media Player | 22 | 22 | 352 |  | **17 / 17** (More »: Stop, Shuffle, Repeat, volume; playlist is content) |
| 18 | Sounds | 18 | 18 | 323 |  | **8 / 8** (Scheme and events ») |
| 19 | Dream House | 14 | 42 | 74 |  | **12 / 40** (zoom buttons in View; catalog is the palette) |
| 20 | Compass | 17 | 32 | 186 | (already a baseline browser) | 17 / 32 |
| 21 | Keyboard Properties | 12 | 12 | 491 | **8 / 8** (text 418) | 8 / 8 |
| 22 | Clock | 10 | 10 | 1301 | (world clocks: content) | 10 / 10 (New alarm: label and days under More) |
| 23 | Desktop Themes | 12 | 12 | 468 |  | **5 / 5** (parts and previews under More) |
| 24 | Control Panel | 20 | 20 | 291 | **10 / 10** (6 common icons) | 10 / 10 |
| 25 | Photos | 17 | 17 | 567 | **14 / 14** (text 310) | 14 / 14 |
| 26 | Accessibility Options | 12 | 12 | 414 |  | 12 / 12 (color scheme under More) |
| 27 | Lovebirds Quiz Show | 13 | 13 | 671 |  | **7 / 7** (More games ») |
| 28 | Backup | 8 | 8 | 675 | **5 / 5** (text 525) | 5 / 5 |
| 29 | My Computer | 17 | 17 | 188 |  | **12 / 17** (phone: buttons once usable) |
| 30 | Power Management | 8 | 8 | 663 |  | **7 / 7** (screen on, Screen Saver... under More) |
| 31 | Storage | 8 | 8 | 1014 | 9 / 9 (text 895: the breakdown is tucked) | 9 / 9 |
| 32 | Character Map | 5 | 6 | 972 |  | 5 / 6 |
| 33 | Fonts | 15 | 15 | 204 |  | 15 / 15 |
| 34 | Monster Duel | 9 | 9 | 772 |  | **8 / 8** (More modes »; Tutorial and Card Packs stay while new) |
| 35 | Pickleball 98 | 13 | 13 | 367 | **11 / 11** (text 272) | 11 / 11 |
| 36 | YouTube '98 | 13 | 13 | 284 |  | 13 / 13 |
| 37 | Find | 10 | 13 | 243 |  | **3 / 6** (Named + Find Now; More options ») |
| 38 | Regional Settings | 7 | 7 | 655 |  | **8 / 8** (Samples ») |
| 39 | Passwords | 9 | 9 | 342 |  | 9 / 9 |
| 40 | Last Card | 10 | 10 | 328 | **6 / 6** | 6 / 6 |
| 41 | Hexlands | 10 | 10 | 328 | **6 / 6** | 6 / 6 |
| 42 | Welcome to 98ish | 8 | 10 | 316 |  | 8 / 10 |
| 43 | Mouse | 9 | 11 | 236 |  | 9 / 11 |
| 44 | Checkers (online lobby, shared by every online game) | 8 | 8 | 514 | **6 / 9** (rooms open on a computer) | 6 / 9 |
| 45 | Speed Typist 98 | 9 | 9 | 369 | **6 / 6** | 6 / 6 |
| 46 | Internet Options | 9 | 9 | 364 |  | **7 / 7** (More options ») |
| 47 | Address Book | 4 | 18 | 267 | 4 / 18 (list kept; card and editor below) | 4 / 18 |
| 48 | Tetris | 8 | 7 | 232 | **4 / 4** | 4 / 4 |
| 49 | Task Manager | 10 | 10 | 170 |  | 10 / 10 |
| 50 | Sound Recorder | 10 | 10 | 93 |  | 10 / 10 |
| 51 | Shred 98 | 8 | 8 | 186 |  | 8 / 8 |
| 52 | Hearts | 4 | 4 | 481 |  | 4 / 4 |
| 53 | Network Neighborhood | 5 | 5 | 277 |  | 5 / 5 |
| 54 | Sunny Acres | 7 | 7 | 177 |  | 7 / 7 |
| 55 | WinPopup | 7 | 7 | 167 |  | 7 / 7 |
| 56 | Appward 98 | 5 | 5 | 265 |  | 5 / 5 |
| 57 | Photo Puzzle | 5 | 5 | 285 |  | 5 / 5 |
| 58 | 98 Messenger (sign-on screen) | 5 | 5 | 132 | IM window below | 5 / 5 |
| 59 | Minesweeper | 7 | 5 | 51 |  | 7 / 5 |
| 60 | System Properties | 4 | 4 | 276 |  | 4 / 4 |
| 61 | SPECTRA | 4 | 3 | 281 |  | 4 / 3 |
| 62 | Pinball | 6 | 3 | 104 |  | 6 / 3 |
| 63 | Magnifier | 2 | 3 | 234 |  | 2 / 3 |
| 64 | Downhill | 6 | 3 | 69 |  | 6 / 3 |
| 65 | Notepad | 5 | 5 | 41 |  | 5 / 5 |
| 66 | Recycle Bin | 4 | 4 | 94 |  | 4 / 4 |
| 67 | Block Ten | 3 | 3 | 43 |  | 3 / 3 |
| 68 | Windows Update | 1 | 1 | 221 |  | 1 / 1 |
| 69 | 98ish Mail (signed out) | 1 | 1 | 167 | New Message below | 1 / 1 |
| 70 | Solitaire | 2 | 2 | 46 |  | 2 / 2 |
| 71 | FreeCell | 2 | 2 | 45 |  | 2 / 2 |
| 72 | Love Letters | 1 | 1 | 134 |  | 1 / 1 (signed out here; Write: More options ») |
| 73 | Our Story | 1 | 1 | 128 |  | 1 / 1 |
| 74 | Our Pet | 1 | 1 | 124 |  | 1 / 1 |
| 75 | Us | 1 | 1 | 123 |  | 1 / 1 (signed out here; paired hub: More for two ») |
| 76 | MS-DOS Prompt | 0 | 0 | 110 |  | 0 / 0 |
| 77 | Hover | 0 | 0 | 17 |  | 0 / 0 |

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
- **Pickleball 98 Play (2026-10-07, `play/PlaySetup.jsx`):** the owner found "Start game" above online options confusing. Now: **vs Computer | Online** tabs first; vs Computer = You, Format, Opponents, Where; More options » = Against/Partner, Scoring, Game to, World Tour, 2 Players; **Start Match** in a fixed footer. Where & when is a bottom sheet over the live venue preview.
- **Every online lobby** (`shared/online/PlayOnline.jsx`): Quick Match and Play the Computer; **Play with friends »** (id `online.rooms`, shared by every game): Create Room, Join with Code, Invite Someone. Open by default on a computer, closed on a phone. Join links (`?join=`) and invitations skip the lobby as before.
- **Camera**: baseline = the picture, the shutter, the flip button and the last-photo thumbnail. **More options »** (inline, id `camera.more`, summary "Photo · Timer off · Normal"): the Photo/Burst/Photo Strip/Video tabs, the timer and the Effects button. The menus (Mode, Effects, Frames, Options) are unchanged. The effects panel still starts open on a computer.
- **Photos**: browsing shows Upload, Slideshow, Camera (Up only inside a sub-folder; Wallpaper and Delete only once a picture is picked). A picture shows Pictures, Back, Next, **Edit »**, Slideshow, Share, Delete; Edit (id `photos.edit`) shows Out/Fit/In, rotate, Crop, Adjust, Effects and Undo; it stays open while a tool is in use or there are unsaved edits. Save appears when there are edits. The Edit menu and keys are unchanged.
- **KeepSafe note** (Photos, Camera): one line "Only on this device." + **Keep safe »** + ×.
- **98 Messenger, IM window**: transcript, message box, Send, call buttons. **Aa** (id `messenger.format`) shows the format bar (font, size, B/I/U, color); **+** opens Picture... / Voice Message (the voice bar replaces the box while open); reactions are on long-press / right-click of a message; **More »** (id `messenger.im`) shows Warn, Block, Add Buddy, Get Info, Games, Clear History. Chat rooms share the composer and its Aa (no +). Read receipts and server saving are in My AIM > Preferences.... The Buddy List (4 buttons) was already a baseline.
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
- Round 2: `simple2-apps.mjs [phone|desktop|all] [filter]` (IE, HomePage Studio, Help, Add/Remove, WordPad, Media Player, Sounds, Themes, Power, Regional, Internet Options, Accessibility, Quiz Show, Monster Duel, Dream House, Find, Notifications, Clock, My Computer: baseline shows the main controls, the rest is hidden, More options shows every previous option by selector, remembered after a reload, the main action on screen at 390x844), `simple2-us.mjs` (pairs two accounts; Us hub and Love Letters Write), `s2-audit.mjs` (the Round 2 column). Older suites now preset `98ish.moreOptions` in their helpers (`cal-helpers`, `ab-helpers`, `help-helpers`, `au2-r-ol-helpers`, `au2-r-wd-helpers`, `au2-r-gchat-helpers`, `au2-r-tf-helpers`, `au2-r-tetris-touch`, `ab-r-call-r-aim-e2e`) and dismiss the File Sync offer after signing on; `ab-phone` dropped the removed search Cancel step; `help-e2e` expects the round-2 toolbar; `au2-r-tf-solo` finds a mode by `[data-mode]` (the last mode played is the big "again" button). `s2-noboot.mjs` is a preload that presets it for any suite.

## Round 2 (2026-10-04): everything else

The owner: "Continue, do it." Every program left on the list above, then a second audit of all 77 (the **Round 2** column in the table: bold where it changed) and the screens one tap in. Same shared pieces; no new ones. Two small patterns were added on top of More options:
- **A button only while it can be used** (instead of a gray, disabled one): Help's Forward, IE's Stop (in Refresh's place on phones) and Earlier/Later (once a page is open), My Computer's Cut/Copy/Delete/Properties on phones (once something is selected), Find's Stop/New Search (with its options).
- **Aa** for a formatting bar, as in the IM window: WordPad's Format Bar (View > Format Bar does the same; remembered as `wordpad.format`).

### What moved where (round 2)

- **Internet Explorer** start page: a **Year** drop-down, the address and Go, and six popular sites (Yahoo!, Google, Space Jam, GeoCities, CNN, the Guestbook). **More sites (49) »** (id `ie.directory`; opens by itself while the directory search has words, e.g. a search typed in the Address bar) = the year buttons, the directory search and the whole directory. Phones: History and Captures leave the toolbar (View menu), Stop shows only while loading in Refresh's place. Earlier/Later show once a page is open (they were disabled on the start page).
- **HomePage Studio**: block rows show move up/down/delete only on the picked block (Format menu as before). Computer toolbar: Heading, Text, Clip Art, Picture...; **More blocks »** (`homepage.insert`) the other seven. A block's size/effect/alignment/colors: **More options »** (`homepage.block`, summary "Huge · Rainbow · Center · Default color"); Page Properties: Title and Background, **More options »** (`homepage.page`) colors, font, music, sparkle trail, badge.
- **98ish Help**: toolbar Hide, Back, Home, Print, Options; Forward appears once you've gone back; phones leave Print to Options. Contents opens as closed books on the home page (a topic still opens its book).
- **Add/Remove Programs**: a **Find a program** box over the list; a selected program shows **Add/Remove...**, and **More options »** (`addremove.where`, summary "On the desktop · In the Start menu") the two checkboxes. Shorter intro text.
- **WordPad**: Aa (above). Phones' toolbar: New, Open, Save, Print, Find, Undo, Aa (Print Preview, Cut, Copy, Paste, Date/Time are in the menus).
- **Media Player**: Play (Pause while playing), Previous, Next, and the library tabs **Music | Videos** with **Add Songs...**/**Add Videos...** (wave 2); **More »** (inline, `mediaplayer.more`, summary "Playlist: X · "query" · Shuffle · Repeat · Volume 80%") Stop, Shuffle, Repeat, Mute, volume, Search, Playlist, Picture in Picture. Rows' **…** menu for Play from Start / Add to Playlist / Show in My Computer. Play menu unchanged.
- **PDF Viewer** (wave 2): baseline is the pages, the page counter and **Send to My Phone**; **More »** (`pdfviewer.more`) zoom −/Fit/+, Open in Browser, Download.
- **Sounds**: Volume, Mute, Play system sounds; **Scheme and events »** (`sounds.events`) the events list, Play, Scheme, startup sound.
- **Desktop Themes**: Theme + preview + OK; **More options »** (`themes.parts`, summary "Uses all 8 parts · Previews" or "Not using: ...") the Previews buttons and the parts checkboxes.
- **Power Management**: screen saver wait and lock wait; **More options »** (`power.more`) Screen Saver... and Keep the screen on.
- **Regional Settings**: the samples table is **Samples »** (`regional.samples`); its closed line is the sample itself ("2:15 PM · 10/4/2026 · Week starts Sunday").
- **Internet Options**: home page address and the time machine date; **More options »** (`ieoptions.more`) Use Start Page / Use 98ish.com and History (Clear History).
- **Accessibility Options**: Text size and Use High Contrast; the color scheme and its preview under **More options »** (`a11y.contrast`).
- **Notifications** settings: This device (turn on, test, turn off); **More options »** (`notify.settings`, summary "All 6 kinds · No quiet hours") the kinds and quiet hours.
- **Lovebirds Quiz Show**: How Well Do You Know Me? (big), Play Live Online, Inbox (with its count) and the Your turn! banner; **More games »** (`quiz.modes`) This or That, Deep Talk Cards, Party Trivia, Compatibility, Trivia About Us, Quiz Builder, Past shows. Menus unchanged.
- **Monster Duel**: Duel the Computer, Play Online, plus the Tutorial until it's done and Card Packs while some wait (with the star); **More modes »** (`monsterduel.modes`) Deck Builder, Rules, and the Tutorial / Card Packs otherwise.
- **Dream House**: the Zoom In / Zoom Out toolbar buttons went to the View menu (pinch and the mouse wheel zoom too); Whole House stays. The catalog is the program's palette and stays.
- **Find**: Named and Find Now; **More options »** (`find.criteria`, summary "Containing text · Look in: Everywhere · Any date · Any type · Any size") the three tabs, Stop and New Search. It opens by itself while anything there narrows the search.
- **Clock**, New alarm: time and **Add alarm**; **More options »** (`clock.alarm`, summary "Weekdays · No label · Bedside Beeper") the label, the days and the sound (with ▶ Play); Timer: its sound under **More options »** (`clock.timer`) (2026-10-07).
- **Round 3 (2026-10-07):** Calculator's Standard view is now a 4-column pad (memory and √ % 1/x ± in two short rows); Scientific comes by itself when a phone is held sideways. Chess has **Play | Puzzles** tabs (Chess Puzzles folded in). Zap It!'s title screen has **How to play** in the baseline. Watch Together's first screen is three numbered steps (Video, Watch with, Start), its YouTube search moved out of More options into the one Video box. **Maps 98** (new): baseline = search box, ◎ and the map; the card has **Directions** and **Open in Apple Maps**; steps fold away on phones. 3D Viewer 98's More options says whether a Hugging Face token is set, and opens by itself when free time runs out and there's no token.
- **My Computer** on phones: the toolbar shows Back, Up, Paste, Upload, and Cut/Copy/Delete/Properties once something is selected (menus and long-press as before). Computers unchanged.
- **Us** (paired hub): Love Letters, Our Story, Send Flowers and the call buttons; **More for two »** (`us.more`) the Quiz Show, Photo Puzzle, Doodle Together, Our Pet, Dream House.
- **Love Letters**, Write: To, the letter, Add a photo, **Seal & send** (now right under the letter); **More options »** (`loveletters.compose`, summary "Deliver now · Parchment paper · Rose envelope · Handwritten") Delivery (date, open when..., countdown) and the paper, envelope and handwriting. A delivery other than "now" keeps it open.

Reviewed and kept as they are (the first screen is already the baseline, or the controls are the program): Mouse (tabs + one setting group each), Passwords (PIN or password, Set), Date/Time (the day grid), Shred 98 (a five-item arrow-key menu: Career, Practice, Calibrate Lag, Options, How to Play), SPECTRA, Pinball, Downhill, Minesweeper, Photo Puzzle, Sunny Acres, Our Pet, Appward 98 (its log-on), Sound Recorder (the transport), Task Manager, Fonts, Character Map, YouTube '98 and Compass (browsers), Welcome, Network Neighborhood, WinPopup, System Properties, Solitaire/FreeCell/Hearts, Our Story (its New moment form has five fields), the Display Screen Saver tab (Win98's three rows), Clock's other tabs. Board games, Paint, Calculator and Doodle count their boards, keys and palettes.

Help topics updated: wordpad, media-player, clock, using-help, notifications, search, my-computer, internet-explorer, ie-time-machine, homepage-studio, themes, sounds, power, internet-options, add-remove, accessibility, love-letters, quiz-show, us-together, monster-duel, more-options (the two new patterns). The phone search topic no longer mentions the removed Cancel button.

## Remaining candidates (next rounds)

- **Start menu on phones**: a "frequent programs" section was considered and left out; the search box already gets people there fastest.
- **Clock**'s world clocks: each city's ✕ could wait behind an Edit button (left: they're small and the text is the clocks themselves).
- **Dream House**'s selection bar (Flip, Front, Back, Copy, Delete): Front/Back could go under More (left: they're the things people do with a picked piece of furniture).
- **IE's Links bar** on a computer (8 links, Win98 look): left as it was.
