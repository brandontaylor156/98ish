# Ask Floppy (Floppy's brain)

Built 2026-10-06 from idea #1 of the GitHub research ("Floppy gets a brain"). Floppy, the helper (`OS-specific/Helper.jsx`), gets an **Ask Floppy...** box in every bubble. Typing opens a small chat (`applets/floppy/FloppyChat.jsx`, lazy) that **does things**: opens programs, makes reminders/events/tasks/notes, sends IMs, sets Do Not Disturb, starts Pickleball 98 modes, plays music, starts Watch Together, opens files and answers how-to questions from 98ish Help. Free, private: everything runs in the browser.

## How it decides
`floppyTools.js` `ask(text)`:
1. **Rule-based fallback** (`floppyCore.js` `ruleIntent`): regex intents for the common commands, with a when-parser (`parseWhen`: today/tonight/tomorrow/weekdays/"in 20 minutes"/"at 7" (= 19:00 for 1-7 without am/pm)/"7:30am"/noon). Works instantly, offline, with no model.
2. **Help questions** ("how do I...", or anything when there's no brain): `rankHelp` over `help/topics` (per-word keyword scores via `searchCore.scoreEntry`; with the brain, a hybrid with MiniLM embeddings 0.65 vector + 0.35 keyword). The answer quotes the top page's summary and links the top 2 pages.
3. **The model** (only with the brain): `systemPrompt` lists the tools in a compact signature form + 3 few-shot examples; the model answers ONE line of JSON, `{"tool","args"}` or `{"reply"}`. `parseModelOutput` is forgiving (fences, chatter, single quotes, trailing commas, bare keys, unclosed braces, `arguments`/`name` synonyms, string numbers/booleans, closest enum value) and returns an error text the retry sends back ("That wasn't valid: ... Answer again with ONE line of JSON only"). One retry, then a polite "not sure".
- **Tools come from the registries** (`buildTools`): program names from `utils/programs.js`, venues from `pickleball/park/venues/index.js`, buddies from 98 Messenger. A new program is known without touching Floppy.
- **Confirm rule:** tools with `side: true` (create_reminder/event/task/note, send_im, set_dnd) never run from `ask()`; it returns `{ confirm: call }` and the chat shows **Floppy wants to...** (`describeCall`) with Do it / Cancel.
- Messenger lives inside Desktop's AimProvider; `FloppyBridge.jsx` (mounted there) hands it to `setFloppyAim`. Pickleball modes go through `openTarget({ kind: "program", name: "Pickleball 98", extra: { handoff: { floppy: { mode, venue } } } })`; `Pickleball.jsx` acts on it once the game is up (`floppyGo`).

## The brain
- `brain.js` (page) + `brain.worker.js` (module Worker, transformers.js 4.3.1, `@huggingface/transformers`, Apache-2.0).
- Models (`MODELS` in floppyCore): WebGPU → **onnx-community/Qwen3-0.6B-ONNX q4f16 (570 MB)**, `enable_thinking: false` in the chat template and `<think>` stripped; no WebGPU → **onnx-community/Qwen2.5-0.5B-Instruct q8 (512 MB)**. Both Apache-2.0. Embeddings: Xenova/all-MiniLM-L6-v2 q8 (23 MB), CPU.
- Files come from the Hugging Face CDN once and live in Cache Storage `transformers-cache` (device-wide); the ONNX runtime's WASM comes from jsDelivr. **Never through Render.** `vite.config.js` keeps `*.wasm` and `brain.worker-*.js` out of the service worker's precache (a 27 MB runtime nobody else should download).
- Opt-in only: More options > **Give Floppy a brain...** (dialog with size + Wi-Fi advice), progress in MB. The choice is per user in `98ish.floppy` (`{ brain: "webgpu" | "wasm" | null }`). Delete: chat's More options or Control Panel > Storage (`FloppyBrainRow`, shown only when the cache has files).
- Memory rules: one model at a time; `unloadBrain()` when the chat closes (the worker is terminated) and when Pickleball 98 opens; `loadBrain` refuses while Pickleball 98 is open. The rule path keeps working.
- Streaming tokens show only for replies (a tool call's JSON isn't shown). Context: system + 3 examples + last 4 turns, input capped at 500 chars, 120 new tokens.
- Dev hook `window.__floppyBrain`.

## Measured
See the numbers in the 2026-10-06 report (headless Chrome on the dev machine, no GPU). On iPhone (iOS 26, WebGPU) expect the Qwen3 model; nothing measured on a real phone yet.

## Tests
- `node --test client/src/components/applets/floppy/hands.test.js` (7): Passwords never / private ask / risky labels and dialog OK, recipe plans (Paint + send, Notepad, Who's in?), snapshot text + agent action checks, VB request detection and rule params, every kind compiles (with nasty quotes), a generated quiz actually runs in the VB runtime (score, last screen), the generate → check → repair loop with a fake model.
- `node --test client/src/components/applets/floppy/floppy.test.js` (6): tools from registries (and a new program appears), prompt shape, parser (good/sloppy/wrong/no JSON), when-parser, fallback intents, confirm gating + describeCall, help ranking on the real topics (+ vectors winning).
- Browser (scratchpad `floppy/rules.mjs`, 390x844 touch): open Paint; reminder with confirm, saved in the calendar store; help answer links; IM confirm then "sign on first"; fallback answer; no sideways scroll, no page errors. `floppy/model.mjs [webgpu]`: loads the brain through the app's modules and asks the model directly (skipping the rules).

## Floppy works windows (`hands.js`, `handsCore.js`)
- **Recipes first, no model** (`planRecipe`): Paint background color (right-click a `.pSwatch` = background color, then Image > Clear Image; "and send it to X" adds the `send_picture` tool, which sends the Paint canvas through Messenger's picture pipeline `preparePicture` + `aim.sendMedia`), Notepad open + type, Pickleball 98 "Who's in?" (handoff venue, set date/time inputs, press Create). Each step is `{do: open|click|set|type|choose|menu|key|wait|tool, target: {css, text}}`.
- **Agent with the brain** (page-agent idea, MIT, ported not vendored): the active window's controls become numbered text lines (`snapshotText`); the model answers one JSON action at a time (`click/type/select/key/done`), checked by `parseAgentAction` against the list (index exists, role fits, not disabled); max 8 steps. Routed when MiniLM picks the `operate` tool.
- **Safety** (`appAccess`, `isRisky`): `NEVER_APPS` (passwords, users, lock, account deletion, backup) are refused; `PRIVATE_APPS` (from hangoutCore) need a Yes first; any press whose label (or whose dialog's text, for OK/Yes) says send/delete/remove/buy/pay/bet/share/post/submit/invite/create/sign out/leave/block/call needs a Yes. **Stop** aborts between steps. "Show me each step" (localStorage `98ish.floppy.showMe`, on by default) outlines each control for 900 ms with a tooltip (`.flHandBox`), off = 150 ms.
- Window identity: title bar text matched to `programs.js` names (`programOfWindow`). Dev hook `window.__floppyHands`.

## Floppy writes VB98 programs (`vbgen.js`)
- A small model is unreliable at whole programs, so it only fills **parameters** of known-good patterns: poll, quiz, eightball, countdown, picker, hello (`KINDS`), plus as-is templates (tic-tac-toe, reaction, soundboard, platformer).
- Order: rules from the sentence (`ruleParams`: "poll: Q? a, b, c", "quiz: Q? a / *b / c; ...", holidays/dates for countdown, "between A, B and C") → else the model with schema + one example (`paramMessages`) → `validateParams` → `buildProject` → `checkProject` (`validateProject` + `compile`). Any failure goes back to the model as the next message (up to 3 tries).
- Opens in Visual Basic 98's designer via handoff `{edit: project}`, ready to Run/Send. `detectVbRequest` stays out of notes/reminders/messages.

## Runtime (wllama vs transformers.js)
Not evaluated in this round (stopped early); transformers.js stays the default. To do: measure wllama v3 (WASM, GGUF Qwen2.5-0.5B q4) load time, tokens/s and peak memory against transformers.js on the same machine, switch only if clearly better on iPhone (budget 300-600 MB).

## Privacy
Nothing typed leaves the device; the chat isn't saved (gone on close). Help: `ask-floppy` topic; privacy-device (Cache Storage row) and privacy-third-parties (Hugging Face + jsDelivr row).

## Next
Browser-verify the recipes and VB generation at 390x844 and one real model run (agent 2-step task, quiz); wllama comparison; optional face (TalkingHead / 2D viseme mouth). Voice (Moonshine/Whisper-tiny in, Kokoro out) as optional downloads; tool results fed back to the model for follow-ups ("and invite Sam"); Floppy reachable on phones while a program is open (a tray button).
