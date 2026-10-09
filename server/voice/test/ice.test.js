// TURN credential minting for calls and spatial voice (server/aim/ice.js)
const test = require("node:test")
const assert = require("node:assert/strict")
const crypto = require("crypto")
const { createIce } = require("../../aim/ice")

const quiet = async (fn) => {
  const error = console.error
  console.error = () => {}
  try {
    return await fn()
  } finally {
    console.error = error
  }
}

test("Cloudflare TURN: minted on the server with the token, cached, port 53 left out, the token never reaches the browser", async () => {
  const calls = []
  const fetchImpl = async (url, init) => {
    calls.push({ url, init })
    return {
      ok: true,
      json: async () => ({
        iceServers: [
          { urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"] },
          { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turn:turn.cloudflare.com:53?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u1", credential: "c1", junk: true },
        ],
      }),
    }
  }
  let t = 1_000_000
  const ice = createIce({ env: { CLOUDFLARE_TURN_KEY_ID: "abc123", CLOUDFLARE_TURN_API_TOKEN: "sekrit" }, fetchImpl, now: () => t })
  assert.deepEqual(ice.providers(), ["Cloudflare"])
  const [a, b] = await Promise.all([ice.config(), ice.config()])
  assert.equal(calls.length, 1, "one request for two at once")
  assert.equal(calls[0].url, "https://rtc.live.cloudflare.com/v1/turn/keys/abc123/credentials/generate-ice-servers")
  assert.equal(calls[0].init.method, "POST")
  assert.equal(calls[0].init.headers.Authorization, "Bearer sekrit")
  assert.ok(JSON.parse(calls[0].init.body).ttl >= 3600)
  assert.equal(a.turn, true)
  assert.deepEqual(a, b)
  const relay = a.iceServers.find((s) => s.username === "u1")
  assert.deepEqual(relay, { urls: ["turn:turn.cloudflare.com:3478?transport=udp", "turns:turn.cloudflare.com:443?transport=tcp"], username: "u1", credential: "c1" })
  assert.ok(!JSON.stringify(a).includes(":53"), "no port 53")
  assert.ok(!JSON.stringify(a).includes("sekrit"))
  await ice.config()
  assert.equal(calls.length, 1, "cached")
  t += 61 * 60_000
  await ice.config()
  assert.equal(calls.length, 2, "fetched again after an hour")
})

test("Cloudflare's older answer shape, a bad key id and an outage", async () => {
  const old = createIce({ env: { CLOUDFLARE_TURN_KEY_ID: "k", CLOUDFLARE_TURN_API_TOKEN: "t" }, fetchImpl: async () => ({ ok: true, json: async () => ({ iceServers: { urls: ["turn:turn.cloudflare.com:3478"], username: "x", credential: "y" } }) }) })
  assert.equal((await old.config()).turn, true)
  let fetched = 0
  const bad = createIce({ env: { CLOUDFLARE_TURN_KEY_ID: "../evil", CLOUDFLARE_TURN_API_TOKEN: "t" }, fetchImpl: async () => (fetched++, { ok: true, json: async () => ({}) }) })
  assert.equal((await bad.config()).turn, false)
  assert.equal(fetched, 0)
  const down = await quiet(() => createIce({ env: { CLOUDFLARE_TURN_KEY_ID: "k", CLOUDFLARE_TURN_API_TOKEN: "t" }, fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "no" }) }) }).config())
  assert.equal(down.turn, false)
  assert.ok(down.iceServers.length >= 1, "STUN still there")
})

test("own coturn with a shared secret: time-limited credentials (TURN REST API)", async () => {
  const now = 1_700_000_000_000
  const ice = createIce({ env: { TURN_URLS: "turn:turn.example.com:3478,turns:turn.example.com:443", TURN_SECRET: "s3cret" }, now: () => now })
  const c = await ice.config()
  const relay = c.iceServers.at(-1)
  assert.equal(c.turn, true)
  const [expiry, who] = relay.username.split(":")
  assert.equal(who, "98ish")
  assert.ok(Number(expiry) > now / 1000 + 3600)
  assert.equal(relay.credential, crypto.createHmac("sha1", "s3cret").update(relay.username).digest("base64"))
  assert.deepEqual(ice.providers(), ["own TURN (shared secret)"])
  assert.deepEqual(createIce({ env: {} }).providers(), [])
})
