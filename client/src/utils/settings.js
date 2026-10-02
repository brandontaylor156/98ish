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
  { id: "custom", label: "(Your picture)" },
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
]

export const DEFAULT_SETTINGS = {
  wallpaper: "default",
  display: "stretch", // stretch | center | tile
  scheme: "standard",
  bootScreen: true,
  startupSound: true,
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
    default:
      if (PATTERNS[settings.wallpaper]) return PATTERNS[settings.wallpaper](color)
      return imageStyle("/assets/98ish-desktop.png", settings.display, color)
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
  }
}
