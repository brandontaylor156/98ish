# Open issue: renderer crash in headless Chrome (keyboard + Speed Typist race)
Moved from CLAUDE.md on 2026-10-05. Repro script: docs/keyboard-crash-repro.mjs.

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
