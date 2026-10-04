# The 98ish keyboard

On phones and tablets 98ish types with its own Windows 98-style on-screen keyboard instead of
the phone's modern one. This is the plan it was built from, and the rules new code follows.

Code: `client/src/components/shared/keyboard/` (guide at the top of `index.js`).

## Goals

1. Every text field on the platform types through the 98ish keyboard on touch screens, with
   no per-app work: a new app's `<input>` just works.
2. The field stays a real, focused field: native caret, selection handles, copy/paste callout,
   undo, maxlength, form submission, React state. We never fake a text box.
3. The phone keyboard is always one tap away (emoji, dictation, other languages, password
   managers), per field, and as a setting.
4. Physical keyboards (iPad, Bluetooth) keep working and hide the on-screen one.
5. Desktop (mouse) browsers are completely unaffected: no attributes changed, no code loaded.

## How the phone's keyboard is suppressed

Options considered:

| Technique | Verdict |
| --- | --- |
| `inputmode="none"` | **Chosen.** Supported by iOS Safari 12.2+ and Chrome/Android 66+. The field really focuses: native caret, selection, callout menu and `execCommand` all work; only the virtual keyboard stays down. Works on `contenteditable` too. Both engines also react to the attribute changing on a focused field (WebKit's `focusedElementDidChangeInputMode`, Chrome's text input state), which the focusin path below relies on; confirm on a real iPhone. |
| `readonly` while focused | No caret on iOS, no `execCommand`, selection handles behave differently, React warnings for controlled inputs. Rejected. |
| Blur on focus + a drawn caret | Loses selection, callout, undo, accessibility; every app would need a fake caret. Rejected. |
| VirtualKeyboard API (`navigator.virtualKeyboard`, `virtualkeyboardpolicy="manual"`) | Chromium only (not iOS), and it's about *when* the keyboard shows, not replacing it. Not needed once `inputmode="none"` works. |

How the attribute gets there (`KeyboardHost.jsx`, small and eager so it's in place before the
first tap):

- **pointerdown/touchstart (capture)** on a text field: set `inputmode="none"` before the tap
  focuses it (iOS focuses on touchend, so this always wins for taps).
- **focusin (capture)**: catches programmatic focus (`autoFocus`, Dialog focusing its first
  field, MS-DOS focusing its input). The attribute is set synchronously inside `focus()`,
  before the browser asks the OS for a keyboard.
- The original `inputmode` is kept in `data-kb-inputmode` (it picks our layout: `numeric`,
  `decimal`, `tel`, `email`, `url`, `search`) and is put back when the field loses focus, so
  React's DOM and the phone-keyboard path see the app's own value.

Other native behaviors:

- **Zoom on focus**: iOS zooms into fields under 16px. Phone mode already sets 16px on every
  field (`main.css`), which stays.
- **Scroll on focus**: `.os-root` is `position: fixed; overflow: clip`, so the page can't scroll;
  if iOS still nudges the window, the keyboard puts `scrollY` back to 0.
- **Autocorrect/autocapitalize**: the phone's autocorrect never runs (no phone keyboard). Our
  keyboard auto-capitalizes like iOS, honoring the field's `autocapitalize` (off for MS-DOS,
  URLs, emails, passwords, and anything that says `off`/`none`).
- **The iOS form assistant bar** ("^ v Done"): not shown with `inputmode="none"` on iPhone.
  Needs a real-device check on iPad (where it may show the shortcut bar).

## Which fields, which layout

`fields.js` decides from the element alone (pure, unit tested):

| Field | Gets | Layout |
| --- | --- | --- |
| `input` text, search, email, url, tel, password, number, no type | 98ish keyboard | as iOS: letters; email (`@` `.` by the space bar); url (`.` `/` `.com`, no space bar); `type=number` opens the 123 page; the number pad for `inputmode` numeric/decimal/tel, `type=tel`, or `type=number` with a `[0-9]*` / `\d*` pattern |
| `textarea` | 98ish keyboard | letters, Return inserts a newline unless the app takes Enter |
| `contenteditable` (WordPad, rich text) | 98ish keyboard | letters, Return = new paragraph |
| `input[data-kb-layout=dos]` (MS-DOS Prompt) | 98ish keyboard | DOS: Esc, Tab, Ctrl, \ :, up/down history, all caps optional |
| checkbox, radio, range, color, date, time, file, select | untouched | the platform's own pickers |
| readonly / disabled fields | untouched | |
| `data-kb="off"` | untouched (phone keyboard) | escape hatch for any app that needs it |
| canvas games reading keys (Tetris, Shred, Pickleball, SPECTRA, Pinball...) | never opens: no text field focused | their own touch controls |
| Word Duel guesses, Calculator | never opens: they have their own on-screen keys | |

## Typing into a field (`typing.js`)

Each key behaves like a hardware key:

1. `keydown` (and `keypress` for characters and Enter) is dispatched on the focused field,
   bubbling and cancelable, with `key`, `code`, `keyCode`, `shiftKey`, `ctrlKey`. Apps that
   handle keys themselves (MS-DOS history and Enter, Messenger Enter-to-send, Dialog Escape,
   GameChat) see exactly what a Bluetooth keyboard would send.
2. If the app didn't `preventDefault()`, the key's default action runs:
   - text: `document.execCommand("insertText")`. It replaces the selection, respects
     `maxlength`, fires real `beforeinput`/`input` events (React `onChange`, WordPad's undo
     history) and joins the browser's undo stack. If the browser refuses (some `type=number`
     fields), we fall back to the native value setter + an `input` event (what React listens
     to), with the same editing rules in pure code (`editing.js`).
   - Backspace: `execCommand("delete")` (deletes the selection or one grapheme), same fallback.
     Deletes on touch down; held, it repeats like iOS (`deleteRepeat` in `geometry.js`): after
     the Keyboard Properties delay (500 ms) about every 100 ms, speeding up toward the repeat
     rate, and after ten characters (about 1.2 s) it deletes whole words, one every 180 ms.
   - Enter: textarea → newline; contenteditable → `insertParagraph`; single-line input →
     implicit form submission (`form.requestSubmit()` unless the default button is disabled).
     Afterwards a single-line field that still has focus is dismissed for Go/Search/Done/Enter,
     kept for Send (chat), and Next moves to the next field.
   - Arrows: caret moves (inputs/textareas by pure code, contenteditable by `Selection.modify`).
   - Ctrl (DOS layout) + key: only the key event (Ctrl+C, Ctrl+L in MS-DOS); Ctrl+A/Z/Y select
     all, undo and redo.
3. `keyup` follows.

The Enter key's label comes from `enterkeyhint` (Go, Search, Send, Next, Done), else the field:
search → Search, url → Go, multi-line → Return, else Enter. MS-DOS always says Enter.

## The keyboard itself

It looks like Windows 98 and is placed and behaves like the iPhone's keyboard (iOS 17/18,
English). A 98 tool window docked above the taskbar (the taskbar stays reachable, like
Windows' On-Screen Keyboard, and plays the part of iOS's globe/microphone strip), full width,
respecting the safe areas.

### Where the keys are (`geometry.js`, pure, unit tested)

The iOS numbers, in points (= CSS px). Sources: KeyboardKit's `KeyboardLayoutConfiguration`
and `iPhoneKeyboardLayoutProvider` (an open-source reproduction of the system keyboard,
v7.9), its English callout lists, and the classic 375pt measurement (3 + 10 x 31.5 + 9 x 6 + 3).

| | Portrait | Plus / Pro Max (>= 420 wide) | Landscape |
| --- | --- | --- | --- |
| row pitch / key height | 54 / 42 (12 between rows, 6 above the first) | 56 / 45 | 40 / 32 |
| letter key | width / 10, less 6 (3 each side) | same | same |
| row 2 (a-l) | half a slot of margin at each end | | |
| Shift, Delete (and #+=, 123 on row 3) | 13% of the width | | |
| 123 / ABC, the emoji-globe slot | 12.3% each | | 9.5% |
| return | 25% | | 19.5% |
| . , ? ! ' on 123 / #+= | 14% each | | |
| space | the rest | | |

So on a 390pt iPhone: q is x 3, 33 wide; a is x 22.5; Shift 44.7 wide; z x 61.5; 123 42 wide;
return 91.5 wide; the four rows are 216pt tall. Above them sits the title bar (14px, where
iOS shows its suggestions bar), so keyboard + taskbar is 234 + 35 (+ the home indicator's 34
on a Home Screen app) = 303pt against iOS's 291 without suggestions / 336 with them.

- Every key is an absolutely placed `<button>` whose touch area runs to the middle of the gap
  on each side (the row's ends to the screen edges): a touch in a gap types the nearest key
  (`hitTest`). The keys area's measured width (screen less safe areas) drives the layout.
- Tablets (shorter side >= 500) keep the same layout, up to 1000px wide, with arrow keys
  around the space bar. Phones have no arrow keys (iOS has none).

### Pages

- Letters: QWERTYUIOP / ASDFGHJKL / Shift ZXCVBNM Delete / 123, slot, space, return.
- 123: `1234567890` / `-/:;()$&@"` / #+= `. , ? ! '` Delete / ABC, slot, space, return.
- #+=: `[]{}#%^*+=` / `_\|~<>€£¥•` / 123 `. , ? ! '` Delete / ABC, slot, space, return.
- Email: `@` and `.` beside the space bar. URL: `.` `/` `.com` and no space bar.
- The emoji/globe slot holds the **phone** key: this field switches to the phone's own
  keyboard (emoji, dictation, other languages). It works by its click, inside the tap.
- Number pad (3 columns, digits with their letters under them as on iOS): numeric has an
  empty corner, decimal a `.`, tel a `+*#` key (a page with `+ * # ( - ) , ; /`; hold 0 for +).
  No return key on the pad (iOS has none): the title bar shows the Enter label (Safari's bar
  above the pad has Done) and the phone button.
- MS-DOS gets a top row: Esc, Tab, Ctrl, `\`, `:`, `.`, `*`, `?`, up, down; `/` by the space bar.
- No Undo key (the iPhone has none).
- Title bar: keyboard icon, "Keyboard", **X** (hide); on sign-in fields "Passwords" (the
  phone's keyboard, for AutoFill). Its buttons are small but their touch areas reach into
  the gap above the first row.

### Touch behavior (as iOS)

- **Balloon**: a letter, digit or symbol key pops up on touch DOWN: the key's face grows up out
  of it into a white, beveled head with the character large (pixel font). Not for Shift,
  Delete, space, return, page keys; not on password fields (iOS hides them there too); the
  setting "Show each letter as you tap it" (on by default) turns them off. Heads are the key
  + 26pt wide; edge keys' heads lean inward so they stay on screen.
- **Commit on touch UP**; the finger can slide: the balloon follows the key under it and the
  key under the finger at the end is typed. Sliding off the letters (onto Shift, space, far off
  the keyboard) cancels unless the finger comes back.
- **Rollover**: a second finger down types the first finger's key at once.
- **Long press** (0.5 s) on a key with alternates opens the strip (the key's own character
  first and chosen, then iOS's list: e: è é ê ë ē ė ę, a, c, i, l, n, o, s, u, y, z, 0 (°),
  - (– — •), / (\), $ (€ £ ¥ ₩ ₽ ¢), &, ., ?, !, ', ", %, =, .com (.net .org .edu .us .co.uk)).
  It opens rightward from keys on the left half and leftward on the right half; slide to
  choose, release to type; dragging well below lets go without typing.
- **Shift** acts on touch down: tap = the next letter capital, double-tap (350 ms) = Caps Lock
  (filled arrow over a bar, plus the green LED). Auto-capitals at sentence starts. Sliding
  from Shift onto a letter types it capitalized.
- **123 / #+= / ABC** act on touch down; sliding from 123 onto a character types it and goes
  back to the letters. After a space or `'` the 123 and #+= pages go back to the letters.
- **Delete**: see above (one on down, repeat, then words).
- **Space** types on touch up; double space types ". ". Holding it (0.5 s) or dragging
  sideways turns the keyboard into a trackpad: every key goes blank, moving the finger anywhere
  moves the caret (9px per character, 22px per line in multi-line fields).
- **Return** acts on touch up; Go / Search / Send / Done / Join are drawn in the 98 highlight
  color (iOS's blue key); Return / Enter / Next stay gray with the default-button ring.
- Feedback: key clicks through the shared audio engine (follow system sounds, volume and
  mute), vibration where the browser supports it (Android), and the iOS 18 switch-haptic trick
  with a focus guard.
- Every key is a `<button>` with an `aria-label`; the keyboard never takes focus (keys cancel
  `pointerdown`/`mousedown`), so screen readers and Tab order still belong to the app.

## Keeping the field visible

When the keyboard opens the root gets `kb-open` and `--kb-h` (its height). Phone windows are
full screen, so the window area simply ends above the keyboard (`.mobileDesktop`'s bottom, MS-DOS
full screen's bottom, floating popups' max height) and its content scrolls the field into
view (`scrollIntoView({ block: "nearest" })`). Anything still covered (a dialog centered on
the screen, the Start menu search, a floating window on a tablet) is lifted with the CSS
`translate` property until it clears the keyboard, and dropped back when it closes.

## Showing and hiding

- Opens when a text field is tapped, or focused by code within a second of a touch (Run's
  box, a dialog's first field, Notepad opening). Like iOS, a field focused by code with no
  touch behind it (an IM window popping up by itself) waits: the phone's keyboard stays down
  too, and tapping the field brings ours up.
- Stays while focus moves between fields (no flicker).
- Hides when: its X is pressed, the field is removed or hidden (window closed, minimized,
  switched; a MutationObserver watches while open), the field turns read-only, or Enter
  dismisses (above). A stray tap elsewhere (the desktop, the taskbar, a toolbar) does NOT put
  it away (the owner asked for this): the keyboard stays on its field, and the next key puts
  focus back into the field first (`suppress` then `focus`, so the phone keyboard stays down).
  Focusing another text field moves the keyboard to it.
- Physical keyboard: a real (trusted) key press while a field is focused hides the on-screen
  keyboard for the session; a small "Keyboard" button appears at the bottom right to bring it
  back.

## The phone keyboard

- **Per field**: the phone button. The field is re-focused natively inside the tap (needed for
  iOS to show its keyboard) with the blur/focus hidden from the app, so nothing saves or
  closes. It stays native until it loses focus.
- **Passwords**: the 98ish keyboard is the default (consistent look, no key previews). Sign-in
  fields (`autocomplete` username/current-password/new-password/one-time-code, or
  `type=password`) show a "Passwords" button in the title bar that switches to the phone's
  keyboard, where iCloud Keychain / Google Password Manager AutoFill lives.
- **Setting**: Start > Settings > Keyboard (Keyboard Properties, `control keyboard` / `main.cpl`
  in Run): "On a touch screen, type with: 98ish keyboard / My phone's keyboard", key clicks,
  vibration, key previews, auto-capitals, ". " shortcut; a Speed tab with Windows' repeat
  delay/rate and a test box. Default: 98ish keyboard. Stored in `98ish.settings`.

## Rules for app code

- Plain `<input>`, `<textarea>`, `contenteditable` need nothing.
- Set `enterKeyHint` for what Enter does ("send" for chat, "go", "search", "next"). It labels
  our key and the phone's.
- Handle Enter in `onKeyDown` with `preventDefault()` if you take it (as with a real keyboard).
- A field that must use the phone keyboard: `data-kb="off"`. A key-capturing field that wants
  the DOS layout: `data-kb-layout="dos"`.
- Don't listen for `isTrusted` keys; our keys are synthetic, like a hardware keyboard's in
  effect.

## Tests

- Unit: `node --test client/src/components/shared/keyboard/keyboard.test.js` (editing on
  value + selection, field classification, Enter labels and actions, the iOS pages, accents;
  key places at 375/390/393/402/430 and landscape against hand-worked iOS references within
  2px, rows tiling the width, gap touches going to the nearest key, balloons staying on
  screen, the accents strip's direction, Delete's repeat timing).
- Browser (Playwright, iPhone emulation, kept outside the repo as `kb-*.mjs` / `kbx-*.mjs`):
  every category above typed with real taps, the phone-keyboard button, the setting,
  landscape, keeping the field visible, a hardware keyboard on a touch screen, MS-DOS mode,
  and a mouse browser staying untouched. `kbx-touch.mjs` drives raw CDP touches at 390x844,
  430x932, 844x390 and 932x430: geometry against the iOS reference, balloon on touch down
  over the right key and gone on up, commit on up, sliding, gaps, long-press accents, Shift /
  Caps Lock / auto-capitals, the 123 page, rollover, Delete repeat, the trackpad, email / url /
  number pad; it also renders an iOS reference sketch beside ours (`side-by-side-390.png`).
- Desktop Chrome swallows a tap on a field that comes within ~100 ms of a drag whose
  `pointerdown` was cancelled (a plain page does it too): browser tests wait a moment after a
  slide before tapping a field.

## What needs a real iPhone (can't be emulated in desktop Chrome)

- `inputmode="none"` keeping the iOS keyboard and accessory bar down, including after
  programmatic focus.
- The phone button bringing up the iOS keyboard (focus inside the tap).
- iOS scroll-on-focus being fully neutralized.
- The switch-haptic trick.
- Password AutoFill after switching to the phone keyboard.
- That the keys line up with the real iOS keyboard's (switch between them on one field), the
  balloon's size and feel, the 0.5 s long press and trackpad hold, Delete's speed, and fast
  two-thumb typing (rollover) on the glass.
- Landscape on notched iPhones: the keys span between the safe areas.
