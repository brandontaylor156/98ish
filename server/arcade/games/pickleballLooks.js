// Pickleball 98's player looks, checked on the server before a relay message carries one to
// other people (pickleball.js filterRelay). A look is plain data (the Locker Room's choices:
// client/src/components/applets/pickleball/locker.js); only known ids, #rrggbb colors,
// booleans and a height in range get through, and anything else is dropped (each browser
// fills in defaults for what's missing). The id lists must match locker.js's LOOK_IDS:
// client/src/components/applets/pickleball/locker.test.js checks that.

const LOOK_IDS = {
  body: ["m", "f"],
  hair: ["short", "buzz", "pixie", "buns", "long", "bald"],
  build: ["slim", "regular", "strong"],
  theme: ["classic", "club", "pro", "beach", "winter", "retro", "casual", "custom"],
  shirtStyle: ["tee", "polo", "tank", "rash", "jacket", "crop", "onepiece"],
  bottom: ["shorts", "skirt", "short", "board", "swim", "pants"],
  sockStyle: ["none", "ankle", "crew", "knee"],
  hat: ["none", "cap", "capBack", "visor", "headband", "bucket", "beanie"],
  glasses: ["none", "shades", "sport"],
  paddleDesign: ["stripe", "solid", "split", "dots", "chevron", "flame"],
}
const LOOK_STYLES = {
  classic: ["polo", "dress", "tee"],
  club: ["polo", "tee", "skort"],
  pro: ["tech", "shades", "skort"],
  beach: ["board", "rash", "onepiece", "sporttop"],
  winter: ["jacket", "layers"],
  retro: ["80s", "90s"],
  casual: ["tee", "tank"],
}
const LOOK_COLORS = ["skin", "hairColor", "shirt", "trim", "bottomColor", "socks", "shoes", "shoeAccent", "hatColor", "wristColor", "gloveColor", "paddle", "paddleEdge"]
const LOOK_FLAGS = ["beard", "wristbands", "gloves"]
const HEIGHT = { min: 0.94, max: 1.06 }
const HEX = /^#[0-9a-fA-F]{6}$/

const isObject = (v) => !!v && typeof v === "object" && !Array.isArray(v)

// raw -> a look with only the fields that check out (or null if it isn't a look at all)
const sanitizeLook = (raw) => {
  if (!isObject(raw)) return null
  const out = { v: 2 }
  for (const [k, list] of Object.entries(LOOK_IDS)) if (typeof raw[k] === "string" && list.includes(raw[k])) out[k] = raw[k]
  if (out.theme && LOOK_STYLES[out.theme] && typeof raw.style === "string" && LOOK_STYLES[out.theme].includes(raw.style)) out.style = raw.style
  for (const k of LOOK_COLORS) if (typeof raw[k] === "string" && HEX.test(raw[k])) out[k] = raw[k].toLowerCase()
  for (const k of LOOK_FLAGS) if (typeof raw[k] === "boolean") out[k] = raw[k]
  const h = Number(raw.height)
  if (typeof raw.height === "number" && Number.isFinite(h)) out.height = Math.max(HEIGHT.min, Math.min(HEIGHT.max, h))
  return out
}

module.exports = { LOOK_IDS, LOOK_STYLES, LOOK_COLORS, LOOK_FLAGS, HEIGHT, sanitizeLook }
