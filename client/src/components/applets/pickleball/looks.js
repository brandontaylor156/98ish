// Pickleball 98: the players you can be (and play against). Each has a look (body "m" or
// "f", skin, hair, hat, outfit, paddle; and how they hold it: plays "left" for a left-hander,
// backhand "two" for a two-handed backhand), a playing style for when the computer plays
// them, and small differences (speed, power, touch). Plain data; athlete.js (or rig.js on
// Low) builds the 3D figure from a look. One player in ten is left-handed, like real life.
// Everyone here is made up. (players v3: each wears one of the photographed faces, faceList.js;
// their skin is that face's own tone, locker.js characterLook)

export const SKIN = ["#f6d3b3", "#eab98f", "#d39a6a", "#b5784a", "#8c5734", "#5f3a22"]

export const CHARACTERS = [
  {
    id: "maya",
    name: "Maya Torres",
    nick: "Maya",
    style: "allround",
    blurb: "Plays every shot. Never panics at the kitchen line.",
    stats: { speed: 1, power: 1, touch: 1.04 },
    look: { face: "f03", body: "f", skin: 2, hair: "own", hairColor: "#2a1a10", hat: "visor", hatColor: "#ffffff", shirt: "#18a3b5", shirtStyle: "tank", trim: "#ffffff", bottom: "skirt", bottomColor: "#1d3557", shoes: "#ffffff", shoeAccent: "#18a3b5", socks: "#ffffff", paddle: "#ffd23f", paddleEdge: "#1d3557", build: 0.96 },
  },
  {
    id: "dex",
    name: "Dex Okafor",
    nick: "Dex",
    style: "banger",
    blurb: "Hits it hard and asks questions later.",
    stats: { speed: 1.02, power: 1.08, touch: 0.94 },
    look: { face: "m02", body: "m", skin: 5, hair: "own", hairColor: "#141010", hat: "headband", hatColor: "#ff7a1a", shirt: "#ff7a1a", shirtStyle: "tee", trim: "#2b2b2b", bottom: "shorts", bottomColor: "#2b2b2b", shoes: "#2b2b2b", shoeAccent: "#ff7a1a", socks: "#ffffff", paddle: "#2b2b2b", paddleEdge: "#ff7a1a", build: 1.08, beard: true },
  },
  {
    id: "lena",
    name: "Lena Brandt",
    nick: "Lena",
    style: "dinker",
    blurb: "Will dink with you until the sun goes down.",
    stats: { speed: 0.98, power: 0.94, touch: 1.1 },
    look: { face: "f01", body: "f", skin: 0, hair: "bun", hairColor: "#e3c27a", hat: "cap", hatColor: "#2fb58a", shirt: "#7fe0bf", shirtStyle: "polo", trim: "#2fb58a", bottom: "skirt", bottomColor: "#ffffff", shoes: "#ffffff", shoeAccent: "#2fb58a", socks: "#ffffff", paddle: "#2fb58a", paddleEdge: "#0f3d2e", build: 0.94 },
  },
  {
    id: "kenji",
    name: "Kenji Watanabe",
    nick: "Kenji",
    style: "counter",
    blurb: "Quick hands. Your best drive comes right back.",
    stats: { speed: 1.05, power: 0.97, touch: 1.03 },
    look: { face: "m03", body: "m", skin: 1, hair: "own", hairColor: "#111111", hat: "none", hatColor: "#111111", shirt: "#23395d", shirtStyle: "tee", trim: "#e63946", bottom: "shorts", bottomColor: "#e9ecef", shoes: "#e63946", shoeAccent: "#ffffff", socks: "#23395d", paddle: "#e63946", paddleEdge: "#111111", build: 0.98, glasses: true, plays: "left" },
  },
  {
    id: "priya",
    name: "Priya Nair",
    nick: "Priya",
    style: "lobber",
    blurb: "Crowd the net and you'll be chasing one over your head.",
    stats: { speed: 1, power: 1, touch: 1.05 },
    look: { face: "f04", body: "f", skin: 3, hair: "own", hairColor: "#1c120c", hat: "none", hatColor: "#7b2cbf", shirt: "#9d4edd", shirtStyle: "tank", trim: "#ffd6ff", bottom: "shorts", bottomColor: "#3c096c", shoes: "#ffffff", shoeAccent: "#9d4edd", socks: "#ffffff", paddle: "#ffd6ff", paddleEdge: "#7b2cbf", build: 0.95 },
  },
  {
    id: "gus",
    name: "Gus Holloway",
    nick: "Gus",
    style: "wall",
    blurb: "Seventy-one years old. Has never missed a reset.",
    stats: { speed: 0.9, power: 0.95, touch: 1.12 },
    look: { face: "m04", body: "m", skin: 0, hair: "bald", hairColor: "#d9d9d9", hat: "bucket", hatColor: "#c8b88a", shirt: "#f1faee", shirtStyle: "polo", trim: "#457b9d", bottom: "shorts", bottomColor: "#8a7f5c", shoes: "#ffffff", shoeAccent: "#457b9d", socks: "#ffffff", paddle: "#457b9d", paddleEdge: "#1d3557", build: 1.04, beard: true },
  },
  {
    id: "rosa",
    name: "Rosa Delgado",
    nick: "Rosa",
    style: "allround",
    blurb: "Club champion three years running.",
    stats: { speed: 1.03, power: 1.01, touch: 1.01 },
    look: { face: "f05", body: "f", skin: 2, hair: "own", hairColor: "#3b2416", hat: "none", hatColor: "#ef476f", shirt: "#ef476f", shirtStyle: "tee", trim: "#ffffff", bottom: "skirt", bottomColor: "#2b2d42", shoes: "#ffffff", shoeAccent: "#ef476f", socks: "#ffffff", paddle: "#06d6a0", paddleEdge: "#2b2d42", build: 0.95, backhand: "two" },
  },
  {
    id: "sam",
    name: "Sam Reyes",
    nick: "Sam",
    style: "banger",
    blurb: "Speed-ups from anywhere. Anywhere.",
    stats: { speed: 1.04, power: 1.06, touch: 0.95 },
    look: { face: "m05", body: "m", skin: 4, hair: "short", hairColor: "#1a1a1a", hat: "capBack", hatColor: "#d62828", shirt: "#1a1a1a", shirtStyle: "tee", trim: "#d62828", bottom: "shorts", bottomColor: "#d62828", shoes: "#d62828", shoeAccent: "#1a1a1a", socks: "#1a1a1a", paddle: "#d62828", paddleEdge: "#1a1a1a", build: 1.02, backhand: "two" },
  },
  {
    id: "abby",
    name: "Abby Chen",
    nick: "Abby",
    style: "dinker",
    blurb: "Soft hands, sharp angles.",
    stats: { speed: 1.02, power: 0.95, touch: 1.08 },
    look: { face: "f06", body: "f", skin: 1, hair: "own", hairColor: "#141414", hat: "visor", hatColor: "#ffd166", shirt: "#ffd166", shirtStyle: "tank", trim: "#118ab2", bottom: "skirt", bottomColor: "#118ab2", shoes: "#ffffff", shoeAccent: "#118ab2", socks: "#ffffff", paddle: "#118ab2", paddleEdge: "#073b4c", build: 0.93 },
  },
  {
    id: "lou",
    name: "Lou Marino",
    nick: "Lou",
    style: "allround",
    blurb: "The Kitchen King. Undefeated at the Stadium.",
    stats: { speed: 1.04, power: 1.06, touch: 1.08 },
    boss: true,
    look: { face: "m06", body: "m", skin: 1, hair: "own", hairColor: "#5a5a5a", hat: "cap", hatColor: "#111111", shirt: "#111111", shirtStyle: "polo", trim: "#ffd700", bottom: "shorts", bottomColor: "#111111", shoes: "#111111", shoeAccent: "#ffd700", socks: "#111111", paddle: "#ffd700", paddleEdge: "#111111", build: 1.06, glasses: true },
  },
]

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0]

// Outfits (the Tour unlocks the special ones): a shirt / bottom / trim recolor of any look
export const OUTFITS = [
  { id: "home", name: "Home kit" },
  { id: "away", name: "Away kit", shirt: "#f8f9fa", trim: null, bottomColor: "#343a40" },
  { id: "sunset", name: "Sunset kit", shirt: "#ff8c42", trim: "#ffd166", bottomColor: "#5c2a9d", unlock: "club" },
  { id: "neon", name: "Neon kit", shirt: "#c6ff1a", trim: "#111111", bottomColor: "#111111", paddle: "#111111", paddleEdge: "#c6ff1a", unlock: "night" },
  { id: "gold", name: "Champion's gold", shirt: "#ffd700", trim: "#111111", bottomColor: "#111111", paddle: "#ffd700", paddleEdge: "#111111", unlock: "champion" },
]

// a character's look in an outfit (and with the trim color filled in)
export const lookFor = (characterId, outfitId = "home") => {
  const c = characterById(characterId)
  const o = OUTFITS.find((x) => x.id === outfitId) || OUTFITS[0]
  const look = { ...c.look }
  for (const k of ["shirt", "trim", "bottomColor", "paddle", "paddleEdge"]) if (o[k]) look[k] = o[k]
  if (o.trim === null) look.trim = c.look.shirt
  return look
}

// Doubles teammates in the same colors (a team kit), when two looks clash too much
export const teamKit = (look, color) => ({ ...look, shirt: color })

// A random line-up of opponents (not you), for Quick Match
export const pickOpponents = (rand, exclude = [], n = 1) => {
  const pool = CHARACTERS.filter((c) => !exclude.includes(c.id) && !c.boss)
  const out = []
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rand() * pool.length), 1)[0])
  return out
}

// The venues (venue.js builds them): names, sky, light, court colors, crowd size
export const VENUE_INFO = {
  park: { id: "park", name: "Riverside Park", time: "Day", sky: [0x3f8fe0, 0xd8ecfb], fog: [0xd8ecfb, 70, 185], court: 0x2f62ad, kitchen: 0x3b75c4, apron: 0x3c8a5a, ground: 0x6fae55, sun: { color: 0xfff3dc, intensity: 2.6, pos: [-8, 20, 10] }, hemi: [0xdcefff, 0x4d7a3c, 1.4], crowd: 0, exposure: 1 },
  club: { id: "club", name: "Sunset Club", time: "Golden hour", sky: [0x5a6fb5, 0xffb26b], fog: [0xf2b27a, 60, 170], court: 0x2e7d5b, kitchen: 0x37936c, apron: 0x2a5a8a, ground: 0x6c8f45, sun: { color: 0xffc58a, intensity: 2.8, pos: [-22, 9, -14] }, hemi: [0xffd9b3, 0x3d4a2c, 1.1], crowd: 0.35, exposure: 1.05 },
  beach: { id: "beach", name: "Sandy Point", time: "Midday", sky: [0x2f86e0, 0xcfeaff], fog: [0xd6ecf7, 80, 210], court: 0x2a6fb5, kitchen: 0x3a86cc, apron: 0x2e8f8a, ground: 0xe6d3a3, sun: { color: 0xfff6e0, intensity: 3.0, pos: [6, 24, 8] }, hemi: [0xe0f2ff, 0xc9b48a, 1.5], crowd: 0.2, exposure: 1.05 },
  winter: { id: "winter", name: "Frost Hollow", time: "Snowy afternoon", sky: [0x8fa7c4, 0xe8eef5], fog: [0xe3e9f0, 45, 150], court: 0x2f5f9e, kitchen: 0x3b72b5, apron: 0x5d6f82, ground: 0xf2f5f8, sun: { color: 0xfff0e0, intensity: 2.0, pos: [-14, 12, 10] }, hemi: [0xe8f0ff, 0xb8c4d0, 1.6], crowd: 0, exposure: 1.0, snow: true },
  stadium: { id: "stadium", name: "Center Court", time: "Night", sky: [0x060a1c, 0x1b2550], fog: [0x0b1028, 70, 200], court: 0x2a56a8, kitchen: 0x356bc4, apron: 0x3b2a6b, ground: 0x15182a, sun: { color: 0xf2f6ff, intensity: 2.9, pos: [3, 26, 6] }, hemi: [0x8aa0ff, 0x1a1530, 0.75], crowd: 1, exposure: 1.1, night: true },
}
