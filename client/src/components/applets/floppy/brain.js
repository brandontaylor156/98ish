// Floppy's brain, the page side: one worker, loaded on demand and let go when Floppy closes.
// The person opts in once ("Give Floppy a brain?"); the model files then stay in the browser's
// Cache Storage until Delete (Floppy's More options, or Control Panel > Storage).
// Memory rules (iPhone tabs die around 1.5 GB): one model at a time, never with Pickleball 98.

import { useSyncExternalStore } from "react"
import { EMBEDDER, MODELS } from "./floppyCore"

const PREFS = "98ish.floppy" // per person (the storage seam adds the user prefix): { brain: "webgpu" | "wasm" | null }
const CACHE = "transformers-cache"

let worker = null
let state = { status: "none", progress: 0, loaded: 0, total: 0, device: null, model: null, error: null, stats: null }
const listeners = new Set()
const set = (patch) => {
  state = { ...state, ...patch }
  listeners.forEach((fn) => fn())
}
export const useBrain = () =>
  useSyncExternalStore(
    (fn) => (listeners.add(fn), () => listeners.delete(fn)),
    () => state
  )
export const getBrain = () => state

const prefs = () => {
  try {
    return JSON.parse(localStorage.getItem(PREFS) || "{}") || {}
  } catch {
    return {}
  }
}
const savePrefs = (p) => {
  try {
    localStorage.setItem(PREFS, JSON.stringify({ ...prefs(), ...p }))
  } catch {
    // storage blocked: the opt-in lasts this visit
  }
}
export const brainChosen = () => !!prefs().brain

let pending = new Map() // id -> { resolve, reject, onToken }
let seq = 0
let waitReady = null

const start = () => {
  if (worker) return worker
  worker = new Worker(new URL("./brain.worker.js", import.meta.url), { type: "module" })
  worker.onmessage = (e) => {
    const m = e.data
    if (m.type === "progress") set({ status: state.status === "ready" ? "ready" : "downloading", loaded: m.loaded, total: m.total, progress: m.total ? m.loaded / m.total : 0 })
    else if (m.type === "ready") {
      set({ status: "ready", device: m.device, stats: { ...(state.stats || {}), loadMs: m.ms } })
      waitReady?.resolve()
      waitReady = null
    } else if (m.type === "token") pending.get(m.id)?.onToken?.(m.text)
    else if (m.type === "done") {
      const p = pending.get(m.id)
      pending.delete(m.id)
      const tps = m.tokens && m.ms ? +(m.tokens / ((m.ms - (m.firstMs || 0)) / 1000 || 1)).toFixed(1) : null
      set({ stats: { ...(state.stats || {}), tokens: m.tokens, ms: m.ms, firstMs: m.firstMs, tps } })
      p?.resolve(m.text)
    } else if (m.type === "embedded") {
      const p = pending.get(m.id)
      pending.delete(m.id)
      p?.resolve(m.vectors)
    } else if (m.type === "error") {
      if (m.id && pending.has(m.id)) {
        pending.get(m.id).reject(new Error(m.error))
        pending.delete(m.id)
      } else {
        set({ status: "error", error: m.error })
        waitReady?.reject(new Error(m.error))
        waitReady = null
      }
    } else if (m.type === "probe") probeDone?.(m.webgpu)
  }
  worker.onerror = (e) => {
    set({ status: "error", error: e.message || "The brain stopped." })
    waitReady?.reject(new Error("worker error"))
    waitReady = null
  }
  return worker
}

let probeDone = null
const probe = () =>
  new Promise((resolve) => {
    probeDone = (v) => ((probeDone = null), resolve(v))
    start().postMessage({ type: "probe" })
    setTimeout(() => probeDone?.(false), 4000)
  })

// which model this device gets: the GPU one where WebGPU works, else the CPU one
export const pickModel = async () => {
  const forced = prefs().brain
  if (forced && MODELS[forced]) return MODELS[forced]
  return (await probe()) ? MODELS.webgpu : MODELS.wasm
}

// windows: the desktop's windows (Pickleball 98 open -> no brain, to keep memory for the game)
export const pickleballOpen = (windows = []) => windows.some((w) => !w.closed && (w.app === "pickleball" || w.name === "Pickleball 98"))

export const loadBrain = async (windows) => {
  if (pickleballOpen(windows)) throw new Error("pickleball")
  if (state.status === "ready") return state
  const spec = await pickModel()
  savePrefs({ brain: spec.device === "webgpu" ? "webgpu" : "wasm" })
  set({ status: "loading", model: spec, error: null, progress: 0 })
  const done = new Promise((resolve, reject) => (waitReady = { resolve, reject }))
  start().postMessage({ type: "load", model: spec })
  await done
  return state
}

export const generate = (messages, { onToken, max = 160 } = {}) => {
  const id = ++seq
  const spec = state.model || MODELS.wasm
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onToken })
    start().postMessage({ type: "generate", id, messages, max, template: spec.template || {} })
  })
}

export const embed = (texts) => {
  const id = ++seq
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject })
    start().postMessage({ type: "embed", id, texts, spec: EMBEDDER })
  })
}

// let the memory go (Floppy closed, Pickleball opened): the files stay cached
export const unloadBrain = () => {
  if (!worker) return
  try {
    worker.postMessage({ type: "unload" })
  } catch {
    // gone
  }
  setTimeout(() => {
    worker?.terminate()
    worker = null
    pending = new Map()
  }, 300)
  set({ status: brainChosen() ? "asleep" : "none", progress: 0 })
}

// how much the downloaded model files take (Cache Storage), in bytes
export const brainBytes = async () => {
  try {
    if (!self.caches) return 0
    const cache = await caches.open(CACHE)
    let total = 0
    for (const req of await cache.keys()) {
      const res = await cache.match(req)
      const len = Number(res?.headers.get("content-length"))
      total += Number.isFinite(len) && len > 0 ? len : 0
    }
    return total
  } catch {
    return 0
  }
}

export const deleteBrain = async () => {
  unloadBrain()
  savePrefs({ brain: null })
  try {
    await caches.delete(CACHE)
  } catch {
    // nothing cached
  }
  set({ status: "none", device: null, model: null, stats: null })
}

if (typeof window !== "undefined" && import.meta.env?.DEV) window.__floppyBrain = { loadBrain, generate, embed, unloadBrain, deleteBrain, brainBytes, getBrain }
