// LAN Party 98's games and emulators: what's bundled, where the engines load from, and the
// DOSBox config each way of playing needs. Pure (no DOM), so the unit tests can check it.
//
// Engines load from jsDelivr at pinned versions (free, CORS-open, never through Render):
// js-dos 8 (GPL-2.0, unmodified) for DOS, v86 (BSD-2) for Virtual PC 98, Ruffle (MIT/Apache)
// for Flash. The DOS game bundles and the FreeDOS disk are static files in client/public/emu
// (Vercel), built by tools/lanparty/build_bundles.py from the official shareware releases.
// public/emu/NOTICE.txt has every license.

export const CDN = {
  jsdos: "https://cdn.jsdelivr.net/npm/js-dos@8.5.1/dist/",
  v86: "https://cdn.jsdelivr.net/npm/v86@0.5.470/build/",
  v86Bios: "/emu/vm/", // SeaBIOS (LGPL-3.0) + VGABIOS (LGPL-2.1), copied from the v86 repo
  ruffle: "https://cdn.jsdelivr.net/npm/@ruffle-rs/ruffle@0.6.0/",
}

// js-dos's WebRTC networking (HumbleNet) needs a signaling ("peer") server that hands out peer
// ids and passes WebRTC offers; game traffic itself goes phone to phone. js-dos's own free one
// is the default; VITE_DOS_PEER_SERVER points at a self-hosted WebRTC-NET peer-server instead.
export const PEER_SERVER = (typeof import.meta !== "undefined" && import.meta.env?.VITE_DOS_PEER_SERVER) || "https://net.dos.zone"

// js-dos key codes (GLFW numbering)
export const KEY = {
  enter: 257,
  esc: 256,
  tab: 258,
  space: 32,
  up: 265,
  down: 264,
  left: 263,
  right: 262,
  ctrl: 341,
  shift: 340,
  alt: 342,
  y: 89,
  n: 78,
  pgup: 266,
  pgdn: 267,
  ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7].map((d) => [`d${d}`, 48 + d])),
  f1: 290,
  f2: 291,
  f3: 292,
}

// touch controls shared by the DOOM-engine games (arrows move, Ctrl fires, Space opens doors)
const DOOM_CONTROLS = [
  { id: "up", label: "Forward", key: "up", icon: "▲", default: { portrait: { x: 14, y: 62, w: 16, h: 10 }, landscape: { x: 9, y: 46, w: 10, h: 18 } } },
  { id: "down", label: "Back", key: "down", icon: "▼", default: { portrait: { x: 14, y: 84, w: 16, h: 10 }, landscape: { x: 9, y: 78, w: 10, h: 18 } } },
  { id: "left", label: "Turn left", key: "left", icon: "◀", default: { portrait: { x: 0, y: 73, w: 15, h: 10 }, landscape: { x: 0, y: 62, w: 9, h: 18 } } },
  { id: "right", label: "Turn right", key: "right", icon: "▶", default: { portrait: { x: 29, y: 73, w: 15, h: 10 }, landscape: { x: 19, y: 62, w: 9, h: 18 } } },
  { id: "fire", label: "Fire", key: "ctrl", icon: "FIRE", shape: "round", default: { portrait: { x: 76, y: 70, w: 22, h: 12 }, landscape: { x: 84, y: 56, w: 14, h: 24 } } },
  { id: "use", label: "Use / open", key: "space", icon: "USE", shape: "round", default: { portrait: { x: 56, y: 82, w: 18, h: 10 }, landscape: { x: 70, y: 74, w: 12, h: 20 } } },
  { id: "run", label: "Run", key: "shift", icon: "RUN", default: { portrait: { x: 56, y: 62, w: 18, h: 8 }, landscape: { x: 70, y: 52, w: 12, h: 14 } } },
  { id: "strafe", label: "Strafe", key: "alt", icon: "STR", default: { portrait: { x: 78, y: 84, w: 20, h: 8 }, landscape: { x: 86, y: 82, w: 12, h: 14 } } },
  { id: "menu", label: "Menu", key: "esc", icon: "ESC", default: { portrait: { x: 0, y: 0, w: 16, h: 6 }, landscape: { x: 0, y: 0, w: 9, h: 10 } } },
  { id: "enter", label: "Enter", key: "enter", icon: "↵", default: { portrait: { x: 17, y: 0, w: 16, h: 6 }, landscape: { x: 10, y: 0, w: 9, h: 10 } } },
  { id: "weapon", label: "Next weapon", key: "d2", icon: "1-7", cycle: ["d1", "d2", "d3", "d4", "d5", "d6", "d7"], default: { portrait: { x: 84, y: 0, w: 16, h: 6 }, landscape: { x: 90, y: 0, w: 10, h: 10 } } },
  { id: "yes", label: "Yes (Y)", key: "y", icon: "Y", default: { portrait: { x: 34, y: 0, w: 12, h: 6 }, landscape: { x: 20, y: 0, w: 7, h: 10 } } },
]

// The bundled DOS games: shareware releases, freely distributable unmodified
export const DOS_GAMES = [
  {
    id: "doom",
    name: "DOOM (shareware)",
    short: "DOOM",
    year: 1993,
    by: "id Software",
    blurb: "Episode 1, Knee-Deep in the Dead. Deathmatch or co-op with up to 4 friends.",
    url: "/emu/games/doom.jsdos",
    exe: "DOOM.EXE",
    lan: { setup: "IPXSETUP.EXE", max: 4 },
    controls: DOOM_CONTROLS,
    terms: "Shareware: \"PLEASE DISTRIBUTE!!!\" (id Software). Unmodified from doom19s.zip.",
  },
  {
    id: "heretic",
    name: "Heretic (shareware)",
    short: "Heretic",
    year: 1994,
    by: "Raven Software / id Software",
    blurb: "Shareware Episode One, City of the Damned. Fantasy DOOM with spells; LAN up to 4.",
    url: "/emu/games/heretic.jsdos",
    exe: "HERETIC.EXE",
    lan: { setup: "IPXSETUP.EXE", max: 4 },
    controls: DOOM_CONTROLS,
    terms: "Shareware: \"FREELY DISTRIBUTE\" (Raven Software / id Software). Unmodified from htic_v12.zip.",
  },
]

export const gameById = (id) => DOS_GAMES.find((g) => g.id === id) || null

// Flash: a small original demo (ours, made by tools/lanparty/make_demo_swf.py) plus any .swf
// on the drive
export const FLASH_DEMO = { id: "demo", name: "98ish Spinner (demo)", url: "/emu/flash/98ish-spinner.swf" }

// ---------------- DOSBox config ----------------

const BASE_CONF = `[sdl]
autolock=true
usescancodes=true
[dosbox]
machine=svga_s3
memsize=16
[cpu]
core=auto
cputype=auto
cycles=auto
[mixer]
rate=44100
blocksize=1024
prebuffer=20
[render]
frameskip=0
aspect=false
scaler=none
[sblaster]
sbtype=sb16
sbbase=220
irq=7
dma=1
hdma=5
[speaker]
pcspeaker=true
[dos]
xms=true
ems=true
umb=true
[ipx]
ipx=true
`

const clampInt = (v, lo, hi, d) => (Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Math.round(Number(v)))) : d)

// The command line that starts a game: alone, or on the LAN through IPXSETUP (every player
// runs the same line; IPXSETUP waits until `nodes` players have found each other)
export const launchLine = (game, { mode = "play", nodes = 2, deathmatch = false, skill = 3 } = {}) => {
  if (!game) throw new Error("No game")
  const sk = clampInt(skill, 1, 5, 3)
  if (mode === "play" || !game.lan) return `${game.exe} -skill ${sk}`
  const n = clampInt(nodes, 2, game.lan.max, 2)
  return `${game.lan.setup} -nodes ${n}${deathmatch ? " -deathmatch" : ""} -skill ${sk}`
}

// The whole dosbox.conf js-dos gets for one launch (it replaces the bundle's own)
export const dosboxConf = (game, opts = {}) => `${BASE_CONF}[autoexec]\necho off\nmount c .\nc:\ncls\n${launchLine(game, opts)}\n`

// ---------------- what a file on the drive opens with ----------------

// file name -> { program, kind } | null
export const routeFile = (name = "") => {
  const n = String(name).toLowerCase()
  if (/\.swf$/.test(n)) return { program: "LAN Party 98", kind: "flash" }
  if (/\.(img|ima|iso|vfd|flp)$/.test(n)) return { program: "Virtual PC 98", kind: "disk" }
  if (/\.(jsdos)$/.test(n)) return { program: "LAN Party 98", kind: "dos" }
  return null
}

// a bundled game's program file on the drive (C:\Games\DOOM\DOOM.EXE): which game it starts
export const gameForExe = (path = "") => {
  const p = String(path).toUpperCase().replace(/\\/g, "/")
  return DOS_GAMES.find((g) => p.endsWith(`/${g.exe}`) || p.endsWith(`/${g.short.toUpperCase()}/${g.exe}`)) || null
}

// ---------------- Virtual PC 98 ----------------

// which drive v86 boots a disk image as: none = FreeDOS on floppy A:; an .iso = the CD; up to
// 2.88 MB = a floppy; bigger = the hard disk
export const FREEDOS = "/emu/vm/freedos722.img"
export const diskOptions = (file) => {
  if (!file) return { fda: { url: FREEDOS } }
  const name = String(file.name || "").toLowerCase()
  const buffer = file.buffer
  if (/\.iso$/.test(name)) return { cdrom: { buffer } }
  if (buffer.byteLength <= 2949120) return { fda: { buffer } }
  return { hda: { buffer } }
}
