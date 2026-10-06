// Buddy Locator on the 98ish server: one small record per account (MongoDB collection
// "locations" when MONGODB_URI is set, otherwise memory, lost on restart). A record:
//   { key, name,
//     shares: [{ to, name, until (ms | null = indefinitely), since }]   who may see me
//     paused, coarse,                                                     my switches
//     pos: { lat, lon, acc, at } | null    my LATEST position only (no history); null while
//                                          paused or sharing with nobody
//     places: [{ id, name, lat, lon, r }]  my named places
//     watches: [{ id, who, place, on, inside }]  "tell me when <who> arrives at/leaves <place>"
//     asks: [{ from, name, at }]           people asking to see my location
//     changedAt }
// About 1-3 KB each. Edits to my own record replace it (put); the few things other people
// change in my record are targeted updates (addAsk, removeAsk, setInside, pullMentions), so
// they never overwrite my own edits.

const mongoose = require("mongoose")

const copy = (doc) => (doc ? JSON.parse(JSON.stringify(doc)) : null)
const blank = (key, name) => ({ key, name: name || key, shares: [], paused: false, coarse: false, pos: null, places: [], watches: [], asks: [], changedAt: 0 })

const memoryStore = () => {
  const docs = new Map()
  const all = () => [...docs.values()]
  return {
    kind: "memory",
    get: async (key) => copy(docs.get(key)),
    put: async (doc) => {
      docs.set(doc.key, copy(doc))
    },
    remove: async (key) => docs.delete(key),
    // records that share with `key` (active or not; the caller checks the time)
    sharingWith: async (key) => all().filter((d) => d.shares.some((s) => s.to === key)).map(copy),
    // records with a share that has ended or an ask that's too old
    expired: async (now, askBefore) => all().filter((d) => d.shares.some((s) => s.until != null && s.until <= now) || d.asks.some((a) => a.at < askBefore)).map(copy),
    addAsk: async (key, name, ask, max) => {
      const doc = docs.get(key) || blank(key, name)
      doc.asks = [...doc.asks.filter((a) => a.from !== ask.from), ask].slice(-max)
      docs.set(key, doc)
    },
    removeAsk: async (key, from) => {
      const doc = docs.get(key)
      if (doc) doc.asks = doc.asks.filter((a) => a.from !== from)
    },
    setInside: async (key, watchId, inside) => {
      const w = docs.get(key)?.watches.find((x) => x.id === watchId)
      if (w) w.inside = inside
    },
    // take `key` out of everyone else's record (Delete My Account): shares to them, their
    // asks, and watches on them -> number of records changed
    pullMentions: async (key) => {
      let n = 0
      for (const doc of docs.values()) {
        const before = JSON.stringify([doc.shares, doc.asks, doc.watches])
        doc.shares = doc.shares.filter((s) => s.to !== key)
        doc.asks = doc.asks.filter((a) => a.from !== key)
        doc.watches = doc.watches.filter((w) => w.who !== key)
        if (JSON.stringify([doc.shares, doc.asks, doc.watches]) !== before) n++
      }
      return n
    },
    size: () => docs.size,
  }
}

const mongoStore = async (uri) => {
  if (mongoose.connection.readyState === 0) await mongoose.connect(uri)
  const share = new mongoose.Schema({ to: String, name: String, until: { type: Number, default: null }, since: Number }, { _id: false })
  const place = new mongoose.Schema({ id: String, name: String, lat: Number, lon: Number, r: Number }, { _id: false })
  const watch = new mongoose.Schema({ id: String, who: String, place: String, on: String, inside: { type: Boolean, default: null } }, { _id: false })
  const ask = new mongoose.Schema({ from: String, name: String, at: Number }, { _id: false })
  const schema = new mongoose.Schema(
    {
      key: { type: String, required: true, unique: true },
      name: String,
      shares: { type: [share], default: [] },
      paused: { type: Boolean, default: false },
      coarse: { type: Boolean, default: false },
      pos: { type: mongoose.Schema.Types.Mixed, default: null },
      places: { type: [place], default: [] },
      watches: { type: [watch], default: [] },
      asks: { type: [ask], default: [] },
      changedAt: { type: Number, default: 0 },
    },
    { minimize: false, versionKey: false }
  )
  schema.index({ "shares.to": 1 })
  schema.index({ "shares.until": 1 })
  schema.index({ "asks.from": 1 })
  schema.index({ "asks.at": 1 })
  schema.index({ "watches.who": 1 })
  const Location = mongoose.models.Location || mongoose.model("Location", schema, "locations")
  const lean = (q) => q.lean().then((d) => (Array.isArray(d) ? d.map(strip) : strip(d)))
  const strip = (d) => {
    if (!d) return null
    delete d._id
    return d
  }
  return {
    kind: "mongo",
    get: (key) => lean(Location.findOne({ key })),
    put: async (doc) => {
      const { key, ...rest } = doc
      await Location.updateOne({ key }, { $set: rest }, { upsert: true })
    },
    remove: async (key) => (await Location.deleteOne({ key })).deletedCount > 0,
    sharingWith: (key) => lean(Location.find({ "shares.to": key })),
    expired: (now, askBefore) => lean(Location.find({ $or: [{ shares: { $elemMatch: { until: { $ne: null, $lte: now } } } }, { "asks.at": { $lt: askBefore } }] })),
    addAsk: async (key, name, ask, max) => {
      const { key: _key, asks: _asks, ...init } = blank(key, name)
      await Location.updateOne({ key }, { $setOnInsert: init }, { upsert: true })
      await Location.updateOne({ key }, { $pull: { asks: { from: ask.from } } })
      await Location.updateOne({ key }, { $push: { asks: { $each: [ask], $slice: -max } } })
    },
    removeAsk: async (key, from) => {
      await Location.updateOne({ key }, { $pull: { asks: { from } } })
    },
    setInside: async (key, watchId, inside) => {
      await Location.updateOne({ key, "watches.id": watchId }, { $set: { "watches.$.inside": inside } })
    },
    pullMentions: async (key) =>
      (await Location.updateMany({ $or: [{ "shares.to": key }, { "asks.from": key }, { "watches.who": key }] }, { $pull: { shares: { to: key }, asks: { from: key }, watches: { who: key } } })).modifiedCount,
  }
}

const createLocateStore = (uri = process.env.MONGODB_URI) => (uri ? mongoStore(uri) : Promise.resolve(memoryStore()))

module.exports = { createLocateStore, memoryStore, blank }
