// Storage for 98ish Calendar: calendars (with their members, invitations and labels),
// events (and memos), comments on events, and each calendar's activity feed.
// MongoDB when MONGODB_URI is set (collections calendars, calevents, calcomments,
// calactivity), otherwise memory (lost on restart).
//
// calendar: { id, kind: "personal" | "couple" | "group", name, color, coupleId, code,
//             members: [{ key, name, role: "owner" | "member", color, joinedAt, feed }],
//             invites: [{ key, name, by, at }], labels: [{ id, color, name }], createdAt, updatedAt }
// event:    { id, calendarId, kind: "event" | "memo", title, ...see validate.js, createdBy, ... }
// comment:  { id, calendarId, eventId, by, byName, text, at }
// activity: { id, calendarId, by, byName, action, title, eventId, when, at }

const mongoose = require("mongoose")

const ACTIVITY_KEPT = 200
const copy = (value) => (value === undefined || value === null ? value ?? null : JSON.parse(JSON.stringify(value)))

const memoryStore = () => {
  const calendars = new Map()
  const events = new Map() // calendarId -> Map(id -> event)
  const comments = new Map() // eventId -> [comment]
  const activity = new Map() // calendarId -> [entry]
  const box = (id) => events.get(id) || events.set(id, new Map()).get(id)
  return {
    kind: "memory",
    calendars: {
      get: async (id) => copy(calendars.get(id)) || null,
      forMember: async (key) => [...calendars.values()].filter((c) => c.members.some((m) => m.key === key)).map(copy),
      invitedTo: async (key) => [...calendars.values()].filter((c) => (c.invites || []).some((i) => i.key === key)).map(copy),
      byCode: async (code) => copy([...calendars.values()].find((c) => c.code && c.code === code)) || null,
      byCouple: async (coupleId) => copy([...calendars.values()].find((c) => c.coupleId === coupleId)) || null,
      byFeed: async (token) => copy([...calendars.values()].find((c) => c.members.some((m) => m.feed === token))) || null,
      save: async (calendar) => {
        calendars.set(calendar.id, copy(calendar))
        return calendar
      },
      remove: async (id) => {
        calendars.delete(id)
        for (const e of box(id).keys()) comments.delete(e)
        events.delete(id)
        activity.delete(id)
      },
    },
    events: {
      list: async (calendarId) => [...box(calendarId).values()].map(copy),
      get: async (calendarId, id) => copy(box(calendarId).get(id)) || null,
      count: async (calendarId) => box(calendarId).size,
      save: async (event) => {
        box(event.calendarId).set(event.id, copy(event))
        return event
      },
      remove: async (calendarId, id) => {
        comments.delete(id)
        return box(calendarId).delete(id)
      },
    },
    comments: {
      list: async (eventId) => (comments.get(eventId) || []).map(copy),
      count: async (eventId) => (comments.get(eventId) || []).length,
      add: async (comment) => {
        comments.set(comment.eventId, [...(comments.get(comment.eventId) || []), copy(comment)])
        return comment
      },
      remove: async (eventId, id) => {
        const list = comments.get(eventId) || []
        comments.set(eventId, list.filter((c) => c.id !== id))
        return list.length !== comments.get(eventId).length
      },
      // every comment someone wrote in a calendar (Delete My Account)
      removeBy: async (calendarId, key) => {
        let n = 0
        for (const [eventId, list] of comments) {
          const kept = list.filter((c) => !(c.calendarId === calendarId && c.by === key))
          n += list.length - kept.length
          comments.set(eventId, kept)
        }
        return n
      },
    },
    activity: {
      list: async (calendarId, limit = 50) => (activity.get(calendarId) || []).slice(-limit).reverse().map(copy),
      add: async (entry) => {
        activity.set(entry.calendarId, [...(activity.get(entry.calendarId) || []), copy(entry)].slice(-ACTIVITY_KEPT))
        return entry
      },
      removeBy: async (calendarId, key) => {
        const list = activity.get(calendarId) || []
        activity.set(calendarId, list.filter((a) => a.by !== key))
        return list.length - activity.get(calendarId).length
      },
    },
  }
}

const mixed = mongoose.Schema.Types.Mixed

const calendarSchema = new mongoose.Schema(
  {
    _id: String,
    kind: String,
    name: String,
    color: String,
    coupleId: { type: String, index: true },
    code: { type: String, index: true },
    members: mixed,
    memberKeys: { type: [String], index: true },
    feeds: { type: [String], index: true },
    invites: mixed,
    inviteKeys: { type: [String], index: true },
    labels: mixed,
    createdAt: Number,
    updatedAt: Number,
  },
  { versionKey: false, collection: "calendars", minimize: false }
)

const eventSchema = new mongoose.Schema({ _id: String, calendarId: { type: String, index: true }, data: mixed }, { versionKey: false, collection: "calevents", minimize: false })
const commentSchema = new mongoose.Schema(
  { _id: String, calendarId: { type: String, index: true }, eventId: { type: String, index: true }, data: mixed, at: Number },
  { versionKey: false, collection: "calcomments", minimize: false }
)
const activitySchema = new mongoose.Schema({ _id: String, calendarId: String, data: mixed, at: Number }, { versionKey: false, collection: "calactivity", minimize: false })
activitySchema.index({ calendarId: 1, at: -1 })

const mongoStore = (connection) => {
  const Calendar = connection.model("Calendar", calendarSchema)
  const Event = connection.model("CalEvent", eventSchema)
  const Comment = connection.model("CalComment", commentSchema)
  const Activity = connection.model("CalActivity", activitySchema)
  const calendar = (doc) => {
    if (!doc) return null
    const { _id, memberKeys, feeds, inviteKeys, ...rest } = doc
    return { id: _id, ...rest }
  }
  const data = (doc) => (doc ? doc.data : null)
  return {
    kind: "mongodb",
    calendars: {
      get: async (id) => calendar(await Calendar.findById(id).lean()),
      forMember: async (key) => (await Calendar.find({ memberKeys: key }).lean()).map(calendar),
      invitedTo: async (key) => (await Calendar.find({ inviteKeys: key }).lean()).map(calendar),
      byCode: async (code) => calendar(await Calendar.findOne({ code }).lean()),
      byCouple: async (coupleId) => calendar(await Calendar.findOne({ coupleId }).lean()),
      byFeed: async (token) => calendar(await Calendar.findOne({ feeds: token }).lean()),
      save: async (cal) => {
        const { id, ...rest } = cal
        const doc = { _id: id, ...rest, memberKeys: cal.members.map((m) => m.key), feeds: cal.members.map((m) => m.feed).filter(Boolean), inviteKeys: (cal.invites || []).map((i) => i.key) }
        await Calendar.replaceOne({ _id: id }, doc, { upsert: true })
        return cal
      },
      remove: async (id) => {
        await Promise.all([Calendar.deleteOne({ _id: id }), Event.deleteMany({ calendarId: id }), Comment.deleteMany({ calendarId: id }), Activity.deleteMany({ calendarId: id })])
      },
    },
    events: {
      list: async (calendarId) => (await Event.find({ calendarId }).limit(5000).lean()).map(data),
      get: async (calendarId, id) => data(await Event.findOne({ _id: id, calendarId }).lean()),
      count: async (calendarId) => Event.countDocuments({ calendarId }),
      save: async (event) => {
        await Event.replaceOne({ _id: event.id }, { _id: event.id, calendarId: event.calendarId, data: event }, { upsert: true })
        return event
      },
      remove: async (calendarId, id) => {
        await Comment.deleteMany({ eventId: id, calendarId })
        return (await Event.deleteOne({ _id: id, calendarId })).deletedCount > 0
      },
    },
    comments: {
      list: async (eventId) => (await Comment.find({ eventId }).sort({ at: 1 }).limit(500).lean()).map(data),
      count: async (eventId) => Comment.countDocuments({ eventId }),
      add: async (comment) => {
        await Comment.create({ _id: comment.id, calendarId: comment.calendarId, eventId: comment.eventId, data: comment, at: comment.at })
        return comment
      },
      remove: async (eventId, id) => (await Comment.deleteOne({ _id: id, eventId })).deletedCount > 0,
      removeBy: async (calendarId, key) => (await Comment.deleteMany({ calendarId, "data.by": key })).deletedCount || 0,
    },
    activity: {
      list: async (calendarId, limit = 50) => (await Activity.find({ calendarId }).sort({ at: -1 }).limit(limit).lean()).map(data),
      add: async (entry) => {
        await Activity.create({ _id: entry.id, calendarId: entry.calendarId, data: entry, at: entry.at })
        // keep the newest ACTIVITY_KEPT
        const old = await Activity.find({ calendarId: entry.calendarId }, { _id: 1 }).sort({ at: -1 }).skip(ACTIVITY_KEPT).lean()
        if (old.length) await Activity.deleteMany({ _id: { $in: old.map((o) => o._id) } })
        return entry
      },
      removeBy: async (calendarId, key) => (await Activity.deleteMany({ calendarId, "data.by": key })).deletedCount || 0,
    },
  }
}

const createCalendarStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[calendar] MONGODB_URI not set: calendars are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 5 }).asPromise()
  console.log("[calendar] connected to MongoDB")
  return mongoStore(connection)
}

module.exports = { memoryStore, createCalendarStore, ACTIVITY_KEPT }
