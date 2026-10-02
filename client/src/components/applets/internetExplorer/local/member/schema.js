// What a member homepage can contain. The server (server/net/homepages.js) checks the same
// lists, so keep them in step.

// Each background comes with colors that are easy to read on it (changeable afterwards)
export const BACKGROUNDS = [
  { id: "stars", label: "Night Sky", colors: { bgColor: "#000033", text: "#ffff66", link: "#66ffff" } },
  { id: "clouds", label: "Clouds", colors: { bgColor: "#5fa8ff", text: "#000080", link: "#c00060" } },
  { id: "bricks", label: "Bricks", colors: { bgColor: "#8a2f1c", text: "#ffffff", link: "#ffff00" } },
  { id: "checker", label: "Checkerboard", colors: { bgColor: "#400080", text: "#ffffff", link: "#00ffff" } },
  { id: "hearts", label: "Hearts", colors: { bgColor: "#ffc6dd", text: "#800040", link: "#0000ee" } },
  { id: "grid", label: "Neon Grid", colors: { bgColor: "#120024", text: "#00ffcc", link: "#ff66ff" } },
  { id: "waves", label: "Ocean Waves", colors: { bgColor: "#0b4fa8", text: "#ffffff", link: "#ffee00" } },
  { id: "flames", label: "Flames", colors: { bgColor: "#140000", text: "#ffcc00", link: "#ff6633" } },
  { id: "solid", label: "Plain Color", colors: { bgColor: "#ffffff", text: "#000000", link: "#0000ee" } },
]

export const FONTS = [
  { id: "times", label: "Times New Roman", css: '"Times New Roman", Times, serif' },
  { id: "comic", label: "Comic Sans", css: '"Comic Sans MS", "Comic Sans", "Chalkboard SE", "Comic Neue", cursive' },
  { id: "courier", label: "Courier New", css: '"Courier New", Courier, monospace' },
  { id: "arial", label: "Arial", css: "Arial, Helvetica, sans-serif" },
]

export const CLIPART = [
  { id: "construction", label: "Under Construction" },
  { id: "globe", label: "Spinning Globe" },
  { id: "flames", label: "Flames" },
  { id: "mailbox", label: "Mailbox" },
  { id: "new", label: "NEW! Burst" },
  { id: "dancer", label: "Dancing Dumpling" },
  { id: "rainbow", label: "Rainbow Bar" },
]

// The Media Player's songs (ids match its songs/ folder)
export const SONGS = [
  { id: "startup", file: "STARTUP.MID", title: "Power On!" },
  { id: "highway", file: "HIGHWAY.MID", title: "Desert Highway" },
  { id: "fusion", file: "FUSION.MID", title: "Rooftop Fusion" },
  { id: "neonpop", file: "NEONPOP.MID", title: "Neon Nights" },
  { id: "ballad", file: "RAINDAY.MID", title: "Rainy Window" },
  { id: "chiptune", file: "8BITRUN.MID", title: "Pixel Dash" },
  { id: "ambient", file: "NEBULA.MID", title: "Nebula Drift" },
  { id: "funky", file: "GROOVE.MID", title: "Groove Machine" },
]

export const BLOCK_TYPES = [
  { type: "heading", short: "Heading", label: "Heading", make: () => ({ text: "My Awesome Heading", size: "h1", align: "center", color: "", effect: "none" }) },
  { type: "paragraph", short: "Text", label: "Paragraph", make: () => ({ text: "Type something about yourself here. Use *stars* for bold and _underscores_ for italics.", align: "left", color: "", size: "normal", bold: false, italic: false, underline: false }) },
  { type: "marquee", short: "Marquee", label: "Marquee", make: () => ({ text: "*~*~* Welcome to my homepage!! *~*~*", color: "", bgColor: "", speed: "normal", direction: "left" }) },
  { type: "blink", short: "Blink", label: "Blinking Text", make: () => ({ text: "NEW!", color: "#ff3030", align: "center" }) },
  { type: "image", short: "Clip Art", label: "Picture", make: () => ({ art: "globe", alt: "", align: "center" }) },
  { type: "divider", short: "Divider", label: "Divider", make: () => ({ style: "rainbow" }) },
  { type: "links", short: "Links", label: "Link List", make: () => ({ title: "My Favorite Links", items: [{ label: "The 98ish Guestbook", url: "http://www.98ish.com/guestbook" }, { label: "Yahoo!", url: "http://www.yahoo.com/" }] }) },
  { type: "counter", short: "Counter", label: "Hit Counter", make: () => ({ label: "" }) },
  { type: "guestbook", short: "Guestbook", label: "Guestbook Button", make: () => ({ style: "button", text: "" }) },
  { type: "webring", short: "Web Ring", label: "Web Ring", make: () => ({}) },
]

export const blockLabel = (type) => BLOCK_TYPES.find((b) => b.type === type)?.label || type

export const MAX_PAGE_BYTES = 500 * 1024
export const MAX_IMAGE_BYTES = 150 * 1024

export const DEFAULT_SETTINGS = { title: "My Home Page", bg: "stars", bgColor: "#000033", text: "#ffff66", link: "#66ffff", font: "times", sparkle: false, badge: true, music: "" }

const COLOR = /^#[0-9a-f]{6}$/i
export const safeColor = (value, fallback) => (COLOR.test(value || "") ? value : fallback)

// Only pictures the server accepts are ever drawn
export const safeImage = (src) => (/^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(src || "") ? src : null)

// A link someone can follow: http(s) only
export const safeLink = (url) => {
  try {
    const parsed = new URL(String(url || ""))
    return /^https?:$/.test(parsed.protocol) ? parsed.href : null
  } catch {
    return null
  }
}

let nextId = 1
export const withIds = (blocks) => (Array.isArray(blocks) ? blocks : []).map((b) => ({ ...b, id: b.id || `b${Date.now().toString(36)}${nextId++}` }))
export const newBlock = (type) => withIds([{ type, ...BLOCK_TYPES.find((b) => b.type === type).make() }])[0]

// The page as the server wants it (no editor-only ids)
export const toServer = (doc) => ({ ...doc, blocks: doc.blocks.map(({ id, ...block }) => block) })
