// The rest of the 98ish API (everything but Compass's relay at /api/web) refuses requests from
// opaque origins ("Origin: null"): sandboxed frames, which is what every relayed page is. A
// relayed page has no 98ish token to send, and no 98ish API authenticates by cookie (they all
// want "Authorization: Bearer <token>", which a browser never adds by itself), so this is
// defence in depth: even an anonymous endpoint (guestbook, homepages, socket.io) can't be
// driven from a relayed page through the visitor's browser.
// Nothing legitimate sends Origin: null here: the 98ish client is a normal https origin, and
// calendar feeds, push services and health checks send no Origin at all.

const isOpaqueOrigin = (origin) => String(origin ?? "").trim().toLowerCase() === "null"

// Express middleware (mount after /api/web)
const refuseOpaqueOrigins = (request, response, next) => {
  if (isOpaqueOrigin(request.headers.origin)) {
    response.set({ "content-security-policy": "sandbox", "x-content-type-options": "nosniff" })
    return response.status(403).json({ error: "Requests from sandboxed pages aren't accepted." })
  }
  next()
}

// socket.io's allowRequest: refuse handshakes from opaque origins
const allowSocketRequest = (request, callback) => callback(null, !isOpaqueOrigin(request.headers.origin))

module.exports = { isOpaqueOrigin, refuseOpaqueOrigins, allowSocketRequest }
