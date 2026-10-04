// Pickleball 98: the Locker Room's data. Pure JavaScript (no three.js, no React), tested in
// Node (locker.test.js). A "look" is plain data that athlete.js (and rig.js on Low) builds a
// 3D player from: body, skin, hair, height and build; the kit (a theme: classic whites, club
// colors, pro kit, beach, winter, retro, casual), its colors, socks and shoes; gear (hats,
// glasses, wristbands, gloves); the paddle's colors and design.
//
// - validateLook: whatever comes in (an old save, another player's online hello) becomes a
//   complete look with only known ids, colors that are #rrggbb, and numbers in range. The
//   server checks online looks the same way (server/arcade/games/pickleballLooks.js; the test
//   keeps the two lists equal).
// - applyTheme: dress a look in one of the themes' styles (keeping the person's colors where
//   the theme leaves them free).
// - randomLook: a computer player's kit, picked sensibly (a theme that suits the venue, kit
//   colors that go together); they keep their own body, face and hair.
// - lookForPlayer: what a player wears in a match, from the saved looks and the options
//   (computer players' looks, outfits that follow the venue).
// - How they play (saved with the look, so it goes online with it): "plays" (right- or
//   left-handed) and "backhand" (the pro style: "one", a compact all-court game with a
//   one-handed backhand, or "two", an aggressive two-hander). Looks saved before these existed
//   (v < 3) play right-handed with one hand.
//
// Every kit is ordinary sportswear; beachwear is athletic swimwear (board shorts, rash guards,
// a one-piece, a sports top with swim shorts), the same standard for everyone.

import { CHARACTERS, OUTFITS, SKIN as BASE_SKIN } from "./looks.js"

export const LOOK_VERSION = 3

// ---- the choices ----
export const SKIN_TONES = ["#fbe2cf", "#f6d3b3", "#eab98f", "#d39a6a", "#c98e62", "#b5784a", "#a0663e", "#8c5734", "#5f3a22", "#4a2c1a"]
export const HAIR_STYLES = [
  { id: "short", name: "Short (parted)" },
  { id: "buzz", name: "Buzz cut" },
  { id: "pixie", name: "Pixie crop" },
  { id: "buns", name: "Buns" },
  { id: "long", name: "Long" },
  { id: "bald", name: "Shaved" },
]
// older looks' hair (the World Tour's players) and what they are now, by body
export const HAIR_ALIASES = { spiky: { m: "buzz", f: "pixie" }, curly: { m: "buzz", f: "buns" }, bun: { m: "buns", f: "buns" }, ponytail: { m: "long", f: "long" }, braid: { m: "long", f: "long" } }
export const HAIR_COLORS = ["#141010", "#2b1b0e", "#4a2c1a", "#7a4a26", "#a8441c", "#c9732e", "#d8b26a", "#e8dcc0", "#9a9a9a", "#e6e6e6", "#2f6fd6", "#e05a9a"]
export const HAIR_COLOR_NAMES = ["Black", "Dark brown", "Brown", "Light brown", "Auburn", "Ginger", "Blonde", "Platinum", "Gray", "White", "Blue", "Pink"]
export const KIT_COLORS = [
  "#ffffff", "#f1ede4", "#c8c8c8", "#6b6f78", "#2b2b2b", "#111111",
  "#1d3557", "#23395d", "#2f6fd6", "#5fb3e8", "#18a3b5", "#2a9d8f",
  "#7fe0bf", "#2fb58a", "#2e7d32", "#c6ff1a", "#ffd166", "#ffd700",
  "#ff8c42", "#ff7a1a", "#ef476f", "#e63946", "#d62828", "#8d1b2c",
  "#ff9ec7", "#e05a9a", "#9d4edd", "#5c2a9d", "#c8b88a", "#8a7f5c",
]
export const BODIES = [
  { id: "m", name: "Body A" },
  { id: "f", name: "Body B" },
]
export const BUILDS = [
  { id: "slim", name: "Slim" },
  { id: "regular", name: "Athletic" },
  { id: "strong", name: "Strong" },
]
export const HEIGHT = { min: 0.94, max: 1.06 }
export const TOPS = [
  { id: "tee", name: "Tech tee" },
  { id: "polo", name: "Polo" },
  { id: "tank", name: "Tank top" },
  { id: "rash", name: "Long-sleeve rash guard" },
  { id: "jacket", name: "Track jacket" },
  { id: "crop", name: "Sports top" },
  { id: "onepiece", name: "One-piece swimsuit" },
]
export const BOTTOMS = [
  { id: "shorts", name: "Shorts" },
  { id: "skirt", name: "Skort" },
  { id: "short", name: "Short shorts" },
  { id: "board", name: "Board shorts" },
  { id: "swim", name: "Swim shorts" },
  { id: "pants", name: "Track pants" },
]
export const SOCKS = [
  { id: "none", name: "No-show" },
  { id: "ankle", name: "Ankle" },
  { id: "crew", name: "Crew" },
  { id: "knee", name: "Knee-high (striped)" },
]
export const HATS = [
  { id: "none", name: "None" },
  { id: "cap", name: "Cap" },
  { id: "capBack", name: "Cap, backwards" },
  { id: "visor", name: "Visor" },
  { id: "headband", name: "Headband" },
  { id: "bucket", name: "Bucket hat" },
  { id: "beanie", name: "Beanie" },
]
export const GLASSES = [
  { id: "none", name: "None" },
  { id: "shades", name: "Sunglasses" },
  { id: "sport", name: "Sport wraparounds" },
]
export const PLAYS = [
  { id: "right", name: "Right-handed" },
  { id: "left", name: "Left-handed" },
]
export const PRO_STYLES = [
  { id: "one", name: "Compact all-court (one-handed backhand)" },
  { id: "two", name: "Aggressive two-hander (two-handed backhand)" },
]
export const DESIGNS = [
  { id: "stripe", name: "Diagonal stripe" },
  { id: "solid", name: "Solid" },
  { id: "split", name: "Two-tone" },
  { id: "dots", name: "Dots" },
  { id: "chevron", name: "Chevrons" },
  { id: "flame", name: "Flames" },
]

// ---- themes: each has styles; a style says which garments and gear (and, for themes with
// set colors, the colors). Colors marked "c1"/"c2" are the person's two kit colors. ----
export const THEMES = [
  {
    id: "classic",
    name: "Classic whites",
    styles: [
      { id: "polo", name: "Polo and shorts", set: { shirtStyle: "polo", bottom: "shorts", shirt: "#ffffff", trim: "c1", bottomColor: "#ffffff", socks: "#ffffff", sockStyle: "crew", shoes: "#ffffff", shoeAccent: "c1", hat: "none", glasses: "none", wristbands: false, gloves: false } },
      { id: "dress", name: "Tank and skort", set: { shirtStyle: "tank", bottom: "skirt", shirt: "#ffffff", trim: "c1", bottomColor: "#ffffff", socks: "#ffffff", sockStyle: "ankle", shoes: "#ffffff", shoeAccent: "c1", hat: "visor", hatColor: "#ffffff", glasses: "none", wristbands: false, gloves: false } },
      { id: "tee", name: "Tee and shorts", set: { shirtStyle: "tee", bottom: "shorts", shirt: "#ffffff", trim: "c1", bottomColor: "#ffffff", socks: "#ffffff", sockStyle: "crew", shoes: "#ffffff", shoeAccent: "c1", hat: "cap", hatColor: "#ffffff", glasses: "none", wristbands: true, wristColor: "#ffffff", gloves: false } },
    ],
  },
  {
    id: "club",
    name: "Club colors",
    styles: [
      { id: "polo", name: "Club polo", set: { shirtStyle: "polo", bottom: "shorts", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "crew", shoes: "#ffffff", shoeAccent: "c1", hat: "none", glasses: "none", wristbands: false, gloves: false } },
      { id: "tee", name: "Club tee", set: { shirtStyle: "tee", bottom: "shorts", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "c1", sockStyle: "crew", shoes: "#ffffff", shoeAccent: "c2", hat: "cap", hatColor: "c1", glasses: "none", wristbands: false, gloves: false } },
      { id: "skort", name: "Club tank and skort", set: { shirtStyle: "tank", bottom: "skirt", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "ankle", shoes: "#ffffff", shoeAccent: "c1", hat: "visor", hatColor: "c2", glasses: "none", wristbands: false, gloves: false } },
    ],
  },
  {
    id: "pro",
    name: "Pro kit",
    styles: [
      { id: "tech", name: "Tech tee, headband", set: { shirtStyle: "tee", bottom: "shorts", shirt: "c1", trim: "c2", bottomColor: "#111111", socks: "#111111", sockStyle: "crew", shoes: "c1", shoeAccent: "c2", hat: "headband", hatColor: "c2", glasses: "none", wristbands: true, wristColor: "c2", gloves: false } },
      { id: "shades", name: "Tank, sport shades", set: { shirtStyle: "tank", bottom: "shorts", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "ankle", shoes: "#ffffff", shoeAccent: "c1", hat: "visor", hatColor: "c1", glasses: "sport", wristbands: true, wristColor: "c1", gloves: false } },
      { id: "skort", name: "Pro tank and skort", set: { shirtStyle: "tank", bottom: "skirt", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "ankle", shoes: "c1", shoeAccent: "#ffffff", hat: "visor", hatColor: "c2", glasses: "sport", wristbands: false, gloves: false } },
    ],
  },
  {
    id: "beach",
    name: "Beach",
    styles: [
      { id: "board", name: "Tank and board shorts", set: { shirtStyle: "tank", bottom: "board", shirt: "c1", trim: "#ffffff", bottomColor: "c2", socks: "#ffffff", sockStyle: "none", shoes: "#ffffff", shoeAccent: "c1", hat: "visor", hatColor: "c1", glasses: "shades", wristbands: false, gloves: false } },
      { id: "rash", name: "Rash guard and board shorts", set: { shirtStyle: "rash", bottom: "board", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "none", shoes: "#ffffff", shoeAccent: "c2", hat: "bucket", hatColor: "c2", glasses: "shades", wristbands: false, gloves: false } },
      { id: "onepiece", name: "One-piece swimsuit", set: { shirtStyle: "onepiece", bottom: "swim", shirt: "c1", trim: "c2", bottomColor: "c1", socks: "#ffffff", sockStyle: "none", shoes: "#ffffff", shoeAccent: "c1", hat: "visor", hatColor: "#ffffff", glasses: "sport", wristbands: false, gloves: false } },
      { id: "sporttop", name: "Sports top and swim shorts", set: { shirtStyle: "crop", bottom: "swim", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "none", shoes: "#ffffff", shoeAccent: "c1", hat: "cap", hatColor: "c1", glasses: "shades", wristbands: false, gloves: false } },
    ],
  },
  {
    id: "winter",
    name: "Winter",
    styles: [
      { id: "jacket", name: "Jacket, beanie and gloves", set: { shirtStyle: "jacket", bottom: "pants", shirt: "c1", trim: "c2", bottomColor: "#2b2b2b", socks: "#ffffff", sockStyle: "crew", shoes: "#ffffff", shoeAccent: "c1", hat: "beanie", hatColor: "c2", glasses: "none", wristbands: false, gloves: true, gloveColor: "#2b2b2b" } },
      { id: "layers", name: "Long sleeves and track pants", set: { shirtStyle: "rash", bottom: "pants", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "c1", sockStyle: "crew", shoes: "c2", shoeAccent: "#ffffff", hat: "beanie", hatColor: "c1", glasses: "none", wristbands: false, gloves: false } },
    ],
  },
  {
    id: "retro",
    name: "Retro 80s/90s",
    styles: [
      { id: "80s", name: "80s: short shorts, knee socks", set: { shirtStyle: "tee", bottom: "short", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "knee", shoes: "#ffffff", shoeAccent: "c2", hat: "headband", hatColor: "c1", glasses: "none", wristbands: true, wristColor: "c1", gloves: false } },
      { id: "90s", name: "90s: polo, cap backwards", set: { shirtStyle: "polo", bottom: "board", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "crew", shoes: "#ffffff", shoeAccent: "c1", hat: "capBack", hatColor: "c2", glasses: "shades", wristbands: true, wristColor: "c2", gloves: false } },
    ],
  },
  {
    id: "casual",
    name: "Casual",
    styles: [
      { id: "tee", name: "Tee and board shorts", set: { shirtStyle: "tee", bottom: "board", shirt: "c1", trim: "c1", bottomColor: "c2", socks: "#ffffff", sockStyle: "ankle", shoes: "c2", shoeAccent: "#ffffff", hat: "capBack", hatColor: "c2", glasses: "none", wristbands: false, gloves: false } },
      { id: "tank", name: "Tank, shorts, bucket hat", set: { shirtStyle: "tank", bottom: "shorts", shirt: "c1", trim: "c2", bottomColor: "c2", socks: "#ffffff", sockStyle: "ankle", shoes: "#ffffff", shoeAccent: "c1", hat: "bucket", hatColor: "c2", glasses: "shades", wristbands: false, gloves: false } },
    ],
  },
]
export const THEME_IDS = THEMES.map((t) => t.id)
export const themeById = (id) => THEMES.find((t) => t.id === id) || null

// which kit suits a venue (Auto by venue)
export const VENUE_THEMES = { park: "casual", club: "classic", stadium: "pro", beach: "beach", winter: "winter" }

// colors that go together, for random kits: [main, second]
export const KIT_PAIRS = [
  ["#1d3557", "#ffd166"], ["#18a3b5", "#ffffff"], ["#e63946", "#1d3557"], ["#2a9d8f", "#f1ede4"], ["#ff7a1a", "#2b2b2b"],
  ["#9d4edd", "#ffd166"], ["#2fb58a", "#0f3d2e"], ["#ffd700", "#111111"], ["#ef476f", "#ffffff"], ["#2f6fd6", "#ff8c42"],
  ["#5fb3e8", "#23395d"], ["#c6ff1a", "#111111"], ["#8d1b2c", "#f1ede4"], ["#ff9ec7", "#5c2a9d"], ["#6b6f78", "#ffd166"],
]

// ---- a complete default look ----
export const DEFAULT_LOOK = {
  v: LOOK_VERSION,
  body: "f",
  skin: SKIN_TONES[3],
  hair: "long",
  hairColor: "#2b1b0e",
  beard: false,
  height: 1,
  build: "regular",
  theme: "custom",
  style: "",
  shirtStyle: "tee",
  bottom: "shorts",
  shirt: "#18a3b5",
  trim: "#ffffff",
  bottomColor: "#1d3557",
  socks: "#ffffff",
  sockStyle: "crew",
  shoes: "#ffffff",
  shoeAccent: "#18a3b5",
  hat: "none",
  hatColor: "#ffffff",
  glasses: "none",
  wristbands: false,
  wristColor: "#ffffff",
  gloves: false,
  gloveColor: "#2b2b2b",
  paddle: "#ffd23f",
  paddleEdge: "#1d3557",
  paddleDesign: "stripe",
  plays: "right",
  backhand: "one",
}

// ---- checking ----
const HEX = /^#[0-9a-f]{6}$/
export const isColor = (c) => typeof c === "string" && HEX.test(c.toLowerCase())
const color = (c, fallback) => (isColor(c) ? c.toLowerCase() : fallback)
const oneOf = (v, list, fallback) => (list.some((x) => x.id === v) ? v : fallback)
const ids = (list) => list.map((x) => x.id)
// (the id lists the server checks too: locker.test.js compares them)
export const LOOK_IDS = {
  body: ids(BODIES),
  hair: ids(HAIR_STYLES),
  build: ids(BUILDS),
  theme: [...THEME_IDS, "custom"],
  shirtStyle: ids(TOPS),
  bottom: ids(BOTTOMS),
  sockStyle: ids(SOCKS),
  hat: ids(HATS),
  glasses: ids(GLASSES),
  paddleDesign: ids(DESIGNS),
  plays: ids(PLAYS),
  backhand: ids(PRO_STYLES),
}
export const LOOK_STYLES = Object.fromEntries(THEMES.map((t) => [t.id, t.styles.map((s) => s.id)]))
export const LOOK_COLORS = ["skin", "hairColor", "shirt", "trim", "bottomColor", "socks", "shoes", "shoeAccent", "hatColor", "wristColor", "gloveColor", "paddle", "paddleEdge"]
export const LOOK_FLAGS = ["beard", "wristbands", "gloves"]

// Any look in (an older save, the World Tour's players, a hello from another browser) ->
// a complete look out. Unknown fields are dropped; anything invalid takes the fallback's.
export const validateLook = (raw, fallback = DEFAULT_LOOK) => {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}
  const fb = fallback === DEFAULT_LOOK ? DEFAULT_LOOK : validateLook(fallback)
  const out = { v: LOOK_VERSION }
  out.body = oneOf(r.body, BODIES, fb.body)
  // skin: a color, or (older looks) an index into the six original tones
  if (typeof r.skin === "number" && Number.isInteger(r.skin) && r.skin >= 0 && r.skin < BASE_SKIN.length) out.skin = BASE_SKIN[r.skin]
  else out.skin = color(r.skin, fb.skin)
  // hair: older ids become today's
  const alias = typeof r.hair === "string" && Object.hasOwn(HAIR_ALIASES, r.hair) ? HAIR_ALIASES[r.hair][out.body] : r.hair
  out.hair = oneOf(alias, HAIR_STYLES, fb.hair)
  out.hairColor = color(r.hairColor, fb.hairColor)
  out.beard = typeof r.beard === "boolean" ? r.beard : fb.beard
  const h = Number(r.height)
  out.height = Number.isFinite(h) ? Math.round(Math.max(HEIGHT.min, Math.min(HEIGHT.max, h)) * 100) / 100 : fb.height
  // build: a name, or (older looks) a number around 1
  if (typeof r.build === "number" && Number.isFinite(r.build)) out.build = r.build < 0.97 ? "slim" : r.build > 1.04 ? "strong" : "regular"
  else out.build = oneOf(r.build, BUILDS, fb.build)
  out.theme = LOOK_IDS.theme.includes(r.theme) ? r.theme : fb.theme
  const th = themeById(out.theme)
  if (!th) out.style = ""
  else if (th.styles.some((s) => s.id === r.style)) out.style = r.style
  else out.style = th.styles.some((s) => s.id === fb.style) ? fb.style : th.styles[0].id
  out.shirtStyle = oneOf(r.shirtStyle, TOPS, fb.shirtStyle)
  out.bottom = oneOf(r.bottom, BOTTOMS, fb.bottom)
  // a one-piece is its own bottom (swim shorts underneath never show)
  if (out.shirtStyle === "onepiece") out.bottom = "swim"
  for (const k of LOOK_COLORS) if (k !== "skin" && k !== "hairColor") out[k] = color(r[k], fb[k])
  out.sockStyle = oneOf(r.sockStyle, SOCKS, fb.sockStyle)
  out.hat = oneOf(r.hat, HATS, fb.hat)
  // glasses: older looks said true / false
  out.glasses = r.glasses === true ? "shades" : r.glasses === false ? "none" : oneOf(r.glasses, GLASSES, fb.glasses)
  out.wristbands = typeof r.wristbands === "boolean" ? r.wristbands : fb.wristbands
  out.gloves = typeof r.gloves === "boolean" ? r.gloves : fb.gloves
  out.paddleDesign = oneOf(r.paddleDesign, DESIGNS, fb.paddleDesign)
  // how they play: a look saved before this existed (v 1 or 2) plays right-handed, one hand
  const old = typeof r.v === "number" && r.v < 3
  out.plays = oneOf(r.plays, PLAYS, old ? "right" : fb.plays)
  out.backhand = oneOf(r.backhand, PRO_STYLES, old ? "one" : fb.backhand)
  // only Body A grows a beard
  if (out.body !== "m") out.beard = false
  return out
}

// The same look, ready to send over the network (it's already small: a complete look is
// about 600 characters of JSON)
export const lookPayload = (look) => validateLook(look)

// ---- themes ----
// Dress a look in a theme's style. colors: [c1, c2] the person's kit colors (defaults: the
// look's own shirt and trim)
export const applyTheme = (look, themeId, styleId = null, colors = null) => {
  const base = validateLook(look)
  const th = themeById(themeId)
  if (!th) return { ...base, theme: "custom", style: "" }
  const st = th.styles.find((s) => s.id === styleId) || th.styles[0]
  let [c1, c2] = colors || [base.shirt, base.trim === base.shirt ? base.bottomColor : base.trim]
  // classic whites need a color that shows on white
  if (themeId === "classic" && (!colors || isLight(c1))) c1 = isLight(c1) ? (isLight(c2) ? "#1d3557" : c2) : c1
  if (c1 === c2) c2 = isLight(c1) ? "#1d3557" : "#ffffff"
  const out = { ...base, theme: th.id, style: st.id }
  for (const [k, v] of Object.entries(st.set)) out[k] = v === "c1" ? c1 : v === "c2" ? c2 : v
  return validateLook(out)
}
// the theme's style that fits a body best (a skort and a one-piece suit Body B's defaults; the
// person can still pick any style)
export const defaultStyleFor = (themeId, body) => {
  const th = themeById(themeId)
  if (!th) return ""
  const pref = { classic: { m: "polo", f: "dress" }, club: { m: "polo", f: "skort" }, pro: { m: "tech", f: "skort" }, beach: { m: "board", f: "onepiece" }, winter: { m: "jacket", f: "jacket" }, retro: { m: "80s", f: "80s" }, casual: { m: "tee", f: "tank" } }[themeId]
  return pref?.[body] || th.styles[0].id
}
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255
}
export const isLight = (hex) => isColor(hex) && luminance(hex) > 0.8

// ---- computer players ----
// A kit for a computer player: a theme that suits the venue (or any), kit colors that go
// together, a paddle to match. They keep their own body, skin, face and hair.
export const randomLook = (rand, base, { venue = null } = {}) => {
  const b = validateLook(base)
  const pick = (arr) => arr[Math.floor(rand() * arr.length) % arr.length]
  const themeId = venue && VENUE_THEMES[venue] && rand() < 0.75 ? VENUE_THEMES[venue] : pick(THEME_IDS)
  const th = themeById(themeId)
  // mostly the style that suits their body, sometimes another
  const styleId = rand() < 0.6 ? defaultStyleFor(themeId, b.body) : pick(th.styles).id
  const [c1, c2] = pick(KIT_PAIRS)
  const look = applyTheme(b, themeId, styleId, rand() < 0.5 ? [c1, c2] : [c2 === "#ffffff" || c2 === "#f1ede4" ? c1 : c2, c1])
  look.paddle = pick(KIT_COLORS.filter((c) => !isLight(c) || rand() < 0.2))
  look.paddleEdge = look.paddle === c1 ? c2 : c1
  if (look.paddleEdge === look.paddle) look.paddleEdge = "#111111"
  look.paddleDesign = pick(DESIGNS).id
  return validateLook(look)
}

// The look a World Tour player starts from (their own kit, in an outfit), complete
export const characterLook = (characterId, outfitId = "home") => {
  const c = CHARACTERS.find((x) => x.id === characterId) || CHARACTERS[0]
  const o = OUTFITS.find((x) => x.id === outfitId) || OUTFITS[0]
  const look = { ...c.look }
  for (const k of ["shirt", "trim", "bottomColor", "paddle", "paddleEdge"]) if (o[k]) look[k] = o[k]
  if (o.trim === null) look.trim = c.look.shirt
  return validateLook(look, { ...DEFAULT_LOOK, body: c.look.body })
}

// What someone wears in a match. prefs: { looks: { [characterId]: look }, aiLooks: "own" |
// "random", autoVenue }; who: { character, outfit, ai }; venue; rand (for random kits)
export const lookForPlayer = (prefs, who, venue = null, rand = Math.random) => {
  const saved = prefs?.looks && typeof prefs.looks === "object" ? prefs.looks[who.character] : null
  let look = saved ? validateLook(saved, characterLook(who.character)) : characterLook(who.character, who.outfit)
  if (who.ai && !saved && prefs?.aiLooks === "random") return randomLook(rand, look, { venue })
  if (prefs?.autoVenue && venue && VENUE_THEMES[venue]) {
    const t = VENUE_THEMES[venue]
    if (look.theme !== t) look = applyTheme(look, t, defaultStyleFor(t, look.body))
  }
  return look
}

// The Locker Room's saved looks: { [characterId]: look }, checked (a bad entry is dropped)
export const validateLooks = (raw) => {
  const out = {}
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out
  for (const c of CHARACTERS) if (raw[c.id] && typeof raw[c.id] === "object") out[c.id] = validateLook(raw[c.id], characterLook(c.id))
  return out
}
