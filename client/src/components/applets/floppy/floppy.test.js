// node --test client/src/components/applets/floppy/floppy.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { buildTools, needsConfirm, parseModelOutput, parseWhen, ruleIntent, rankHelp, describeCall, systemPrompt, buildMessages, closestOf, resolveDate, TOOL_EXAMPLES, SLOT_EXAMPLES, routeByVectors, slotMessages, likelyValues, parseSlots, chatMessages } from "./floppyCore.js"
import { readFileSync } from "node:fs"
import { TOPICS } from "../help/topics/index.js"
import { topicText } from "../help/helpCore.js"

// (utils/programs.js imports browser-only modules: read the names from its text)
const PROGRAMS = [...readFileSync(new URL("../../../utils/programs.js", import.meta.url), "utf8").matchAll(/^\s*\{ name: "([^"]+)"/gm)].map((m) => m[1])
const VENUES = [
  { id: "loscab", name: "Los Cab Sports Village", short: "Los Cab" },
  { id: "smash", name: "California SMASH", short: "SMASH" },
]
const BUDDIES = ["Sam", "Jordan Lee", "Mia"]
const tools = buildTools({ programs: PROGRAMS, venues: VENUES, buddies: BUDDIES })
// Tue 2026-10-06 15:00 UTC
const NOW = Date.UTC(2026, 9, 6, 15, 0)
const ctx = { programs: PROGRAMS, venues: VENUES, buddies: BUDDIES, now: NOW, zone: "UTC" }

test("the tool list comes from the registries and stays in step", () => {
  const open = tools.find((t) => t.name === "open_program")
  assert.deepEqual([...open.parameters.properties.name.enum].sort(), [...PROGRAMS].sort())
  assert.ok(open.parameters.properties.name.enum.includes("Pickleball 98"))
  assert.deepEqual(tools.find((t) => t.name === "pickleball").parameters.properties.venue.enum, ["loscab", "smash"])
  assert.deepEqual(tools.find((t) => t.name === "send_im").parameters.properties.to.enum, BUDDIES)
  for (const t of tools) for (const r of t.parameters.required) assert.ok(t.parameters.properties[r], `${t.name}.${r}`)
  // a new program shows up without touching Floppy
  const more = buildTools({ programs: [...PROGRAMS, "Brand New 98"] })
  assert.ok(more.find((t) => t.name === "open_program").parameters.properties.name.enum.includes("Brand New 98"))
  const sys = systemPrompt({ tools, today: "2026-10-06 (Tuesday)", time: "15:00" })
  assert.match(sys, /open_program\(name: string/)
  assert.match(sys, /create_reminder\(text: string, date\?: string, time\?: string\)/)
  const msgs = buildMessages({ system: sys, user: "hi", history: Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: String(i) })) })
  assert.equal(msgs.filter((m) => m.role === "system").length, 1)
  assert.ok(msgs.length <= 1 + 6 + 8 + 1)
})

test("parsing the model: good, sloppy, and wrong answers", () => {
  const ok = parseModelOutput('{"tool":"open_program","args":{"name":"Paint"}}', tools)
  assert.deepEqual(ok, { ok: true, call: { tool: "open_program", args: { name: "Paint" } } })
  // fences, chatter around it, single quotes, trailing comma, bare keys, a lowercase name
  const sloppy = parseModelOutput("Sure!\n```json\n{tool: 'open_program', args: {name: 'paint',},}\n```", tools)
  assert.deepEqual(sloppy.call, { tool: "open_program", args: { name: "Paint" } })
  // unclosed braces
  assert.equal(parseModelOutput('{"tool":"search","args":{"query":"beach photos"', tools).call.args.query, "beach photos")
  // "arguments" instead of "args", a number as a string, a boolean as text
  assert.deepEqual(parseModelOutput('{"name":"set_dnd","arguments":{"on":"yes","minutes":"30"}}', tools).call, { tool: "set_dnd", args: { on: true, minutes: 30 } })
  // a reply
  assert.deepEqual(parseModelOutput('{"reply":"Hi there!"}', tools), { ok: true, reply: "Hi there!" })
  // plain text without JSON counts as a reply
  assert.equal(parseModelOutput("Hello! I'm Floppy.", tools).reply, "Hello! I'm Floppy.")
  // errors the retry can explain
  assert.match(parseModelOutput('{"tool":"format_c_drive","args":{}}', tools).error, /no tool called format_c_drive/)
  assert.match(parseModelOutput('{"tool":"open_program","args":{"name":"Photoshop"}}', tools).error, /allowed values/)
  assert.match(parseModelOutput('{"tool":"send_im","args":{"to":"Sam"}}', tools).error, /needs text/)
  assert.equal(parseModelOutput("{{{", tools).ok, false)
  assert.equal(closestOf("pickle ball 98", PROGRAMS), "Pickleball 98")
})

test("days and times in plain words", () => {
  assert.deepEqual(pick(parseWhen("call mom tomorrow at 6pm", ctx)), { date: "2026-10-07", time: "18:00", rest: "call mom" })
  assert.deepEqual(pick(parseWhen("pick up paddles at 7", ctx)), { date: "2026-10-06", time: "19:00", rest: "pick up paddles" })
  // already past today -> tomorrow
  assert.equal(parseWhen("stretch at 9am", ctx).date, "2026-10-07")
  assert.deepEqual(pick(parseWhen("in 20 minutes take the pizza out", ctx)), { date: "2026-10-06", time: "15:20", rest: "take the pizza out" })
  // Tuesday -> Friday is 3 days on; "tuesday" is next week's
  assert.equal(parseWhen("friday", ctx).date, "2026-10-09")
  assert.equal(parseWhen("tuesday", ctx).date, "2026-10-13")
  assert.deepEqual(pick(parseWhen("dinner tonight", ctx)), { date: "2026-10-06", time: "20:00", rest: "dinner" })
  assert.equal(parseWhen("noon", ctx).time, "12:00")
  assert.equal(parseWhen("at 13:45", ctx).time, "13:45")
  assert.equal(resolveDate("tomorrow", ctx), "2026-10-07")
  assert.equal(resolveDate("2026-12-25", ctx), "2026-12-25")
})
const pick = ({ date, time, rest }) => ({ date, time, rest })

test("the fallback understands the common things with no model", () => {
  assert.deepEqual(ruleIntent("open paint", ctx), { tool: "open_program", args: { name: "Paint" } })
  assert.deepEqual(ruleIntent("Open Pickleball and start practice", ctx), { tool: "pickleball", args: { mode: "practice" } })
  assert.deepEqual(ruleIntent("play pickleball", ctx), { tool: "pickleball", args: { mode: "quick" } })
  assert.deepEqual(ruleIntent("take me to Los Cab", ctx), { tool: "pickleball", args: { mode: "park", venue: "loscab" } })
  assert.deepEqual(ruleIntent("remind me to buy balls tomorrow at 6pm", ctx), { tool: "create_reminder", args: { text: "Buy balls", date: "2026-10-07", time: "18:00" } })
  assert.deepEqual(ruleIntent("new note: groceries, milk, eggs", ctx), { tool: "create_note", args: { title: "Groceries", body: "milk, eggs" } })
  assert.deepEqual(ruleIntent("add a task fix the bike friday", ctx), { tool: "create_task", args: { title: "Fix the bike", date: "2026-10-09" } })
  assert.deepEqual(ruleIntent("message sam saying running late!", ctx), { tool: "send_im", args: { to: "Sam", text: "running late" } })
  assert.deepEqual(ruleIntent("turn on do not disturb for 2 hours", ctx), { tool: "set_dnd", args: { on: true, minutes: 120 } })
  assert.deepEqual(ruleIntent("turn off dnd", ctx), { tool: "set_dnd", args: { on: false } })
  assert.deepEqual(ruleIntent("search for beach photos", ctx), { tool: "search", args: { query: "beach photos" } })
  assert.deepEqual(ruleIntent("how do I set a wallpaper?", ctx), { help: "set a wallpaper" })
  assert.deepEqual(ruleIntent("watch https://youtu.be/dQw4w9WgXcQ with mia", ctx), { tool: "watch_together", args: { url: "https://youtu.be/dQw4w9WgXcQ", with: "Mia" } })
  assert.deepEqual(ruleIntent("play some music", ctx), { tool: "play_music", args: {} })
  assert.deepEqual(ruleIntent("minesweeper", ctx), { tool: "open_program", args: { name: "Minesweeper" } })
  assert.deepEqual(ruleIntent("open the browser", ctx), { tool: "open_program", args: { name: "Compass" } })
  assert.equal(ruleIntent("what a lovely day it has been for all of us", ctx)?.tool, undefined)
  assert.equal(ruleIntent("", ctx), null)
})

test("anything that sends or changes something asks first", () => {
  for (const tool of ["create_reminder", "create_event", "create_task", "create_note", "send_im", "set_dnd"]) assert.equal(needsConfirm(tools, { tool }), true, tool)
  for (const tool of ["open_program", "search", "open_help", "pickleball", "play_music", "watch_together", "open_file"]) assert.equal(needsConfirm(tools, { tool }), false, tool)
  assert.equal(needsConfirm(tools, { tool: "nope" }), false)
  assert.equal(describeCall({ tool: "send_im", args: { to: "Sam", text: "hi" } }), 'Send Sam the message "hi"')
  assert.equal(describeCall({ tool: "create_reminder", args: { text: "Call mom", date: "2026-10-07", time: "18:00" } }), 'Remind you: "Call mom" on Wed, Oct 7, 6:00 PM')
})

test("with the brain: route to one tool, then fill only its arguments", () => {
  // every tool has routing examples and a slot example; "chat" is the talk-only class
  for (const t of tools) {
    assert.ok(TOOL_EXAMPLES[t.name]?.length >= 2, `examples for ${t.name}`)
    assert.ok(SLOT_EXAMPLES[t.name], `slot example for ${t.name}`)
  }
  assert.ok(TOOL_EXAMPLES.chat.length >= 3)
  // nearest example wins, with a margin
  const ex = { open_program: [[1, 0, 0]], create_note: [[0, 1, 0]], chat: [[0, 0, 1]] }
  const r = routeByVectors([0.1, 0.95, 0.1], ex)
  assert.equal(r.tool, "create_note")
  assert.ok(r.score > 0.9 && r.margin > 0.5)
  // the slot prompt is tiny and only carries likely program names
  const open = tools.find((t) => t.name === "open_program")
  const msgs = slotMessages(open, "I feel like drawing something", { today: "2026-10-06", time: "11:00" })
  const sys = msgs[0].content
  assert.ok(sys.length < 1200, `slot prompt ${sys.length} chars`)
  assert.match(sys, /Paint/)
  assert.ok(likelyValues(PROGRAMS, "open the calculator").slice(0, 3).includes("Calculator"))
  assert.equal(likelyValues(["A", "B"], "x").length, 2)
  // the model's bare arguments become a checked call
  assert.deepEqual(parseSlots('{"name":"paint"}', open, tools).call, { tool: "open_program", args: { name: "Paint" } })
  const note = tools.find((t) => t.name === "create_note")
  assert.deepEqual(parseSlots('Sure: {"title":"New paddles"}', note, tools).call, { tool: "create_note", args: { title: "New paddles" } })
  assert.equal(parseSlots("{}", note, tools).ok, false)
  assert.equal(chatMessages("who are you?")[0].role, "system")
})

test("help questions find the right page", () => {
  const docs = TOPICS.map((t) => ({ id: t.id, title: t.title, keywords: t.keywords || [], summary: t.summary || "", body: topicText(t, (id) => id) }))
  const top = (q) => rankHelp(q, docs).map((d) => d.id)
  assert.ok(top("how do I change my wallpaper").some((id) => /wallpaper|display|desktop/.test(id)), top("how do I change my wallpaper").join())
  assert.ok(top("lock my computer with a pin").some((id) => /lock|password/.test(id)))
  assert.ok(top("how do I watch youtube with a friend").includes("watch-together"))
  assert.ok(top("score my real pickleball game").includes("pickleball-club"))
  // vectors win when they're given
  const vectors = Object.fromEntries(docs.map((d) => [d.id, d.id === "calendar" ? [1, 0] : [0, 1]]))
  assert.equal(rankHelp("zzz", docs, { vectors, qvec: [1, 0] })[0].id, "calendar")
})
