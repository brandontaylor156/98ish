// Appward 98 record engine tests. Run: node --test client/src/components/applets/appward/
import test from "node:test"
import assert from "node:assert/strict"
import * as E from "./engine.js"
import { APPS, CATEGORIES } from "./catalog.js"
import { newWorkspace } from "./seed.js"

const fresh = () => newWorkspace({ company: "Acme Widgets Co.", me: "Pat Tester", now: new Date(2026, 9, 2) })
const empty = () => newWorkspace({ me: "Pat Tester", sample: false })

test("every catalog app is in a category and parses into a valid schema", () => {
  const names = new Set()
  for (const app of E.BUILTIN) {
    assert.ok(!names.has(app.name), `duplicate ${app.name}`)
    names.add(app.name)
    if (app.hidden) continue
    assert.ok(CATEGORIES.includes(app.cat), app.name)
    assert.ok(app.prefix, app.name)
    if (app.noRecords) continue
    assert.ok(app.fields.length > 0, app.name)
    const keys = app.fields.map((f) => f.key)
    assert.equal(new Set(keys).size, keys.length, `${app.name} has duplicate field keys`)
    for (const f of app.fields) {
      if (f.type === "ref") assert.ok(E.appById(null, f.app), `${app.name}.${f.key} points at unknown app ${f.app}`)
      if (f.type === "select") assert.ok(f.options.length > 0)
    }
  }
  assert.ok(APPS.filter((a) => !a.hidden).length >= 74)
})

test("field specs parse: required, choices, types and links", () => {
  assert.deepEqual(E.parseField("Subject*"), { key: "subject", label: "Subject", type: "text", required: true })
  assert.deepEqual(E.parseField("Status=New|Open").options, ["New", "Open"])
  assert.equal(E.parseField("Duration (min):number").key, "durationMin")
  assert.deepEqual(E.parseField("Company:@companies"), { key: "company", label: "Company", type: "ref", required: false, app: "companies" })
})

test("validation catches bad values and fills defaults", () => {
  const ws = empty()
  const app = E.appById(ws, "tickets")
  const bad = E.validate(ws, app, { subject: "", status: "Exploded", assignee: "nobody", requester: "999" })
  assert.equal(bad.ok, false)
  assert.ok(bad.errors.subject && bad.errors.status && bad.errors.assignee && bad.errors.requester)
  const good = E.validate(ws, app, { subject: "Printer jam" })
  assert.equal(good.ok, true)
  assert.equal(good.value.status, "New")
  assert.equal(good.value.priority, "Normal")
  assert.equal(E.validate(ws, E.appById(ws, "expenses"), { description: "x", amount: "12.345" }).value.amount, 12.35)
  assert.equal(E.validate(ws, E.appById(ws, "meetings"), { subject: "x", date: "10/02/1998" }).ok, false)
})

test("create, read, update and delete a record", () => {
  const ws = empty()
  const made = E.createRecord(ws, "tickets", { subject: "Printer jam", priority: "High" })
  assert.ok(made.ok)
  const id = made.record.id
  assert.equal(E.recordNo(E.appById(ws, "tickets"), id), "TK-101")
  assert.equal(E.getRecord(ws, "tickets", id).priority, "High")
  assert.ok(E.updateRecord(ws, "tickets", id, { status: "Resolved" }).ok)
  assert.equal(E.getRecord(ws, "tickets", id).status, "Resolved")
  assert.equal(E.getRecord(ws, "tickets", id).subject, "Printer jam", "partial updates keep other fields")
  assert.equal(E.updateRecord(ws, "tickets", id, { status: "Nope" }).ok, false)
  assert.ok(E.deleteRecord(ws, "tickets", id).ok)
  assert.equal(E.getRecord(ws, "tickets", id), null)
  assert.equal(E.createRecord(ws, "insights", {}).ok, false, "custom-view apps keep no records")
})

test("deleting a record cleans up links, link fields, attachments and notifications", () => {
  const ws = fresh()
  const company = E.recordsOf(ws, "companies").find((c) => c.company === "Globex Hardware")
  const contacts = E.recordsOf(ws, "contacts").filter((c) => c.company === company.id)
  assert.ok(contacts.length)
  const ticket = E.recordsOf(ws, "tickets").find((t) => t.subject.includes("squeaks"))
  const ticketRef = E.refOf("tickets", ticket.id)
  assert.ok(E.linksOf(ws, ticketRef).length >= 2)
  const msg = E.recordsOf(ws, "messages").find((m) => m.attachments.includes(ticketRef))
  assert.ok(msg)
  E.notify(ws, { to: ws.me, text: "look", target: { app: "tickets", id: ticket.id } })

  const out = E.deleteRecord(ws, "tickets", ticket.id)
  assert.ok(out.ok && out.cleared >= 3)
  assert.equal(ws.links.some(([a, b]) => a === ticketRef || b === ticketRef), false)
  assert.equal(msg.attachments.includes(ticketRef), false)
  assert.equal(ws.notifications.some((n) => n.target?.app === "tickets" && n.target.id === ticket.id), false)

  E.deleteRecord(ws, "companies", company.id)
  for (const c of contacts) assert.equal(E.getRecord(ws, "contacts", c.id).company, "", "link fields are cleared, records stay")
})

test("deleting a channel deletes its messages; deleting a part trims bills of materials", () => {
  const ws = fresh()
  const general = E.recordsOf(ws, "conversations").find((c) => c.channel === "general")
  assert.ok(E.channelMessages(ws, general.id).length)
  E.deleteRecord(ws, "conversations", general.id)
  assert.equal(E.recordsOf(ws, "messages").some((m) => m.channel === general.id), false)
  const widget = E.recordsOf(ws, "parts").find((p) => p.partNumber === "WDG-1000")
  const bolt = E.recordsOf(ws, "parts").find((p) => p.partNumber === "BLT-0420")
  E.deleteRecord(ws, "parts", bolt.id)
  assert.equal(widget.components.some((l) => l.part === bolt.id), false)
})

test("free links: no self links, no duplicates, both directions", () => {
  const ws = fresh()
  const a = E.refOf("tickets", E.recordsOf(ws, "tickets")[1].id)
  const b = E.refOf("parts", E.recordsOf(ws, "parts")[0].id)
  assert.equal(E.link(ws, a, a).ok, false)
  assert.ok(E.link(ws, a, b).ok)
  assert.equal(E.link(ws, b, a).ok, false)
  assert.ok(E.linksOf(ws, b).includes(a))
  assert.ok(E.unlink(ws, b, a).ok)
  assert.equal(E.linksOf(ws, a).includes(b), false)
  assert.equal(E.link(ws, a, "tickets:9999").ok, false)
})

test("related records come from link fields", () => {
  const ws = fresh()
  const project = E.recordsOf(ws, "projects").find((p) => p.project === "Globex Store Rollout")
  const related = E.relatedTo(ws, "projects", project.id)
  assert.ok(related.filter((r) => r.app === "actions").length >= 5)
})

test("search indexes every app, matches by word prefix and record number, and updates", () => {
  const ws = fresh()
  const hits = E.search(ws, "squeak")
  assert.ok(hits.some((h) => h.app === "tickets"))
  assert.ok(hits.some((h) => h.app === "problems"))
  assert.equal(E.search(ws, "squeak globex").length <= hits.length, true)
  assert.ok(E.search(ws, "tk-101").some((h) => h.no === "TK-101"))
  assert.ok(E.search(ws, "Kowalski").some((h) => h.app === "contacts"))
  assert.equal(E.search(ws, "zzzzqqq").length, 0)
  assert.equal(E.search(ws, "Flux capacitor").length, 0)
  E.createRecord(ws, "notes", { title: "Flux capacitor ideas" })
  assert.equal(E.search(ws, "flux capac").length, 1, "the index rebuilds after a change")
  assert.equal(E.search(ws, "morning").some((h) => h.app === "messages"), false, "hidden apps stay out of results")
  assert.ok(E.searchIndex(ws).size > 100)
})

test("@mentions notify the person mentioned, with a deep link to the message", () => {
  const ws = fresh()
  const shop = E.recordsOf(ws, "conversations").find((c) => c.channel === "shop-floor")
  const before = ws.notifications.length
  const out = E.postMessage(ws, shop.id, { text: "@dana @maria please look. @nobody", attachments: [E.refOf("tickets", "101")] })
  assert.ok(out.ok)
  assert.deepEqual(out.mentioned.sort(), ["dana", "maria"])
  const notes = ws.notifications.slice(before)
  assert.equal(notes.length, 2)
  assert.deepEqual(notes[0].target, { app: "conversations", id: shop.id, msg: out.record.id })
  // a coworker mentioning me shows up in my notifications
  const unread = E.unreadCount(ws)
  E.postMessage(ws, shop.id, { from: "tom", text: `@${ws.me} done!` })
  assert.equal(E.unreadCount(ws), unread + 1)
  const mine = E.myNotifications(ws)[0]
  assert.equal(mine.kind, "mention")
  E.markRead(ws, mine.id)
  assert.equal(E.unreadCount(ws), unread)
  assert.equal(E.postMessage(ws, shop.id, { text: "   " }).ok, false)
})

test("assigning someone notifies them", () => {
  const ws = empty()
  E.createRecord(ws, "actions", { action: "Sweep", assignee: "tom" })
  assert.equal(ws.notifications.at(-1).to, "tom")
  const n = ws.notifications.length
  E.createRecord(ws, "actions", { action: "Mine", assignee: ws.me })
  assert.equal(ws.notifications.length, n, "no notification for assigning yourself")
})

test("approvals change the status once and tell the requester", () => {
  const ws = fresh()
  const req = E.recordsOf(ws, "timeOff").find((r) => r.employee === "tom" && r.status === "Pending")
  assert.ok(E.decide(ws, "timeOff", req.id, "Approved").ok)
  assert.equal(req.status, "Approved")
  assert.equal(ws.notifications.at(-1).to, "tom")
  assert.equal(E.decide(ws, "timeOff", req.id, "Denied").ok, false)
  assert.equal(E.decide(ws, "tickets", "101", "Approved").ok, false)
})

test("a work order consumes its bill of materials from inventory, then stocks what it built", () => {
  const ws = fresh()
  const widget = E.recordsOf(ws, "parts").find((p) => p.partNumber === "WDG-1000")
  const gear = E.recordsOf(ws, "parts").find((p) => p.partNumber === "GR-0032")
  const wo = E.recordsOf(ws, "workOrders").find((w) => w.qty === 50)
  const gearsBefore = E.onHand(ws, gear.id)
  const widgetsBefore = E.onHand(ws, widget.id)
  assert.equal(E.completeWorkOrder(ws, wo.id).ok, false, "can't complete before issuing")
  const out = E.issueMaterials(ws, wo.id)
  assert.ok(out.ok)
  assert.equal(E.onHand(ws, gear.id), gearsBefore - 100, "2 gears per widget x 50")
  assert.equal(wo.status, "In Progress")
  assert.equal(E.issueMaterials(ws, wo.id).ok, false, "only once")
  assert.ok(E.completeWorkOrder(ws, wo.id).ok)
  assert.equal(E.onHand(ws, widget.id), widgetsBefore + 50)
  assert.equal(wo.status, "Complete")
})

test("a work order that needs more than inventory has is refused and changes nothing", () => {
  const ws = fresh()
  const widget = E.recordsOf(ws, "parts").find((p) => p.partNumber === "WDG-1000")
  const housing = E.recordsOf(ws, "parts").find((p) => p.partNumber === "HSG-2000")
  const wo = E.createRecord(ws, "workOrders", { workOrder: "Huge order", part: widget.id, qty: 1000 }).record
  const before = E.onHand(ws, housing.id)
  const out = E.issueMaterials(ws, wo.id)
  assert.equal(out.ok, false)
  assert.match(out.error, /Not enough/)
  assert.equal(E.onHand(ws, housing.id), before)
  assert.equal(wo._issued, undefined)
})

test("Report Builder queries: columns, filters, sort and totals", () => {
  const ws = fresh()
  const out = E.runQuery(ws, { app: "leads", columns: ["lead", "stage", "value"], filters: [{ field: "stage", op: "is not", value: "Lost" }, { field: "value", op: ">", value: "10000" }], sort: { field: "value", dir: "desc" } })
  assert.ok(out.ok)
  assert.deepEqual(out.columns.map((c) => c.label), ["Lead", "Stage", "Value"])
  assert.deepEqual(out.rows.map((r) => r.cells[2]), ["$52,000.00", "$36,000.00", "$22,000.00", "$15,000.00"])
  assert.equal(out.totals.value, "$125,000.00")
  const people = E.runQuery(ws, { app: "tickets", columns: ["subject", "assignee"], filters: [{ field: "assignee", op: "is", value: "Pat Tester" }] })
  assert.equal(people.rows.length, 2, "person fields filter by name")
  const contains = E.runQuery(ws, { app: "contacts", filters: [{ field: "company", op: "contains", value: "globex" }] })
  assert.equal(contains.rows.length, 1, "link fields filter by the linked record's title")
  assert.equal(E.runQuery(ws, { app: "insights" }).ok, false)
})

test("App Creator makes a working app, validates, and deletes cleanly", () => {
  const ws = fresh()
  assert.equal(E.createCustomApp(ws, { name: "Tickets", fields: [{ label: "A", type: "text" }] }).ok, false, "names are unique")
  assert.equal(E.createCustomApp(ws, { name: "Loans", fields: [] }).ok, false)
  assert.equal(E.createCustomApp(ws, { name: "Loans", fields: [{ label: "Item", type: "text" }, { label: "Item", type: "date" }] }).ok, false)
  assert.equal(E.createCustomApp(ws, { name: "Loans", fields: [{ label: "Item", type: "text" }, { label: "State", type: "select", options: "" }] }).ok, false)
  assert.equal(E.createCustomApp(ws, { name: "Loans", fields: [{ label: "Item", type: "teleport" }] }).ok, false)
  const made = E.createCustomApp(ws, {
    name: "Equipment Loans",
    icon: "box",
    fields: [{ label: "Item", type: "text" }, { label: "Borrower", type: "user" }, { label: "Due Back", type: "date" }, { label: "State", type: "select", options: "Out, Returned" }, { label: "Deposit", type: "money" }],
  })
  assert.ok(made.ok, made.error)
  const app = made.app
  assert.equal(app.cat, "Custom Apps")
  assert.equal(app.prefix, "EL")
  assert.ok(E.launcherApps(ws).some((a) => a.id === app.id))
  assert.ok(E.categoriesOf(ws).includes("Custom Apps"))
  assert.equal(app.fields[0].required, true)
  const rec = E.createRecord(ws, app.id, { item: "Ladder", borrower: "tom", dueBack: "2026-10-09", deposit: 20 })
  assert.ok(rec.ok)
  assert.equal(rec.record.state, "Out")
  assert.equal(E.createRecord(ws, app.id, { item: "" }).ok, false)
  assert.ok(E.search(ws, "ladder").some((h) => h.app === app.id))
  assert.equal(E.runQuery(ws, { app: app.id, columns: ["item", "deposit"] }).totals.deposit, "$20.00")
  assert.ok(E.link(ws, E.refOf(app.id, rec.record.id), E.refOf("tickets", "101")).ok)
  // it survives a save and load
  const back = E.load(E.serialize(ws))
  assert.equal(E.getRecord(back, app.id, rec.record.id).item, "Ladder")
  assert.ok(E.deleteCustomApp(ws, app.id).ok)
  assert.equal(E.appById(ws, app.id), null)
  assert.equal(ws.links.some(([a, b]) => a.startsWith(app.id) || b.startsWith(app.id)), false)
})

test("insights group by a field, counting or summing", () => {
  const ws = fresh()
  const byStage = E.groupBy(ws, "leads", "stage", "value")
  assert.deepEqual(byStage.map((g) => g.label), ["New", "Qualified", "Proposal", "Negotiation", "Won", "Lost"])
  assert.equal(byStage.find((g) => g.label === "Won").value, 22000)
  assert.equal(E.groupBy(ws, "tickets", "status").reduce((s, g) => s + g.value, 0), E.recordsOf(ws, "tickets").length)
})

test("a workspace saves and loads intact; garbage loads as nothing", () => {
  const ws = fresh()
  const json = E.serialize(ws)
  assert.ok(json.length < 200000)
  const back = E.load(json)
  assert.equal(back.v, E.VERSION)
  assert.deepEqual(back.records, ws.records)
  assert.deepEqual(back.links, ws.links)
  assert.equal(E.load("not json"), null)
  assert.equal(E.load("[1,2]"), null)
  assert.equal(E.load(JSON.stringify({ v: 99 })), null, "a save from a newer version isn't misread")
})

test("version 1 saves migrate: record arrays and links on records", () => {
  const v1 = {
    version: 1,
    company: "Old Co",
    me: "Pat",
    data: {
      tickets: [{ id: 101, subject: "Old ticket", status: "Open", links: ["notes:101"] }],
      notes: [{ id: 101, title: "Old note" }],
      ghosts: [{ id: 1 }],
    },
    apps: [],
  }
  const ws = E.migrate(v1)
  assert.equal(ws.v, E.VERSION)
  assert.equal(ws.company, "Old Co")
  assert.equal(E.getRecord(ws, "tickets", "101").subject, "Old ticket")
  assert.deepEqual(E.linksOf(ws, "tickets:101"), ["notes:101"])
  assert.equal(ws.records.ghosts, undefined, "unknown apps are dropped")
  assert.equal(E.createRecord(ws, "tickets", { subject: "New" }).record.id, "102", "numbering continues")
  // a current save with a dangling link and missing pieces is repaired
  const broken = { v: 2, company: "X", me: "zed", users: [{ handle: "zed", name: "Zed" }], records: { notes: { 101: { id: "101", title: "n" } } }, links: [["notes:101", "tickets:5"]] }
  const fixed = E.migrate(broken)
  assert.equal(fixed.links.length, 0)
  assert.ok(Array.isArray(fixed.notifications) && Array.isArray(fixed.customApps))
})

test("reports save by name and replace on the same name", () => {
  const ws = empty()
  assert.ok(E.saveReport(ws, "Open tickets", { app: "tickets", columns: ["subject"] }).ok)
  assert.ok(E.saveReport(ws, "open tickets", { app: "tickets", columns: ["status"] }).ok)
  assert.equal(ws.reports.length, 1)
  assert.deepEqual(ws.reports[0].def.columns, ["status"])
  assert.equal(E.saveReport(ws, "", { app: "tickets" }).ok, false)
})
