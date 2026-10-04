const test = require("node:test")
const assert = require("node:assert/strict")
const { isBlockedAddress, checkUrlShape, checkUrl, pinnedLookup, parseTestHosts } = require("../guard")

test("private, loopback, link-local and special IPv4 addresses are blocked", () => {
  for (const ip of [
    "0.0.0.0",
    "0.1.2.3",
    "10.0.0.1",
    "10.255.255.255",
    "100.64.0.1",
    "100.127.255.254",
    "127.0.0.1",
    "127.1.2.3",
    "169.254.169.254", // cloud metadata
    "169.254.0.1",
    "172.16.0.1",
    "172.31.255.255",
    "192.0.0.8",
    "192.0.2.1",
    "192.88.99.1",
    "192.168.1.1",
    "198.18.0.1",
    "198.19.255.255",
    "198.51.100.7",
    "203.0.113.9",
    "224.0.0.1",
    "239.255.255.250",
    "240.0.0.1",
    "255.255.255.255",
  ])
    assert.equal(isBlockedAddress(ip), true, ip)
})

test("public IPv4 addresses are allowed, including neighbors of blocked ranges", () => {
  for (const ip of ["1.1.1.1", "8.8.8.8", "93.184.215.14", "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.1", "192.167.1.1", "169.253.1.1", "11.0.0.1", "126.255.255.255", "223.255.255.254"])
    assert.equal(isBlockedAddress(ip), false, ip)
})

test("special IPv6 addresses are blocked, including IPv4 hidden inside them", () => {
  for (const ip of [
    "::",
    "::1",
    "0:0:0:0:0:0:0:1",
    "[::1]",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:169.254.169.254",
    "::ffff:10.0.0.1",
    "::127.0.0.1", // IPv4-compatible
    "64:ff9b::a00:1", // NAT64
    "64:ff9b:1::1",
    "100::1",
    "2001::1", // Teredo
    "2001:db8::1",
    "2002:7f00:1::1", // 6to4
    "fc00::1",
    "fd00:ec2::254", // AWS metadata over IPv6
    "fdff:ffff::1",
    "fe80::1",
    "fe80::1%eth0",
    "febf::1",
    "fec0::1",
    "ff02::1",
    "3fff::1".replace("3fff", "4000"), // outside 2000::/3
    "not-an-ip",
    "",
  ])
    assert.equal(isBlockedAddress(ip), true, ip)
})

test("global IPv6 unicast is allowed", () => {
  for (const ip of ["2606:4700:4700::1111", "2a00:1450:4001:80b::200e", "2001:4860:4860::8888", "::ffff:8.8.8.8"]) assert.equal(isBlockedAddress(ip), false, ip)
})

test("URL shapes: schemes, ports, credentials and local names", () => {
  const ok = (u) => assert.equal(checkUrlShape(u).ok, true, u)
  const no = (u) => assert.equal(checkUrlShape(u).ok, false, u)
  ok("https://example.com/")
  ok("http://example.com:8080/x")
  ok("https://example.com:8443/x")
  ok("http://example.com:80/")
  no("ftp://example.com/")
  no("file:///etc/passwd")
  no("javascript:alert(1)")
  no("data:text/html,hi")
  no("gopher://example.com/")
  no("https://example.com:22/")
  no("http://example.com:6379/")
  no("http://example.com:3000/")
  no("https://user:pass@example.com/")
  no("http://localhost/")
  no("http://LOCALHOST./")
  no("http://foo.localhost/")
  no("http://printer.local/")
  no("http://metadata.google.internal/")
  no("http://router.lan/")
  no("http://intranet/")
  no("http://127.0.0.1/")
  no("http://2130706433/") // 127.0.0.1 as one number
  no("http://0x7f.0.0.1/")
  no("http://0177.0.0.1/")
  no("http://127.1/")
  no("http://[::1]/")
  no("http://[::ffff:169.254.169.254]/")
  no("http://169.254.169.254/latest/meta-data/")
  no("http://10.0.0.5:8080/")
  no("not a url")
})

test("our own host names are refused", () => {
  const own = { blockedHosts: ["nine8ish.onrender.com", "localhost:8352"] }
  assert.equal(checkUrlShape("https://nine8ish.onrender.com/api/web/r/x", own).ok, false)
  assert.equal(checkUrlShape("https://NINE8ISH.onrender.com./", own).ok, false)
  assert.equal(checkUrlShape("https://sub.nine8ish.onrender.com/", own).ok, false)
  assert.equal(checkUrlShape("https://other.onrender.com/", own).ok, true)
})

const resolver = (table) => async (host) => {
  if (!(host in table)) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" })
  return table[host].map((address) => ({ address, family: address.includes(":") ? 6 : 4 }))
}

test("DNS answers are checked: any private answer refuses the whole name", async () => {
  const resolve = resolver({
    "good.example": ["93.184.215.14"],
    "evil.example": ["127.0.0.1"],
    "mixed.example": ["93.184.215.14", "10.0.0.1"],
    "meta.example": ["169.254.169.254"],
    "six.example": ["2606:4700::1"],
    "sixlocal.example": ["::1"],
    "mapped.example": ["::ffff:192.168.0.1"],
  })
  assert.deepEqual((await checkUrl("https://good.example/", { resolve })).addresses, [{ address: "93.184.215.14", family: 4 }])
  assert.equal((await checkUrl("https://six.example/", { resolve })).ok, true)
  for (const host of ["evil", "mixed", "meta", "sixlocal", "mapped"]) assert.equal((await checkUrl(`https://${host}.example/`, { resolve })).ok, false, host)
  const missing = await checkUrl("https://nowhere.example/", { resolve })
  assert.equal(missing.ok, false)
  assert.equal(missing.dns, true)
})

test("DNS rebinding: the connection uses the checked address, never a second lookup", async () => {
  // a name that answers public first, private the second time
  let calls = 0
  const resolve = async () => (++calls === 1 ? [{ address: "93.184.215.14", family: 4 }] : [{ address: "127.0.0.1", family: 4 }])
  const checked = await checkUrl("https://rebind.example/", { resolve })
  assert.equal(checked.ok, true)
  const lookup = pinnedLookup(checked.addresses)
  await new Promise((done) =>
    lookup("rebind.example", {}, (error, address, family) => {
      assert.equal(error, null)
      assert.equal(address, "93.184.215.14")
      assert.equal(family, 4)
      done()
    })
  )
  await new Promise((done) =>
    lookup("rebind.example", { all: true }, (error, list) => {
      assert.deepEqual(list, [{ address: "93.184.215.14", family: 4 }])
      done()
    })
  )
  assert.equal(calls, 1) // the second (private) answer was never asked for
  // and checking again would refuse it
  assert.equal((await checkUrl("https://rebind.example/", { resolve })).ok, false)
})

test("a real connection is pinned: a request to a name connects to the checked address", async () => {
  const http = require("node:http")
  const { requestOnce } = require("../fetcher")
  const server = http.createServer((req, res) => res.end(`host=${req.headers.host}`)).listen(0, "127.0.0.1")
  await new Promise((r) => server.once("listening", r))
  const port = server.address().port
  try {
    // "pinned.example" doesn't exist in DNS; the pinned lookup takes it to 127.0.0.1
    const res = await requestOnce(new URL(`http://pinned.example:${port}/`), [{ address: "127.0.0.1", family: 4 }], {})
    let body = ""
    for await (const chunk of res) body += chunk
    assert.equal(body, `host=pinned.example:${port}`)
  } finally {
    server.close()
  }
})

test("test hosts (WEB_TEST_HOSTS) are parsed and bypass only for those names", async () => {
  const hosts = parseTestHosts("site.test=127.0.0.1, bad=notanip,other.test=::1")
  assert.deepEqual(hosts, { "site.test": "127.0.0.1", "other.test": "::1" })
  assert.equal(parseTestHosts(""), null)
  const checked = await checkUrl("http://site.test:5555/", { testHosts: hosts })
  assert.equal(checked.ok, true)
  assert.equal(checked.addresses[0].address, "127.0.0.1")
  assert.equal((await checkUrl("http://127.0.0.1:5555/", { testHosts: hosts })).ok, false)
})

test("allowHost (the guest allowlist) is checked before DNS, test hosts included", async () => {
  let looked = 0
  const resolve = async () => (looked++, [{ address: "93.184.215.14", family: 4 }])
  const allowHost = (h) => h === "en.wikipedia.org"
  assert.equal((await checkUrl("https://en.wikipedia.org/wiki/X", { resolve, allowHost })).ok, true)
  const no = await checkUrl("https://evil.example/", { resolve, allowHost })
  assert.equal(no.ok, false)
  assert.equal(no.notAllowed, true)
  assert.equal(looked, 1)
  assert.equal((await checkUrl("http://site.test:5555/", { testHosts: { "site.test": "127.0.0.1" }, allowHost })).notAllowed, true)
})
