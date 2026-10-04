// The relay's SSRF guard: which addresses the 98ish server may fetch for Compass.
//
// A URL may be fetched only if it is http(s), on port 80/443/8080/8443, carries no user
// name or password, isn't a local-only name (localhost, *.local, *.internal...), isn't one of
// our own host names, and EVERY address its host resolves to is a public unicast address.
// The caller then connects to the address that was checked (pinnedLookup), never resolving
// the name again, so a DNS answer that changes between the check and the connection (DNS
// rebinding) can't point the request at a private address. Redirects are checked again
// hop by hop (see fetcher.js).

const net = require("net")
const dns = require("dns")

const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"])
const LOCAL_NAMES = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa|in-addr\.arpa|ip6\.arpa|onion)$/

// ---------- IPv4 ----------

const v4ToInt = (ip) => ip.split(".").reduce((n, part) => n * 256 + Number(part), 0)
const cidr4 = (base, bits) => {
  const start = v4ToInt(base)
  const size = 2 ** (32 - bits)
  return (n) => n >= start && n < start + size
}
const BLOCKED_V4 = [
  cidr4("0.0.0.0", 8), // "this network"
  cidr4("10.0.0.0", 8), // private
  cidr4("100.64.0.0", 10), // carrier-grade NAT
  cidr4("127.0.0.0", 8), // loopback
  cidr4("169.254.0.0", 16), // link-local, incl. the cloud metadata address 169.254.169.254
  cidr4("172.16.0.0", 12), // private
  cidr4("192.0.0.0", 24), // IETF protocol assignments
  cidr4("192.0.2.0", 24), // documentation
  cidr4("192.88.99.0", 24), // 6to4 relay
  cidr4("192.168.0.0", 16), // private
  cidr4("198.18.0.0", 15), // benchmarking
  cidr4("198.51.100.0", 24), // documentation
  cidr4("203.0.113.0", 24), // documentation
  cidr4("224.0.0.0", 4), // multicast
  cidr4("240.0.0.0", 4), // reserved, incl. broadcast
]
const blockedV4 = (ip) => BLOCKED_V4.some((inRange) => inRange(v4ToInt(ip)))

// ---------- IPv6 ----------

// "::ffff:1.2.3.4" / "fe80::1%eth0" -> 8 numbers (or null)
const v6Words = (input) => {
  let ip = String(input).replace(/^\[|\]$/g, "").replace(/%.*$/, "").toLowerCase()
  const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(ip)
  if (dotted) {
    if (!net.isIPv4(dotted[1])) return null
    const n = v4ToInt(dotted[1])
    ip = ip.slice(0, -dotted[1].length) + ((n >>> 16) & 0xffff).toString(16) + ":" + (n & 0xffff).toString(16)
  }
  const halves = ip.split("::")
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(":") : []
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : []
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0
  const words = [...head, ...Array(Math.max(0, fill)).fill("0"), ...tail]
  if (words.length !== 8 || words.some((w) => !/^[0-9a-f]{1,4}$/.test(w))) return null
  return words.map((w) => parseInt(w, 16))
}

const blockedV6 = (ip) => {
  const w = v6Words(ip)
  if (!w) return true
  const embeddedV4 = () => `${w[6] >> 8}.${w[6] & 255}.${w[7] >> 8}.${w[7] & 255}`
  // ::/96 (unspecified, loopback, the old IPv4-compatible form) and ::ffff:0:0/96 (IPv4-mapped)
  if (w.slice(0, 5).every((x) => x === 0) && (w[5] === 0 || w[5] === 0xffff)) {
    if (w[5] === 0xffff) return blockedV4(embeddedV4())
    return true
  }
  if (w[0] === 0x64 && w[1] === 0xff9b) return true // NAT64 (64:ff9b::/96 and /48): could reach anything
  if (w[0] === 0x0100 && w[1] === 0 && w[2] === 0 && w[3] === 0) return true // discard-only 100::/64
  if (w[0] === 0x2001 && w[1] < 0x0200) return true // 2001::/23 IETF special (Teredo 2001::/32, ORCHID...)
  if (w[0] === 0x2001 && w[1] === 0x0db8) return true // documentation
  if (w[0] === 0x2002) return true // 6to4: carries an IPv4 address
  if ((w[0] & 0xfe00) === 0xfc00) return true // unique local fc00::/7 (incl. fd00:ec2::254 metadata)
  if ((w[0] & 0xffc0) === 0xfe80) return true // link-local fe80::/10
  if ((w[0] & 0xffc0) === 0xfec0) return true // old site-local fec0::/10
  if ((w[0] & 0xff00) === 0xff00) return true // multicast
  if ((w[0] & 0xe000) !== 0x2000) return true // only global unicast 2000::/3 is on the public Internet
  return false
}

// true if the relay must never connect to this address
const isBlockedAddress = (address) => {
  const ip = String(address || "").replace(/^\[|\]$/g, "")
  if (net.isIPv4(ip)) return blockedV4(ip)
  if (net.isIPv6(ip.replace(/%.*$/, ""))) return blockedV6(ip)
  return true // not an address at all
}

// ---------- URLs ----------

// The parts of a URL that can be decided without DNS -> { ok, url } | { ok: false, reason }
// allowHost(host): an extra rule for who is asking (guests: the guest allowlist), checked on
// every hop, test hosts included. denyHost(host) -> null | { category, message }: sites Compass
// never opens (blocklist.js), also checked on every hop
const checkUrlShape = (input, { blockedHosts = [], testHosts = null, allowHost = null, denyHost = null } = {}) => {
  let url
  try {
    url = input instanceof URL ? new URL(input.href) : new URL(String(input))
  } catch {
    return { ok: false, reason: "That isn't a web address." }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "Only http and https addresses can be opened." }
  if (url.username || url.password) return { ok: false, reason: "Addresses with a user name or password in them can't be opened." }
  const denied = denyHost ? denyHost(url.hostname.toLowerCase().replace(/\.$/, "")) : null
  if (denied) return { ok: false, reason: denied.message, denied: denied.category }
  if (allowHost && !allowHost(url.hostname.toLowerCase().replace(/\.$/, ""))) return { ok: false, reason: "Sign on with your 98 Messenger screen name to browse other sites.", notAllowed: true }
  // local test sites (WEB_TEST_HOSTS, never set in production): any port, their own address
  if (testHosts && Object.prototype.hasOwnProperty.call(testHosts, url.hostname)) return { ok: true, url, host: url.hostname, test: testHosts[url.hostname] }
  if (!ALLOWED_PORTS.has(url.port)) return { ok: false, reason: "Only the usual web ports (80, 443, 8080, 8443) can be opened." }
  const host = url.hostname.toLowerCase().replace(/\.$/, "")
  if (!host) return { ok: false, reason: "That address has no host name." }
  const bare = host.replace(/^\[|\]$/g, "")
  if (net.isIP(bare)) {
    if (isBlockedAddress(bare)) return { ok: false, reason: "That address is on a private network." }
  } else {
    if (!host.includes(".") || LOCAL_NAMES.test(host)) return { ok: false, reason: "That address is on a private network." }
    if (!/^[a-z0-9.-]+$/.test(host)) return { ok: false, reason: "That host name isn't valid." }
  }
  const own = blockedHosts.map((h) => String(h).toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "")).filter(Boolean)
  if (own.some((h) => host === h || host.endsWith("." + h))) return { ok: false, reason: "Compass can't open the 98ish server itself." }
  return { ok: true, url, host: bare }
}

const defaultResolve = (host) => dns.promises.lookup(host, { all: true, verbatim: true })

// The whole check, DNS included -> { ok, url, addresses: [{ address, family }] } | { ok: false, reason }
const checkUrl = async (input, { blockedHosts = [], resolve = defaultResolve, testHosts = null, allowHost = null, denyHost = null } = {}) => {
  const shape = checkUrlShape(input, { blockedHosts, testHosts, allowHost, denyHost })
  if (!shape.ok) return shape
  if (shape.test) return { ok: true, url: shape.url, addresses: [{ address: shape.test, family: net.isIP(shape.test) || 4 }] }
  if (net.isIP(shape.host)) return { ok: true, url: shape.url, addresses: [{ address: shape.host, family: net.isIP(shape.host) }] }
  let addresses
  try {
    addresses = await resolve(shape.host)
  } catch {
    return { ok: false, reason: `Compass can't find the server at ${shape.host}.`, dns: true }
  }
  addresses = (Array.isArray(addresses) ? addresses : [addresses]).filter((a) => a && a.address)
  if (!addresses.length) return { ok: false, reason: `Compass can't find the server at ${shape.host}.`, dns: true }
  // one private answer is enough to refuse: an attacker's name could mix public and private ones
  if (addresses.some((a) => isBlockedAddress(a.address))) return { ok: false, reason: "That address points to a private network." }
  return { ok: true, url: shape.url, addresses: addresses.map((a) => ({ address: a.address, family: a.family || net.isIP(a.address) })) }
}

// A `lookup` for http.request that answers with the address that was checked: the socket
// connects there and nowhere else (no second DNS query)
const pinnedLookup = (checked) => (hostname, options, callback) => {
  if (typeof options === "function") (callback = options), (options = {})
  const first = checked[0]
  if (options && options.all) return callback(null, checked.map((a) => ({ address: a.address, family: a.family })))
  callback(null, first.address, first.family)
}

// WEB_TEST_HOSTS="site.test=127.0.0.1,other.test=127.0.0.1" -> { "site.test": "127.0.0.1", ... }
const parseTestHosts = (text) => {
  const out = {}
  for (const pair of String(text || "").split(",")) {
    const [host, address] = pair.split("=").map((s) => s && s.trim().toLowerCase())
    if (host && address && net.isIP(address)) out[host] = address
  }
  return Object.keys(out).length ? out : null
}

module.exports = { parseTestHosts, isBlockedAddress, checkUrlShape, checkUrl, pinnedLookup, ALLOWED_PORTS }
