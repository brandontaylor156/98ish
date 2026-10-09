// My Park finds, kept per 98 Messenger account (MongoDB collection "parkfinds" when MONGODB_URI
// is set, otherwise memory): the park's easter eggs you've found, so they follow you to every
// device you sign on to. Today one: "keys", Vince's car keys (give the thirsty regular by a
// venue's drinks machine a cold drink from it, client park/leisure/parkside.js), which unlock
// his car, the Sundowner GT, in Explore Valencia (client/src/roam/).
//
// A record: { key (the account), finds: { <id>: { at, venue } }, changedAt }. Tiny: a few known
// ids (FINDS), at most one record per account. Delete My Account removes it (eraseAccount,
// server/account/index.js "park finds").
//
//   const finds = createParkFinds({ store })   store: memoryFindsStore() | mongoFindsStore()
//   finds.get(key) -> { ok, finds }
//   finds.add(key, id, { venue }) -> { ok, finds, fresh }   (fresh: found just now)
//   finds.eraseAccount({ key }) -> { removed }

const mongoose = require("mongoose")

const FINDS = ["keys"]
const VENUE = /^[a-z]{2,20}$/
const copy = (v) => (v ? JSON.parse(JSON.stringify(v)) : v)

const memoryFindsStore = () => {
  const docs = new Map()
  return {
    docs,
    get: async (key) => copy(docs.get(key)) || null,
    put: async (doc) => {
      docs.set(doc.key, copy(doc))
      return true
    },
    remove: async (key) => docs.delete(key),
  }
}

const mongoFindsStore = () => {
  const schema = new mongoose.Schema({ key: { type: String, required: true, unique: true }, finds: { type: mongoose.Schema.Types.Mixed, default: {} }, changedAt: Number }, { minimize: false })
  const Model = mongoose.models.ParkFind || mongoose.model("ParkFind", schema, "parkfinds")
  return {
    get: async (key) => {
      const d = await Model.findOne({ key }).lean()
      return d ? { key: d.key, finds: d.finds || {}, changedAt: d.changedAt } : null
    },
    put: async (doc) => {
      await Model.updateOne({ key: doc.key }, { $set: { finds: doc.finds, changedAt: doc.changedAt } }, { upsert: true })
      return true
    },
    remove: async (key) => (await Model.deleteOne({ key })).deletedCount > 0,
  }
}

const clean = (finds) => {
  const out = {}
  for (const id of FINDS) {
    const f = finds?.[id]
    if (f && Number.isFinite(f.at)) out[id] = { at: f.at, venue: typeof f.venue === "string" && VENUE.test(f.venue) ? f.venue : null }
  }
  return out
}

const createParkFinds = ({ store = null, now = () => Date.now() } = {}) => {
  const db = store || (process.env.MONGODB_URI ? mongoFindsStore() : memoryFindsStore())
  const keyOk = (key) => typeof key === "string" && key.length > 0 && key.length <= 64
  return {
    FINDS,
    get: async (key) => {
      if (!keyOk(key)) return { ok: false, error: "Sign on to 98 Messenger to keep your finds." }
      const d = await db.get(key)
      return { ok: true, finds: clean(d?.finds) }
    },
    add: async (key, id, { venue = null } = {}) => {
      if (!keyOk(key)) return { ok: false, error: "Sign on to 98 Messenger to keep your finds." }
      if (!FINDS.includes(id)) return { ok: false, error: "That isn't something to find." }
      const d = await db.get(key)
      const finds = clean(d?.finds)
      if (finds[id]) return { ok: true, finds, fresh: false }
      finds[id] = { at: now(), venue: typeof venue === "string" && VENUE.test(venue) ? venue : null }
      await db.put({ key, finds, changedAt: now() })
      return { ok: true, finds, fresh: true }
    },
    eraseAccount: async ({ key }) => ({ removed: keyOk(key) ? !!(await db.remove(key)) : false }),
  }
}

module.exports = { createParkFinds, memoryFindsStore, mongoFindsStore, FINDS }
