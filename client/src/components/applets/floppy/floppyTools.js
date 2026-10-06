// Floppy's hands: what each tool does in 98ish, and the ask() flow that decides between the
// rule-based fallback, a help answer and the model. Side-effecting tools never run here
// without the person's OK: ask() returns { confirm: call } and FloppyChat asks first.

import { launch, programs } from "../../../utils/programs"
import { openHelp } from "../../../utils/help"
import { openTarget } from "../../../utils/notifications"
import { searchAll, openResult } from "../../../utils/search"
import { openItem } from "../../../utils/openItem"
import { createNote } from "../../../utils/notes"
import { setDnd, turnOffDnd, turnOnDnd } from "../../../utils/dnd"
import { pickDefault, saveEvent, zone as calZone } from "../calendar/store"
import { taskDraft } from "../tasks/tasksCore"
import { VENUE_LIST } from "../pickleball/park/venues/index.js"
import { TOPICS } from "../help/topics/index.js"
import { topicText } from "../help/helpCore.js"
import { buildMessages, buildTools, dayIn, describeCall, needsConfirm, parseModelOutput, rankHelp, resolveDate, ruleIntent, systemPrompt } from "./floppyCore"
import { embed, generate, getBrain } from "./brain"

// 98 Messenger lives inside the desktop's AimProvider; FloppyBridge hands it over
let aim = null
export const setFloppyAim = (a) => {
  aim = a
}
const buddies = () => {
  const seen = new Set()
  for (const g of aim?.me?.groups || []) for (const b of g.buddies || []) if (b && !/^smarterchild$/i.test(b)) seen.add(b)
  return [...seen]
}

const registry = () => ({ programs: programs.map((p) => p.name), venues: VENUE_LIST.map((v) => ({ id: v.id, name: v.name, short: v.short })), buddies: buddies() })
export const currentTools = () => buildTools(registry())

const zone = () => {
  try {
    return calZone() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

// ---- help pages (and their vectors, made once the brain is around) ----
let docs = null
const helpDocs = () =>
  (docs ||= TOPICS.map((t) => ({ id: t.id, title: t.title, keywords: t.keywords || [], summary: t.summary || "", body: topicText(t, (id) => TOPICS.find((x) => x.id === id)?.title || id).slice(0, 1500) })))
let vectors = null
const helpVectors = async () => {
  if (vectors) return vectors
  const d = helpDocs()
  const out = await embed(d.map((x) => `${x.title}. ${x.summary} ${x.body.slice(0, 300)}`))
  vectors = Object.fromEntries(d.map((x, i) => [x.id, out[i]]))
  return vectors
}
export const findHelp = async (question, { useVectors = false } = {}) => {
  const d = helpDocs()
  if (useVectors) {
    try {
      const v = await helpVectors()
      const [qvec] = await embed([question])
      return rankHelp(question, d, { vectors: v, qvec, limit: 3 })
    } catch {
      // fall back to words
    }
  }
  return rankHelp(question, d, { limit: 3 })
}

// ---- running a tool -> { text, results?, help? } ----

const open = (dispatch, name, extra) => dispatch({ type: "open_window", payload: launch(name, extra) })

export const runTool = async (call, { dispatch }) => {
  const a = call.args || {}
  const z = zone()
  const now = Date.now()
  switch (call.tool) {
    case "open_program":
      open(dispatch, a.name)
      return { text: `Opening ${a.name}!` }
    case "search": {
      const { groups } = searchAll(a.query, { perType: 3 })
      const results = groups.flatMap((g) => g.results.map((r) => ({ ...r, group: g.label }))).slice(0, 6)
      return results.length ? { text: `Here's what I found for "${a.query}":`, results } : { text: `I couldn't find anything for "${a.query}".` }
    }
    case "open_help": {
      const [top] = await findHelp(a.subject, { useVectors: getBrain().status === "ready" })
      if (!top) return { text: "I couldn't find a help page about that." }
      openHelp(top.id)
      return { text: `Here's the help page "${top.title}".` }
    }
    case "create_reminder": {
      const date = resolveDate(a.date, { now, zone: z }) || dayIn(now, z).date
      const draft = taskDraft({ title: a.text, when: "date", date, time: a.time || "09:00", reminder: 0, zone: z, now })
      const r = await saveEvent(pickDefault(), draft)
      return r?.ok === false ? { text: `Hmm, that didn't save: ${r.error}` } : { text: `Done! ${describeCall({ ...call, args: { ...a, date, time: a.time || "09:00" } }).replace("Remind you", "I'll remind you")}.` }
    }
    case "create_event": {
      const date = resolveDate(a.date, { now, zone: z }) || dayIn(now, z).date
      const draft = { ...taskDraft({ title: a.title, when: "date", date, time: a.time || "", zone: z, now }), todo: false, done: false }
      if (!draft.allDay && a.minutes) draft.end = draft.start + Math.min(24 * 60, Math.max(5, a.minutes)) * 60_000
      else if (!draft.allDay) draft.end = draft.start + 60 * 60_000
      const r = await saveEvent(pickDefault(), draft)
      return r?.ok === false ? { text: `Hmm, that didn't save: ${r.error}` } : { text: `It's on your calendar: ${a.title}.` }
    }
    case "create_task": {
      const date = a.date ? resolveDate(a.date, { now, zone: z }) : null
      const r = await saveEvent(pickDefault(), taskDraft({ title: a.title, when: date ? "date" : "today", date, zone: z, now }))
      return r?.ok === false ? { text: `Hmm, that didn't save: ${r.error}` } : { text: `Added to Tasks: ${a.title}.` }
    }
    case "create_note": {
      createNote({ title: a.title, body: a.body || "" })
      return { text: `I made a note: ${a.title}.` }
    }
    case "send_im": {
      if (aim?.status !== "online") return { text: "Sign on to 98 Messenger first, then I can send it." }
      const r = await aim.sendIm(a.to, a.text)
      return r?.ok === false ? { text: `It didn't go: ${r.error || "try again"}` } : { text: `Sent to ${a.to}!` }
    }
    case "set_dnd":
      if (!a.on) turnOffDnd()
      else if (a.minutes) setDnd({ on: true, until: now + Math.min(24 * 60, a.minutes) * 60_000, skip: null })
      else turnOnDnd("off")
      return { text: a.on ? `Shh! Do Not Disturb is on${a.minutes ? ` for ${a.minutes} minutes` : ""}.` : "Do Not Disturb is off." }
    case "pickleball":
      openTarget({ kind: "program", name: "Pickleball 98", extra: { handoff: { id: now, floppy: { mode: a.mode, venue: a.venue || null } } } })
      return { text: describeCall(call) + "!" }
    case "play_music": {
      const { groups } = searchAll(a.song || "", { types: ["files"], all: !a.song })
      const song = groups.flatMap((g) => g.results).find((r) => r.item?.type === "song")
      if (song) {
        openItem(song.item, dispatch)
        return { text: `Playing ${song.item.name.replace(/\.[^.]+$/, "")}.` }
      }
      open(dispatch, "Music 98")
      return { text: a.song ? `I couldn't find "${a.song}", so here's Music 98.` : "Here's Music 98. Add some songs and press play!" }
    }
    case "watch_together": {
      const video = /(?:youtu\.be\/|v=|shorts\/)([\w-]{11})/.exec(a.url || "")?.[1]
      open(dispatch, "Watch Together", { handoff: { id: now, ...(video ? { video } : {}), ...(a.with ? { with: a.with } : {}) } })
      return { text: "Watch Together is ready: press Start when you are." }
    }
    case "open_file": {
      const { groups } = searchAll(a.name, { types: ["files", "photos"], perType: 1 })
      const hit = groups[0]?.results[0]
      if (!hit) return { text: `I couldn't find a file called "${a.name}".` }
      openResult(hit, dispatch)
      return { text: `Opening ${hit.title || a.name}.` }
    }
    default:
      return { text: "I don't know how to do that yet." }
  }
}

// ---- asking ----
// -> { reply, help?: [topics] } | { confirm: call } | { call, result }

const CANT = "I'm not sure what you mean. Try \"open Paint\", \"remind me to call Sam at 7\", or \"how do I change my wallpaper?\""

export const ask = async (text, { history = [], dispatch, onToken } = {}) => {
  const tools = currentTools()
  const z = zone()
  const reg = registry()
  const intent = ruleIntent(text, { ...reg, now: Date.now(), zone: z })
  const brain = getBrain().status === "ready"

  const act = async (call) => (needsConfirm(tools, call) ? { confirm: call } : { call, result: await runTool(call, { dispatch }) })

  if (intent?.tool) return act(intent)
  if (intent?.help || !brain) {
    const pages = await findHelp(intent?.help || text, { useVectors: brain })
    if (intent?.help || pages.length) {
      if (!pages.length) return { reply: "I looked, but I couldn't find a help page about that." }
      return { reply: `This help page should answer it: "${pages[0].title}". ${pages[0].summary}`, help: pages }
    }
    return { reply: brain ? CANT : `${CANT} Or give me a brain (More options) and I'll understand much more.` }
  }

  // the model, with a retry that explains what was wrong
  const now = Date.now()
  const today = dayIn(now, z)
  const grounding = (await findHelp(text, { useVectors: true })).slice(0, 2).map((p) => ({ title: p.title, text: p.summary }))
  const system = systemPrompt({ tools, today: `${today.date} (${["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][today.weekday]})`, time: new Date(now).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: z }), grounding })
  let messages = buildMessages({ system, history, user: text })
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await generate(messages, { onToken, max: 120 })
    const parsed = parseModelOutput(out, tools)
    if (parsed.ok && parsed.reply) return { reply: parsed.reply, help: grounding.length ? (await findHelp(text)).slice(0, 1) : undefined, raw: out }
    if (parsed.ok && parsed.call) return { ...(await act(parsed.call)), raw: out }
    messages = [...messages, { role: "assistant", content: out }, { role: "user", content: `That wasn't valid: ${parsed.error} Answer again with ONE line of JSON only.` }]
  }
  return { reply: CANT }
}
