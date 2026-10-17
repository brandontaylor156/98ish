// Delete My Account and Pickleball 98's records from before it moved to its own site
const test = require("node:test")
const assert = require("node:assert/strict")
const { createPickleballLegacy } = require("../pickleballLegacy")

// a stand-in for MongoDB's db: records each call, answers with fixed counts
const fakeDb = () => {
  const calls = []
  return {
    calls,
    collection: (name) => ({
      deleteMany: async (filter) => (calls.push({ name, op: "delete", filter }), { deletedCount: 1 }),
      updateMany: async (filter, update, options) => (calls.push({ name, op: "update", filter, update, options }), { modifiedCount: 2 }),
    }),
  }
}

test("erases the person's part of every old Pickleball 98 collection", async () => {
  const db = fakeDb()
  const r = await createPickleballLegacy({ db }).eraseAccount({ key: "alice" })
  const deleted = db.calls.filter((c) => c.op === "delete").map((c) => c.name)
  assert.deepEqual(deleted.sort(), ["parkclones", "parkfinds", "pbmatches", "pbsessions", "pbtourneys", "pbtrophies", "roamlife"])
  const updated = db.calls.filter((c) => c.op === "update").map((c) => c.name)
  assert.deepEqual(updated.sort(), ["parkclones", "pbsessions", "roamlife", "roamlife"])
  assert.deepEqual(r, { removed: 7, changed: 8 })
  // others' sessions lose them entirely (members, invitations, chat, RSVPs, names)
  const s = db.calls.find((c) => c.name === "pbsessions" && c.op === "update")
  assert.deepEqual(s.update.$pull, { members: "alice", invited: "alice", chat: { k: "alice" } })
  assert.deepEqual(Object.keys(s.update.$unset).sort(), ["names.alice", "rsvps.alice"])
})

test("a key that isn't a screen name key touches nothing", async () => {
  const db = fakeDb()
  for (const key of ["", "A", "$where", { $ne: null }, "ab"]) assert.deepEqual(await createPickleballLegacy({ db }).eraseAccount({ key }), { removed: 0, changed: 0 })
  assert.equal(db.calls.length, 0)
})

test("without MongoDB there's nothing stored", async () => {
  const saved = process.env.MONGODB_URI
  delete process.env.MONGODB_URI
  assert.deepEqual(await createPickleballLegacy().eraseAccount({ key: "alice" }), { removed: 0, changed: 0 })
  if (saved !== undefined) process.env.MONGODB_URI = saved
})
