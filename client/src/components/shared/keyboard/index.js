// The 98ish keyboard: on touch screens every text field types with a Windows 98-style
// on-screen keyboard instead of the phone's own. The plan and its reasons: docs/keyboard.md.
//
// Mounted once: App renders <KeyboardHost />. Nothing else is needed for plain <input>,
// <textarea> and contenteditable fields. In app code:
//   enterKeyHint="send" | "go" | "search" | "next" | "done"   labels Enter (and decides
//                       whether Enter puts the keyboard away: Send keeps it up for chat)
//   onKeyDown + preventDefault()   take a key (Enter to send, arrows...) as with a real keyboard
//   data-kb="off"                  this field (or everything inside) uses the phone's keyboard
//   data-kb-layout="dos"           MS-DOS keys (Esc, Tab, Ctrl, history arrows)
//   data-kb-keep                   tapping this doesn't put the keyboard away
//   data-kb-auto                   the keyboard comes up without a tap (a typing game's box);
//                                  requestKeyboard(el) (native.js) when it turns typable
//   data-kb-status="keep"          a status bar that stays while typing (phones hide the rest)
//   data-kb-enter="OK"             what Enter says in a dialog (Dialog.jsx sets it)
//
// Pieces:
//   KeyboardHost.jsx  eager and tiny: keeps the phone's keyboard down (inputmode="none" on
//                     the field before it focuses), lazy-loads the keyboard on touch screens
//   Keyboard.jsx      the keyboard window: keys, pages, iPhone-style touch (balloon on touch
//                     down, type on touch up, sliding, rollover), Shift/Caps Lock, long-press
//                     accents, space-bar trackpad, making room on screen, the phone key
//   typing.js         a key press as a hardware keyboard does it: key events, then insertText
//                     / delete / Enter / arrows unless the app cancelled the key
//   fields.js         which fields, which layout, what Enter says and does (pure)
//   editing.js        text editing on { value, start, end } (pure)
//   layouts.js        the pages' keys and long-press alternates, as the iPhone has them (pure)
//   geometry.js       where each key is (iOS measurements), hit testing, the press balloon,
//                     the accents strip, Delete's repeat timing (pure)
//   native.js         inputmode bookkeeping, switching one field to the phone's keyboard
//   feedback.js       key clicks (shared audio engine) and haptics
// Settings (utils/settings.js, Keyboard Properties): keyboard ("98ish" | "phone"), keyClicks,
// keyVibrate, keyPreviews, autoCaps, periodShortcut, keyRepeatDelay, keyRepeatRate.

export { default as KeyboardHost } from "./KeyboardHost"
