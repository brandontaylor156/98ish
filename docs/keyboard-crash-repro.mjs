// Reproduces the open "page crashes while typing a Speed Typist race with the 98ish keyboard"
// issue in headless Chrome (see CLAUDE.md). Needs vite on 5199 and the chat server on 8000:
//   node docs/keyboard-crash-repro.mjs
// It logs audio stats every 0.5 s (heap, DOM nodes, live sounds) so the state just before the
// crash is visible. Expected today: "AUDIO error event" twice, "state suspended", PAGE CRASHED.
import { chromium } from "playwright-core"
const browser = await chromium.launch({ executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe" })
try {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1" })
  await ctx.addInitScript(() => { localStorage.setItem("98ish.bootScreen", "off"); localStorage.setItem("98ish.helper", "off") })
  await ctx.addInitScript(() => {
    const AC = window.AudioContext
    const stats = { ctx: 0, osc: 0, buf: 0, gain: 0, comp: 0, biquad: 0, started: 0, live: 0, maxLive: 0, ramps: 0 }
    window.__aud = stats
    const wrap = (proto, name, key) => { const f = proto[name]; proto[name] = function (...a) { stats[key]++; return f.apply(this, a) } }
    wrap(BaseAudioContext.prototype, "createOscillator", "osc"); wrap(BaseAudioContext.prototype, "createBufferSource", "buf"); wrap(BaseAudioContext.prototype, "createGain", "gain"); wrap(BaseAudioContext.prototype, "createDynamicsCompressor", "comp"); wrap(BaseAudioContext.prototype, "createBiquadFilter", "biquad")
    const st = AudioScheduledSourceNode.prototype.start
    AudioScheduledSourceNode.prototype.start = function (...a) { stats.started++; stats.live++; stats.maxLive = Math.max(stats.maxLive, stats.live); this.addEventListener("ended", () => stats.live--); return st.apply(this, a) }
    for (const m of ["setValueAtTime", "linearRampToValueAtTime", "exponentialRampToValueAtTime", "setTargetAtTime", "cancelScheduledValues"]) { const f = AudioParam.prototype[m]; AudioParam.prototype[m] = function (...a) { stats.ramps++; if (a.some((v) => typeof v === "number" && !Number.isFinite(v))) console.log("AUDIO bad arg", m, JSON.stringify(a)); return f.apply(this, a) } }
    window.AudioContext = function (...a) { const c = new AC(...a); stats.ctx++; console.log("AUDIO new context", JSON.stringify(a), c.sampleRate, c.state); c.addEventListener("statechange", () => console.log("AUDIO state", c.state, c.currentTime.toFixed(2))); c.addEventListener("error", (e) => console.log("AUDIO error event", e?.message || e?.error?.message || e.type)); window.__ctxs = (window.__ctxs || []).concat(c); return c }
    window.AudioContext.prototype = AC.prototype
    setInterval(() => { const c = (window.__ctxs || [])[0]; console.log("AUDIO tick heapMB=" + Math.round((performance.memory?.usedJSHeapSize || 0) / 1e6) + " nodes=" + document.getElementsByTagName("*").length + " live=" + stats.live, c ? c.state : "") }, 500)
  })
  const page = await ctx.newPage()
  page.on("crash", () => console.log("PAGE CRASHED")); page.on("console", (m) => (m.type() === "error" || m.text().startsWith("AUDIO")) && console.log("CONSOLE", m.text().slice(0, 300)))
  const errs = []; page.on("pageerror", (e) => errs.push(e.message))
  await page.goto("http://localhost:5199/"); await page.waitForTimeout(1200)
  await page.tap(".startBtn"); await page.locator(".smItem", { hasText: "Run..." }).tap(); await page.locator("#run-open").tap()
  // type "typing" on the 98ish keyboard into Run
  for (const ch of "typing") await page.locator(`.kb98 button[aria-label="${ch}"]`).first().tap()
  console.log("run box:", await page.inputValue("#run-open"))
  await page.locator(".kb98 button", { hasText: /^(Go|Enter|OK)$/ }).first().tap().catch(async () => page.keyboard.press("Enter"))
  await page.waitForTimeout(2500)
  await page.tap("[data-mode=computer]"); await page.waitForTimeout(400); await page.tap("[data-start]")
  await page.waitForFunction(() => document.querySelector(".stInput") && !document.querySelector(".stInput").readOnly, null, { timeout: 20000 })
  const input = page.locator(".stInput")
  console.log("step: tapping input"); await input.tap(); await page.waitForTimeout(400); console.log("step: tapped")
  const kb = await page.locator(".kb98").count()
  const prompt = await page.evaluate(() => document.querySelector("[data-prompt]")?.innerText || document.querySelector(".stPrompt, [class*=Prompt]")?.innerText || "")
  const word = prompt.trim().split(/\s+/)[0] || ""
  console.log("step: word", word)
  for (const ch of (prompt.replace(/[^A-Za-z ]/g, "").slice(0, 40))) { console.log("key", ch); const lab = ch; const b = page.locator(`.kb98 button[aria-label="${lab}"]`).first(); if (await b.count()) await b.tap({ timeout: 4000 }); else { await page.locator(`.kb98 button[aria-label="shift"], .kb98 button[aria-label="Shift"]`).first().tap({ timeout: 4000 }).catch(() => {}); await page.locator(`.kb98 button[aria-label="${lab.toLowerCase()}"]`).first().tap({ timeout: 4000 }).catch(() => {}) } }
  console.log("keyboard shown:", kb, "prompt word:", word, "typed:", await input.inputValue())
  await page.screenshot({ path: "shots/kb/st-kb.png" })
  console.log("errors", JSON.stringify(errs))
} finally { await browser.close() }
