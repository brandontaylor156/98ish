# The official Tetris app on iPhone, and how 98ish Tetris copies it

Research for 98ish Tetris's phone controls and layout (2026-10-04). The app is "Tetris®"
(App Store id 1491074310), made by N3TWORK from January 2020 and by PLAYSTUDIOS since the
license moved on 29 November 2021. Each fact below says whether a source confirms it or
whether it is our own estimate.

## Controls

### Confirmed by the publisher's help center
Source: PLAYSTUDIOS help center, "Tetris Controls"
(https://playstudios.helpshift.com/hc/en/16-tetris-mobile/faq/2944-tetris-controls/):

- **Swipe left/right**: "Swiping the screen left or right will move your Tetrimino to the
  left or right."
- **Tap**: rotates the piece. Tapping the **right side** of the screen rotates
  **clockwise**; tapping the **left side** rotates **counterclockwise**.
- **Swipe down**: "To Hard Drop, swipe down on the screen. This immediately locks your
  Tetrimino in place."
- **Hold and drag down**: soft drop. "hold your finger on the screen and drag down"; the
  piece can still be moved before it locks.
- **Swipe up**: "you'll put whatever Tetrimino is falling into your Hold Queue. If there's
  already a Tetrimino there, it'll pop into your Matrix."

### Confirmed elsewhere
- **Ghost piece**: on by default, and a setting turns it off. Source:
  https://playstudios.helpshift.com/hc/en/16-tetris-mobile/faq/2952-are-ghost-pieces-enabled-by-default/
- **Pause**: there is Pause and "Save and Exit". Source:
  https://playstudios.helpshift.com/hc/en/16-tetris-mobile/faq/2954-what-should-i-know-about-pausing-and-saving/
- **No controllers or keyboards.** Source:
  https://playstudios.helpshift.com/hc/en/16-tetris-mobile/faq/2953-is-there-controller-support/
- **Two schemes at first**: touch gestures, or on-screen buttons ("Enjoy intuitive touch
  controls or choose on-screen controls"). Sources: tetris.com
  (https://tetris.com/products/video-game/tetris) and Android Police, July 2020
  (https://www.androidpolice.com/2020/07/09/tetris-mobile-update-android/).
- **The buttons drew complaints and were later removed.** App Store reviews call them
  "small and slightly awkward… unscalable and immobile". A 2023 review asks "what happened
  to the screen controls?" (https://apps.apple.com/us/app/tetris/id1491074310?see-all=reviews).
  TetrisWiki says they were removed in version 5.7.2
  (https://tetris.wiki/Tetris_(2020_mobile_game)). Today the swipes are the default and the
  only scheme (inferred from that, and from the help center describing only gestures).
- **Haptic feedback.** Sources: Pocket Gamer
  (https://www.pocketgamer.com/tetris-n3twork/tetris-is-back-no-sooner-than-it-left-for-ios-and-android-thanks-to-n3twork/)
  and iDownloadBlog (https://www.idownloadblog.com/2020/01/23/tetris-n3twork-app-store/).
- **Game rules**: SRS rotation, a 10×20 matrix, Hold, hard drop, and **3 Next pieces**
  (Puzzle mode shows 1 Next piece and has no Hold). Source: TetrisWiki, above.
- **Portrait only.** Source:
  https://playstudios.helpshift.com/hc/en/16-tetris-mobile/faq/2947-what-orientation-can-i-play-in/

### Not found
- **No "One-Touch" mode.** That name belongs to EA's earlier Tetris app, not this one.
- **No source describes**:
  - sensitivity settings, a hard-drop safety setting, or DAS options;
  - what a drag does at the wall;
  - whether a drag follows the finger cell for cell from where it started;
  - whether tapping the Hold box holds a piece.
- **Reviews** ask for "more control customization". They also report missed swipe-downs,
  and pieces dropping while being turned. That suggests the app has no tuning options
  (inferred).

## Portrait layout (our estimate)
No source gives the app's exact proportions. Neither the App Store nor the help center
describes the screen, and the screenshot pages could not be read. The reference below is our
best estimate from memory of the app and its gameplay videos:

| Element | In the app (estimate) |
|---|---|
| Matrix width | about 70% of the screen width, centered |
| Matrix top / bottom | top about 20-25%, bottom about 88-92% of the screen height |
| Matrix center | a little below the middle (about 55-57%) |
| Score | at the top, centered above the matrix |
| Hold | a small box at the top left, beside the top of the matrix |
| Next | a column at the top right, 3 pieces, the first one larger |
| Level / lines | small, beside the matrix |
| Pause | a button in a top corner |
| Ghost | a faint copy of the piece where it will land |
| Background | themed art behind the matrix (Back to Basics, Monstris, Neon Future...; TetrisWiki) |

## What 98ish does (Start > Programs > Games > Tetris on a phone)

### Controls
The default scheme is **"Like the Tetris app"** (`app` in `utils/touchPrefs.js`):
- **Gestures**:
  - Drag moves the piece. It follows the finger, one column per cell of travel.
  - Tap the right half to rotate clockwise, the left half to rotate counterclockwise.
  - Hold and drag down soft drops, one row per cell.
  - A quick swipe down hard drops (it is measured by speed, so a slow drag never hard
    drops).
  - Swipe up holds.
  - These rules are in `utils/gestures.js` (unit tests in `gestures.test.js`).
- **The Hold button is kept on purpose** (the owner asked for it). Since 2026-10-05 it sits in the left column about halfway up the board (centre at 57% of the game area's height, 48x64 px; `APP_HOLD_CENTER` in `tetrisControls.jsx`), where the thumb of the hand holding the phone rests; the owner found the bottom-left corner a reach. Saved layouts that never moved Hold come up too (`retired` default, `shared/controls`); a Hold the player placed stays. Measured at 390x844: centre 52% up the board, 56% down the screen.
  **Pause** sits at the top left. Arena's Item button sits at the bottom right.
- **Our own additions** (the app documents nothing about these):
  - At the wall the drag re-anchors, so coming back moves the piece at once.
  - A sideways drag never drops the piece on its own.
  - After a hard drop or a hold, the rest of that touch is ignored.
  - A second finger is ignored.
  - The Drag speed setting runs from 50% to 200%.
- **Other schemes in Customize Controls**: Gestures + buttons (the swipes plus a row of
  rotate and drop buttons), Gestures only, and Buttons only (the classic d-pad). "Tap left
  half to rotate left" is on by default, as in the app; turning it off makes every tap
  rotate clockwise.
- **Saved settings**: preferences saved before this version (no `v: 2`) move from the old
  default, "Gestures + buttons" with tap-sides off, to the new default. Any other choice is
  kept.

### Layout
The portrait layout is `data-layout="app"` in `TetrisWindow.jsx` (CSS in `Tetris.css`):
- **Top**: a strip with Pause on the left and the controls gear on the right.
- **Above the matrix**: the mode's first stat (Score, or the Sprint/Ultra clock), big and
  centered.
- **Left column (48 px)**: Hold, with the other stats under it.
- **Right column**: Next, 3 pieces.
- **The matrix**:
  - It is as wide as the two columns allow.
  - The free height splits 1 : 0.5 above and below it, so it sits below the middle.
  - The window, minus the 98 title bar and taskbar, is its size container.
  - The rest of the Win98 look stays: the window chrome, sunken boxes, the 98 font and
    colors, and the outlined ghost.
- **Landscape** (the app has none) keeps the 98ish layout: Hold and the stats on the left
  of the board, Next on the right, and Hold/Pause buttons beside the board.

### Measured on iPhone-sized screens
Phone emulation with an iPhone user agent, before and after. The Tetris window is maximized
between the title bar and the taskbar (`shots/tetris2/*-metrics.json`):

| Screen | Board top | Board bottom | Width | Center |
|---|---|---|---|---|
| 390×844 before (Gestures + buttons) | 18.7% | 73.7% | 59.5% (232 px) | 46.2% |
| 390×844 after (Like the Tetris app) | 25.8% | 88.9% | 68.2% (266 px) | 57.3% |
| 430×932 before | 17.4% | 75.8% | 63.3% (272 px) | 46.6% |
| 430×932 after | 23.9% | 89.6% | 71.2% (306 px) | 56.8% |
| The app (estimate) | ~20-25% | ~88-92% | ~70% | ~55-57% |

So the owner's feeling was right. The board's center sat above the middle of the screen
(46%), because the button row and the Hold/Pause stack took the space under it. It now sits
where the app's does, and it is 15% bigger.

On a Home Screen install with the `black` status bar, the page starts below the status bar.
The taskbar adds the home indicator's safe area (`--taskbar-h`), so the board's bottom stays
clear of it.

## Implementation summary (moved from CLAUDE.md on 2026-10-05)

- **Tetris swipe controls** (like the Tetris phone app): rules in `applets/tetris/utils/gestures.js` (pure tracker, thresholds in `GESTURE`; tests `node --test client/src/components/applets/tetris/utils/gestures.test.js`), wired by `hooks/useSwipeControls.js` (pointer events with coalesced samples on the whole Tetris window, skipping buttons; `touch-action: none` via `data-scheme`, non-passive touchmove, contextmenu cancelled) into `useTetris().step` (one column/row, no DAS; returns false at a wall so the drag re-anchors). Drag sideways = the piece follows the finger in cells from the touch start (x sensitivity), drag down slowly = soft drop per cell, flick down (>= 0.7 px/ms over the last 64 ms, 2x its sideways speed, >= 20 px, only while the drag is locked downward) = hard drop, swipe up (>= 1.5 cells) = hold, tap (< 9 px, < 500 ms) = right half CW, left half CCW like the app (option off: every tap CW). The first decisive move locks an axis; switching needs 1.2 cells on the other axis; after a hard drop/hold, or when the piece locks, the rest of the touch is ignored; a second finger is ignored. Settings (`utils/touchPrefs.js`, localStorage `98ish.tetris.touch`, per user): scheme `app` ("Like the Tetris app", default on touch: swipes + a Hold button + Pause) / `gestures+buttons` / `gestures` / `buttons` (the classic d-pad), sensitivity 0.5-2, tapSides (default on); `v: 2` prefs (older saved prefs with the old defaults move to app + tapSides); chosen in the controls editor (`components/TouchSettings.jsx`). Each scheme saves its own button layout (`controlsGameFor`: `tetris`, `tetris-gestures`, `tetris-swipe`, `tetris-app`). **App layout** (portrait + `app` scheme, `data-layout="app"` in TetrisWindow, CSS in Tetris.css): top strip with Pause (left) and the gear (right), the mode's first stat big above the board, Hold + the other stats in a 48 px left column (`APP_SIDE`), Next (3 pieces) on the right, board as wide as the columns allow (68% of a 390 px screen) and sitting below the middle (free height 1 : 0.5 above/below; the window is the size container), Hold halfway up the left column, Item in the bottom right corner. Research and before/after numbers: `docs/tetris-mobile.md`; landscape keeps the side layout. A one-time how-to card (`98ish.tetris.swipeHint`). No vibration on iOS (8 ms on Android for hard drop/hold when "Vibrate on press" is on). Browser tests `tet-gest-solo.mjs`, `tet-gest-online.mjs` (scratchpad); older touch suites that expect the d-pad must set `98ish.tetris.touch` to `{"scheme":"buttons"}`. Browser tests `tet2/solo.mjs <390x844|430x932>`, `tet2/online.mjs` (Battle 2P + Arena with bots), `tet2/desk.mjs`, `tet2/measure.mjs` (layout %) in the scratchpad. Under a loaded machine CDP moves arrive ~50 ms apart, so test flicks send few, big, undelayed moves.
