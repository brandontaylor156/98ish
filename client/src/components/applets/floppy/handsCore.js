// Floppy's hands, the pure part (no DOM): turning a request into steps in 98ish's own windows,
// the safety rules every step passes, and the text a small model sees of a window.
//
// Two ways to operate a window:
// - recipes: known multi-step jobs read straight from the sentence ("make Paint's background
//   blue and send it to Sam", "set up a Who's in? at Los Cab Saturday 9am", "open Notepad and
//   type ..."): reliable, no model needed;
// - the agent: anything else, with the brain: the window's controls become numbered lines of
//   text (the page-agent idea: the page as text, no screenshots, so a 0.5B model can follow) and
//   the model answers one action at a time.
// Every action passes the same rules: an allow-list of what Floppy may do, private programs
// (Passwords never; Messenger, Mail, Notes, Photos... only after the person says yes), and a
// confirm before anything that sends, deletes, buys, shares or invites.
// hands.js runs the steps in the page. Tested in hands.test.js.

import { PRIVATE_APPS } from "../hangout/hangoutCore.js"
import { fold } from "../../../utils/searchCore.js"
import { dayIn, firstObject, parseWhen, tryJson } from "./floppyCore.js"

// ---- safety ----

export const ACTIONS = ["open", "click", "type", "set", "select", "menu", "key", "wait", "tool", "say", "done"]
export const KEYS = ["Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"]
// Floppy never works inside these, even if asked
export const NEVER_APPS = new Set(["passwords", "users", "lock", "aim-delete", "backup"])
// -> "never" | "ask" (only after the person allows it, once per job) | "ok"
export const appAccess = (app) => {
  const a = String(app || "")
  if (NEVER_APPS.has(a)) return "never"
  if (a.startsWith("aim") || PRIVATE_APPS.has(a)) return "ask"
  return "ok"
}
// what a press does, judged from the control's words (and the dialog it sits in)
const RISKY = /\b(send|sent|delete|remove|erase|empty|clear all|uninstall|format|reset|buy|purchase|pay|bet|wager|deal|share|post|publish|submit|invite|create session|create|sign out|log out|log off|shut down|restart|leave|block|report|call)\b/i
export const isRisky = (label, context = "") => RISKY.test(String(label || "")) || (/^(ok|yes|do it|confirm)$/i.test(String(label || "").trim()) && RISKY.test(String(context || "")))

// ---- a window as text (for the model) ----
// elements: [{ role, label, value?, disabled?, checked? }] in the order the window lists them

export const elementLine = (e, i) => {
  const value = e.value !== undefined && e.value !== "" ? ` = "${String(e.value).slice(0, 40)}"` : ""
  const state = `${e.checked ? " (checked)" : ""}${e.disabled ? " (disabled)" : ""}`
  return `[${i}] ${e.role} "${String(e.label || "").slice(0, 60)}"${value}${state}`
}
export const snapshotText = (title, elements, max = 60) => [`Window: ${title}`, ...elements.slice(0, max).map(elementLine), ...(elements.length > max ? [`(${elements.length - max} more not shown)`] : [])].join("\n")

export const agentMessages = ({ goal, title, elements, done = [] }) => [
  {
    role: "system",
    content:
      "You operate a Windows 98-style computer for the user, one step at a time. You see the controls of one window as numbered lines. Reply with ONE line of JSON and nothing else:\n" +
      '{"do":"click","i":N} or {"do":"type","i":N,"text":"..."} or {"do":"select","i":N,"value":"..."} or {"do":"key","key":"Enter"} or {"do":"done","say":"what you did"}.\n' +
      "Only use numbers from the list. Say done as soon as the goal is reached.",
  },
  { role: "user", content: `Goal: ${String(goal).slice(0, 200)}\n${done.length ? `Already done: ${done.join("; ")}\n` : ""}${snapshotText(title, elements)}` },
]

// the model's step -> { ok, action } | { ok: false, error } (checked against the list it saw)
export const parseAgentAction = (text, elements) => {
  const raw = firstObject(text)
  const obj = raw ? tryJson(raw) : null
  if (!obj || typeof obj !== "object") return { ok: false, error: "Answer with one line of JSON." }
  const act = String(obj.do || obj.action || "").toLowerCase()
  if (!["click", "type", "select", "key", "done"].includes(act)) return { ok: false, error: `"do" must be click, type, select, key or done.` }
  if (act === "done") return { ok: true, action: { do: "done", say: String(obj.say || obj.text || "Done!").slice(0, 200) } }
  if (act === "key") {
    const key = KEYS.find((k) => k.toLowerCase() === String(obj.key || "").toLowerCase())
    return key ? { ok: true, action: { do: "key", key } } : { ok: false, error: `key must be one of ${KEYS.join(", ")}.` }
  }
  const i = Number(obj.i ?? obj.index ?? obj.id)
  if (!Number.isInteger(i) || i < 0 || i >= elements.length) return { ok: false, error: `"i" must be a number from the list (0-${elements.length - 1}).` }
  const el = elements[i]
  if (el.disabled) return { ok: false, error: `[${i}] is disabled.` }
  if (act === "type") {
    if (!/^(textbox|textarea|searchbox|combobox)$/.test(el.role)) return { ok: false, error: `[${i}] isn't a text box.` }
    return { ok: true, action: { do: "type", i, text: String(obj.text ?? obj.value ?? "").slice(0, 2000) } }
  }
  if (act === "select") {
    if (el.role !== "listbox" && el.role !== "combobox") return { ok: false, error: `[${i}] isn't a drop-down.` }
    return { ok: true, action: { do: "select", i, value: String(obj.value ?? obj.text ?? "").slice(0, 100) } }
  }
  return { ok: true, action: { do: "click", i } }
}

// ---- recipes ----

// Paint's palette (paintLogic.js PALETTE) by name
export const PAINT_COLORS = {
  black: "#000000", gray: "#808080", grey: "#808080", maroon: "#800000", olive: "#808000", "dark green": "#008000", teal: "#008080", navy: "#000080", "dark blue": "#000080", purple: "#800080", brown: "#804000",
  white: "#ffffff", silver: "#c0c0c0", "light gray": "#c0c0c0", red: "#ff0000", yellow: "#ffff00", green: "#00ff00", lime: "#00ff00", cyan: "#00ffff", aqua: "#00ffff", blue: "#0000ff", magenta: "#ff00ff", pink: "#ff00ff", orange: "#ff8040", "sky blue": "#80ffff", "light blue": "#80ffff",
}
const colorIn = (lower) => {
  const names = Object.keys(PAINT_COLORS).sort((a, b) => b.length - a.length)
  const name = names.find((n) => new RegExp(`\\b${n}\\b`).test(lower))
  return name ? { name, hex: PAINT_COLORS[name] } : null
}
const buddyIn = (text, buddies) => {
  const m = /\b(?:send|give|share)\s+(?:it|this|that|the (?:picture|drawing|image))\s+(?:to|with)\s+([\w.-]+(?:\s[\w.-]+)?)/i.exec(text)
  if (!m) return null
  const said = m[1].trim()
  const f = fold(said)
  return buddies.find((b) => fold(b) === f) || buddies.find((b) => fold(b).startsWith(f.split(" ")[0])) || said
}

// -> { title, steps } | null.  ctx: { programs, buddies, venues, now, zone }
export const planRecipe = (input, { programs = [], buddies = [], venues = [], now = Date.now(), zone = "UTC" } = {}) => {
  const text = String(input || "").trim()
  const lower = text.toLowerCase()

  // Paint: fill the picture with a color (and send it to a buddy)
  if (/\bpaint\b/.test(lower) && /\b(background|backdrop|canvas|whole (?:picture|thing|page)|fill)\b/.test(lower)) {
    const color = colorIn(lower)
    if (color && programs.includes("Paint")) {
      const to = buddyIn(text, buddies)
      const steps = [
        { do: "open", program: "Paint", say: "Opening Paint." },
        { do: "click", target: { css: `.pSwatch[aria-label="Color ${color.hex}"]` }, pointer: { button: 2 }, say: `Making ${color.name} the background color (a right-click on the swatch).` },
        { do: "menu", path: ["Image", "Clear Image"], say: "Image > Clear Image fills the whole picture with the background color." },
      ]
      if (to) steps.push({ do: "tool", call: { tool: "send_picture", args: { to, app: "Paint" } }, risky: true, say: `Sending the picture to ${to}.` })
      return { title: `Paint the picture ${color.name}${to ? ` and send it to ${to}` : ""}`, steps }
    }
  }

  // Notepad: open it and type something
  let m
  if ((m = /\bnotepad\b.*?\b(?:type|write|put)\s+["“]?(.+?)["”]?$/i.exec(text)) && programs.includes("Notepad")) {
    return {
      title: "Type in Notepad",
      steps: [
        { do: "open", program: "Notepad", say: "Opening Notepad." },
        { do: "type", target: { css: "textarea" }, text: m[1], say: "Typing it in." },
      ],
    }
  }

  // Pickleball 98 > Real Games: a "Who's in?" session at a venue, on a day and time
  if (/\b(who'?s in|open play|session|set up (?:a )?(?:game|play)|plan (?:a )?(?:game|session))\b/i.test(lower)) {
    const venue = venues.find((v) => lower.includes(fold(v.short || v.name)) || lower.includes(fold(v.name).split(" ")[0]))
    const when = parseWhen(text, { now, zone })
    if (venue) {
      const date = when.date || dayIn(now, zone).date
      const steps = [
        { do: "open", program: "Pickleball 98", handoff: { venue: venue.id }, say: `Opening Real Games with a new session at ${venue.short || venue.name}.` },
        { do: "wait", target: { css: "input[data-date]" }, ms: 15000, say: "Waiting for the New Session box." },
        { do: "set", target: { css: "input[data-date]" }, value: date, say: `Setting the day.` },
      ]
      if (when.time) steps.push({ do: "set", target: { css: "input[data-time]" }, value: when.time, say: "Setting the time." })
      steps.push({ do: "click", target: { css: ".dialog", text: "Create" }, risky: true, say: "Creating the session: your buddies get invited." })
      return { title: `Set up a Who's in? at ${venue.short || venue.name}`, steps }
    }
  }
  return null
}

// ---- words for the confirm box and the transcript ----

export const describeStep = (step) => {
  if (step.say) return step.say
  switch (step.do) {
    case "open":
      return `Open ${step.program}`
    case "click":
      return `Press ${step.label || "that"}`
    case "type":
      return `Type "${String(step.text).slice(0, 40)}"`
    case "menu":
      return `Choose ${step.path.join(" > ")}`
    default:
      return step.do
  }
}
