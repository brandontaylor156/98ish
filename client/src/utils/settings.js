import { useEffect, useState } from "react"

// Desktop settings (Display Properties and the startup options), kept in this browser.
// The custom wallpaper image lives under its own key since it's much bigger.

const KEY = "98ish.settings"
const IMAGE_KEY = "98ish.wallpaper"

export const WALLPAPERS = [
  { id: "default", label: "98ish" },
  { id: "vaporwave", label: "Vaporwave" },
  { id: "none", label: "(None)" },
  { id: "bricks", label: "Bricks" },
  { id: "checks", label: "Checks" },
  { id: "diamonds", label: "Diamonds" },
  { id: "stripes", label: "Pinstripe" },
  { id: "dots", label: "Polka Dots" },
  // the Desktop Themes' pictures
  { id: "space", label: "Deep Space", url: "/assets/themes/space.svg" },
  { id: "underwater", label: "Underwater", url: "/assets/themes/underwater.svg" },
  { id: "sunset", label: "Sunset Grid", url: "/assets/themes/sunset.svg" },
  { id: "dinosaurs", label: "Dinosaurs", url: "/assets/themes/dinosaurs.svg" },
  { id: "custom", label: "(Your picture)" },
  // photos from Our Story, taking turns while you're signed on with your partner (see utils/couple.js)
  { id: "ourphotos", label: "Our photos ♥" },
]

export const SCHEMES = [
  { id: "standard", label: "Windows Standard", title: ["#000080", "#1084d0"], inactive: ["#808080", "#b5b5b5"], desktop: "#008080" },
  { id: "rainy", label: "Rainy Day", title: ["#4f657d", "#8da1b8"], inactive: ["#808080", "#b5b5b5"], desktop: "#4f657d" },
  { id: "eggplant", label: "Eggplant", title: ["#5c3d5c", "#a37ba3"], inactive: ["#808080", "#b5b5b5"], desktop: "#5c3d5c" },
  { id: "lilac", label: "Lilac", title: ["#6b52a5", "#b8a8e0"], inactive: ["#8f8f8f", "#c4c4c4"], desktop: "#6b52a5" },
  { id: "marine", label: "Marine", title: ["#006060", "#00a0a0"], inactive: ["#808080", "#b5b5b5"], desktop: "#004848" },
  { id: "brick", label: "Brick", title: ["#800000", "#c04040"], inactive: ["#808080", "#b5b5b5"], desktop: "#5a2020" },
  { id: "pumpkin", label: "Pumpkin", title: ["#b05000", "#f09030"], inactive: ["#808080", "#b5b5b5"], desktop: "#2a2a2a" },
  { id: "plum", label: "Plum (high color)", title: ["#402040", "#c080c0"], inactive: ["#808080", "#b5b5b5"], desktop: "#402040" },
  // the Desktop Themes' schemes
  { id: "nebula", label: "Nebula", title: ["#1b1458", "#6a4fd8"], inactive: ["#57566e", "#9a98b4"], desktop: "#0a0a26" },
  { id: "lagoon", label: "Lagoon", title: ["#004c6e", "#22a7c4"], inactive: ["#6a8088", "#a9bcc2"], desktop: "#05415a" },
  { id: "synth", label: "Synth", title: ["#a0207c", "#25b9d0"], inactive: ["#7a6a86", "#b9aec4"], desktop: "#2a0c46" },
  { id: "jurassic", label: "Jurassic", title: ["#3e5a16", "#a39a34"], inactive: ["#7a7a66", "#b8b8a2"], desktop: "#3a4719" },
]

export const DEFAULT_SETTINGS = {
  wallpaper: "default",
  display: "stretch", // stretch | center | tile
  scheme: "standard",
  bootScreen: true,
  startupSound: true,
  systemSounds: true,
  helper: true, // Floppy, the helper
  screensaver: "none", // an id from components/screensavers, or "none"
  screensaverWait: 10, // minutes
  screensaverOptions: {}, // { [id]: that screensaver's options }
  volume: 80, // the taskbar speaker: 0-100, for system sounds and Media Player
  muted: false,
  soundScheme: "classic", // system sound flavor (Desktop Themes): classic | space | ocean | synth | dino
  theme: "standard", // the Desktop Theme last applied
  iconStyle: "none", // desktop icon effect (Desktop Themes)
  cursor: "default", // mouse pointer set (Desktop Themes)
  taskbarAutoHide: false,
  taskbarClock: true,
  quickLaunch: true, // show the Quick Launch toolbar
}

const listeners = new Set()

const read = () => {
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(KEY)) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

let current = read()

export const getSettings = () => current

// the master volume as a gain multiplier (0 when muted)
export const masterGain = (s = current) => (s.muted ? 0 : Math.pow(Math.max(0, Math.min(100, s.volume ?? 80)) / 100, 2))

export const setSettings = (patch) => {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // storage full or blocked: keep it for this visit only
  }
  listeners.forEach((fn) => fn(current))
}

export const useSettings = () => {
  const [value, setValue] = useState(current)
  useEffect(() => {
    listeners.add(setValue)
    setValue(current)
    return () => listeners.delete(setValue)
  }, [])
  return value
}

// ---- custom wallpaper ----

let imageCache
export const getWallpaperImage = () => {
  if (imageCache === undefined) {
    try {
      imageCache = localStorage.getItem(IMAGE_KEY)
    } catch {
      imageCache = null
    }
  }
  return imageCache
}

// Shrinks a picture to fit 1920x1080 (JPEG) so it fits in browser storage.
// Resolves with the data URL; rejects with a message for the user.
export const loadWallpaperFile = (file) =>
  new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith("image/")) return reject("That file isn't a picture.")
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const scale = Math.min(1, 1920 / img.width, 1080 / img.height)
      const canvas = document.createElement("canvas")
      canvas.width = Math.max(1, Math.round(img.width * scale))
      canvas.height = Math.max(1, Math.round(img.height * scale))
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height)
      let data = canvas.toDataURL("image/jpeg", 0.85)
      if (data.length > 3_000_000) data = canvas.toDataURL("image/jpeg", 0.6)
      resolve(data)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject("That picture couldn't be opened.")
    }
    img.src = url
  })

export const saveWallpaperImage = (data) => {
  try {
    localStorage.setItem(IMAGE_KEY, data)
    imageCache = data
    return true
  } catch {
    return false
  }
}

// the Our Story photo showing on the desktop right now (kept in memory only)
let ourPhoto = null
export const setOurPhoto = (data) => {
  ourPhoto = data || null
  listeners.forEach((fn) => fn({ ...current }))
}

// ---- what the desktop looks like ----

const PATTERNS = {
  bricks: (c) => ({
    backgroundColor: c,
    backgroundImage:
      "linear-gradient(335deg, rgba(0,0,0,.35) 23px, transparent 23px), linear-gradient(155deg, rgba(0,0,0,.35) 23px, transparent 23px), linear-gradient(335deg, rgba(0,0,0,.35) 23px, transparent 23px), linear-gradient(155deg, rgba(0,0,0,.35) 23px, transparent 23px)",
    backgroundSize: "58px 58px",
    backgroundPosition: "0 2px, 4px 35px, 29px 31px, 34px 6px",
  }),
  checks: (c) => ({
    backgroundColor: c,
    backgroundImage:
      "linear-gradient(45deg, rgba(0,0,0,.25) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.25) 75%), linear-gradient(45deg, rgba(0,0,0,.25) 25%, transparent 25%, transparent 75%, rgba(0,0,0,.25) 75%)",
    backgroundSize: "16px 16px",
    backgroundPosition: "0 0, 8px 8px",
  }),
  diamonds: (c) => ({
    backgroundColor: c,
    backgroundImage: "linear-gradient(45deg, rgba(255,255,255,.18) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.18) 75%), linear-gradient(-45deg, rgba(255,255,255,.18) 25%, transparent 25%, transparent 75%, rgba(255,255,255,.18) 75%)",
    backgroundSize: "12px 12px",
  }),
  stripes: (c) => ({
    backgroundColor: c,
    backgroundImage: "repeating-linear-gradient(90deg, rgba(0,0,0,.22) 0 1px, transparent 1px 4px)",
  }),
  dots: (c) => ({
    backgroundColor: c,
    backgroundImage: "radial-gradient(rgba(255,255,255,.35) 2px, transparent 2.5px)",
    backgroundSize: "14px 14px",
  }),
}

const imageStyle = (url, display, color) => ({
  backgroundColor: color,
  backgroundImage: `url("${url}")`,
  backgroundRepeat: display === "tile" ? "repeat" : "no-repeat",
  backgroundPosition: display === "tile" ? "0 0" : "center",
  backgroundSize: display === "stretch" ? "cover" : "auto",
})

const wallpaperUrl = (id) => WALLPAPERS.find((w) => w.id === id)?.url

export const schemeFor = (id) => SCHEMES.find((s) => s.id === id) || SCHEMES[0]

// CSS for the desktop background
export const wallpaperStyle = (settings) => {
  const color = schemeFor(settings.scheme).desktop
  switch (settings.wallpaper) {
    case "none":
      return { backgroundColor: color, backgroundImage: "none" }
    case "vaporwave":
      return imageStyle("/assets/vaporwave.png", settings.display, color)
    case "custom": {
      const data = getWallpaperImage()
      return data ? imageStyle(data, settings.display, color) : { backgroundColor: color }
    }
    case "ourphotos":
      return ourPhoto
        ? { ...imageStyle(ourPhoto, settings.display === "tile" ? "stretch" : settings.display, "#3a1830"), transition: "background-image 1.2s ease" }
        : { backgroundColor: "#f4c6d6", backgroundImage: "radial-gradient(circle at 12px 12px, rgba(255,255,255,.55) 3px, transparent 3.5px)", backgroundSize: "24px 24px" }
    default:
      if (wallpaperUrl(settings.wallpaper)) return imageStyle(wallpaperUrl(settings.wallpaper), settings.display, color)
      if (PATTERNS[settings.wallpaper]) return PATTERNS[settings.wallpaper](color)
      return imageStyle("/assets/98ish-desktop.webp", settings.display, color)
  }
}

// CSS variables for title bars
export const schemeVars = (settings) => {
  const s = schemeFor(settings.scheme)
  return {
    "--title-a": s.title[0],
    "--title-b": s.title[1],
    "--title-inactive-a": s.inactive[0],
    "--title-inactive-b": s.inactive[1],
    // Desktop Themes: desktop icon effect and mouse pointers
    "--icon-filter": ICON_STYLES[settings.iconStyle] || "none",
    "--os-cursor": CURSORS[settings.cursor] || "default",
  }
}

// desktop icon effects a theme can set
export const ICON_STYLES = {
  none: "none",
  glow: "drop-shadow(0 0 3px #9fd8ff) drop-shadow(0 0 1px #fff)",
  sea: "sepia(0.35) hue-rotate(150deg) saturate(1.4) drop-shadow(0 0 2px #7fe9ff)",
  neon: "saturate(1.6) drop-shadow(0 0 3px #ff4fd8)",
  fossil: "sepia(0.55) saturate(1.2) drop-shadow(1px 1px 0 #2f3a10)",
}

// mouse pointer sets (small SVGs under /assets/themes/cursors)
export const CURSORS = {
  rocket: 'url("/assets/themes/cursors/rocket.svg") 1 1, default',
  fish: 'url("/assets/themes/cursors/fish.svg") 1 1, default',
  neon: 'url("/assets/themes/cursors/neon.svg") 1 1, default',
  bone: 'url("/assets/themes/cursors/bone.svg") 1 1, default',
}
