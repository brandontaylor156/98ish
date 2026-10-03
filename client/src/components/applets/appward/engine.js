// Appward 98's record engine. Pure functions over a workspace object (no React, no
// storage), so Node tests can drive it. Every app, built in or made with App Creator, is a
// schema; records are plain objects in ws.records[appId][id]. Records point at each other
// two ways: link fields in a schema ("Company:@companies") and free links between any two
// records (ws.links, shown as chips). Deleting a record cleans up both.
//
// Functions that change the workspace mutate it, bump ws.rev and return { ok, ... } or
// { ok: false, error | errors }.

import { APPS, CATEGORIES, CUSTOM_CATEGORY, FIELD_TYPES } from "./catalog.js"

export const VERSION = 2
const FIRST_ID = 100
const MAX_NOTIFICATIONS = 200
const LIMITS = { text: 200, long: 5000, rich: 40000 }

// ---- schemas ----

// "Duration (min)" -> "durationMin", "Est. Cost" -> "estCost"
export const keyOf = (label) => {
  const words = String(label).replace(/\(%\)/g, "").replace(/[^a-zA-Z0-9 ]/g, " ").trim().split(/\s+/).filter(Boolean)
  return words.map((w, i) => (i ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join("") || "field"
}

// one field spec ("Status=New|Open", "Company:@companies", "Due:date", "Name*") -> a field
export const parseField = (spec) => {
  if (spec && typeof spec === "object") return { ...spec, key: spec.key || keyOf(spec.label) }
  let s = String(spec)
  const required = s.includes("*")
  s = s.replace(/\*/g, "")
  let label = s
  let type = "text"
  let options
  let app
  const eq = s.indexOf("=")
  const colon = s.indexOf(":")
  if (eq > 0 && (colon < 0 || eq < colon)) {
    label = s.slice(0, eq)
    type = "select"
    options = s.slice(eq + 1).split("|")
  } else if (colon > 0) {
    label = s.slice(0, colon)
    const t = s.slice(colon + 1)
    if (t.startsWith("@")) {
      type = "ref"
      app = t.slice(1)
    } else type = t
  }
  return { key: keyOf(label), label, type, required, ...(options ? { options } : {}), ...(app ? { app } : {}) }
}

const LISTABLE = new Set(["text", "number", "money", "date", "time", "check", "select", "user", "ref"])

// the field that says where a record stands (Status, Stage, Result), if there is one
export const statusFieldOf = (app) => app.fields.find((f) => f.key === app.board) || app.fields.find((f) => f.type === "select" && ["status", "stage", "result"].includes(f.key)) || null

export const expandApp = (spec) => {
  const fields = (spec.fields || []).map(parseField)
  const app = { ...spec, fields, titleKey: fields[0]?.key || null }
  // a list shows the first few fields, and always the status
  const listKeys = fields.filter((f) => LISTABLE.has(f.type)).slice(0, 5).map((f) => f.key)
  const status = statusFieldOf(app)
  if (status && !listKeys.includes(status.key)) listKeys.splice(Math.min(listKeys.length, 4), 1, status.key)
  return { ...app, listKeys }
}

export const BUILTIN = APPS.map(expandApp)
const BUILTIN_BY_ID = Object.fromEntries(BUILTIN.map((a) => [a.id, a]))

export const allApps = (ws) => [...BUILTIN, ...(ws?.customApps || [])]
export const launcherApps = (ws) => allApps(ws).filter((a) => !a.hidden)
export const appById = (ws, id) => BUILTIN_BY_ID[id] || ws?.customApps?.find((a) => a.id === id) || null
export const fieldOf = (app, key) => app?.fields.find((f) => f.key === key) || null
export const categoriesOf = (ws) => {
  const extra = [...new Set((ws?.customApps || []).map((a) => a.cat).filter((c) => !CATEGORIES.includes(c)))]
  return [...CATEGORIES, ...extra]
}

// ---- the workspace ----

export const handleFor = (name) => String(name || "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 16) || "you"

export const emptyWorkspace = ({ company = "Acme Widgets Co.", me = "You", title = "Team Member", users = [] } = {}) => {
  const self = { handle: handleFor(me), name: String(me).slice(0, 40) || "You", title: String(title).slice(0, 40) }
  const others = users.filter((u) => u.handle !== self.handle)
  return {
    v: VERSION,
    company: String(company).slice(0, 60) || "Acme Widgets Co.",
    me: self.handle,
    users: [self, ...others],
    seq: {},
    records: {},
    links: [],
    customApps: [],
    notifications: [],
    reports: [],
    prefs: { tips: true, tipIndex: 0 },
    stats: { opened: [] },
    nseq: 0,
    rev: 0,
  }
}

const touch = (ws) => {
  ws.rev = (ws.rev || 0) + 1
}

export const userOf = (ws, handle) => ws.users.find((u) => u.handle === handle) || null
export const userName = (ws, handle) => userOf(ws, handle)?.name || handle || ""
export const meUser = (ws) => userOf(ws, ws.me)

// ---- refs: "tickets:104" ----

export const refOf = (appId, id) => `${appId}:${id}`
export const parseRef = (ref) => {
  const i = String(ref).lastIndexOf(":")
  return i > 0 ? { app: ref.slice(0, i), id: ref.slice(i + 1) } : null
}
export const recordsOf = (ws, appId) => Object.values(ws.records[appId] || {})
export const getRecord = (ws, appId, id) => ws.records[appId]?.[id] || null
export const getRef = (ws, ref) => {
  const r = parseRef(ref)
  return r ? getRecord(ws, r.app, r.id) : null
}
export const recordNo = (app, id) => `${app?.prefix || "REC"}-${id}`

export const recordTitle = (ws, appId, rec) => {
  const app = appById(ws, appId)
  if (!app || !rec) return ""
  const f = app.fields[0]
  const raw = f ? rec[f.key] : ""
  const text = f && (f.type === "ref" || f.type === "user") ? display(ws, f, raw) : raw
  return String(text ?? "").trim() || recordNo(app, rec.id)
}

// ---- values ----

const DATE = /^\d{4}-\d{2}-\d{2}$/
const TIME = /^\d{2}:\d{2}$/

export const defaultValue = (field) => {
  switch (field.type) {
    case "select":
      return field.options?.[0] ?? ""
    case "check":
      return false
    case "number":
    case "money":
      return null
    case "refs":
    case "bom":
      return []
    default:
      return ""
  }
}

// one raw value from a form -> { value } or { error }
export const cleanValue = (ws, field, raw) => {
  const empty = raw === undefined || raw === null || raw === ""
  switch (field.type) {
    case "text":
    case "long":
    case "rich": {
      const s = String(raw ?? "")
      return { value: (field.type === "text" ? s.trim() : s).slice(0, LIMITS[field.type]) }
    }
    case "number":
    case "money": {
      if (empty) return { value: null }
      const n = Number(raw)
      if (!Number.isFinite(n)) return { error: `${field.label} must be a number.` }
      return { value: field.type === "money" ? Math.round(n * 100) / 100 : n }
    }
    case "date":
      if (empty) return { value: "" }
      return DATE.test(raw) ? { value: raw } : { error: `${field.label} must be a date (YYYY-MM-DD).` }
    case "time":
      if (empty) return { value: "" }
      return TIME.test(raw) ? { value: raw } : { error: `${field.label} must be a time (HH:MM).` }
    case "check":
      return { value: raw === true || raw === "true" || raw === 1 || raw === "on" }
    case "select":
      if (empty) return { value: field.options?.[0] ?? "" }
      return field.options?.includes(raw) ? { value: raw } : { error: `${field.label} must be one of: ${field.options?.join(", ")}.` }
    case "user":
      if (empty) return { value: "" }
      return userOf(ws, raw) ? { value: raw } : { error: `Nobody called "${raw}" works here.` }
    case "ref":
      if (empty) return { value: "" }
      return getRecord(ws, field.app, String(raw)) ? { value: String(raw) } : { error: `${field.label}: that record doesn't exist.` }
    case "refs": {
      const list = Array.isArray(raw) ? raw : []
      return { value: [...new Set(list.filter((r) => getRef(ws, r)))].slice(0, 20) }
    }
    case "bom": {
      const list = Array.isArray(raw) ? raw : []
      const out = []
      for (const line of list) {
        const qty = Number(line?.qty)
        if (!getRecord(ws, "parts", String(line?.part))) return { error: `${field.label}: pick a part on every line.` }
        if (!(qty > 0)) return { error: `${field.label}: quantities must be more than zero.` }
        out.push({ part: String(line.part), qty })
      }
      return { value: out.slice(0, 30) }
    }
    default:
      return { value: String(raw ?? "").slice(0, LIMITS.text) }
  }
}

// a whole form -> { ok, value, errors }. partial: only check the fields given (updates)
export const validate = (ws, app, data, { partial = false } = {}) => {
  const errors = {}
  const value = {}
  for (const field of app.fields) {
    const given = data && Object.prototype.hasOwnProperty.call(data, field.key)
    if (partial && !given) continue
    const out = given ? cleanValue(ws, field, data[field.key]) : { value: defaultValue(field) }
    if (out.error) errors[field.key] = out.error
    else value[field.key] = out.value
    const blank = out.value === "" || out.value === null || out.value === undefined
    if (!out.error && field.required && blank) errors[field.key] = `${field.label} is required.`
  }
  return { ok: Object.keys(errors).length === 0, value, errors }
}

const money = (n) => "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

export const formatDate = (iso) => {
  if (!iso || !DATE.test(iso)) return ""
  const [y, m, d] = iso.split("-")
  return `${m}/${d}/${y}`
}

export const stripHtml = (html) => String(html || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/\s+/g, " ").trim()

// a stored value -> the text a list or report shows
export const display = (ws, field, value) => {
  if (!field) return ""
  switch (field.type) {
    case "money":
      return value === null || value === undefined || value === "" ? "" : money(value)
    case "number":
      return value === null || value === undefined ? "" : String(value)
    case "date":
      return formatDate(value)
    case "check":
      return value ? "Yes" : "No"
    case "user":
      return value ? userName(ws, value) : ""
    case "ref": {
      const rec = value ? getRecord(ws, field.app, value) : null
      return rec ? recordTitle(ws, field.app, rec) : ""
    }
    case "refs":
      return (value || []).map((r) => {
        const p = parseRef(r)
        return p ? recordTitle(ws, p.app, getRecord(ws, p.app, p.id)) : ""
      }).filter(Boolean).join(", ")
    case "bom":
      return (value || []).length ? `${value.length} component${value.length === 1 ? "" : "s"}` : ""
    case "rich":
      return stripHtml(value).slice(0, 120)
    default:
      return String(value ?? "")
  }
}

// ---- notifications ----

export const notify = (ws, { to, text, target = null, from = "", kind = "info" }) => {
  if (!to) return null
  ws.nseq = (ws.nseq || 0) + 1
  const n = { id: ws.nseq, to, from, kind, text: String(text).slice(0, 240), target, time: Date.now(), read: false }
  ws.notifications.push(n)
  if (ws.notifications.length > MAX_NOTIFICATIONS) ws.notifications.splice(0, ws.notifications.length - MAX_NOTIFICATIONS)
  touch(ws)
  return n
}

export const myNotifications = (ws) => ws.notifications.filter((n) => n.to === ws.me).sort((a, b) => b.time - a.time || b.id - a.id)
export const unreadCount = (ws) => ws.notifications.filter((n) => n.to === ws.me && !n.read).length
export const markRead = (ws, id) => {
  const n = ws.notifications.find((x) => x.id === id)
  if (n && !n.read) {
    n.read = true
    touch(ws)
  }
}
export const markAllRead = (ws) => {
  ws.notifications.forEach((n) => n.to === ws.me && (n.read = true))
  touch(ws)
}

// someone picked for a person field (Assignee, Owner...) hears about it
const announceAssignments = (ws, app, rec, before, by) => {
  if (!by) return
  for (const f of app.fields) {
    if (f.type !== "user") continue
    const who = rec[f.key]
    if (!who || who === by || who === before?.[f.key]) continue
    const title = recordTitle(ws, app.id, rec)
    const text = app.id === "shoutouts" && f.key === "to"
      ? `${userName(ws, by)} gave you a shoutout: "${title}"`
      : `${userName(ws, by)} set you as ${f.label} on ${recordNo(app, rec.id)}: ${title}`
    notify(ws, { to: who, from: by, kind: "assign", text, target: { app: app.id, id: rec.id } })
  }
}

// ---- records ----

export const createRecord = (ws, appId, data = {}, { by = ws.me, quiet = false } = {}) => {
  const app = appById(ws, appId)
  if (!app) return { ok: false, error: "No such app." }
  if (app.noRecords) return { ok: false, error: `${app.name} doesn't keep records.` }
  const check = validate(ws, app, data)
  if (!check.ok) return { ok: false, errors: check.errors }
  ws.seq[appId] = Math.max(ws.seq[appId] || FIRST_ID, FIRST_ID) + 1
  const id = String(ws.seq[appId])
  const now = Date.now()
  const record = { id, ...check.value, _c: now, _u: now, _by: by || "" }
  ws.records[appId] = ws.records[appId] || {}
  ws.records[appId][id] = record
  touch(ws)
  if (!quiet) announceAssignments(ws, app, record, null, by)
  return { ok: true, record }
}

export const updateRecord = (ws, appId, id, patch = {}, { by = ws.me, quiet = false } = {}) => {
  const app = appById(ws, appId)
  const record = getRecord(ws, appId, id)
  if (!app || !record) return { ok: false, error: "That record doesn't exist any more." }
  const check = validate(ws, app, patch, { partial: true })
  if (!check.ok) return { ok: false, errors: check.errors }
  const before = { ...record }
  Object.assign(record, check.value, { _u: Date.now() })
  touch(ws)
  if (!quiet) announceAssignments(ws, app, record, before, by)
  return { ok: true, record }
}

// remove a record and everything that pointed at it: free links, link fields in other
// records (cleared), attachments, notifications
export const deleteRecord = (ws, appId, id) => {
  if (!getRecord(ws, appId, id)) return { ok: false, error: "That record doesn't exist any more." }
  // a channel takes its messages with it
  if (appId === "conversations") for (const m of recordsOf(ws, "messages")) if (m.channel === id) deleteRecord(ws, "messages", m.id)
  const ref = refOf(appId, id)
  delete ws.records[appId][id]
  let cleared = 0
  const before = ws.links.length
  ws.links = ws.links.filter(([a, b]) => a !== ref && b !== ref)
  cleared += before - ws.links.length
  for (const app of allApps(ws)) {
    for (const rec of recordsOf(ws, app.id)) {
      for (const f of app.fields) {
        if (f.type === "ref" && f.app === appId && rec[f.key] === id) {
          rec[f.key] = ""
          cleared++
        } else if (f.type === "refs" && rec[f.key]?.includes(ref)) {
          rec[f.key] = rec[f.key].filter((r) => r !== ref)
          cleared++
        } else if (f.type === "bom" && appId === "parts" && rec[f.key]?.some((l) => l.part === id)) {
          rec[f.key] = rec[f.key].filter((l) => l.part !== id)
          cleared++
        }
      }
    }
  }
  ws.notifications = ws.notifications.filter((n) => !(n.target && n.target.app === appId && n.target.id === id))
  touch(ws)
  return { ok: true, cleared }
}

// ---- links: the "smart set" ----

export const link = (ws, a, b) => {
  if (a === b) return { ok: false, error: "A record can't be linked to itself." }
  if (!getRef(ws, a) || !getRef(ws, b)) return { ok: false, error: "That record doesn't exist any more." }
  if (ws.links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) return { ok: false, error: "Those records are already linked." }
  ws.links.push([a, b])
  touch(ws)
  return { ok: true }
}

export const unlink = (ws, a, b) => {
  const n = ws.links.length
  ws.links = ws.links.filter(([x, y]) => !((x === a && y === b) || (x === b && y === a)))
  touch(ws)
  return { ok: ws.links.length < n }
}

export const linksOf = (ws, ref) => ws.links.flatMap(([a, b]) => (a === ref ? [b] : b === ref ? [a] : [])).filter((r) => getRef(ws, r))

// records whose link fields point here (a company's contacts, a project's actions...)
export const relatedTo = (ws, appId, id) => {
  const out = []
  for (const app of allApps(ws)) {
    const fields = app.fields.filter((f) => (f.type === "ref" && f.app === appId) || (f.type === "bom" && appId === "parts"))
    if (!fields.length || app.hidden) continue
    for (const rec of recordsOf(ws, app.id)) {
      for (const f of fields) {
        const hit = f.type === "bom" ? rec[f.key]?.some((l) => l.part === id) : rec[f.key] === id
        if (hit) {
          out.push({ app: app.id, id: rec.id, field: f.label })
          break
        }
      }
    }
  }
  return out
}

// ---- search ----

const TOKEN = /[a-z0-9][a-z0-9'.-]*/g
export const tokens = (text) => (String(text || "").toLowerCase().match(TOKEN) || []).map((t) => t.replace(/[.'-]+$/, "")).filter((t) => t.length >= 2)

const indexCache = new WeakMap()

// token -> Set of refs, rebuilt when the workspace changes
export const searchIndex = (ws) => {
  const cached = indexCache.get(ws)
  if (cached && cached.rev === ws.rev) return cached
  const map = new Map()
  const titles = new Map()
  const add = (t, ref) => {
    if (!map.has(t)) map.set(t, new Set())
    map.get(t).add(ref)
  }
  for (const app of allApps(ws)) {
    for (const rec of recordsOf(ws, app.id)) {
      const ref = refOf(app.id, rec.id)
      const title = recordTitle(ws, app.id, rec)
      titles.set(ref, new Set(tokens(title)))
      add(recordNo(app, rec.id).toLowerCase(), ref)
      for (const f of app.fields) {
        const v = f.type === "rich" ? stripHtml(rec[f.key]) : f.type === "bom" || f.type === "refs" ? "" : display(ws, f, rec[f.key])
        for (const t of tokens(v)) add(t, ref)
      }
    }
  }
  const index = { rev: ws.rev, map, titles, size: map.size }
  indexCache.set(ws, index)
  return index
}

// every record matching all the words (by prefix), best first
export const search = (ws, query, limit = 60) => {
  const words = tokens(query)
  if (!words.length) return []
  const { map, titles } = searchIndex(ws)
  let hits = null
  for (const w of words) {
    const found = new Set()
    for (const [t, refs] of map) if (t.startsWith(w)) refs.forEach((r) => found.add(r))
    hits = hits ? new Set([...hits].filter((r) => found.has(r))) : found
    if (!hits.size) return []
  }
  return [...hits]
    .map((ref) => {
      const { app, id } = parseRef(ref)
      const a = appById(ws, app)
      const rec = getRecord(ws, app, id)
      const t = titles.get(ref) || new Set()
      const score = words.filter((w) => [...t].some((x) => x.startsWith(w))).length * 10 + (a?.view ? 1 : 0)
      return { ref, app, id, appName: a?.name || app, title: recordTitle(ws, app, rec), no: recordNo(a, id), score, rec }
    })
    .filter((h) => h.rec && !appById(ws, h.app)?.hidden)
    .sort((a, b) => b.score - a.score || a.title.localeCompare(b.title))
    .slice(0, limit)
}

// ---- conversations ----

export const mentionsIn = (ws, text) => {
  const found = new Set()
  for (const m of String(text).matchAll(/@([a-z0-9]+)/gi)) {
    const h = m[1].toLowerCase()
    if (userOf(ws, h)) found.add(h)
  }
  return [...found]
}

export const channelMessages = (ws, channelId) => recordsOf(ws, "messages").filter((m) => m.channel === channelId).sort((a, b) => a._c - b._c || Number(a.id) - Number(b.id))

export const postMessage = (ws, channelId, { from = ws.me, text = "", attachments = [] } = {}) => {
  const channel = getRecord(ws, "conversations", channelId)
  if (!channel) return { ok: false, error: "That conversation doesn't exist any more." }
  const body = String(text).trim()
  if (!body && !attachments.length) return { ok: false, error: "Type a message first." }
  const out = createRecord(ws, "messages", { text: body || "(attachment)", channel: channelId, from, attachments }, { by: from, quiet: true })
  if (!out.ok) return out
  const mentioned = mentionsIn(ws, body).filter((h) => h !== from)
  const where = channel.kind === "Direct" ? "a direct message" : `#${channel.channel}`
  for (const h of mentioned) {
    notify(ws, { to: h, from, kind: "mention", text: `${userName(ws, from)} mentioned you in ${where}: "${body.slice(0, 80)}"`, target: { app: "conversations", id: channelId, msg: out.record.id } })
  }
  touch(ws)
  return { ok: true, record: out.record, mentioned }
}

// ---- approvals (Time Off, Expenses, Purchase Requests) ----

export const decide = (ws, appId, id, decision, { by = ws.me } = {}) => {
  const app = appById(ws, appId)
  const rec = getRecord(ws, appId, id)
  if (!app?.approval || !rec) return { ok: false, error: "Nothing to approve." }
  if (!["Approved", "Denied"].includes(decision)) return { ok: false, error: "Approve or deny." }
  if (rec.status !== "Pending") return { ok: false, error: `This request was already ${rec.status.toLowerCase()}.` }
  rec.status = decision
  rec._decidedBy = by
  rec._u = Date.now()
  const who = rec[app.fields.find((f) => f.type === "user")?.key]
  if (who && who !== by) {
    notify(ws, { to: who, from: by, kind: "approval", text: `${userName(ws, by)} ${decision.toLowerCase()} your ${app.name.toLowerCase()} request: ${recordTitle(ws, appId, rec)}`, target: { app: appId, id } })
  }
  touch(ws)
  return { ok: true, record: rec }
}

// ---- manufacturing: work orders consume parts from inventory ----

export const onHand = (ws, partId) => recordsOf(ws, "inventory").filter((r) => r.part === partId).reduce((s, r) => s + (Number(r.onHand) || 0), 0)

// what a work order needs: its part's bill of materials times the quantity
export const materialsFor = (ws, wo) => {
  const part = getRecord(ws, "parts", wo?.part)
  return (part?.components || []).map((l) => ({ part: l.part, qty: l.qty * (Number(wo.qty) || 0), have: onHand(ws, l.part) }))
}

export const issueMaterials = (ws, woId) => {
  const wo = getRecord(ws, "workOrders", woId)
  if (!wo) return { ok: false, error: "That work order doesn't exist any more." }
  if (wo._issued) return { ok: false, error: "Materials were already issued to this work order." }
  if (!getRecord(ws, "parts", wo.part)) return { ok: false, error: "Pick the part this work order builds first." }
  if (!(Number(wo.qty) > 0)) return { ok: false, error: "Set a quantity to build first." }
  const need = materialsFor(ws, wo)
  if (!need.length) return { ok: false, error: "That part has no components in its bill of materials." }
  const short = need.find((n) => n.have < n.qty)
  if (short) {
    const name = recordTitle(ws, "parts", getRecord(ws, "parts", short.part))
    return { ok: false, error: `Not enough ${name} in inventory: need ${short.qty}, have ${short.have}.` }
  }
  for (const n of need) {
    let left = n.qty
    const rows = recordsOf(ws, "inventory").filter((r) => r.part === n.part).sort((a, b) => (b.onHand || 0) - (a.onHand || 0))
    for (const row of rows) {
      const take = Math.min(left, Number(row.onHand) || 0)
      row.onHand = (Number(row.onHand) || 0) - take
      row._u = Date.now()
      left -= take
      if (!left) break
    }
  }
  wo._issued = true
  if (wo.status === "Planned" || wo.status === "Released") wo.status = "In Progress"
  wo._u = Date.now()
  touch(ws)
  return { ok: true, used: need.map(({ part, qty }) => ({ part, qty })) }
}

// a finished work order puts what it built into inventory
export const completeWorkOrder = (ws, woId) => {
  const wo = getRecord(ws, "workOrders", woId)
  if (!wo) return { ok: false, error: "That work order doesn't exist any more." }
  if (wo.status === "Complete") return { ok: false, error: "This work order is already complete." }
  if (!wo._issued) return { ok: false, error: "Issue materials before completing the work order." }
  let row = recordsOf(ws, "inventory").find((r) => r.part === wo.part && (!wo.location || r.location === wo.location))
  if (!row) row = createRecord(ws, "inventory", { part: wo.part, location: wo.location || "", onHand: 0, reorderAt: 0 }, { quiet: true }).record
  row.onHand = (Number(row.onHand) || 0) + (Number(wo.qty) || 0)
  wo.status = "Complete"
  wo._u = Date.now()
  touch(ws)
  return { ok: true, inventory: row }
}

// ---- reports (Report Builder) ----

export const OPERATORS = ["contains", "is", "is not", ">", "<", "is empty", "is not empty"]

const comparable = (field, value) => (["number", "money"].includes(field.type) ? Number(value) : String(value ?? ""))

const matches = (ws, field, rec, { op, value }) => {
  const raw = rec[field.key]
  const shown = display(ws, field, raw).toLowerCase()
  const want = String(value ?? "").toLowerCase()
  switch (op) {
    case "contains":
      return shown.includes(want)
    case "is":
      return shown === want || String(raw ?? "").toLowerCase() === want
    case "is not":
      return !(shown === want || String(raw ?? "").toLowerCase() === want)
    case ">":
    case "<": {
      if (raw === null || raw === "" || raw === undefined) return false
      const a = comparable(field, raw)
      const b = comparable(field, value)
      return op === ">" ? a > b : a < b
    }
    case "is empty":
      return !shown
    case "is not empty":
      return !!shown
    default:
      return true
  }
}

export const runQuery = (ws, { app: appId, columns = [], filters = [], sort = null } = {}) => {
  const app = appById(ws, appId)
  if (!app || app.noRecords) return { ok: false, error: "Pick a table to report on." }
  const cols = (columns.length ? columns : app.listKeys).map((k) => fieldOf(app, k)).filter(Boolean)
  let recs = recordsOf(ws, appId)
  for (const flt of filters) {
    const f = fieldOf(app, flt.field)
    if (f && OPERATORS.includes(flt.op)) recs = recs.filter((r) => matches(ws, f, r, flt))
  }
  const sf = sort && fieldOf(app, sort.field)
  if (sf) {
    const dir = sort.dir === "desc" ? -1 : 1
    recs = [...recs].sort((a, b) => {
      const x = ["number", "money"].includes(sf.type) ? Number(a[sf.key] ?? -Infinity) : display(ws, sf, a[sf.key]).toLowerCase()
      const y = ["number", "money"].includes(sf.type) ? Number(b[sf.key] ?? -Infinity) : display(ws, sf, b[sf.key]).toLowerCase()
      return (x < y ? -1 : x > y ? 1 : 0) * dir || Number(a.id) - Number(b.id)
    })
  } else recs = [...recs].sort((a, b) => Number(a.id) - Number(b.id))
  const totals = {}
  for (const c of cols) if (["number", "money"].includes(c.type)) totals[c.key] = recs.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)
  return {
    ok: true,
    app: appId,
    columns: cols.map((c) => ({ key: c.key, label: c.label, type: c.type })),
    rows: recs.map((r) => ({ id: r.id, cells: cols.map((c) => display(ws, c, r[c.key])) })),
    totals: Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, display(ws, fieldOf(app, k), v)])),
  }
}

// saved report definitions ({ app, columns, filters, sort, title })
export const saveReport = (ws, name, def) => {
  const clean = String(name || "").trim().slice(0, 60)
  if (!clean) return { ok: false, error: "Name the report first." }
  if (!appById(ws, def?.app)) return { ok: false, error: "Pick a table to report on." }
  const existing = ws.reports.find((r) => r.name.toLowerCase() === clean.toLowerCase())
  const report = { id: existing?.id || `r${Date.now().toString(36)}`, name: clean, def: { app: def.app, columns: def.columns || [], filters: def.filters || [], sort: def.sort || null } }
  ws.reports = [...ws.reports.filter((r) => r !== existing), report]
  touch(ws)
  return { ok: true, report }
}

export const deleteReport = (ws, id) => {
  ws.reports = ws.reports.filter((r) => r.id !== id)
  touch(ws)
  return { ok: true }
}

// ---- insights: count (or sum) records grouped by a field ----

export const groupBy = (ws, appId, fieldKey, measureKey = null) => {
  const app = appById(ws, appId)
  const f = fieldOf(app, fieldKey)
  if (!f) return []
  const m = measureKey ? fieldOf(app, measureKey) : null
  const groups = new Map((f.options || []).map((o) => [o, 0]))
  for (const rec of recordsOf(ws, appId)) {
    const label = display(ws, f, rec[f.key]) || "(none)"
    groups.set(label, (groups.get(label) || 0) + (m ? Number(rec[m.key]) || 0 : 1))
  }
  return [...groups].map(([label, value]) => ({ label, value }))
}

// ---- App Creator ----

const VALID_TYPES = new Set(FIELD_TYPES.map((t) => t.id))

export const createCustomApp = (ws, { name, category = CUSTOM_CATEGORY, icon = "star", fields = [] } = {}) => {
  const clean = String(name || "").trim().replace(/\s+/g, " ")
  if (clean.length < 2 || clean.length > 40) return { ok: false, error: "Give your app a name (2 to 40 characters)." }
  if (allApps(ws).some((a) => a.name.toLowerCase() === clean.toLowerCase())) return { ok: false, error: `There's already an app called ${clean}.` }
  if (!fields.length) return { ok: false, error: "Add at least one field." }
  if (fields.length > 20) return { ok: false, error: "An app can have up to 20 fields." }
  const out = []
  for (const [i, f] of fields.entries()) {
    const label = String(f.label || "").trim().slice(0, 40)
    if (!label) return { ok: false, error: `Field ${i + 1} needs a name.` }
    if (!VALID_TYPES.has(f.type)) return { ok: false, error: `${label}: unknown field type.` }
    const key = keyOf(label)
    if (out.some((o) => o.key === key) || key.startsWith("_") || key === "id") return { ok: false, error: `Two fields can't both be called ${label}.` }
    const field = { key, label, type: f.type, required: i === 0 }
    if (f.type === "select") {
      const options = [...new Set((Array.isArray(f.options) ? f.options : String(f.options || "").split(/[,\n|]/)).map((o) => String(o).trim().slice(0, 40)).filter(Boolean))]
      if (!options.length) return { ok: false, error: `${label}: list at least one choice.` }
      field.options = options.slice(0, 20)
    }
    out.push(field)
  }
  if (!["text", "number", "money", "date", "select", "user"].includes(out[0].type)) return { ok: false, error: "The first field is the record's title: make it Text, a Number, a Date, a Choice or a Person." }
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, "")
  let id = "x_" + (slug || "app")
  while (appById(ws, id)) id += "1"
  const words = clean.toUpperCase().replace(/[^A-Z0-9 ]/g, "").split(/\s+/).filter(Boolean)
  const prefix = (words.length > 1 ? words.map((w) => w[0]).join("") : words[0] || "APP").slice(0, 4)
  const app = expandApp({ id, name: clean, cat: String(category || CUSTOM_CATEGORY).slice(0, 30), icon: String(icon || "star"), prefix, custom: true, created: Date.now(), fields: out })
  ws.customApps.push(app)
  touch(ws)
  return { ok: true, app }
}

export const deleteCustomApp = (ws, id) => {
  const app = ws.customApps.find((a) => a.id === id)
  if (!app) return { ok: false, error: "Only apps made with App Creator can be deleted." }
  for (const rec of recordsOf(ws, id)) deleteRecord(ws, id, rec.id)
  delete ws.records[id]
  delete ws.seq[id]
  ws.customApps = ws.customApps.filter((a) => a.id !== id)
  touch(ws)
  return { ok: true }
}

// ---- usage ----

export const setPrefs = (ws, patch) => {
  ws.prefs = { ...ws.prefs, ...patch }
  touch(ws)
}

export const markOpened = (ws, appId) => {
  if (!ws.stats.opened.includes(appId)) {
    ws.stats.opened.push(appId)
    touch(ws)
  }
  return ws.stats.opened.length
}

// ---- saving and loading ----

export const serialize = (ws) => JSON.stringify(ws)

// an older or damaged save -> a current workspace (or null if it isn't one at all)
export const migrate = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  let ws = data
  if (data.version === 1 || (data.v === undefined && data.data)) {
    // version 1 kept each app's records in an array, with links on the records
    ws = emptyWorkspace({ company: data.company, me: data.me || "You" })
    if (Array.isArray(data.users)) ws.users = [ws.users[0], ...data.users.filter((u) => u?.handle && u.handle !== ws.me)]
    ws.customApps = (data.apps || []).map(expandApp)
    for (const [appId, list] of Object.entries(data.data || {})) {
      if (!Array.isArray(list)) continue
      ws.records[appId] = {}
      for (const rec of list) {
        if (!rec || rec.id === undefined) continue
        const { links = [], ...rest } = rec
        const id = String(rec.id)
        ws.records[appId][id] = { ...rest, id, _c: rest._c || Date.now(), _u: rest._u || Date.now() }
        ws.seq[appId] = Math.max(ws.seq[appId] || FIRST_ID, Number(id) || 0)
        for (const to of links) ws.links.push([refOf(appId, id), to])
      }
    }
  }
  if (ws.v > VERSION) return null
  const fresh = emptyWorkspace({ company: ws.company })
  for (const key of Object.keys(fresh)) if (ws[key] === undefined || ws[key] === null) ws[key] = fresh[key]
  if (!Array.isArray(ws.users) || !ws.users.length) ws.users = fresh.users
  if (!userOf(ws, ws.me)) ws.me = ws.users[0].handle
  ws.prefs = { ...fresh.prefs, ...ws.prefs }
  ws.stats = { ...fresh.stats, ...ws.stats }
  ws.customApps = ws.customApps.map(expandApp)
  // records of apps that no longer exist go; links must point at real records
  for (const appId of Object.keys(ws.records)) if (!appById(ws, appId)) delete ws.records[appId]
  ws.links = ws.links.filter((l) => Array.isArray(l) && l.length === 2 && getRef(ws, l[0]) && getRef(ws, l[1]))
  ws.v = VERSION
  return ws
}

export const load = (json) => {
  try {
    return migrate(JSON.parse(json))
  } catch {
    return null
  }
}
