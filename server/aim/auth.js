// HTTP requests from a signed-on 98 Messenger user (98ish Mail, HomePage Studio) carry
// the session's token as "Authorization: Bearer <token>": the same secret the client
// already holds to resume its session. Signing off (or being bumped) ends it.

const BEARER = /^Bearer ([a-f0-9]{48})$/

// The signed-on session behind a request, or null
const sessionFrom = (aim, request) => {
  const match = BEARER.exec(String(request.headers.authorization || ""))
  return (match && aim?.authenticate?.(match[1])) || null
}

module.exports = { sessionFrom }
