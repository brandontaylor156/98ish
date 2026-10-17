// Pickleball 98 moved to its own site (repo brandontaylor156/pickleball-98, its own server and
// player names), so 98ish's server no longer runs Real Games, Living Park, My Park, Explore or
// tournaments. What 98ish accounts saved there before the move still sits in MongoDB until the
// owner decides what to do with it; Delete My Account erases a person's part of it here.
//
// Nobody can see these records any more, so shared ones are simply deleted when they involve
// the person (a session they host, a match or tournament they played); in sessions someone
// else hosts they're taken out (members, invitations, RSVPs, names, chat), in clones' logs
// they become "Deleted player", and places others shared with them and gifts they sent go.
// Without MONGODB_URI (dev and tests) there's nothing stored: every count is 0.

const mongoose = require("mongoose")

const KEY = /^[a-z][a-z0-9]{2,15}$/

const createPickleballLegacy = ({ db = null } = {}) => {
  const ready = async () => {
    if (db) return db
    if (!process.env.MONGODB_URI) return null
    if (mongoose.connection.readyState === 0) await mongoose.connect(process.env.MONGODB_URI)
    await mongoose.connection.asPromise()
    return mongoose.connection.db
  }
  return {
    // Delete My Account: -> what was removed or changed, per collection
    eraseAccount: async ({ key }) => {
      const d = await ready()
      if (!d || typeof key !== "string" || !KEY.test(key)) return { removed: 0, changed: 0 }
      const c = (name) => d.collection(name)
      const n = { removed: 0, changed: 0 }
      const del = async (name, filter) => (n.removed += (await c(name).deleteMany(filter)).deletedCount || 0)
      const upd = async (name, filter, update, options) => (n.changed += (await c(name).updateMany(filter, update, options)).modifiedCount || 0)
      // Real Games: sessions they host, and every match they played or logged
      await del("pbsessions", { host: key })
      await upd("pbsessions", { members: key }, { $pull: { members: key, invited: key, chat: { k: key } }, $unset: { [`rsvps.${key}`]: "", [`names.${key}`]: "" } })
      await del("pbmatches", { $or: [{ keys: key }, { by: key }] })
      // tournaments they were in, and their trophy shelf
      await del("pbtourneys", { members: key })
      await del("pbtrophies", { key })
      // Living Park: their clone; others' clones' logs keep the game but not who
      await del("parkclones", { key })
      await upd("parkclones", { "log.byKey": key }, { $set: { "log.$[e].byKey": null, "log.$[e].by": "Deleted player" } }, { arrayFilters: [{ "e.byKey": key }] })
      // My Park's finds and Explore's Home/Work, Bag and gifts
      await del("parkfinds", { key })
      await del("roamlife", { key })
      await upd("roamlife", { "places.shared": key }, { $pull: { "places.$[].shared": key } })
      await upd("roamlife", { "gifts.from": key }, { $pull: { gifts: { from: key } } })
      return n
    },
  }
}

module.exports = { createPickleballLegacy }
