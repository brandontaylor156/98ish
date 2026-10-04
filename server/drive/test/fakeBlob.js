// A tiny in-memory Vercel Blob for tests (and the browser test): the API the @vercel/blob SDK
// talks to (point VERCEL_BLOB_API_URL at `${url}/api/blob`) and the private store's URLs
// (BLOB_STORE_URL = `${url}/store`). Presigned URLs are checked the way Vercel does: an HMAC
// of the operation, pathname and limits with the delegation's signing key, its expiry, the
// size and type limits, and no overwriting unless allowed. CORS answers any localhost origin.
//
//   const blob = await startFakeBlob({ token })   blob.objects, blob.counts, blob.close()

const http = require("node:http")
const crypto = require("node:crypto")

const KEYS = [
  "vercel-blob-add-random-suffix",
  "vercel-blob-allow-overwrite",
  "vercel-blob-allowed-content-types",
  "vercel-blob-cache-control-max-age",
  "vercel-blob-callback-token-payload",
  "vercel-blob-callback-url",
  "vercel-blob-if-match",
  "vercel-blob-maximum-size-in-bytes",
  "vercel-blob-valid-until",
]

const b64url = (buffer) => Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
const canonical = (pathname, params, operation) =>
  [`operation=${operation}`, `pathname=${pathname}`, ...KEYS.filter((k) => params.get(k)).map((k) => `${k}=${params.get(k)}`)].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).join("\n")

const startFakeBlob = async ({ token, storeId = String(token).split("_")[3], port = 0, origins = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/ } = {}) => {
  const objects = new Map() // pathname -> { body, at, etag }
  const delegations = new Map() // delegationToken -> { key, scope }
  const counts = { token: 0, put: 0, presignedPut: 0, head: 0, list: 0, del: 0, get: 0, presignedGet: 0, refused: 0 }
  const state = { suspended: false }
  let base = ""

  const meta = (pathname) => {
    const o = objects.get(pathname)
    const url = `https://${storeId}.private.blob.vercel-storage.com/${pathname}`
    return { url, downloadUrl: `${url}?download=1`, pathname, size: o.body.length, contentType: o.type, contentDisposition: "attachment", cacheControl: "public, max-age=2592000", uploadedAt: new Date(o.at).toISOString(), etag: o.etag }
  }

  // a presigned request -> null if fine, else why not
  const presignProblem = (params, pathname, operation) => {
    const delegation = delegations.get(params.get("vercel-blob-delegation") || "")
    if (!delegation) return "unknown delegation"
    const { key, scope } = delegation
    if (scope.pathname !== "*" && scope.pathname !== pathname) return "pathname out of scope"
    if (!scope.operations.includes(operation)) return "operation not allowed"
    const until = Number(params.get("vercel-blob-valid-until") || scope.validUntil)
    if (until > scope.validUntil || until < Date.now()) return "expired"
    const expected = b64url(crypto.createHmac("sha256", key).update(canonical(pathname, params, operation)).digest())
    if (expected !== params.get("vercel-blob-signature")) return "bad signature"
    return null
  }

  const server = http.createServer(async (request, response) => {
    const origin = request.headers.origin
    if (origin && origins.test(origin)) {
      response.setHeader("Access-Control-Allow-Origin", origin)
      response.setHeader("Access-Control-Expose-Headers", "etag, content-length")
      response.setHeader("Vary", "Origin")
    }
    if (request.method === "OPTIONS") {
      response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, PUT, POST, DELETE")
      response.setHeader("Access-Control-Allow-Headers", request.headers["access-control-request-headers"] || "content-type")
      response.setHeader("Access-Control-Max-Age", "600")
      return response.writeHead(204).end()
    }
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    const url = new URL(request.url, base)
    const params = url.searchParams
    const send = (status, data) => {
      response.writeHead(status, { "content-type": "application/json" })
      response.end(JSON.stringify(data))
    }
    const fail = (status, code, message = code) => {
      counts.refused++
      send(status, { error: { code, message } })
    }
    const bearer = String(request.headers.authorization || "") === `Bearer ${token}`
    const presigned = params.has("vercel-blob-signature")
    // for the browser test: what was asked of the store
    if (url.pathname === "/__counts") return send(200, { counts, objects: [...objects.keys()] })
    if (state.suspended) return fail(403, "store_suspended", "This store has been suspended")

    // ----- the store's URLs -----
    if (url.pathname.startsWith("/store/")) {
      const pathname = decodeURIComponent(url.pathname.slice("/store/".length))
      const operation = request.method === "HEAD" ? "head" : "get"
      if (presigned) {
        const problem = presignProblem(params, pathname, operation)
        if (problem) return fail(403, "forbidden", problem)
        counts.presignedGet++
      } else if (bearer) counts.get++
      else return fail(403, "forbidden")
      const o = objects.get(pathname)
      if (!o) return fail(404, "not_found")
      response.writeHead(200, { "content-type": o.type, "content-length": o.body.length, etag: o.etag, "cache-control": "private, max-age=2592000" })
      return response.end(request.method === "HEAD" ? undefined : o.body)
    }

    if (!url.pathname.startsWith("/api/blob")) return fail(404, "not_found")
    const route = url.pathname.slice("/api/blob".length).replace(/^\/$/, "")

    if (request.method === "POST" && route === "/signed-token") {
      if (!bearer) return fail(403, "forbidden")
      const options = JSON.parse(body.toString() || "{}")
      counts.token++
      const scope = { storeId: `store_${storeId}`, pathname: options.pathname || "*", operations: options.operations || ["get"], validUntil: options.validUntil || Date.now() + 3600_000, maximumSizeInBytes: options.maximumSizeInBytes, allowedContentTypes: options.allowedContentTypes }
      const key = crypto.randomBytes(24).toString("hex")
      const delegationToken = `${b64url(JSON.stringify(scope))}.${b64url(crypto.randomBytes(16))}`
      delegations.set(delegationToken, { key, scope })
      return send(200, { delegationToken, clientSigningToken: key, validUntil: scope.validUntil })
    }

    if (request.method === "PUT" && route === "") {
      const pathname = params.get("pathname") || ""
      const type = String(request.headers["x-content-type"] || request.headers["content-type"] || "application/octet-stream")
      let overwrite = request.headers["x-allow-overwrite"] === "1"
      if (presigned) {
        const problem = presignProblem(params, pathname, "put")
        if (problem) return fail(403, "forbidden", problem)
        const scope = delegations.get(params.get("vercel-blob-delegation")).scope
        const max = Math.min(Number(params.get("vercel-blob-maximum-size-in-bytes") || Infinity), scope.maximumSizeInBytes ?? Infinity)
        if (body.length > max) return fail(400, "bad_request", `the file length cannot be greater than ${max}`)
        const allowed = (params.get("vercel-blob-allowed-content-types") || "").split(",").filter(Boolean)
        if (allowed.length && !allowed.includes(type)) return fail(400, "bad_request", `contentType ${type} is not allowed`)
        overwrite = params.get("vercel-blob-allow-overwrite") === "true"
        counts.presignedPut++
      } else if (bearer) counts.put++
      else return fail(403, "forbidden")
      if (!pathname) return fail(400, "bad_request", "pathname is required")
      if (objects.has(pathname) && !overwrite) return fail(400, "bad_request", "This blob already exists")
      objects.set(pathname, { body, type, at: Date.now(), etag: `"${crypto.createHash("md5").update(body).digest("hex")}"` })
      return send(200, meta(pathname))
    }

    if (!bearer) return fail(403, "forbidden")

    if (request.method === "GET" && route === "" && params.has("url")) {
      counts.head++
      const target = params.get("url")
      const pathname = /^https?:/.test(target) ? decodeURIComponent(new URL(target).pathname.slice(1)) : target
      if (!objects.has(pathname)) return fail(404, "not_found", "The requested blob does not exist")
      return send(200, meta(pathname))
    }

    if (request.method === "GET" && route === "") {
      counts.list++
      const prefix = params.get("prefix") || ""
      const limit = Number(params.get("limit")) || 1000
      const all = [...objects.keys()].filter((p) => p.startsWith(prefix)).sort()
      const start = Number(params.get("cursor") || 0)
      const page = all.slice(start, start + limit)
      const hasMore = start + limit < all.length
      return send(200, { blobs: page.map((p) => meta(p)), cursor: hasMore ? String(start + limit) : undefined, hasMore })
    }

    if (request.method === "POST" && route === "/delete") {
      const { urls = [] } = JSON.parse(body.toString() || "{}")
      for (const target of urls) {
        counts.del++
        objects.delete(/^https?:/.test(target) ? decodeURIComponent(new URL(target).pathname.slice(1)) : target)
      }
      return send(200, {})
    }

    fail(404, "not_found")
  })

  await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve))
  base = `http://127.0.0.1:${server.address().port}`
  return { url: base, apiUrl: `${base}/api/blob`, storeUrl: `${base}/store`, objects, counts, state, close: () => new Promise((resolve) => server.close(resolve)) }
}

module.exports = { startFakeBlob }

// `node server/drive/test/fakeBlob.js <port> <token>` runs one for the browser test
if (require.main === module) {
  startFakeBlob({ port: Number(process.argv[2]) || 9364, token: process.argv[3] || "vercel_blob_rw_teststore_secret" }).then((blob) => console.log(`fake Vercel Blob on ${blob.url}`))
}
