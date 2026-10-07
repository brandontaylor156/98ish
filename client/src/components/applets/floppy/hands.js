// Floppy's hands, the page part: finds windows and controls, shows each step (a dashed box
// around the control and a little caption, "show me"), then presses, types or chooses the way a
// person would (pointer and input events, so React and 98ish's own handlers run as usual).
// Plans come from handsCore.js (recipes) or the brain (one action at a time). Every step goes
// through the safety rules first: never inside Passwords and friends, private programs only
// after the person allows it, and a confirm before anything that sends, deletes or invites.

import { launch, programs } from "../../../utils/programs"
import { openTarget } from "../../../utils/notifications"
import { agentMessages, appAccess, describeStep, isRisky, parseAgentAction } from "./handsCore"

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const visible = (el) => !!el && el.isConnected && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"

// ---- windows ----

const windowEls = () => [...document.querySelectorAll(".window[data-window-index]")].filter((w) => !w.closest(".d-none"))
const titleOf = (w) => document.getElementById(`win-title-${w.dataset.windowIndex}`)?.textContent?.trim() || ""
// the program a window shows, from its title ("untitled - Paint" -> Paint)
export const programOfWindow = (w) => {
  const t = titleOf(w).toLowerCase()
  return programs.filter((p) => t.includes(p.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length)[0] || null
}
export const findWindowEl = (name) => {
  const n = String(name).toLowerCase()
  const hits = windowEls().filter((w) => titleOf(w).toLowerCase().includes(n))
  return hits[hits.length - 1] || null
}
// the window a person is looking at: the active one (windows: the desktop's list)
export const activeWindowEl = (windows = []) => {
  const i = windows.findIndex((w) => w.active && !w.closed && !w.minimized)
  return (i >= 0 && document.querySelector(`.window[data-window-index="${i}"]`)) || windowEls().at(-1) || null
}

// ---- controls ----

const labelOf = (el) => {
  const aria = el.getAttribute("aria-label")
  if (aria) return aria
  if (el.labels?.[0]?.textContent) return el.labels[0].textContent.trim()
  const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim()
  if (text) return text.slice(0, 80)
  return el.getAttribute("placeholder") || el.getAttribute("title") || el.getAttribute("name") || ""
}
const roleOf = (el) => {
  const r = el.getAttribute("role")
  if (r) return r === "option" ? "option" : r
  const tag = el.tagName
  if (tag === "TEXTAREA") return "textarea"
  if (tag === "SELECT") return "listbox"
  if (tag === "A") return "link"
  if (tag === "INPUT") {
    const t = (el.getAttribute("type") || "text").toLowerCase()
    return t === "checkbox" ? "checkbox" : t === "radio" ? "radio" : t === "range" ? "slider" : t === "button" || t === "submit" ? "button" : "textbox"
  }
  if (el.classList.contains("selCombo")) return "combobox"
  if (el.isContentEditable) return "textarea"
  return "button"
}
const INTERACTIVE = "button, a[href], input:not([type=hidden]), textarea, select, [role=tab], [role=menuitem], [role=option], [contenteditable=true]"
// a window's controls, in order -> [{ role, label, value, disabled, checked, el }]
export const collectElements = (root) => {
  if (!root) return []
  const out = []
  for (const el of root.querySelectorAll(INTERACTIVE)) {
    if (!visible(el)) continue
    if (el.closest(".title-bar-controls")) continue // minimize/close: not Floppy's business
    const role = roleOf(el)
    const value = role === "textbox" || role === "textarea" ? el.value ?? el.textContent : role === "combobox" ? el.dataset.value : undefined
    out.push({ role, label: labelOf(el), value, disabled: !!el.disabled || el.getAttribute("aria-disabled") === "true", checked: el.checked || el.getAttribute("aria-checked") === "true" || el.getAttribute("aria-selected") === "true" || undefined, el })
  }
  return out
}

// a recipe's target -> the element: { css, text? } (text: inside the matches, a button with those words)
const resolve = (target, root) => {
  const scopes = [root, document].filter(Boolean)
  for (const scope of scopes) {
    const hits = [...scope.querySelectorAll(target.css)].filter(visible)
    if (!target.text) {
      if (hits[0]) return hits[0]
      continue
    }
    for (const h of hits) {
      const btn = [...h.querySelectorAll("button, [role=button]"), h].find((b) => visible(b) && (b.innerText || b.textContent || "").trim().toLowerCase() === target.text.toLowerCase())
      if (btn) return btn
    }
  }
  return null
}
const waitFor = async (fn, ms = 8000, signal) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    if (signal?.aborted) return null
    const v = fn()
    if (v) return v
    await sleep(120)
  }
  return null
}

// ---- showing ----

let box = null
const show = (el, caption) => {
  hide()
  if (!el?.getBoundingClientRect) return
  const r = el.getBoundingClientRect()
  box = document.createElement("div")
  box.className = "flHandBox"
  box.setAttribute("aria-hidden", "true")
  Object.assign(box.style, { left: `${r.left - 4}px`, top: `${r.top - 4}px`, width: `${r.width + 8}px`, height: `${r.height + 8}px` })
  if (caption) {
    const tip = document.createElement("div")
    tip.className = "flHandTip"
    tip.textContent = caption
    box.appendChild(tip)
  }
  document.body.appendChild(box)
}
const hide = () => {
  box?.remove()
  box = null
}

// ---- doing ----

const press = (el, { button = 0 } = {}) => {
  el.scrollIntoView?.({ block: "nearest", inline: "nearest" })
  const r = el.getBoundingClientRect()
  const at = { bubbles: true, cancelable: true, composed: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, button, buttons: button === 2 ? 2 : 1, pointerId: 1, pointerType: "mouse", isPrimary: true }
  el.dispatchEvent(new PointerEvent("pointerdown", at))
  el.dispatchEvent(new MouseEvent("mousedown", at))
  el.focus?.({ preventScroll: true })
  el.dispatchEvent(new PointerEvent("pointerup", at))
  el.dispatchEvent(new MouseEvent("mouseup", at))
  if (button === 0) el.dispatchEvent(new MouseEvent("click", at))
  else el.dispatchEvent(new MouseEvent("contextmenu", at))
}
// set a field's value so React notices (its own setter, then input/change events)
const setValue = (el, value) => {
  el.focus?.({ preventScroll: true })
  if (el.isContentEditable) {
    el.textContent = value
    el.dispatchEvent(new InputEvent("input", { bubbles: true }))
    return
  }
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
  el.dispatchEvent(new Event("change", { bubbles: true }))
}
const choose = async (el, value) => {
  if (el.tagName === "SELECT") {
    const opt = [...el.options].find((o) => o.value === value || o.textContent.trim().toLowerCase() === String(value).toLowerCase())
    if (!opt) return false
    setValue(el, opt.value)
    return true
  }
  // a 98ish drop-down (shared/select/Combo): open it, then the row
  press(el)
  const row = await waitFor(() => [...document.querySelectorAll(".selLayer [role=option]")].find((o) => o.textContent.trim().toLowerCase() === String(value).toLowerCase()), 1500)
  if (!row) return false
  press(row)
  return true
}
const menu = async (root, path) => {
  const titles = [...root.querySelectorAll(".menuBar > li > button")]
  const top = titles.find((b) => b.textContent.trim().toLowerCase() === path[0].toLowerCase())
  if (!top) return null
  press(top)
  let item = null
  for (const name of path.slice(1)) {
    item = await waitFor(() => [...root.querySelectorAll(".menu button")].find((b) => visible(b) && (b.querySelector(".menuLabel")?.textContent || b.textContent).trim().toLowerCase().startsWith(name.toLowerCase())), 1500)
    if (!item) return null
    if (item.getAttribute("aria-haspopup")) press(item)
  }
  return item
}
const key = (el, k) => {
  const target = el || document.activeElement || document.body
  target.dispatchEvent(new KeyboardEvent("keydown", { key: k, bubbles: true, cancelable: true }))
  target.dispatchEvent(new KeyboardEvent("keyup", { key: k, bubbles: true, cancelable: true }))
}

// ---- the safety check every step passes ----

// -> null (fine) | "never" | "ask"
const accessFor = (windowEl) => {
  const p = windowEl ? programOfWindow(windowEl) : null
  const a = appAccess(p?.app)
  return a === "ok" ? null : { level: a, name: p?.name || "that window" }
}

// ---- running a plan ----
// io: { dispatch, confirm(text) -> Promise<bool>, narrate(text), runTool(call) -> Promise<{ text }>,
//       signal (AbortSignal: Stop), showMs (how long each step is shown first) }
// -> { ok, done: [step words], stopped?, error? }
export const runPlan = async (plan, io) => {
  const { dispatch, confirm, narrate, runTool, signal, showMs = 700 } = io
  const done = []
  let win = null
  const allowed = new Set()
  const gate = async (el, words) => {
    const w = el?.closest?.(".window[data-window-index]") || win
    const acc = accessFor(w)
    if (acc?.level === "never") throw new Error(`I don't work inside ${acc.name}. That's yours alone.`)
    if (acc?.level === "ask" && !allowed.has(acc.name)) {
      if (!(await confirm(`Floppy needs to work inside ${acc.name} for this. Allow it, just this once?`))) throw new Error("stop")
      allowed.add(acc.name)
    }
    return words
  }
  try {
    for (const step of plan.steps) {
      if (signal?.aborted) return { ok: false, stopped: true, done }
      const words = describeStep(step)
      if (step.do === "open") {
        narrate(words)
        if (step.handoff) openTarget({ kind: "program", name: step.program, extra: { handoff: { id: Date.now(), ...step.handoff } } })
        else if (!findWindowEl(step.program)) dispatch({ type: "open_window", payload: launch(step.program) })
        win = await waitFor(() => findWindowEl(step.program), 15000, signal)
        if (!win) throw new Error(`${step.program} didn't open.`)
        await gate(win, words)
        await sleep(Math.min(showMs, 400))
      } else if (step.do === "wait") {
        const el = await waitFor(() => resolve(step.target, win), step.ms || 8000, signal)
        if (!el) throw new Error("The window didn't show what I was waiting for.")
      } else if (step.do === "tool") {
        if (step.risky && !(await confirm(words))) throw new Error("stop")
        const r = await runTool(step.call)
        narrate(r.text)
      } else if (step.do === "say") {
        narrate(step.text)
      } else {
        // click / type / set / select / menu on a control
        let el = step.do === "menu" ? null : await waitFor(() => resolve(step.target, win), 5000, signal)
        if (step.do !== "menu" && !el) throw new Error(`I couldn't find the control for "${words}".`)
        await gate(el || win, words)
        if (el) show(el, words)
        narrate(words)
        await sleep(showMs)
        if (signal?.aborted) return { ok: false, stopped: true, done }
        const risky = step.risky || (step.do === "click" && isRisky(el?.innerText || el?.getAttribute?.("aria-label"), el?.closest?.(".dialog")?.textContent))
        if (risky && !(await confirm(words))) throw new Error("stop")
        if (step.do === "click") press(el, step.pointer)
        else if (step.do === "type" || step.do === "set") setValue(el, step.do === "type" ? (el.value ? `${el.value}${el.value.endsWith("\n") ? "" : "\n"}` : "") + step.text : step.value)
        else if (step.do === "select") {
          if (!(await choose(el, step.value))) throw new Error(`"${step.value}" isn't one of the choices.`)
        } else if (step.do === "menu") {
          const item = await menu(win || document, step.path)
          if (!item) throw new Error(`I couldn't find ${step.path.join(" > ")}.`)
          show(item, words)
          await sleep(Math.min(showMs, 400))
          press(item)
        }
        hide()
        await sleep(120)
      }
      done.push(words)
    }
    return { ok: true, done }
  } catch (e) {
    hide()
    if (e.message === "stop") return { ok: false, stopped: true, done }
    return { ok: false, done, error: e.message }
  }
}

// ---- the agent: the brain, one step at a time, in the window you're looking at ----
// io as runPlan, plus generate(messages) -> text, windows (the desktop's list)
export const runAgent = async (goal, io) => {
  const { generate, windows, confirm, narrate, signal, showMs = 700, maxSteps = 8 } = io
  const win = activeWindowEl(windows)
  if (!win) return { ok: false, done: [], error: "Open the window you want me to work in first." }
  const acc = accessFor(win)
  if (acc?.level === "never") return { ok: false, done: [], error: `I don't work inside ${acc.name}. That's yours alone.` }
  if (acc?.level === "ask" && !(await confirm(`Floppy needs to work inside ${acc.name} for this. Allow it, just this once?`))) return { ok: false, stopped: true, done: [] }
  const title = titleOf(win)
  const done = []
  for (let n = 0; n < maxSteps; n++) {
    if (signal?.aborted) return { ok: false, stopped: true, done }
    const elements = collectElements(win)
    let messages = agentMessages({ goal, title, elements, done })
    let parsed = null
    for (let tries = 0; tries < 2 && !parsed?.ok; tries++) {
      const out = await generate(messages)
      parsed = parseAgentAction(out, elements)
      if (!parsed.ok) messages = [...messages, { role: "assistant", content: out }, { role: "user", content: `${parsed.error} Answer again.` }]
    }
    if (!parsed?.ok) return { ok: false, done, error: "I got confused about what to press. Try saying it step by step." }
    const a = parsed.action
    if (a.do === "done") {
      hide()
      return { ok: true, done, say: a.say }
    }
    if (a.do === "key") {
      narrate(`Pressing ${a.key}.`)
      key(document.activeElement?.closest?.(".window") === win ? document.activeElement : win, a.key)
      done.push(`pressed ${a.key}`)
      await sleep(250)
      continue
    }
    const target = elements[a.i]
    const words = a.do === "type" ? `Typing "${a.text.slice(0, 40)}" into ${target.label || "the box"}` : a.do === "select" ? `Choosing ${a.value} in ${target.label || "the list"}` : `Pressing ${target.label || "that"}`
    show(target.el, words)
    narrate(words)
    await sleep(showMs)
    if (signal?.aborted) return { ok: false, stopped: true, done }
    if (a.do === "click" && isRisky(target.label, target.el.closest(".dialog")?.textContent) && !(await confirm(words))) {
      hide()
      return { ok: false, stopped: true, done }
    }
    if (a.do === "click") press(target.el)
    else if (a.do === "type") setValue(target.el, a.text)
    else if (a.do === "select" && !(await choose(target.el, a.value))) narrate(`"${a.value}" isn't one of the choices.`)
    hide()
    done.push(words)
    await sleep(300)
  }
  hide()
  return { ok: false, done, error: "That took more steps than I'm allowed. Here's how far I got." }
}

if (typeof window !== "undefined" && import.meta.env?.DEV) window.__floppyHands = { collectElements, activeWindowEl, findWindowEl, runPlan }
