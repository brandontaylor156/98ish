// The pure part of saves.js (names and encoding), for the unit tests

export const MAX_SAVE_BYTES = 4 * 1024 * 1024

// js-dos keys a game's changes by the bundle URL; we keep one save file per game
export const saveName = (key = "") => {
  const m = /([a-z0-9_-]+)\.jsdos/i.exec(String(key))
  return `${(m ? m[1] : "GAME").toUpperCase().slice(0, 8)}.SAV`
}

export const toDataUrl = (bytes) => {
  let bin = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK))
  return `data:application/octet-stream;base64,${btoa(bin)}`
}

export const fromDataUrl = (url) => {
  const m = /^data:[^,]*;base64,(.*)$/s.exec(String(url || ""))
  if (!m) return null
  const bin = atob(m[1])
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

