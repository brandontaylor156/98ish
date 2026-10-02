// The Quiz Show's HTTP API (server/quiz), signed with the 98 Messenger session's token.
// Every call resolves to { ok, ... } or { ok: false, error } (never throws).

export const SERVER_URL = import.meta.env.VITE_SOCKET_URL || "http://localhost:8000"

export const quizApi = (token) => {
  const call = async (method, path, body) => {
    if (!token) return { ok: false, error: "Sign on to 98 Messenger first.", signedOut: true }
    try {
      const response = await fetch(`${SERVER_URL}/api/quiz${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      })
      return await response.json().catch(() => ({ ok: false, error: `The quiz server had a problem (${response.status}).` }))
    } catch {
      return { ok: false, error: "Couldn't reach the quiz server. It may be waking up; try again in a minute." }
    }
  }
  const id = (x) => encodeURIComponent(x)
  return {
    inbox: () => call("GET", "/inbox"),
    send: (challenge) => call("POST", "/challenges", challenge),
    get: (challengeId) => call("GET", `/challenges/${id(challengeId)}`),
    attempt: (challengeId, answers) => call("POST", `/challenges/${id(challengeId)}/attempt`, { answers }),
    remove: (challengeId) => call("DELETE", `/challenges/${id(challengeId)}`),
    quizzes: () => call("GET", "/quizzes"),
    saveQuiz: (quiz) => call("POST", "/quizzes", quiz),
    removeQuiz: (quizId) => call("DELETE", `/quizzes/${id(quizId)}`),
    scores: () => call("GET", "/scores"),
  }
}
