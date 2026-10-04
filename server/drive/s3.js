// A tiny S3 client for one bucket (Backblaze B2's S3-compatible API), with AWS Signature
// Version 4 done by hand on Node's crypto, so there's no SDK to install. Path-style URLs:
// <endpoint>/<bucket>/<key>.
//
//   presign(method, key, { expires, headers })   a URL the browser can use by itself
//                                                (query-string auth, UNSIGNED-PAYLOAD; any
//                                                headers given are signed and must be sent
//                                                exactly, e.g. content-type and content-length)
//   head(key) -> { size, etag, lastModified } | null
//   get(key) -> Buffer | null
//   put(key, body, contentType)
//   del(key)
//   deleteMany(keys)                             DeleteObjects in batches of 1000
//   list({ prefix, token, max }) -> { items: [{ key, size, lastModified }], next }
//
// Errors are S3Error { status, code, message, capped }: `capped` is B2 saying a daily cap was
// reached (403 with "cap exceeded"), which callers treat as "resting until tomorrow".

const crypto = require("node:crypto")

const ALGORITHM = "AWS4-HMAC-SHA256"
const UNSIGNED = "UNSIGNED-PAYLOAD"

const sha256hex = (data) => crypto.createHash("sha256").update(data).digest("hex")
const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest()

// RFC 3986, as SigV4 wants it (only A-Z a-z 0-9 - _ . ~ stay as they are)
const encode = (text) => encodeURIComponent(text).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const encodePath = (key) => key.split("/").map(encode).join("/")

// 2013-05-24T00:00:00.000Z -> 20130524T000000Z
const amzDate = (date) => new Date(date).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "")

const signingKey = (secret, day, region, service = "s3") => hmac(hmac(hmac(hmac(`AWS4${secret}`, day), region), service), "aws4_request")

const canonicalQuery = (params) =>
  params
    .map(([k, v]) => [encode(k), encode(String(v))])
    .sort(([a, av], [b, bv]) => (a < b ? -1 : a > b ? 1 : av < bv ? -1 : av > bv ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("&")

// headers: { lowercase name: value } (only the signed ones)
const canonicalRequest = ({ method, url, headers, payloadHash }) => {
  const names = Object.keys(headers).sort()
  const path = url.pathname.split("/").map((part) => encode(decodeURIComponent(part))).join("/") || "/"
  const query = canonicalQuery([...url.searchParams.entries()].filter(([k]) => k !== "X-Amz-Signature"))
  const lines = names.map((name) => `${name}:${String(headers[name]).trim().replace(/\s+/g, " ")}\n`).join("")
  return { text: [method, path, query, lines, names.join(";"), payloadHash].join("\n"), signed: names.join(";") }
}

const signatureFor = ({ secret, region, date, canonical }) => {
  const stamp = amzDate(date)
  const day = stamp.slice(0, 8)
  const scope = `${day}/${region}/s3/aws4_request`
  const toSign = [ALGORITHM, stamp, scope, sha256hex(canonical)].join("\n")
  return crypto.createHmac("sha256", signingKey(secret, day, region)).update(toSign).digest("hex")
}

// a URL that carries its own signature (the browser sends it as is)
const presignUrl = ({ method, url, keyId, secret, region, date, expires, headers = {} }) => {
  const target = new URL(url)
  const stamp = amzDate(date)
  const signedHeaders = { host: target.host }
  for (const [name, value] of Object.entries(headers)) signedHeaders[name.toLowerCase()] = value
  target.searchParams.set("X-Amz-Algorithm", ALGORITHM)
  target.searchParams.set("X-Amz-Credential", `${keyId}/${stamp.slice(0, 8)}/${region}/s3/aws4_request`)
  target.searchParams.set("X-Amz-Date", stamp)
  target.searchParams.set("X-Amz-Expires", String(expires))
  target.searchParams.set("X-Amz-SignedHeaders", Object.keys(signedHeaders).sort().join(";"))
  const canonical = canonicalRequest({ method, url: target, headers: signedHeaders, payloadHash: UNSIGNED })
  const signature = signatureFor({ secret, region, date, canonical: canonical.text })
  // the URL class would re-encode the query differently from what was signed: build it by hand
  const query = canonicalQuery([...target.searchParams.entries()])
  return `${target.origin}${target.pathname}?${query}&X-Amz-Signature=${signature}`
}

// headers for a request the server makes itself (Authorization header)
const signHeaders = ({ method, url, keyId, secret, region, date, headers = {}, body }) => {
  const target = new URL(url)
  const stamp = amzDate(date)
  const payloadHash = sha256hex(body || "")
  const signedHeaders = { host: target.host, "x-amz-content-sha256": payloadHash, "x-amz-date": stamp }
  for (const [name, value] of Object.entries(headers)) signedHeaders[name.toLowerCase()] = value
  const canonical = canonicalRequest({ method, url: target, headers: signedHeaders, payloadHash })
  const signature = signatureFor({ secret, region, date, canonical: canonical.text })
  const out = { ...signedHeaders }
  delete out.host
  out.authorization = `${ALGORITHM} Credential=${keyId}/${stamp.slice(0, 8)}/${region}/s3/aws4_request, SignedHeaders=${canonical.signed}, Signature=${signature}`
  return out
}

class S3Error extends Error {
  constructor(status, code = "", message = "") {
    super(`S3 ${status} ${code} ${message}`.trim())
    this.status = status
    this.code = code
    this.capped = status === 403 && /cap.?exceeded/i.test(`${code} ${message}`)
  }
}

const xmlValue = (xml, tag) => {
  const match = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`).exec(xml)
  return match ? match[1] : ""
}
const xmlUnescape = (text) => text.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&")
const xmlEscape = (text) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// "s3.us-west-004.backblazeb2.com" -> "us-west-004"
const regionOf = (endpoint) => /^https?:\/\/s3\.([a-z0-9-]+)\./i.exec(endpoint || "")?.[1] || "us-east-1"

const createS3 = ({ endpoint, region, bucket, keyId, secret, now = () => Date.now(), fetch: fetchImpl = globalThis.fetch, timeoutMs = 30_000 }) => {
  const base = `${String(endpoint).replace(/\/+$/, "")}/${bucket}`
  const where = region || regionOf(endpoint)
  const urlOf = (key = "") => `${base}/${encodePath(key)}`.replace(/\/$/, key ? "/" : "")

  const send = async (method, url, { headers = {}, body } = {}) => {
    const signed = signHeaders({ method, url, keyId, secret, region: where, date: now(), headers, body })
    const response = await fetchImpl(url, { method, headers: signed, body, signal: AbortSignal.timeout(timeoutMs) })
    if (response.ok || (response.status === 404 && (method === "HEAD" || method === "GET"))) return response
    const text = method === "HEAD" ? "" : await response.text().catch(() => "")
    throw new S3Error(response.status, xmlUnescape(xmlValue(text, "Code")), xmlUnescape(xmlValue(text, "Message")))
  }

  const presign = (method, key, { expires = 300, headers = {} } = {}) => presignUrl({ method, url: urlOf(key), keyId, secret, region: where, date: now(), expires, headers })

  const head = async (key) => {
    const response = await send("HEAD", urlOf(key))
    if (response.status === 404) return null
    return { size: Number(response.headers.get("content-length")) || 0, etag: response.headers.get("etag") || "", lastModified: response.headers.get("last-modified") || "" }
  }

  const get = async (key) => {
    const response = await send("GET", urlOf(key))
    if (response.status === 404) return null
    return Buffer.from(await response.arrayBuffer())
  }

  const put = async (key, body, contentType = "application/octet-stream") => {
    await send("PUT", urlOf(key), { headers: { "content-type": contentType }, body })
  }

  const del = async (key) => {
    await send("DELETE", urlOf(key))
  }

  // B2 supports DeleteObjects; anything it couldn't delete is tried one by one
  const deleteMany = async (keys) => {
    for (let i = 0; i < keys.length; i += 1000) {
      const batch = keys.slice(i, i + 1000)
      const body = `<?xml version="1.0" encoding="UTF-8"?><Delete><Quiet>true</Quiet>${batch.map((k) => `<Object><Key>${xmlEscape(k)}</Key></Object>`).join("")}</Delete>`
      let failed = []
      try {
        const response = await send("POST", `${base}/?delete=`, { headers: { "content-type": "application/xml", "content-md5": crypto.createHash("md5").update(body).digest("base64") }, body })
        const text = await response.text()
        failed = [...text.matchAll(/<Error>([\s\S]*?)<\/Error>/g)].map((m) => xmlUnescape(xmlValue(m[1], "Key"))).filter(Boolean)
      } catch (error) {
        if (error.capped || ![400, 405, 501].includes(error.status)) throw error
        failed = batch
      }
      for (const key of failed) await del(key)
    }
  }

  const list = async ({ prefix = "", token = "", max = 1000 } = {}) => {
    const url = new URL(`${base}/`)
    url.searchParams.set("list-type", "2")
    url.searchParams.set("max-keys", String(max))
    if (prefix) url.searchParams.set("prefix", prefix)
    if (token) url.searchParams.set("continuation-token", token)
    const response = await send("GET", `${url.origin}${url.pathname}?${canonicalQuery([...url.searchParams.entries()])}`)
    const text = await response.text()
    const items = [...text.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)].map((m) => ({
      key: xmlUnescape(xmlValue(m[1], "Key")),
      size: Number(xmlValue(m[1], "Size")) || 0,
      lastModified: xmlValue(m[1], "LastModified"),
    }))
    const truncated = xmlValue(text, "IsTruncated") === "true"
    return { items, next: truncated ? xmlUnescape(xmlValue(text, "NextContinuationToken")) : "" }
  }

  return { presign, head, get, put, del, deleteMany, list, urlOf, region: where }
}

module.exports = { createS3, presignUrl, signHeaders, canonicalRequest, signatureFor, amzDate, encode, encodePath, regionOf, S3Error, sha256hex, UNSIGNED, ALGORITHM }
