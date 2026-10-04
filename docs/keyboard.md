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
| `input` text, search, email, url, tel, password, number, no type | 98ish keyboard | letters; email (`@` `.`), url (`/` `.com`), numeric keypad for number/tel and `inputmode` numeric/decimal/tel |
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
     Held: repeats after the Keyboard Properties delay/rate; after a second it deletes words.
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

A 98 tool window docked above the taskbar (the taskbar stays reachable, like Windows'
On-Screen Keyboard), full width, respecting the safe areas:

- Title bar in the color scheme: keyboard icon, "Keyboard", a **phone** button (use the phone's
  keyboard for this field) and **X** (hide). On sign-in fields a "Passwords" button does the
  same thing, labelled for AutoFill.
- Beveled gray keys (98.css bevels), pixel font. Keys >= 42px tall in portrait, ~34px landscape.
- Pages: letters (QWERTY), 123 (digits and punctuation), #+= (symbols). Shift: tap = one
  capital, double-tap = Caps Lock (a green LED on the key). Auto-capitals at sentence starts.
  Double space types ". ".
- Number fields get a numeric keypad (with `.`/`-` or `+ * #` for phones) and an ABC key.
- MS-DOS gets a top row: Esc, Tab, Ctrl, `\`, `:`, `.`, up, down.
- Press preview in a yellow 98 tooltip (not on passwords). Long-press a key for accents and
  alternates (é ñ ü ß ç, “ ” « », € £ ¥, …, – —, ¿ ¡, .net .org...): slide to pick, release.
- Space bar: hold or drag sideways to move the caret (like iOS); vertical drag moves lines in
  multi-line fields.
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
  value + selection, field classification, Enter labels and actions, layouts, accents).
- Browser (Playwright, iPhone emulation, kept outside the repo as `kb-*.mjs`): every category
  above typed with real taps, the phone-keyboard button, the setting, landscape, keeping the
  field visible, a hardware keyboard on a touch screen, MS-DOS mode, and a mouse browser
  staying untouched.

## What needs a real iPhone (can't be emulated in desktop Chrome)

- `inputmode="none"` keeping the iOS keyboard and accessory bar down, including after
  programmatic focus.
- The phone button bringing up the iOS keyboard (focus inside the tap).
- iOS scroll-on-focus being fully neutralized.
- The switch-haptic trick.
- Password AutoFill after switching to the phone keyboard.
