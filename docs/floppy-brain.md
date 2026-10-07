# Ask Floppy (Floppy's brain)

Built 2026-10-06 from idea #1 of the GitHub research ("Floppy gets a brain"). Floppy, the helper (`OS-specific/Helper.jsx`), gets an **Ask Floppy...** box in every bubble. Typing opens a small chat (`applets/floppy/FloppyChat.jsx`, lazy) that **does things**: opens programs, makes reminders/events/tasks/notes, sends IMs, sets Do Not Disturb, starts Pickleball 98 modes, plays music, starts Watch Together, opens files and answers how-to questions from 98ish Help. Free, private: everything runs in the browser.

## How it decides
`floppyTools.js` `ask(text)`:
1. **Rule-based fallback** (`floppyCore.js` `ruleIntent`): regex intents for the common commands, with a when-parser (`parseWhen`: today/tonight/tomorrow/weekdays/"in 20 minutes"/"at 7" (= 19:00 for 1-7 without am/pm)/"7:30am"/noon). Works instantly, offline, with no model.
2. **Help questions** ("how do I...", or anything when there's no brain): `rankHelp` over `help/topics` (per-word keyword scores via `searchCore.scoreEntry`; with the brain, a hybrid with MiniLM embeddings 0.65 vector + 0.35 keyword). The answer quotes the top page's summary and links the top 2 pages.
3. **The brain** (`askModel`, only when the model is loaded): **route, then fill** (small models can't pick among 13 tools in one prompt; see Measured).
   - **Route:** MiniLM embeds the question and compares it with `TOOL_EXAMPLES` (a few sentences per tool plus a `chat` class); best match ≥ 0.45 wins (`routeByVectors`). `open_help` answers from the help pages.
   - **Fill:** `fillSlots` reads the arguments from the sentence (when-parser, Pickleball mode words and venues, "tell <buddy> that ...", "jot down that ...", minutes for Do Not Disturb, URLs); `open_program` without a name in the sentence is matched **by meaning** against each program's help summary. Only if that fails does the language model fill the one tool's arguments from a tiny prompt (`slotMessages`, one example, long enums cut to likely values by `likelyValues`), parsed by `parseSlots` with one retry.
   - **Chat:** `cannedReply` for small talk (who are you, what can you do, thanks, a joke), else a short model answer with the top help pages as context (`chatMessages`), streamed.
   - `parseModelOutput` is forgiving (fences, chatter, single quotes, trailing commas, bare keys, unclosed braces, `arguments`/`name` synonyms, string numbers/booleans, closest enum value) and returns an error the retry sends back. `systemPrompt`/`buildMessages` (the one-big-prompt form) are kept for a bigger model later.
   - **45 s limit** (`GENERATE_LIMIT_MS`): a device too slow for the model gets "too slow, plain commands still work" and the brain is let go.
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

## Measured (2026-10-06, headless Chrome on the dev machine: no GPU, so WASM, single-threaded, and the machine busy with other agents)
- Model: Qwen2.5-0.5B-Instruct q8 (WASM). Load 64-138 s each run (the headless profile couldn't keep Cache Storage, "QuotaExceededError", so every run downloaded again; a real browser keeps it).
- **v1, one big prompt with every tool** (13 tools + examples): first token after **94-152 s**, decode ~6.7 tokens/s, and **0 of 4** right (e.g. "open Pickleball and start practice" -> open_file). A 0.5B model can't choose among 13 tools in one prompt, and on a CPU the long prompt alone takes minutes.
- **v2, route then fill** (what ships): the embedding model picked the right tool for **6 of 6** test sentences (scores 0.47-0.94); the language model filling arguments was still poor (invented a note title, rambled for Pickleball).
- **v3, route then the sentence fills the arguments** (rules first, model as fallback): **5 of 6** right calls in 33 ms-2.2 s (12 s for the first, which warms up the embedding model); "I feel like drawing something" still went to the model, which (starved for CPU) needed 309 s for its first token. Fixed after that run by matching programs by meaning (help summaries + embeddings) and a **45 s limit** on generation (the brain is let go; Floppy says it's too slow); that last run was stopped by Claude Code for low memory, so the fix is unit-tested but not re-measured in the browser.
- Not measured: WebGPU (no GPU here) and any real phone. On an iPhone with iOS 26 the WebGPU path (Qwen3-0.6B q4f16, 570 MB) should be far faster than this CPU; the 45 s limit protects slow devices either way.
- Memory note from the round-2 research: iPhone Safari tabs crash well under 1.5 GB in practice; keep models at 300-600 MB (both are). The llama.cpp WebGPU runtime **wllama** (MIT) used ~41% less peak memory than transformers.js on iPhone 15/17 Pro Max (LlamaWeb, arXiv 2605.20706): the next runtime to try.

## Tests
- `node --test client/src/components/applets/floppy/floppy.test.js` (8): tools from registries (and a new program appears), prompt shape, parser (good/sloppy/wrong/no JSON), when-parser, fallback intents, confirm gating + describeCall, routing + slot prompt + `parseSlots`, `fillSlots` on the sentences the model got wrong in the real run, canned replies, help ranking on the real topics (+ vectors winning).
- Browser (scratchpad `floppy/rules.mjs`, 390x844 touch): open Paint; reminder with confirm, saved in the calendar store; help answer links; IM confirm then "sign on first"; fallback answer; no sideways scroll, no page errors. `floppy/model.mjs [webgpu]`: loads the brain through the app's modules and asks the model directly (skipping the rules).

## Privacy
Nothing typed leaves the device; the chat isn't saved (gone on close). Help: `ask-floppy` topic; privacy-device (Cache Storage row) and privacy-third-parties (Hugging Face + jsDelivr row).

## Next
- Measure on a real iPhone (iOS 26 WebGPU) and on a desktop GPU; try **wllama** (llama.cpp WebGPU, MIT, ~41% less peak memory on iPhone) behind the same worker messages.
- Voice (Moonshine/Whisper-tiny in, Kokoro out) as optional downloads.
- Follow-ups ("and invite Sam") and operating windows with a DOM-as-text agent (research suggests page-agent, MIT).
- Floppy reachable on phones while a program is open (a tray button); today he only shows on the bare desktop there.
