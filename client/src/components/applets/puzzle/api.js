// The puzzle server (server/puzzles), signed with the 98 Messenger session's token. Every
// call resolves to { ok, ... } or { ok: false, error } (never throws).
export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"

export const puzzleApi = (token) => {
  const call = async (method, path, body) => {
    if (!token) return { ok: false, error: "Sign on to 98 Messenger to send and get puzzles." }
    try {
      const response = await fetch(`${SERVER_URL}/api/puzzles${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      return await response.json().catch(() => ({ ok: false, error: `The puzzle server had a problem (${response.status}).` }))
    } catch {
      return { ok: false, error: "Couldn't reach the puzzle server. It may be waking up; try again in a minute." }
    }
  }
  return {
    list: () => call("GET", "/"),
    get: (id) => call("GET", `/${encodeURIComponent(id)}`),
    send: (puzzle) => call("POST", "/", puzzle),
    solved: (id, ms, moves) => call("POST", `/${encodeURIComponent(id)}/solved`, { ms, moves }),
    remove: (id) => call("DELETE", `/${encodeURIComponent(id)}`),
  }
}
