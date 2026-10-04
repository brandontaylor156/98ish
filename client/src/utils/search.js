// Search everything (Start menu search and Find): programs, settings, files (names and the
// words in text documents), contacts, calendar events, 98 Messenger conversations, mail and
// photos. Loaded on the first search (it brings the calendar and contacts with it).
//
// searchAll(query, { types, perType, limit }) -> { groups: [{ type, label, icon, results,
//   total }], ms }. Everything is indexed in memory once and only what changed is indexed
// again (the drive's files on every change, the rest when its data changes), and typing more
// letters only looks through the last matches, so each key costs a few milliseconds.
// openResult(result, dispatch) opens one. Nothing is found while the computer is locked.

import { contentReady, fs, onFsChange } from "./fs"
import { programs, launch, photosWindow } from "./programs"
import { openItem } from "./openItem"
import { iconFor, typeName } from "./fileInfo"
import { shellAction } from "./shell"
import { isLocked } from "./lock"
import { FileIndex, prepare, rank, scoreEntry, snippet, tokenize } from "./searchCore"
import { PROGRAM_KEYWORDS, SEARCH_TYPES, searchProviders, searchableEntries, searchableVersion } from "./searchIndex"
import { ALIASES } from "../components/applets/dos/commands"
import { getContacts } from "./contacts"
import { displayName, addressText, mailAddressOf, dateText } from "./contactsCore"
import { getCal, openCalendar, calendarById, zone } from "../components/applets/calendar/store"
import { occurrences, dateIn, dateLabel } from "../components/applets/calendar/recur"

const DAY = 86_400_000
const PROGRAM_FILE_TYPES = new Set(programs.map((p) => p.type).filter(Boolean))

// ---- programs ----

let programEntries = null
const programList = () => {
  if (programEntries) return programEntries
  const aliases = {}
  for (const [alias, name] of Object.entries(ALIASES)) (aliases[name] ||= []).push(alias)
  programEntries = programs.map((p) => ({
    id: `program:${p.name}`,
    type: "programs",
    title: p.name,
    subtitle: p.group ? `Programs > ${p.group}` : "Program",
    icon: p.icon,
    program: p.name,
    search: prepare({ title: p.name, keywords: [...(PROGRAM_KEYWORDS[p.name] || []), ...(aliases[p.name] || [])], detail: p.group || "" }),
  }))
  return programEntries
}

// ---- settings (utils/searchIndex.js) ----

let settingsCache = { version: -1, list: [] }
const settingsList = () => {
  if (settingsCache.version === searchableVersion()) return settingsCache.list
  const list = searchableEntries().map((e) => ({
    ...e,
    type: e.type || "settings",
    subtitle: e.detail || "Settings",
    icon: e.icon || "/assets/vaporwave.png",
    search: prepare({ title: e.title, keywords: e.keywords || [], detail: e.detail || "" }),
  }))
  settingsCache = { version: searchableVersion(), list }
  return list
}

// ---- the drive ----

const DATES_KEY = "98ish.search.dates"
const loadDates = () => {
  try {
    return JSON.parse(localStorage.getItem(DATES_KEY)) || {}
  } catch {
    return {}
  }
}
const dates = loadDates()
let datesTimer = null
const saveDates = () => {
  clearTimeout(datesTimer)
  datesTimer = setTimeout(() => {
    try {
      localStorage.setItem(DATES_KEY, JSON.stringify(dates))
    } catch {
      // full: dates last for this visit
    }
  }, 1000)
}

// Every folder and file on the drive (through fs.js's public tree; the Recycle Bin isn't searched)
function* walkDrive() {
  const stack = [...fs.root.content].reverse()
  while (stack.length) {
    const item = stack.pop()
    // contents only when they're already in memory: big files (photos, long documents) load
    // lazily, and reading textContent would start loading every one of them
    yield { key: item, name: item.name, path: fs.displayPath(item), type: item.type, isDirectory: item.isDirectory, text: () => (contentReady(item) ? item.textContent || "" : "") }
    if (item.isDirectory) for (let i = item.content.length - 1; i >= 0; i--) stack.push(item.content[i])
  }
}

const files = new FileIndex({ walk: walkDrive, dates })
let filesVersion = 0
onFsChange(() => {
  files.invalidate()
  filesVersion++
})
const fileEntries = () => {
  const before = files.entries
  const list = files.refresh()
  if (list !== before) saveDates()
  return list
}

const fileResult = (e, query) => ({
  id: `file:${e.path}`,
  type: e.type === "image" ? "photos" : "files",
  title: e.name,
  // found by its words: show them; found by its name: show where it is
  subtitle: e.body && !scoreEntry({ title: e.search.title, keywords: [], detail: e.search.detail, body: "" }, tokenize(query)) ? snippet(e.body, query) : e.path,
  detail: e.path,
  icon: iconFor(e.key),
  item: e.key,
  isDirectory: e.isDirectory,
  kind: typeName(e.key),
  size: e.size,
  time: e.modified ?? null,
  search: e.search,
})

// ---- contacts ----

let contactsCache = { source: null, list: [] }
const contactList = () => {
  const source = getContacts()
  if (contactsCache.source === source) return contactsCache.list
  const list = source.map((c) => ({
    id: `contact:${c.id}`,
    type: "contacts",
    title: displayName(c),
    subtitle: [c.screenName && `${c.screenName} (98 Messenger)`, c.phones[0]?.value, c.emails[0]?.value, c.company].filter(Boolean).join(" · ") || "Contact",
    icon: c.picture || "/assets/program_icons/addressbook.svg",
    round: !!c.picture,
    contactId: c.id,
    search: prepare({
      title: displayName(c),
      keywords: [c.nickname, c.screenName, mailAddressOf(c), ...c.groups].filter(Boolean),
      detail: [c.company, ...c.emails.map((e) => e.value), ...c.phones.map((p) => p.value), ...c.phones.map((p) => p.value.replace(/[^\d]/g, ""))].join(" "),
      body: [addressText(c.address), c.notes, c.birthday && `birthday ${dateText(c.birthday)}`].filter(Boolean).join(" "),
    }),
  }))
  contactsCache = { source, list }
  return list
}

// ---- calendar events: the year before and after today ----

let eventsCache = { source: null, day: null, list: [] }
const eventList = () => {
  const cal = getCal()
  const now = Date.now()
  const day = Math.floor(now / DAY)
  if (eventsCache.source === cal.events && eventsCache.day === day) return eventsCache.list
  const z = zone()
  const list = []
  for (const calendar of cal.calendars) {
    for (const event of cal.events[calendar.id] || []) {
      if (event.kind === "memo") {
        list.push({ id: `memo:${calendar.id}:${event.id}`, type: "events", title: event.title || "(Memo)", subtitle: `Memo · ${calendar.name}`, icon: "/assets/program_icons/calendar.svg", calendarId: calendar.id, eventId: event.id, time: event.updatedAt || null, search: prepare({ title: event.title, detail: calendar.name, body: [event.notes, ...(event.checklist || []).map((c) => c.text)].join(" ") }) })
        continue
      }
      const occs = occurrences(event, now - 365 * DAY, now + 365 * DAY, z)
      if (!occs.length) continue
      // the next one, else the last one (an all-day one counts from noon that day, here)
      const start = (o) => (o.allDay ? new Date(`${o.start}T12:00:00`).getTime() : o.start)
      const next = occs.find((o) => start(o) >= now - DAY) || occs[occs.length - 1]
      const date = next.allDay ? next.start : dateIn(next.start, z)
      list.push({
        id: `event:${calendar.id}:${event.id}`,
        type: "events",
        title: next.title || "(No title)",
        subtitle: [dateLabel(date, { year: true }), next.location, calendar.name].filter(Boolean).join(" · "),
        icon: "/assets/program_icons/calendar.svg",
        calendarId: calendar.id,
        eventId: event.id,
        key: next.key,
        date,
        time: start(next),
        allDay: next.allDay,
        search: prepare({ title: next.title, keywords: [], detail: [next.location, calendar.name].join(" "), body: next.notes }),
      })
    }
  }
  eventsCache = { source: cal.events, day, list }
  return list
}

// ---- mail: the headers 98ish Mail keeps on this device ----

const MAIL_KEY = "98ish.mail.index"
let mailCache = { raw: null, list: [] }
const mailList = () => {
  let raw = null
  try {
    raw = localStorage.getItem(MAIL_KEY)
  } catch {
    raw = null
  }
  if (raw === mailCache.raw) return mailCache.list
  let saved = null
  try {
    saved = JSON.parse(raw)
  } catch {
    saved = null
  }
  const list = []
  for (const [folder, headers] of Object.entries(saved?.folders || {})) {
    for (const m of headers || []) {
      const who = folder === "inbox" || folder === "deleted" ? m.from : (m.to || []).join(", ")
      list.push({
        id: `mail:${m.id}`,
        type: "mail",
        title: m.subject || "(no subject)",
        subtitle: `${folder === "inbox" ? "From" : "To"} ${who} · ${new Date(m.time).toLocaleDateString()}`,
        icon: "/assets/program_icons/mail.svg",
        folder,
        messageId: m.id,
        time: m.time,
        search: prepare({ title: m.subject || "", keywords: [m.from, ...(m.to || [])].filter(Boolean), detail: folder }),
      })
    }
  }
  mailCache = { raw, list }
  return list
}

// ---- the providers (98 Messenger's conversations) ----

const providerCache = new Map()
const providerList = (type) => {
  const out = []
  for (const [id, provider] of searchProviders()) {
    if ((provider.type || id) !== type) continue
    const version = provider.version?.()
    const cached = providerCache.get(id)
    if (cached && version !== undefined && cached.version === version) {
      out.push(...cached.list)
      continue
    }
    const list = (provider.entries?.() || []).map((e) => ({ type, icon: provider.icon, ...e, search: prepare({ title: e.title, keywords: e.keywords || [], detail: e.detail || "", body: e.body || "" }) }))
    providerCache.set(id, { version, list })
    out.push(...list)
  }
  return out
}

// ---- searching ----

const SOURCES = {
  programs: () => [programList(), 0],
  settings: () => [settingsList(), searchableVersion()],
  files: () => {
    const list = fileEntries()
    return [list.filter((e) => e.type !== "image" && !(PROGRAM_FILE_TYPES.has(e.type) && e.path.startsWith("C:\\Programs"))), filesVersion]
  },
  photos: () => [fileEntries().filter((e) => e.type === "image"), filesVersion],
  contacts: () => [contactList(), getContacts()],
  events: () => [eventList(), getCal().events],
  messages: () => [providerList("messages"), null],
  mail: () => [mailList(), mailCache.raw],
}

// typing more letters: look only through what the last query matched
const last = new Map() // type -> { query, version, matches }

const searchType = (type, query) => {
  const [all, version] = SOURCES[type]()
  const q = query.trim().toLowerCase()
  const prev = last.get(type)
  const pool = prev && prev.version === version && version !== null && prev.list === all && q.startsWith(prev.query) && prev.query ? prev.matches : all
  const matches = rank(pool, q, { limit: Infinity, boost: (e) => (type === "events" && e.time ? Math.max(0, 6 - Math.abs(e.time - Date.now()) / (30 * DAY)) : 0) })
  last.set(type, { query: q, version, list: all, matches })
  return matches
}

export const TYPES = SEARCH_TYPES

// all: with no words typed, everything of those types (Find with only a date or a size)
export const searchAll = (query, { types = SEARCH_TYPES.map((t) => t.id), perType = Infinity, all = false } = {}) => {
  const started = performance.now()
  const q = String(query || "").trim()
  if ((!q && !all) || isLocked()) return { groups: [], ms: 0 }
  const groups = []
  for (const t of SEARCH_TYPES) {
    if (!types.includes(t.id)) continue
    let matches = []
    try {
      matches = q ? searchType(t.id, q) : SOURCES[t.id]()[0]
    } catch (error) {
      console.error(`[search] ${t.id}`, error)
    }
    if (!matches.length) continue
    const results = matches.slice(0, perType).map((e) => (t.id === "files" || t.id === "photos" ? fileResult(e, q) : e))
    groups.push({ type: t.id, label: t.label, icon: t.icon, results, total: matches.length })
  }
  return { groups, ms: performance.now() - started }
}

// warm the indexes up (the Start menu calls this when it opens, after a moment)
export const warmUp = () => {
  if (isLocked()) return
  programList()
  settingsList()
  fileEntries()
  contactList()
  eventList()
}

// ---- opening ----

export const openResult = (result, dispatch) => {
  if (!result || isLocked()) return false
  const open = (payload) => dispatch({ type: "open_window", payload })
  switch (result.type) {
    case "programs":
      open(launch(result.program))
      return true
    case "settings": {
      const how = result.open
      if (typeof how === "function") how(dispatch)
      else if (how?.shell) shellAction(how.shell)
      else if (how?.program) open(launch(how.program, how.extra || {}))
      return true
    }
    case "files":
      return openItem(result.item, dispatch)
    case "photos":
      open(photosWindow(result.item))
      return true
    case "contacts":
      open(launch("Address Book", { handoff: { id: Date.now(), contactId: result.contactId } }))
      return true
    case "events":
      openCalendar(calendarById(result.calendarId) ? { calendarId: result.calendarId, eventId: result.eventId, key: result.key, date: result.date } : { date: result.date })
      return true
    case "mail":
      open(launch("98ish Mail", { handoff: { id: Date.now(), message: { folder: result.folder, id: result.messageId } } }))
      return true
    default:
      if (typeof result.open === "function") {
        result.open(dispatch)
        return true
      }
      return false
  }
}
