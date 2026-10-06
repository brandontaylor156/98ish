// What a Visual Basic 98 program's sandbox may say to 98ish (the allow-list). Anything not
// listed here, or not shaped right, is dropped: a program can't ask 98ish to do anything
// else (open windows, read files, send messages...). Pure, for the unit tests.

export const SHARED_KEY = /^[\w .:\-#@!?+=]{1,64}$/
export const MAX_VALUE = 8000
const SOUND = /^[a-z]{2,12}$/

// returns a clean copy of an allowed message, or null
export const checkSandboxMessage = (data) => {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null
  switch (data.t) {
    case "boot":
    case "ready":
    case "end":
      return { t: data.t }
    case "pong":
      return Number.isFinite(data.n) ? { t: "pong", n: data.n } : null
    case "sound":
      return typeof data.name === "string" && SOUND.test(data.name) ? { t: "sound", name: data.name } : null
    case "set": {
      if (typeof data.k !== "string" || !SHARED_KEY.test(data.k)) return null
      const v = data.v
      if (typeof v === "number") return Number.isFinite(v) ? { t: "set", k: data.k, v } : null
      if (typeof v === "boolean") return { t: "set", k: data.k, v }
      if (typeof v === "string" && v.length <= MAX_VALUE) return { t: "set", k: data.k, v }
      return null
    }
    case "error":
      return {
        t: "error",
        message: String(data.message ?? "").slice(0, 300),
        line: Number.isFinite(data.line) ? Math.max(0, Math.round(data.line)) : 0,
        fatal: !!data.fatal,
      }
  }
  return null
}

// Shared state's size as the server counts it (keys + JSON values)
export const sharedBytes = (state) => Object.entries(state || {}).reduce((n, [k, v]) => n + k.length + JSON.stringify(v).length, 0)
