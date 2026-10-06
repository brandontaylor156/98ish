// Loads the emulators on first use, from jsDelivr at pinned versions (see catalog.js CDN).
// Each loads once per page; later calls get the same promise.
import { CDN } from "./catalog"

const once = new Map()

const script = (src, { module = false } = {}) =>
  new Promise((resolve, reject) => {
    const el = document.createElement("script")
    el.src = src
    if (module) el.type = "module"
    el.async = true
    el.crossOrigin = "anonymous"
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Couldn't load ${src.split("/").slice(-2).join("/")}. Check the connection and try again.`))
    document.head.appendChild(el)
  })

const style = (href) =>
  new Promise((resolve) => {
    const el = document.createElement("link")
    el.rel = "stylesheet"
    el.href = href
    el.onload = () => resolve()
    el.onerror = () => resolve()
    document.head.appendChild(el)
  })

const load = (key, fn) => {
  if (!once.has(key))
    once.set(
      key,
      fn().catch((e) => {
        once.delete(key)
        throw e
      })
    )
  return once.get(key)
}

// js-dos 8: window.Dos(element, options)
export const loadJsDos = () =>
  load("jsdos", async () => {
    await Promise.all([style(`${CDN.jsdos}js-dos.css`), script(`${CDN.jsdos}js-dos.js`)])
    if (typeof window.Dos !== "function") throw new Error("The DOS player didn't start.")
    return window.Dos
  })

// v86: window.V86
export const loadV86 = () =>
  load("v86", async () => {
    await script(`${CDN.v86}libv86.js`)
    if (typeof window.V86 !== "function") throw new Error("The PC emulator didn't start.")
    return window.V86
  })

// Ruffle: window.RufflePlayer
export const loadRuffle = () =>
  load("ruffle", async () => {
    window.RufflePlayer = window.RufflePlayer || {}
    window.RufflePlayer.config = { publicPath: CDN.ruffle, autoplay: "on", unmuteOverlay: "hidden", splashScreen: false, letterbox: "on", contextMenu: "off", warnOnUnsupportedContent: false, showSwfDownload: false, ...(window.RufflePlayer.config || {}) }
    await script(`${CDN.ruffle}ruffle.js`)
    const r = window.RufflePlayer?.newest?.()
    if (!r) throw new Error("The Flash player didn't start.")
    return r
  })
