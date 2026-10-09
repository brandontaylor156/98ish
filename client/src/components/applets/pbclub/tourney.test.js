import test from "node:test"
import assert from "node:assert/strict"
import * as T from "./tourneyCore.js"

test("the schedule: weekly events at local time, across daylight saving, ids that check out", () => {
  // Sunday 2026-10-11 2 PM PDT = 21:00 UTC; Sunday 2026-11-08 2 PM PST = 22:00 UTC
  assert.equal(T.parseId("narrows-20261011").start, Date.UTC(2026, 9, 11, 21))
  assert.equal(T.parseId("narrows-20261108").start, Date.UTC(2026, 10, 8, 22))
  assert.equal(T.parseId("narrows-20261012"), null, "not its weekday")
  assert.equal(T.parseId("narrows-20261131"), null, "no such day")
  assert.equal(T.parseId("capa-20261011"), null, "not one of ours")
  assert.ok(T.parseId("riverside-20261012"), "Riverside Nightly is every day")
  const now = Date.UTC(2026, 9, 9, 19)
  const list = T.upcoming(now)
  assert.ok(list.length >= 9 + 7)
  assert.ok(list.every((e) => e.start >= now - 3 * T.HOUR && e.start <= now + T.LIMITS.showDays * T.DAY))
  assert.equal(new Set(list.map((e) => e.id)).size, list.length)
  // original names only: none of the real organizers' names
  for (const e of T.EVENTS) assert.doesNotMatch(e.name, /CAPA|iPickle|PPA|APP|MLP|USA Pickleball/i)
})

test("the draw: seeds apart, computers fill to 4/8/16, the same draw every time", () => {
  assert.deepEqual(T.seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6])
  assert.deepEqual([1, 3, 4, 5, 9, 16, 30].map(T.bracketSize), [4, 4, 4, 8, 16, 16, 16])
  const entries = ["a", "b", "c"].map((k, i) => ({ id: `e${k}`, div: "d30", keys: [k], names: { [k]: k.toUpperCase() }, partner: k === "a" ? { k: "z", name: "Z", ok: true } : k === "b" ? { k: "y", name: "Y", ok: false } : null, at: i }))
  const b = T.draw(entries, "d30", 42)
  assert.equal(b.size, 4)
  assert.deepEqual(b.rounds.map((r) => r.length), [2, 1])
  assert.deepEqual(b.teams.ea.players.map((p) => p.name), ["A", "Z"])
  assert.ok(b.teams.eb.players[1].cpu, "a partner who never accepted: a computer partner")
  assert.equal(Object.values(b.teams).filter((t) => t.cpu).length, 1)
  // seeds 1 and 2 (the first two to sign up) are in different halves
  const half = (id) => (b.rounds[0][0].a === id || b.rounds[0][0].b === id ? 0 : 1)
  assert.notEqual(half("ea"), half("eb"))
  assert.deepEqual(T.draw(entries, "d30", 42), b)
  assert.equal(T.draw(entries, "s", 42), null, "nobody in singles")
})

test("progress: computers play themselves, the clock settles the rest, champions and trophies", () => {
  const inst = T.parseId("fvclassic-20261010")
  const doc = T.freshTourney(inst, 7)
  doc.entries.push({ id: "e1", div: "d40", keys: ["me"], names: { me: "Me" }, partner: { k: "pal", name: "Pal", ok: true }, at: 1 })
  for (let i = 0; i < 4; i++) doc.entries.push({ id: `x${i}`, div: "d30", keys: [`p${i}`], names: { [`p${i}`]: `P${i}` }, partner: null, at: 10 + i })
  assert.equal(T.progress(doc, inst.start - 1), false, "nothing before the start")
  assert.equal(T.progress(doc, inst.start), true)
  assert.equal(doc.status, "live")
  assert.equal(doc.brackets.mx, null)
  assert.equal(doc.brackets.d30.size, 4)
  // d40: me + 3 computer teams: the computers' semi is already played
  const d40 = doc.brackets.d40
  assert.equal(d40.rounds[0].filter((m) => m.how === "sim").length, 1)
  const next = T.nextMatchFor(doc, "pal")
  assert.ok(next.vsCpu)
  assert.equal(T.report(doc, next.match.id, "me", [11, 9], inst.start + 5 * T.MINUTE), null, "my win goes in")
  assert.equal(T.validScore([12, 10]), true)
  assert.equal(T.validScore([13, 10]), false)
  assert.equal(T.validScore([11, 10]), false)
  assert.equal(T.validScore([9, 11]), true)
  // the final, unplayed: the computers take it when the time's up
  T.progress(doc, inst.start + 2 * T.ROUND_MS)
  assert.ok(d40.rounds[1][0].w)
  // d30: four people, nobody plays: drawing lots, so it still finishes
  assert.ok(doc.brackets.d30.rounds[0].every((m) => m.how === "lots"))
  assert.equal(doc.status, "done")
  const trophies = T.trophiesOf(doc)
  assert.ok(trophies.some((t) => t.k === "me" && t.trophy.div === "Doubles 4.0+"))
  assert.equal(trophies.filter((t) => t.trophy.id.endsWith("d30")).length, 2, "a champion and a runner-up (one each, singles-sized teams)")
  // the same record and time give the same result elsewhere
  const again = T.freshTourney(inst, 7)
  again.entries = JSON.parse(JSON.stringify(doc.entries))
  T.progress(again, inst.start)
  T.report(again, next.match.id, "me", [11, 9], inst.start + 5 * T.MINUTE)
  T.progress(again, inst.start + 2 * T.ROUND_MS)
  assert.deepEqual(again.brackets, doc.brackets)
})

test("Delete My Account in the bracket: Deleted player; before the start their sign-up goes", () => {
  const inst = T.parseId("narrows-20261011")
  const doc = T.freshTourney(inst, 3)
  doc.entries.push({ id: "e1", div: "d30", keys: ["al", "bo"], names: { al: "Al", bo: "Bo" }, partner: { k: "bo", name: "Bo", ok: true }, at: 1 })
  doc.entries.push({ id: "e2", div: "s", keys: ["cy"], names: { cy: "Cy" }, partner: null, at: 2 })
  const open = JSON.parse(JSON.stringify(doc))
  T.eraseFrom(open, "bo", "xanon")
  assert.equal(open.entries[0].partner, null)
  assert.deepEqual(open.entries[0].keys, ["al"])
  T.eraseFrom(open, "cy", "xanon")
  assert.equal(open.entries.length, 1)
  T.progress(doc, inst.start)
  T.eraseFrom(doc, "al", "xanon")
  assert.ok(!JSON.stringify(doc).includes('"al"'))
  assert.ok(JSON.stringify(doc.brackets).includes("Deleted player"))
  assert.deepEqual(doc.members.sort(), ["bo", "cy", "xanon"])
})
