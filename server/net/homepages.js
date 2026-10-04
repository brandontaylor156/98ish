// Member homepages: every 98 Messenger account can publish one page, built in HomePage
// Studio and shown inside Internet Explorer at http://www.98ish.com/~screenname.
//   GET    /api/homepages?sort=newest|popular&page=1   the members directory, 20 a page
//   GET    /api/homepages/:key                         one published page
//   POST   /api/homepages/:key/hit                     counts a visit { visitor }
//   GET    /api/ring                                   member pages in the 98ish Web Ring
//   GET    /api/homepage        (signed on)            your own published page
//   PUT    /api/homepage        (signed on)            publish { page }
//   DELETE /api/homepage        (signed on)            unpublish
// A page is a structured document (a title, page settings and a list of blocks), never
// HTML: every field is checked against a whitelist here and the client draws it as text.
// Pages live in MongoDB when MONGODB_URI is set, otherwise in memory.

const express = require("express")
const mongoose = require("mongoose")
const { limiter } = require("./limiter")
const { isProfane, LINK } = require("./guestbook")
const { sessionFrom } = require("../aim/auth")

const MAX_PAGE_BYTES = 500 * 1024 // the whole page, pictures included
const MAX_IMAGE_BYTES = 150 * 1024 // one picture, decoded
const MAX_IMAGES = 8
const MAX_BLOCKS = 60
const PER_PAGE = 20
const HIT_DEDUPE_MS = 10 * 60_000

const BACKGROUNDS = ["stars", "clouds", "bricks", "checker", "hearts", "grid", "waves", "flames", "solid"]
const FONTS = ["times", "comic", "courier", "arial"]
const SONGS = ["startup", "highway", "fusion", "neonpop", "ballad", "chiptune", "ambient", "funky"]
const CLIPART = ["construction", "globe", "flames", "mailbox", "new", "dancer", "rainbow"]
const ALIGNS = ["left", "center", "right"]
const BLOCK_TYPES = ["heading", "paragraph", "marquee", "blink", "image", "divider", "links", "counter", "guestbook", "webring"]

const DEFAULTS = { bg: "stars", bgColor: "#000033", text: "#ffff66", link: "#66ffff", font: "times" }

// ---------- validation ----------

class Invalid extends Error {}
const fail = (message) => {
  throw new Invalid(message)
}

const clean = (text) =>
  String(text ?? "")
    .replace(/[\u0000-\u0008\u000B-\u001F\u007F​-‏‪-‮⁦-⁩]/g, "")
    .replace(/\r\n?/g, "\n")

const HTML = /<\s*\/?\s*[a-z!][^>]*>/i
const COLOR = /^#[0-9a-f]{6}$/i

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback)
const color = (value, fallback = "") => {
  if (value === undefined || value === null || value === "") return fallback
  if (typeof value !== "string" || !COLOR.test(value)) fail("Colors must look like #ff00ff.")
  return value.toLowerCase()
}

// Visitor-facing text: plain, family friendly, no markup, no links (those go in a Link List)
const text = (value, { max, min = 1, label, lines = true }) => {
  if (value !== undefined && value !== null && typeof value !== "string") fail(`${label} must be text.`)
  let result = clean(value)
  result = lines ? result.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n") : result.replace(/\s+/g, " ")
  result = result.trim()
  if (result.length < min) fail(`${label} can't be empty.`)
  if (result.length > max) fail(`${label} can be at most ${max} characters.`)
  if (HTML.test(result)) fail(`${label}: HTML tags aren't allowed. Use the block's options to style it.`)
  if (LINK.test(result)) fail(`${label}: put web addresses in a Link List block.`)
  if (isProfane(result)) fail(`${label}: please keep it family friendly!`)
  return result
}

// http(s) addresses only, to a real-looking host, no passwords in them
const normalizeLink = (value) => {
  let url = String(value ?? "").trim()
  if (/^www\./i.test(url)) url = `http://${url}`
  if (!/^https?:\/\//i.test(url) || url.length > 200 || /\s/.test(url)) return null
  try {
    const parsed = new URL(url)
    if (!/^https?:$/.test(parsed.protocol) || parsed.username || parsed.password) return null
    if (!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(parsed.hostname)) return null
    return parsed.href.length <= 200 && !isProfane(parsed.href) ? parsed.href : null
  } catch {
    return null
  }
}

const MAGIC = {
  png: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47,
  jpeg: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  gif: (b) => b.length > 6 && b.toString("latin1", 0, 4) === "GIF8",
  webp: (b) => b.length > 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP",
}

// A picture from the member's drive: a base64 PNG/JPEG/GIF/WebP data URL whose bytes really
// are that kind of picture, under the size cap
const imageData = (value) => {
  const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(String(value ?? ""))
  if (!match) fail("Pictures must be PNG, JPEG, GIF or WebP images.")
  const bytes = Buffer.from(match[2], "base64")
  if (bytes.length > MAX_IMAGE_BYTES) fail(`That picture is too big. Pictures can be at most ${MAX_IMAGE_BYTES / 1024} KB.`)
  if (!MAGIC[match[1]](bytes)) fail("That picture file is damaged.")
  return value
}

const flag = (value) => value === true

const BLOCKS = {
  heading: (b) => ({
    text: text(b.text, { max: 80, label: "Heading", lines: false }),
    size: pick(b.size, ["h1", "h2", "h3"], "h1"),
    align: pick(b.align, ALIGNS, "center"),
    color: color(b.color),
    effect: pick(b.effect, ["none", "rainbow", "shadow"], "none"),
  }),
  paragraph: (b) => ({
    text: text(b.text, { max: 2000, label: "Paragraph" }),
    align: pick(b.align, ALIGNS, "left"),
    color: color(b.color),
    size: pick(b.size, ["small", "normal", "big", "huge"], "normal"),
    bold: flag(b.bold),
    italic: flag(b.italic),
    underline: flag(b.underline),
  }),
  marquee: (b) => ({
    text: text(b.text, { max: 200, label: "Marquee", lines: false }),
    color: color(b.color),
    bgColor: color(b.bgColor),
    speed: pick(b.speed, ["slow", "normal", "fast"], "normal"),
    direction: pick(b.direction, ["left", "right"], "left"),
  }),
  blink: (b) => ({
    text: text(b.text, { max: 100, label: "Blinking text", lines: false }),
    color: color(b.color),
    align: pick(b.align, ALIGNS, "center"),
  }),
  image: (b) => {
    const art = b.art === undefined || b.art === null || b.art === "" ? null : b.art
    if (art !== null && !CLIPART.includes(art)) fail("That clip art doesn't exist.")
    if (art === null && !b.src) fail("Pick a picture or some clip art.")
    return {
      ...(art ? { art } : { src: imageData(b.src) }),
      alt: b.alt ? text(b.alt, { max: 100, label: "Picture description", lines: false }) : "",
      align: pick(b.align, ALIGNS, "center"),
    }
  },
  divider: (b) => ({ style: pick(b.style, ["line", "rainbow", "dots", "stars"], "line") }),
  links: (b) => {
    const items = Array.isArray(b.items) ? b.items : []
    if (!items.length) fail("A Link List needs at least one link.")
    if (items.length > 20) fail("A Link List can have at most 20 links.")
    return {
      title: b.title ? text(b.title, { max: 60, label: "Link List title", lines: false }) : "",
      items: items.map((item) => {
        const url = normalizeLink(item?.url)
        if (!url) fail("Links must be http:// or https:// web addresses.")
        return { label: text(item?.label, { max: 60, label: "Link name", lines: false }), url }
      }),
    }
  },
  counter: (b) => ({ label: b.label ? text(b.label, { max: 60, label: "Counter label", lines: false }) : "" }),
  guestbook: (b) => ({
    style: pick(b.style, ["link", "button"], "button"),
    text: b.text ? text(b.text, { max: 60, label: "Guestbook link", lines: false }) : "",
  }),
  webring: () => ({}),
}

// -> { ok: true, page, size } | { ok: false, error }
const validatePage = (input) => {
  try {
    if (!input || typeof input !== "object" || Array.isArray(input)) fail("That page is empty.")
    if (!Array.isArray(input.blocks)) fail("A page needs a list of blocks.")
    if (input.blocks.length > MAX_BLOCKS) fail(`A page can have at most ${MAX_BLOCKS} blocks.`)
    const blocks = input.blocks.map((block, i) => {
      if (!block || typeof block !== "object" || !BLOCK_TYPES.includes(block.type)) fail(`Block ${i + 1} isn't a kind of block HomePage Studio knows.`)
      return { type: block.type, ...BLOCKS[block.type](block) }
    })
    if (blocks.filter((b) => b.src).length > MAX_IMAGES) fail(`A page can have at most ${MAX_IMAGES} of your own pictures.`)
    const page = {
      title: text(input.title, { max: 60, label: "Page title", lines: false }),
      bg: pick(input.bg, BACKGROUNDS, DEFAULTS.bg),
      bgColor: color(input.bgColor, DEFAULTS.bgColor),
      text: color(input.text, DEFAULTS.text),
      link: color(input.link, DEFAULTS.link),
      font: pick(input.font, FONTS, DEFAULTS.font),
      sparkle: flag(input.sparkle),
      badge: flag(input.badge),
      music: input.music ? pick(input.music, SONGS, null) ?? fail("That song isn't in the Media Player.") : "",
      blocks,
    }
    const size = Buffer.byteLength(JSON.stringify(page))
    if (size > MAX_PAGE_BYTES) fail(`That page is too big (${Math.ceil(size / 1024)} KB). Pages can be at most ${MAX_PAGE_BYTES / 1024} KB: use fewer or smaller pictures.`)
    return { ok: true, page, size }
  } catch (error) {
    if (error instanceof Invalid) return { ok: false, error: error.message }
    throw error
  }
}

// ---------- storage ----------

const summary = (doc) => ({
  key: doc.key ?? doc._id,
  screenName: doc.screenName,
  title: doc.title,
  hits: doc.hits || 0,
  publishedAt: new Date(doc.publishedAt).getTime(),
  updatedAt: new Date(doc.updatedAt).getTime(),
})
const full = (doc) => doc && { ...summary(doc), page: doc.page }

const memoryStore = () => {
  const pages = new Map() // key -> { key, screenName, title, page, size, hits, publishedAt, updatedAt }
  const sorted = (sort) =>
    [...pages.values()].sort((a, b) => (sort === "popular" ? b.hits - a.hits || b.updatedAt - a.updatedAt : b.updatedAt - a.updatedAt))
  return {
    kind: "memory",
    get: async (key) => full(pages.get(key)),
    put: async (key, { screenName, title, page, size }) => {
      const old = pages.get(key)
      const now = new Date()
      const doc = { key, screenName, title, page, size, hits: old?.hits || 0, publishedAt: old?.publishedAt || now, updatedAt: now }
      pages.set(key, doc)
      return full(doc)
    },
    remove: async (key) => pages.delete(key),
    list: async ({ sort, skip, limit }) => ({ total: pages.size, pages: sorted(sort).slice(skip, skip + limit).map(summary) }),
    ring: async () => [...pages.values()].sort((a, b) => a.publishedAt - b.publishedAt).slice(0, 500).map(summary),
    hit: async (key, increment) => {
      const doc = pages.get(key)
      if (!doc) return null
      if (increment) doc.hits++
      return doc.hits
    },
  }
}

const homepageSchema = new mongoose.Schema(
  {
    _id: String, // the screen name key
    screenName: String,
    title: String,
    page: mongoose.Schema.Types.Mixed,
    size: Number,
    hits: { type: Number, default: 0 },
    publishedAt: Date,
    updatedAt: Date,
  },
  { versionKey: false }
)
homepageSchema.index({ updatedAt: -1 })
homepageSchema.index({ hits: -1 })

const mongoStore = (connection) => {
  const Homepage = connection.model("Homepage", homepageSchema)
  const LIST_FIELDS = { screenName: 1, title: 1, hits: 1, publishedAt: 1, updatedAt: 1 }
  return {
    kind: "mongodb",
    get: async (key) => full(await Homepage.findById(key).lean()),
    put: async (key, { screenName, title, page, size }) => {
      const now = new Date()
      const doc = await Homepage.findOneAndUpdate(
        { _id: key },
        { $set: { screenName, title, page, size, updatedAt: now }, $setOnInsert: { publishedAt: now, hits: 0 } },
        { upsert: true, returnDocument: "after" }
      ).lean()
      return full(doc)
    },
    remove: async (key) => (await Homepage.deleteOne({ _id: key })).deletedCount > 0,
    list: async ({ sort, skip, limit }) => {
      const order = sort === "popular" ? { hits: -1, updatedAt: -1 } : { updatedAt: -1 }
      const [total, docs] = await Promise.all([Homepage.estimatedDocumentCount(), Homepage.find({}, LIST_FIELDS).sort(order).skip(skip).limit(limit).lean()])
      return { total, pages: docs.map(summary) }
    },
    ring: async () => (await Homepage.find({}, LIST_FIELDS).sort({ publishedAt: 1 }).limit(500).lean()).map(summary),
    hit: async (key, increment) => {
      const doc = increment
        ? await Homepage.findOneAndUpdate({ _id: key }, { $inc: { hits: 1 } }, { returnDocument: "after", projection: { hits: 1 } }).lean()
        : await Homepage.findById(key, { hits: 1 }).lean()
      return doc ? doc.hits : null
    },
  }
}

const createHomepageStore = async (uri = process.env.MONGODB_URI) => {
  if (!uri) {
    console.warn("[homepages] MONGODB_URI not set: member homepages are kept in memory")
    return memoryStore()
  }
  const connection = await mongoose.createConnection(uri, { maxPoolSize: 5 }).asPromise()
  console.log("[homepages] connected to MongoDB")
  return mongoStore(connection)
}

// ---------- HTTP ----------

const ipOf = (request) => String(request.headers["x-forwarded-for"] || request.socket.remoteAddress || "").split(",")[0].trim()
const KEY = /^[a-z][a-z0-9]{2,15}$/

const homepageRouter = ({ store: storeOrPromise, aim: initialAim = null, limits = {} } = {}) => {
  let aim = initialAim
  let storePromise = null
  const getStore = () => (storePromise ??= Promise.resolve(storeOrPromise || createHomepageStore()))
  getStore().catch((error) => {
    console.error("[homepages] storage failed to start", error.message)
    storePromise = null
  })

  const publishes = limiter(limits.publishesPerHour ?? 20, 60 * 60_000)
  const publishBurst = limiter(limits.publishesPerMinute ?? 4, 60_000)
  const reads = limiter(limits.readsPerMinute ?? 240, 60_000)
  const hitsPerIp = limiter(60, 60_000)
  const recentHits = new Map() // "ip visitor key" -> time

  const router = express.Router()

  const handle = (fn) => async (request, response) => {
    try {
      await fn(request, response)
    } catch (error) {
      console.error("[homepages]", error.message)
      response.status(503).json({ ok: false, error: "The 98ish web server is taking a nap. Please try again later." })
    }
  }

  // Everything that changes a page needs a signed-on 98 Messenger user
  const signedOn = (request, response) => {
    const session = sessionFrom(aim, request)
    if (!session) response.status(401).json({ ok: false, error: "Sign on to 98 Messenger to publish a homepage." })
    return session
  }

  const readLimited = (request, response) => {
    if (!reads(ipOf(request))) return false
    response.status(429).json({ ok: false, error: "Slow down!" })
    return true
  }

  router.get(
    "/homepages",
    handle(async (request, response) => {
      if (readLimited(request, response)) return
      const sort = request.query.sort === "popular" ? "popular" : "newest"
      const page = Math.max(1, Math.min(500, parseInt(request.query.page, 10) || 1))
      const { total, pages } = await (await getStore()).list({ sort, skip: (page - 1) * PER_PAGE, limit: PER_PAGE })
      response.json({ ok: true, sort, page, pages: Math.max(1, Math.ceil(total / PER_PAGE)), total, members: pages })
    })
  )

  router.get(
    "/homepages/:key",
    handle(async (request, response) => {
      if (readLimited(request, response)) return
      const key = String(request.params.key).toLowerCase()
      const found = KEY.test(key) && (await (await getStore()).get(key))
      if (!found) return response.status(404).json({ ok: false, error: "That member hasn't published a homepage yet." })
      response.json({ ok: true, ...found })
    })
  )

  router.post(
    "/homepages/:key/hit",
    express.json({ limit: "1kb" }),
    handle(async (request, response) => {
      const key = String(request.params.key).toLowerCase()
      if (!KEY.test(key)) return response.status(404).json({ ok: false })
      const ip = ipOf(request)
      const visitor = /^[a-z0-9]{8,32}$/i.test(request.body?.visitor) ? request.body.visitor : ""
      // the owner looking at their own page doesn't count
      const own = sessionFrom(aim, request)?.key === key
      const dedupe = `${ip} ${visitor} ${key}`
      const now = Date.now()
      const fresh = !own && (!recentHits.has(dedupe) || now - recentHits.get(dedupe) > HIT_DEDUPE_MS) && !hitsPerIp(ip)
      if (fresh) recentHits.set(dedupe, now)
      if (recentHits.size > 20000) for (const [k, t] of recentHits) if (now - t > HIT_DEDUPE_MS) recentHits.delete(k)
      const count = await (await getStore()).hit(key, fresh)
      if (count === null) return response.status(404).json({ ok: false })
      response.json({ ok: true, count })
    })
  )

  router.get(
    "/ring",
    handle(async (request, response) => {
      if (readLimited(request, response)) return
      const members = await (await getStore()).ring()
      response.json({ ok: true, members: members.map((m) => ({ path: `/~${m.key}`, title: m.title, screenName: m.screenName })) })
    })
  )

  router.get(
    "/homepage",
    handle(async (request, response) => {
      const session = signedOn(request, response)
      if (!session) return
      const found = await (await getStore()).get(session.key)
      response.json({ ok: true, published: found || null, url: `http://www.98ish.com/~${session.key}` })
    })
  )

  router.put(
    "/homepage",
    // signed on before the (big) body is even read
    (request, response, next) => signedOn(request, response) && next(),
    express.json({ limit: Math.ceil(MAX_PAGE_BYTES * 1.2) }),
    handle(async (request, response) => {
      const session = signedOn(request, response)
      if (!session) return
      const result = validatePage(request.body?.page)
      if (!result.ok) return response.status(400).json(result)
      if (publishes.over(session.key) || publishBurst.over(session.key)) {
        return response.status(429).json({ ok: false, error: "You're publishing too often. Wait a few minutes and try again." })
      }
      publishes(session.key)
      publishBurst(session.key)
      const saved = await (await getStore()).put(session.key, { screenName: session.user.screenName, title: result.page.title, page: result.page, size: result.size })
      response.json({ ok: true, published: saved, url: `http://www.98ish.com/~${session.key}` })
    })
  )

  router.delete(
    "/homepage",
    handle(async (request, response) => {
      const session = signedOn(request, response)
      if (!session) return
      const removed = await (await getStore()).remove(session.key)
      response.json({ ok: true, removed })
    })
  )

  // A body over the size limit, or one that isn't JSON
  router.use((error, request, response, next) => {
    if (error?.type === "entity.too.large") return response.status(413).json({ ok: false, error: `That page is too big. Pages can be at most ${MAX_PAGE_BYTES / 1024} KB.` })
    if (error?.type === "entity.parse.failed") return response.status(400).json({ ok: false, error: "That page couldn't be read." })
    next(error)
  })

  // Delete My Account (../account): their published page
  const eraseAccount = async ({ key }) => ({ removed: !!(await (await getStore()).remove(key)) })

  return Object.assign(router, { useAim: (value) => (aim = value), eraseAccount })
}

module.exports = {
  validatePage,
  normalizeLink,
  memoryStore,
  createHomepageStore,
  homepageRouter,
  BLOCK_TYPES,
  BACKGROUNDS,
  CLIPART,
  SONGS,
  MAX_PAGE_BYTES,
  MAX_IMAGE_BYTES,
}
