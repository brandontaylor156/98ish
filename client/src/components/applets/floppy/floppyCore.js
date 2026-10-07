// Floppy's brain, the pure part (no DOM, no models): the tool list built from 98ish's own
// registries, the prompt, a forgiving parser for the model's JSON, the rule-based fallback
// that works with no model at all, the when-parser ("tomorrow at 7pm"), the confirm rule
// and retrieval ranking. floppyTools.js runs the tools; brain.js runs the model in a worker.
// Tested in floppy.test.js.

import { fold, prepare, scoreEntry, tokenize } from "../../../utils/searchCore.js"

// ---- the tools ----
// side: true = it sends or changes something, so the person confirms it first

export const PICKLEBALL_MODES = ["quick", "practice", "park", "real", "online", "tour"]

// registry = { programs: [names], venues: [{ id, name }], buddies: [names] }
export const buildTools = (registry = {}) => {
  const programs = (registry.programs || []).slice().sort()
  const venues = (registry.venues || []).map((v) => v.id)
  return [
    { name: "open_program", side: false, description: "Open a program by its exact name.", parameters: { type: "object", properties: { name: { type: "string", enum: programs } }, required: ["name"] } },
    { name: "search", side: false, description: "Search files, programs, help, contacts and events.", parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "open_help", side: false, description: "Open the 98ish Help page about a subject.", parameters: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"] } },
    { name: "create_reminder", side: true, description: "Remind the person about something at a day and time.", parameters: { type: "object", properties: { text: { type: "string" }, date: { type: "string", description: "YYYY-MM-DD, today or tomorrow" }, time: { type: "string", description: "HH:MM, 24-hour" } }, required: ["text"] } },
    { name: "create_event", side: true, description: "Put an event on the calendar.", parameters: { type: "object", properties: { title: { type: "string" }, date: { type: "string" }, time: { type: "string" }, minutes: { type: "number" } }, required: ["title", "date"] } },
    { name: "create_task", side: true, description: "Add a to-do to Tasks.", parameters: { type: "object", properties: { title: { type: "string" }, date: { type: "string" } }, required: ["title"] } },
    { name: "create_note", side: true, description: "Make a new note in Notes.", parameters: { type: "object", properties: { title: { type: "string" }, body: { type: "string" } }, required: ["title"] } },
    { name: "send_im", side: true, description: "Send an instant message to a buddy.", parameters: { type: "object", properties: { to: { type: "string", enum: registry.buddies?.length ? registry.buddies : undefined }, text: { type: "string" } }, required: ["to", "text"] } },
    { name: "set_dnd", side: true, description: "Turn Do Not Disturb on (for some minutes, or until turned off) or off.", parameters: { type: "object", properties: { on: { type: "boolean" }, minutes: { type: "number" } }, required: ["on"] } },
    { name: "pickleball", side: false, description: "Open Pickleball 98 in a mode: quick (match), practice, park (My Park, optionally at a venue), real (Real Games), online, tour.", parameters: { type: "object", properties: { mode: { type: "string", enum: PICKLEBALL_MODES }, venue: { type: "string", enum: venues.length ? venues : undefined } }, required: ["mode"] } },
    { name: "play_music", side: false, description: "Play songs in Music 98 (optionally one matching a name).", parameters: { type: "object", properties: { song: { type: "string" } }, required: [] } },
    { name: "watch_together", side: false, description: "Start Watch Together with a YouTube link, optionally with a buddy.", parameters: { type: "object", properties: { url: { type: "string" }, with: { type: "string" } }, required: ["url"] } },
    { name: "open_file", side: false, description: "Open a file from the drive by its name.", parameters: { type: "object", properties: { name: { type: "string" } }, required: ["name"] } },
    { name: "send_picture", side: true, description: "Send the picture in an open window (Paint) to a buddy in 98 Messenger.", parameters: { type: "object", properties: { to: { type: "string", enum: registry.buddies?.length ? registry.buddies : undefined }, app: { type: "string" } }, required: ["to"] } },
  ]
}

export const toolByName = (tools, name) => tools.find((t) => t.name === name) || null
export const needsConfirm = (tools, call) => !!toolByName(tools, call?.tool)?.side

// ---- the prompt ----

const shortSchema = (t) => {
  const props = Object.entries(t.parameters.properties).map(([k, v]) => {
    const req = t.parameters.required.includes(k) ? "" : "?"
    const kind = v.enum ? (v.enum.length > 12 ? `${v.type} (e.g. ${v.enum.slice(0, 12).join(", ")}...)` : v.enum.join("|")) : v.type
    return `${k}${req}: ${kind}`
  })
  return `- ${t.name}(${props.join(", ")}): ${t.description}`
}

export const systemPrompt = ({ tools, today, time, grounding = [] }) =>
  [
    "You are Floppy, the cheerful floppy-disk helper of 98ish, a Windows 98-style computer.",
    `Today is ${today}, the time is ${time}.`,
    "Answer with ONE line of JSON and nothing else:",
    '{"tool":"<name>","args":{...}} to do something, or {"reply":"<short friendly answer>"} to just talk.',
    "Tools:",
    ...tools.map(shortSchema),
    "Use exact program names. Dates as YYYY-MM-DD, times as HH:MM (24-hour). Keep replies under 40 words.",
    ...(grounding.length ? ["Help pages that may answer the question (mention the title):", ...grounding.map((g) => `* ${g.title}: ${g.text}`)] : []),
  ].join("\n")

export const FEW_SHOT = [
  ["open paint", '{"tool":"open_program","args":{"name":"Paint"}}'],
  ["remind me to call mom tomorrow at 6pm", '{"tool":"create_reminder","args":{"text":"Call mom","date":"tomorrow","time":"18:00"}}'],
  ["who are you?", '{"reply":"I\'m Floppy! I hold 1.44 MB of helpful tips and I can open programs, make reminders and more."}'],
]

// ---- parsing what the model wrote ----

// the first balanced {...} in the text (inside ```json fences or not)
export const firstObject = (text) => {
  const s = String(text || "")
  const start = s.indexOf("{")
  if (start < 0) return null
  let depth = 0
  let inStr = false
  let q = ""
  for (let i = start; i < s.length; i++) {
    const c = s[i]
    if (inStr) {
      if (c === "\\") i++
      else if (c === q) inStr = false
      continue
    }
    if (c === '"' || c === "'") {
      inStr = true
      q = c
    } else if (c === "{") depth++
    else if (c === "}" && --depth === 0) return s.slice(start, i + 1)
  }
  return depth > 0 ? s.slice(start) + "}".repeat(depth) : null
}

// small repairs for small models: single quotes, trailing commas, bare keys
const repair = (json) =>
  json
    .replace(/,\s*([}\]])/g, "$1")
    .replace(/([{,]\s*)([A-Za-z_][\w]*)\s*:/g, '$1"$2":')
    .replace(/'([^'"\\]*)'/g, '"$1"')

export const tryJson = (s) => {
  try {
    return JSON.parse(s)
  } catch {
    try {
      return JSON.parse(repair(s))
    } catch {
      return undefined
    }
  }
}

const coerce = (value, schema) => {
  if (value === undefined || value === null) return value
  if (schema.type === "number") return Number.isFinite(Number(value)) ? Number(value) : undefined
  if (schema.type === "boolean") return typeof value === "boolean" ? value : /^(true|yes|on|1)$/i.test(String(value)) ? true : /^(false|no|off|0)$/i.test(String(value)) ? false : undefined
  return String(value)
}

// the closest allowed value ("paint" -> "Paint", "pickle ball 98" -> "Pickleball 98")
export const closestOf = (value, allowed) => {
  if (!allowed?.length || value === undefined) return value
  const f = fold(String(value))
  const exact = allowed.find((a) => fold(a) === f)
  if (exact) return exact
  const squash = (x) => fold(x).replace(/[^a-z0-9]/g, "")
  const sq = squash(value)
  return allowed.find((a) => squash(a) === sq) || allowed.find((a) => squash(a).startsWith(sq) && sq.length >= 3) || allowed.find((a) => sq.length >= 4 && squash(a).includes(sq)) || null
}

// -> { ok: true, call: { tool, args } } | { ok: true, reply } | { ok: false, error }
export const parseModelOutput = (text, tools) => {
  const raw = firstObject(text)
  if (!raw) {
    const plain = String(text || "").trim()
    return plain && !plain.includes("{") ? { ok: true, reply: plain.slice(0, 400) } : { ok: false, error: "No JSON in the answer." }
  }
  const obj = tryJson(raw)
  if (!obj || typeof obj !== "object") return { ok: false, error: "The JSON couldn't be read." }
  if (typeof obj.reply === "string" && !obj.tool) return { ok: true, reply: obj.reply.trim().slice(0, 400) }
  const name = obj.tool || obj.name || obj.function
  const tool = toolByName(tools, name)
  if (!tool) return { ok: false, error: `There's no tool called ${name || "(none)"}.` }
  const given = obj.args || obj.arguments || obj.parameters || {}
  const args = {}
  for (const [k, schema] of Object.entries(tool.parameters.properties)) {
    let v = coerce(given[k], schema)
    if (v !== undefined && schema.enum) {
      const c = closestOf(v, schema.enum)
      if (!c) return { ok: false, error: `${k} must be one of the allowed values, not "${v}".` }
      v = c
    }
    if (v !== undefined && v !== "") args[k] = v
  }
  for (const k of tool.parameters.required) if (args[k] === undefined) return { ok: false, error: `${tool.name} needs ${k}.` }
  return { ok: true, call: { tool: tool.name, args } }
}

// ---- days and times ----

const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
const pad = (n) => String(n).padStart(2, "0")

// "YYYY-MM-DD" and weekday of an instant in a time zone
export const dayIn = (t, zone = "UTC") => {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(new Date(t))
  const g = (type) => p.find((x) => x.type === type)?.value
  return { date: `${g("year")}-${g("month")}-${g("day")}`, weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday")) }
}
const clockIn = (t, zone = "UTC") => {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: zone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t))
  return `${p.find((x) => x.type === "hour").value}:${p.find((x) => x.type === "minute").value}`
}
export const addDaysTo = (date, n) => {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

// When in a sentence -> { date: "YYYY-MM-DD" | null, time: "HH:MM" | "", rest: the sentence without it }
export const parseWhen = (text, { now = Date.now(), zone = "UTC" } = {}) => {
  let s = ` ${String(text || "")} `
  const today = dayIn(now, zone)
  let date = null
  let time = ""
  const cut = (re) => {
    const m = re.exec(s)
    if (m) s = s.replace(m[0], " ")
    return m
  }
  // in 20 minutes / in 2 hours
  let m = cut(/\bin\s+(\d+|an?|one|two|three)\s*(minutes?|mins?|hours?|hrs?)\b/i)
  if (m) {
    const n = { a: 1, an: 1, one: 1, two: 2, three: 3 }[m[1].toLowerCase()] ?? Number(m[1])
    const at = now + n * (/^h/i.test(m[2]) ? 3600_000 : 60_000)
    return { date: dayIn(at, zone).date, time: clockIn(at, zone), rest: s.replace(/\s+/g, " ").trim() }
  }
  if (cut(/\btoday\b/i)) date = today.date
  else if (cut(/\btonight\b/i)) {
    date = today.date
    time = "20:00"
  } else if (cut(/\b(day after tomorrow)\b/i)) date = addDaysTo(today.date, 2)
  else if (cut(/\btomorrow\b/i)) date = addDaysTo(today.date, 1)
  else if ((m = cut(/\b(?:on\s+|this\s+|next\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday|sun|mon|tues?|wed|thu(?:rs)?|fri|sat)\b/i))) {
    const name = m[1].toLowerCase()
    const target = WEEKDAYS.findIndex((w) => w.startsWith(name.slice(0, 3)))
    // "friday" = the coming Friday (a week from today if today is Friday)
    const diff = (target - today.weekday + 7) % 7 || 7
    date = addDaysTo(today.date, diff)
  } else if ((m = cut(/\b(\d{4})-(\d{2})-(\d{2})\b/))) date = `${m[1]}-${m[2]}-${m[3]}`
  if ((m = cut(/\bat\s+noon\b|\bnoon\b/i))) time = "12:00"
  else if ((m = cut(/\b(?:in the\s+)?morning\b/i))) time = time || "09:00"
  else if ((m = cut(/\b(?:in the\s+)?(?:afternoon)\b/i))) time = time || "15:00"
  else if ((m = cut(/\b(?:in the\s+)?evening\b/i))) time = time || "19:00"
  if ((m = cut(/\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i))) {
    let h = Number(m[1]) % 12
    if (/p/i.test(m[3])) h += 12
    time = `${pad(h)}:${pad(Number(m[2] || 0))}`
  } else if ((m = cut(/\b(?:at\s+)(\d{1,2})(?::(\d{2}))?\b/i)) || (m = cut(/\b(\d{1,2}):(\d{2})\b/))) {
    let h = Number(m[1])
    // "at 7": an evening hour more likely than 7 in the morning
    if (!m[2] && h >= 1 && h <= 7) h += 12
    if (h < 24) time = `${pad(h)}:${pad(Number(m[2] || 0))}`
  }
  if (time && !date) {
    // a time already gone today means tomorrow
    date = time <= clockIn(now, zone) ? addDaysTo(today.date, 1) : today.date
  }
  return { date, time, rest: s.replace(/\s+/g, " ").trim() }
}

// a date argument from the model ("today", "tomorrow", "2026-10-07") -> "YYYY-MM-DD"
export const resolveDate = (value, { now = Date.now(), zone = "UTC" } = {}) => {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value
  return parseWhen(String(value), { now, zone }).date
}

// ---- the fallback: plain sentences without the model ----

const PROGRAM_ALIASES = {
  pickleball: "Pickleball 98",
  messenger: "98 Messenger",
  aim: "98 Messenger",
  "buddy list": "98 Messenger",
  help: "98ish Help",
  mail: "98ish Mail",
  email: "98ish Mail",
  browser: "Compass",
  internet: "Compass",
  web: "Compass",
  computer: "My Computer",
  files: "My Computer",
  "file explorer": "My Computer",
  dos: "MS-DOS Prompt",
  "command prompt": "MS-DOS Prompt",
  music: "Music 98",
  vb: "Visual Basic 98",
  "visual basic": "Visual Basic 98",
  settings: "Control Panel",
  casino: "Casino 98",
}

export const programFor = (phrase, programs) => {
  const p = fold(String(phrase || "").replace(/^(the|my|a)\s+/i, "").replace(/\s+(app|program|game|please)$/i, "").trim())
  if (!p) return null
  if (PROGRAM_ALIASES[p] && programs.includes(PROGRAM_ALIASES[p])) return PROGRAM_ALIASES[p]
  return closestOf(p, programs)
}

const PB_WORDS = /(pickle\s*ball|pickleball)/i

// -> { tool, args } | { help: query } | null
export const ruleIntent = (input, { programs = [], venues = [], buddies = [], now = Date.now(), zone = "UTC" } = {}) => {
  const text = String(input || "").trim().replace(/[.!?]+$/, "")
  if (!text) return null
  const lower = text.toLowerCase()
  let m

  // Pickleball modes
  const venue = venues.find((v) => lower.includes(fold(v.name).split(" ")[0]) || lower.includes(fold(v.short || v.name)))
  if (/\b(start|begin|do|go to|let'?s)?\s*practice\b/i.test(lower) && (PB_WORDS.test(lower) || /^(start |begin |let'?s )?practice/i.test(lower))) return { tool: "pickleball", args: { mode: "practice" } }
  if (/\bquick match\b/i.test(lower) || (/\bplay\b/.test(lower) && PB_WORDS.test(lower) && !/practice|park|online|real/.test(lower))) return { tool: "pickleball", args: { mode: "quick" } }
  if (/\bmy park\b/i.test(lower) || (venue && /\b(go|walk|take me|park|visit)\b/.test(lower))) return { tool: "pickleball", args: venue ? { mode: "park", venue: venue.id } : { mode: "park" } }
  if (/\breal games\b|\bscore(keeper| my game)\b/i.test(lower)) return { tool: "pickleball", args: { mode: "real" } }

  // Do Not Disturb
  if (/\b(do not disturb|dnd|quiet mode|silence)\b/i.test(lower)) {
    if (/\b(off|stop|end|disable|cancel)\b/.test(lower)) return { tool: "set_dnd", args: { on: false } }
    const mins = /(\d+)\s*(hours?|hrs?|minutes?|mins?)/i.exec(lower)
    return { tool: "set_dnd", args: mins ? { on: true, minutes: Number(mins[1]) * (/^h/i.test(mins[2]) ? 60 : 1) } : { on: true } }
  }

  // reminders, events, tasks, notes
  if ((m = /^(?:please\s+)?remind me(?:\s+to)?\s+(.+)$/i.exec(text)) || (m = /^(?:set|make|add)\s+(?:a\s+)?reminder(?:\s+to)?[:\s]+(.+)$/i.exec(text))) {
    const when = parseWhen(m[1], { now, zone })
    return { tool: "create_reminder", args: { text: cap(when.rest.replace(/^(to|that)\s+/i, "")), date: when.date || dayIn(now, zone).date, time: when.time || "09:00" } }
  }
  if ((m = /^(?:add|put|create|schedule|make)\s+(?:an?\s+)?(?:event|appointment|meeting)?\s*(.+?)\s+(?:to|on|in)\s+(?:my\s+|the\s+)?calendar\b(.*)$/i.exec(text)) || (m = /^schedule\s+(.+)$/i.exec(text))) {
    const when = parseWhen(`${m[1]} ${m[2] || ""}`, { now, zone })
    if (when.date) return { tool: "create_event", args: { title: cap(when.rest), date: when.date, ...(when.time ? { time: when.time } : {}) } }
  }
  if ((m = /^(?:add|create|new|make)\s+(?:a\s+)?(?:task|to-?do)[:\s]+(.+)$/i.exec(text)) || (m = /^to-?do[:\s]+(.+)$/i.exec(text))) {
    const when = parseWhen(m[1], { now, zone })
    return { tool: "create_task", args: { title: cap(when.rest), ...(when.date ? { date: when.date } : {}) } }
  }
  if ((m = /^(?:new note|make a note|take a note|write down|note)[:\s]+(.+)$/i.exec(text))) {
    const body = m[1].trim()
    const [first, ...more] = body.split(/[,:]\s+/)
    return { tool: "create_note", args: { title: cap(first.slice(0, 60)), ...(more.length ? { body: more.join(", ") } : {}) } }
  }

  // messages
  if ((m = /^(?:send\s+(?:an?\s+)?(?:im|message)\s+to|message|im|tell|text)\s+(.+?)\s*(?:saying|that|:)\s*(.+)$/i.exec(text))) {
    const to = closestOf(m[1].replace(/^(to)\s+/i, ""), buddies) || m[1].trim()
    return { tool: "send_im", args: { to, text: m[2].trim() } }
  }

  // watch together
  if ((m = /\bwatch\b.*?(https?:\/\/\S+)(?:.*?\bwith\s+(\S+))?/i.exec(text))) return { tool: "watch_together", args: { url: m[1], ...(m[2] ? { with: closestOf(m[2], buddies) || m[2] } : {}) } }

  // music
  if ((m = /^play\s+(?:some\s+)?(?:music|songs?|tunes)$/i.exec(text))) return { tool: "play_music", args: {} }
  if ((m = /^play\s+(.+?)(?:\s+(?:in|on)\s+music(?:\s+98)?)$/i.exec(text))) return { tool: "play_music", args: { song: m[1] } }

  // help questions
  if ((m = /^(?:how\s+(?:do|can|should)\s+i|how\s+to|what(?:'s| is| are)|where(?:'s| is)|why|can i|help(?:\s+me)?(?:\s+with)?)\s+(.+)$/i.exec(text))) return { help: m[1] }

  // search / open file
  if ((m = /^(?:search(?:\s+for)?|find|look\s+for|look\s+up)\s+(.+)$/i.exec(text))) return { tool: "search", args: { query: m[1] } }
  if ((m = /^open\s+(?:the\s+)?(?:file|document)\s+(.+)$/i.exec(text))) return { tool: "open_file", args: { name: m[1] } }

  // open a program
  if ((m = /^(?:open|launch|start|run|show(?: me)?|go to)\s+(.+)$/i.exec(text))) {
    if (PB_WORDS.test(m[1])) return { tool: "open_program", args: { name: "Pickleball 98" } }
    const name = programFor(m[1], programs)
    if (name) return { tool: "open_program", args: { name } }
    return { tool: "search", args: { query: m[1] } }
  }
  // just a program's name
  const bare = programFor(text, programs)
  if (bare && text.split(/\s+/).length <= 3) return { tool: "open_program", args: { name: bare } }
  return null
}

const cap = (s) => {
  const t = String(s || "").trim().replace(/\s+/g, " ")
  return t ? t[0].toUpperCase() + t.slice(1) : t
}

// ---- what a call does, in words (the confirm dialog and the transcript) ----

const prettyDate = (date, time) => {
  if (!date) return ""
  const d = new Date(`${date}T12:00:00Z`)
  const day = d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
  if (!time) return day
  const [h, mm] = time.split(":").map(Number)
  return `${day}, ${((h + 11) % 12) + 1}:${pad(mm)} ${h < 12 ? "AM" : "PM"}`
}

export const describeCall = (call) => {
  const a = call?.args || {}
  switch (call?.tool) {
    case "open_program":
      return `Open ${a.name}`
    case "search":
      return `Search for "${a.query}"`
    case "open_help":
      return `Open Help about ${a.subject}`
    case "create_reminder":
      return `Remind you: "${a.text}" on ${prettyDate(a.date, a.time)}`
    case "create_event":
      return `Add "${a.title}" to your calendar on ${prettyDate(a.date, a.time)}`
    case "create_task":
      return `Add the task "${a.title}"${a.date ? ` due ${prettyDate(a.date)}` : ""}`
    case "create_note":
      return `Make a note: "${a.title}"`
    case "send_im":
      return `Send ${a.to} the message "${a.text}"`
    case "set_dnd":
      return a.on ? `Turn on Do Not Disturb${a.minutes ? ` for ${a.minutes} minutes` : ""}` : "Turn off Do Not Disturb"
    case "pickleball":
      return `Open Pickleball 98: ${{ quick: "Quick Match", practice: "Practice", park: "My Park", real: "Real Games", online: "Play Online", tour: "World Tour" }[a.mode] || a.mode}${a.venue ? ` at ${a.venue}` : ""}`
    case "play_music":
      return a.song ? `Play "${a.song}" in Music 98` : "Play music in Music 98"
    case "watch_together":
      return `Watch Together${a.with ? ` with ${a.with}` : ""}`
    case "open_file":
      return `Open the file "${a.name}"`
    case "send_picture":
      return `Send ${a.app || "Paint"}'s picture to ${a.to}`
    default:
      return call?.tool || "Do that"
  }
}

// ---- retrieval: which help pages answer a question ----

// docs: [{ id, title, keywords, summary, body }]; vectors (optional): { id: Float32Array }, qvec
export const rankHelp = (query, docs, { vectors = null, qvec = null, limit = 3 } = {}) => {
  // any word may match (a question has filler words): the sum of each word's best match
  const tokens = tokenize(helpQuery(query))
  const kw = new Map()
  for (const d of docs) {
    const entry = d._search || (d._search = prepare({ title: d.title, keywords: d.keywords || [], detail: d.summary || "", body: d.body || "" }))
    let score = 0
    for (const t of tokens) score += scoreEntry(entry, [t], t)
    if (score > 0) kw.set(d.id, score)
  }
  const top = Math.max(1, ...kw.values())
  const scored = docs.map((d) => {
    const k = (kw.get(d.id) || 0) / top
    const v = vectors && qvec && vectors[d.id] ? cosine(vectors[d.id], qvec) : null
    return { d, s: v === null ? k : 0.65 * v + 0.35 * k }
  })
  return scored
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .slice(0, limit)
    .map((x) => x.d)
}

export const cosine = (a, b) => {
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0
}

// a few words from the question are enough for keyword ranking
export const helpQuery = (q) => tokenize(q).filter((w) => !/^(i|a|an|the|to|my|do|can|how|what|is|in|on|of)$/.test(w)).join(" ") || q

// ---- routing: which tool (small models can't pick from 13 tools in one prompt) ----
// The embedding model compares the question with these examples; the language model then only
// fills in one tool's arguments (a tiny prompt: fast on a phone's CPU, and far more accurate).

export const TOOL_EXAMPLES = {
  open_program: ["open paint", "launch the calculator", "I want to draw something", "show me my computer", "let me write a document", "start minesweeper", "I'd like to browse the web", "open my email"],
  search: ["find my beach photos", "search for the grocery list", "where is my resume", "look for anything about tacos"],
  open_help: ["how do I change the wallpaper", "how can I lock my computer", "what does do not disturb do", "explain how file sync works"],
  create_reminder: ["remind me to call mom at 6", "don't let me forget the dentist tomorrow", "ping me in 20 minutes to check the oven", "remember to buy paddles friday"],
  create_event: ["put dinner with Sam on my calendar saturday at 7", "schedule a meeting monday at 10", "add the tournament to my calendar on the 12th"],
  create_task: ["add buy milk to my to-do list", "new task: fix the bike", "I need to do laundry this week, add it as a task"],
  create_note: ["jot down that I need new paddles", "take a note: gate code is 4512", "write this down: book ideas", "make a note about the trip"],
  send_im: ["tell Sam I'm running late", "message Mia that dinner is ready", "send Jordan a message saying good game", "let Alex know I'm on my way"],
  set_dnd: ["turn on do not disturb", "silence notifications for an hour", "don't bother me for a while", "turn quiet mode off"],
  pickleball: ["start pickleball practice", "let's play a quick match", "take me to the park at Los Cab", "score my real pickleball game", "play pickleball online"],
  play_music: ["play some music", "put on my songs", "play that song I like", "I want to listen to music"],
  watch_together: ["watch this youtube video with Sam", "let's watch a video together"],
  send_picture: ["send my paint picture to Sam", "send this drawing to Mia", "share what I drew with Alex in messenger"],
  open_file: ["open the file budget.txt", "open my resume document", "show the photo called beach"],
  operate: ["click the send button", "press the start button in this window", "in this game tap new game", "type my name into the box", "fill in this form for me", "choose large in the list here", "turn on the second checkbox"],
  chat: ["who are you", "who made you", "tell me a joke", "how are you today", "what can you do", "thanks Floppy", "what is the meaning of life"],
}

// -> { tool, score, margin } (tool "chat" = just talk)
export const routeByVectors = (qvec, exampleVecs) => {
  const best = {}
  for (const [tool, vecs] of Object.entries(exampleVecs)) best[tool] = Math.max(...vecs.map((v) => cosine(v, qvec)))
  const ranked = Object.entries(best).sort((a, b) => b[1] - a[1])
  return { tool: ranked[0][0], score: ranked[0][1], margin: ranked[0][1] - (ranked[1]?.[1] ?? 0), ranked }
}

// Once the tool is known, most arguments come out of the sentence reliably without the model
// (a 0.5B model invents details: it copied the example's text into a note). -> args | null
const stripLead = (s, re) => s.replace(re, "").replace(/^(that|to|about)\s+/i, "").trim()
export const fillSlots = (toolName, input, { programs = [], venues = [], buddies = [], now = Date.now(), zone = "UTC" } = {}) => {
  const text = String(input || "").trim().replace(/[.!?]+$/, "")
  const lower = text.toLowerCase()
  switch (toolName) {
    case "pickleball": {
      const venue = venues.find((v) => lower.includes(fold(v.short || v.name)) || lower.includes(fold(v.name).split(" ")[0]))
      const mode = /practi|drill|lesson|ball machine/.test(lower) ? "practice" : /park|walk|venue|court/.test(lower) || venue ? "park" : /real|score|my game|ladder|session/.test(lower) ? "real" : /online|friend/.test(lower) ? "online" : /tour/.test(lower) ? "tour" : "quick"
      return { mode, ...(mode === "park" && venue ? { venue: venue.id } : {}) }
    }
    case "create_reminder": {
      const when = parseWhen(text, { now, zone })
      const what = stripLead(when.rest, /^(please\s+)?(remind me|don'?t let me forget|ping me|remember|make sure i|tell me)\b\s*/i)
      return what ? { text: cap(what), date: when.date || dayIn(now, zone).date, time: when.time || "09:00" } : null
    }
    case "create_event": {
      const when = parseWhen(text, { now, zone })
      const what = stripLead(when.rest, /^(please\s+)?(put|add|schedule|book|set up|plan)\b\s*/i).replace(/\s+(on|to|in)\s+(my|the)\s+calendar\b/i, "")
      return what && when.date ? { title: cap(what), date: when.date, ...(when.time ? { time: when.time } : {}) } : null
    }
    case "create_task": {
      const when = parseWhen(text, { now, zone })
      const what = stripLead(when.rest, /^(please\s+)?(add|new task:?|i need to|i have to|put)\b\s*/i).replace(/\s+(to|on)\s+(my\s+)?(to-?do( list)?|tasks?|list)\b.*$/i, "").replace(/,?\s*add it as a task$/i, "")
      return what ? { title: cap(what), ...(when.date ? { date: when.date } : {}) } : null
    }
    case "create_note": {
      const what = stripLead(text, /^(please\s+)?(can you\s+)?(jot down|write (this )?down|take a note|make a note|note( down)?|remember)\b:?\s*/i)
      if (!what) return null
      const [first, ...more] = what.split(/:\s+/)
      return { title: cap(first.slice(0, 60)), ...(more.length ? { body: more.join(": ") } : first.length > 60 ? { body: what } : {}) }
    }
    case "send_im": {
      const lead = "^(?:please\\s+)?(?:tell|message|text|let|send|ping|ask)\\s+"
      const tail = "\\s*(?:know\\s+)?(?:that\\s+|saying\\s+|:\\s*|a message saying\\s+)?(.+)$"
      // known buddies first, longest name first ("Jordan Lee" before "Jordan")
      for (const b of [...buddies].sort((x, y) => y.length - x.length)) {
        const mb = new RegExp(`${lead}(${b.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})\\b${tail}`, "i").exec(text)
        if (mb) return { to: b, text: mb[2].replace(/^(that|saying)\s+/i, "").trim() }
      }
      const m = /^(?:please\s+)?(?:tell|message|text|let|send|ping|ask)\s+(\w[\w ]*?)\s+(?:know\s+)?(?:that\s+|saying\s+|:\s*|a message saying\s+)?(.+)$/i.exec(text)
      if (!m) return null
      const to = closestOf(m[1], buddies) || m[1].trim()
      return { to, text: m[2].replace(/^(that|saying)\s+/i, "").trim() }
    }
    case "set_dnd": {
      const off = /\b(off|stop|end|disable|cancel)\b/.test(lower)
      const mins = /(\d+|an?|one)\s*(hours?|hrs?|minutes?|mins?)/i.exec(lower)
      const n = mins ? ({ a: 1, an: 1, one: 1 }[mins[1]] ?? Number(mins[1])) * (/^h/i.test(mins[2]) ? 60 : 1) : null
      return off ? { on: false } : n ? { on: true, minutes: n } : { on: true }
    }
    case "play_music": {
      const m = /play\s+(?!some|music|songs?|my songs)(.+?)(?:\s+(?:in|on)\s+music.*)?$/i.exec(text)
      return m ? { song: m[1] } : {}
    }
    case "watch_together": {
      const url = /(https?:\/\/\S+)/.exec(text)?.[1]
      if (!url) return null
      const w = /\bwith\s+(\S+)/i.exec(text)?.[1]
      return { url, ...(w ? { with: closestOf(w, buddies) || w } : {}) }
    }
    case "search":
      return { query: stripLead(text, /^(please\s+)?(search( for)?|find( me)?|look( for| up)?|where('s| is| are)( my)?)\b\s*/i) || text }
    case "open_help":
      return { subject: text }
    case "open_program": {
      const name = programFor(text.replace(/^.*\b(open|launch|start|run|show me|use)\s+/i, ""), programs)
      return name ? { name } : null
    }
    case "open_file": {
      const m = /(?:open|show)\s+(?:the\s+)?(?:file|document|photo|picture)?\s*(?:called\s+)?(.+)$/i.exec(text)
      return m ? { name: m[1].trim() } : null
    }
    default:
      return null
  }
}

// small talk a 0.5B model fumbles: Floppy's own answers
export const cannedReply = (input) => {
  const t = fold(String(input || ""))
  if (/\b(who|what) are you\b|your name/.test(t)) return "I'm Floppy, the 98ish helper! I hold 1.44 MB of tips, and I can open programs, make reminders and notes, send IMs and find help pages."
  if (/who (made|built|created) you/.test(t)) return "I was put together for 98ish, a Windows 98-style computer for friends. My brain is a small open AI model running right on this device."
  if (/what can you do|help me|what do you do/.test(t)) return "Try: \"open Paint\", \"remind me to stretch at 7\", \"jot down that I need new paddles\", \"tell Sam I'm on my way\", \"start pickleball practice\", or ask how to do something."
  if (/\b(thanks|thank you|thx)\b/.test(t)) return "Any time! That's what floppies are for."
  if (/\bjoke\b/.test(t)) return "Why did the floppy disk go to therapy? It had too many bad sectors."
  if (/^(hi|hello|hey|yo)\b/.test(t)) return "Hi there! What can I do for you?"
  if (/how are you/.test(t)) return "Spinning along at 300 RPM, thanks for asking!"
  return null
}

// a few words about each argument for the slot-filling prompt
const argHint = (k, v) => (v.enum ? `${k}: one of ${v.enum.length > 40 ? v.enum.slice(0, 40).join(", ") + ", ..." : v.enum.join(", ")}` : `${k}: ${v.type}${v.description ? ` (${v.description})` : ""}`)

export const SLOT_EXAMPLES = {
  open_program: ["I want to draw", { name: "Paint" }],
  search: ["find my beach photos", { query: "beach photos" }],
  open_help: ["how do I change the wallpaper", { subject: "change the wallpaper" }],
  create_reminder: ["remind me to call mom tomorrow at 6pm", { text: "Call mom", date: "tomorrow", time: "18:00" }],
  create_event: ["dinner with Sam saturday at 7pm", { title: "Dinner with Sam", date: "saturday", time: "19:00" }],
  create_task: ["add buy milk to my list", { title: "Buy milk" }],
  create_note: ["write down the wifi password", { title: "The wifi password" }],
  send_im: ["tell Sam I'm running late", { to: "Sam", text: "I'm running late" }],
  set_dnd: ["silence everything for an hour", { on: true, minutes: 60 }],
  pickleball: ["let's practice pickleball", { mode: "practice" }],
  play_music: ["play some music", {}],
  watch_together: ["watch https://youtu.be/abcdefghijk with Mia", { url: "https://youtu.be/abcdefghijk", with: "Mia" }],
  open_file: ["open budget.txt", { name: "budget.txt" }],
  send_picture: ["send my drawing to Sam", { to: "Sam", app: "Paint" }],
}

// the tiny prompt that fills one tool's arguments
// a long list of allowed values (every program) cut to the ones the question is likely about
export const likelyValues = (values, user, max = 24) => {
  if (values.length <= max) return values
  const words = tokenize(user).filter((w) => w.length >= 3)
  const score = (v) => {
    const f = fold(v)
    return words.reduce((s, w) => s + (f.includes(w) ? 3 : f.split(/[^a-z0-9]+/).some((x) => x.startsWith(w.slice(0, 4))) ? 1 : 0), 0)
  }
  const hinted = programFor(user.replace(/^.*\b(open|launch|start|play|show)\s+/i, ""), values)
  const ranked = values.map((v) => [v, score(v)]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]).map(([v]) => v)
  const common = ["Paint", "Notepad", "My Computer", "Compass", "Calculator", "Minesweeper", "Solitaire", "98 Messenger", "Music 98", "Photos", "Calendar", "Notes", "Pickleball 98", "WordPad", "Camera"]
  return [...new Set([hinted, ...ranked, ...common.filter((c) => values.includes(c)), ...values].filter(Boolean))].slice(0, max)
}

export const slotMessages = (tool, user, { today, time }) => {
  const [ex, exArgs] = SLOT_EXAMPLES[tool.name] || ["", {}]
  const props = Object.entries(tool.parameters.properties).map(([k, v]) => [k, v.enum ? { ...v, enum: likelyValues(v.enum, user) } : v])
  return [
    { role: "system", content: `Extract the arguments for "${tool.name}" (${tool.description}) as one line of JSON. Today is ${today}, it's ${time}.\nArguments:\n${props.map(([k, v]) => `- ${argHint(k, v)}${tool.parameters.required.includes(k) ? " (required)" : ""}`).join("\n")}` },
    { role: "user", content: ex },
    { role: "assistant", content: JSON.stringify(exArgs) },
    { role: "user", content: String(user).slice(0, 300) },
  ]
}
// the model's arguments -> a parsed call (same checks as a full tool call)
export const parseSlots = (text, tool, tools) => {
  const raw = String(text || "")
  const obj = raw.includes('"tool"') ? raw : `{"tool":"${tool.name}","args":${raw.slice(raw.indexOf("{")) || "{}"}}`
  return parseModelOutput(obj, tools)
}

// a short chat answer (no tools): who Floppy is, small talk, or a help page in words
export const chatMessages = (user, { grounding = [] } = {}) => [
  { role: "system", content: `You are Floppy, the cheerful floppy-disk helper of 98ish, a Windows 98-style computer. Answer in one or two short, friendly sentences.${grounding.length ? `\nUseful help pages:\n${grounding.map((g) => `* ${g.title}: ${g.text}`).join("\n")}` : ""}` },
  { role: "user", content: String(user).slice(0, 300) },
]

// ---- the model ----

export const MODELS = {
  // WebGPU (iPhone with iOS 26, desktop Chrome/Edge/Safari): the better small model
  webgpu: { id: "onnx-community/Qwen3-0.6B-ONNX", dtype: "q4f16", device: "webgpu", mb: 570, name: "Qwen3 0.6B", license: "Apache-2.0", template: { enable_thinking: false } },
  // no WebGPU: an 8-bit model the CPU can run
  wasm: { id: "onnx-community/Qwen2.5-0.5B-Instruct", dtype: "q8", device: "wasm", mb: 512, name: "Qwen2.5 0.5B Instruct", license: "Apache-2.0", template: {} },
}
export const EMBEDDER = { id: "Xenova/all-MiniLM-L6-v2", dtype: "q8", mb: 23 }

// the conversation the model sees: system + a few examples + the last turns (kept short)
export const buildMessages = ({ system, history = [], user, maxTurns = 4 }) => [
  { role: "system", content: system },
  ...FEW_SHOT.flatMap(([u, a]) => [
    { role: "user", content: u },
    { role: "assistant", content: a },
  ]),
  ...history.slice(-maxTurns * 2),
  { role: "user", content: String(user).slice(0, 500) },
]
