// One request from the relay to a web site, through the SSRF guard: the host is resolved and
// checked (guard.js), and the socket connects to exactly the address that was checked.
// fetchChecked() never follows redirects itself unless asked (the relay hands redirects back
// to the browser as relay addresses, so every hop comes back through the guard); with
// { follow: n } it follows up to n hops, checking each one again.

const http = require("http")
const https = require("https")
const net = require("net")
const { checkUrl, pinnedLookup } = require("./guard")

const agents = {
  "http:": new http.Agent({ keepAlive: true, maxSockets: 24, maxFreeSockets: 6, timeout: 30000 }),
  "https:": new https.Agent({ keepAlive: true, maxSockets: 24, maxFreeSockets: 6, timeout: 30000 }),
}

class Refused extends Error {
  constructor(status, message, extra = {}) {
    super(message)
    this.status = status
    Object.assign(this, extra)
  }
}

const REDIRECTS = new Set([301, 302, 303, 307, 308])

// -> Promise<IncomingMessage>
const requestOnce = (url, addresses, { method = "GET", headers = {}, body = null, timeoutMs = 20000 }) =>
  new Promise((resolve, reject) => {
    const host = url.hostname.replace(/^\[|\]$/g, "")
    const req = (url.protocol === "https:" ? https : http).request({
      protocol: url.protocol,
      hostname: host,
      port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname + url.search,
      method,
      headers: { ...headers, host: url.host },
      agent: agents[url.protocol],
      lookup: pinnedLookup(addresses),
      servername: net.isIP(host) ? undefined : host,
      timeout: timeoutMs,
    })
    // no answer at all in time: give up (a slow body is limited by the socket timeout)
    const deadline = setTimeout(() => req.destroy(new Refused(504, "The site took too long to answer.")), timeoutMs)
    req.on("response", (res) => {
      clearTimeout(deadline)
      resolve(res)
    })
    req.on("timeout", () => req.destroy(new Refused(504, "The site took too long to answer.")))
    req.on("error", (error) => {
      clearTimeout(deadline)
      reject(error instanceof Refused ? error : new Refused(502, `Compass couldn't reach ${url.hostname} (${error.code || error.message}).`))
    })
    if (body && body.length) req.end(body)
    else req.end()
  })

// -> { res, url } ; headersFor(url, method) builds each hop's headers (cookies differ per hop)
const fetchChecked = async (input, { method = "GET", headersFor = () => ({}), body = null, follow = 0, timeoutMs, guard = {}, onResponse } = {}) => {
  let url = input instanceof URL ? input : new URL(input)
  let hops = 0
  for (;;) {
    const checked = await checkUrl(url, guard)
    if (!checked.ok) throw new Refused(checked.dns ? 502 : 403, checked.reason, checked.notAllowed ? { notAllowed: true, url: url.href } : checked.denied ? { blocked: true, denied: checked.denied, url: url.href } : { blocked: !checked.dns })
    const res = await requestOnce(checked.url, checked.addresses, { method, headers: headersFor(checked.url, method), body, timeoutMs })
    onResponse?.(res, checked.url)
    const location = res.headers.location
    if (follow && REDIRECTS.has(res.statusCode) && location) {
      res.resume()
      if (++hops > follow) throw new Refused(508, "The site redirected too many times.")
      let next
      try {
        next = new URL(location, checked.url)
      } catch {
        throw new Refused(502, "The site sent a broken redirect.")
      }
      if (res.statusCode === 303 || ((res.statusCode === 301 || res.statusCode === 302) && method === "POST")) {
        method = "GET"
        body = null
      }
      url = next
      continue
    }
    return { res, url: checked.url }
  }
}

module.exports = { fetchChecked, requestOnce, Refused, REDIRECTS, agents }
