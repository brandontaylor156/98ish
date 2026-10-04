// Rewriting relayed pages so they keep working inside Compass.
//
// Relay addresses keep the real address readable: https://example.com:8443/a/b?q=1 is
// <prefix>https/example.com:8443/a/b?q=1, so relative links in a page resolve to relay
// addresses by themselves. The HTML rewriter is a small tokenizer (no dependency): it walks
// tags, skips comments, treats <script>/<style>/<textarea>/<title> contents as raw text, and
// rewrites the URL attributes it knows (links, forms, frames, src/srcset, CSS url() in
// <style> and style="", meta refresh, base href). It never builds a DOM, so it's fast and
// the output is the input byte for byte except for the tags it changed.
//
// ctx = {
//   pageUrl,           the page's real address (after redirects)
//   nav(url),          address for something that opens a page (a link, a form, a frame)
//   asset(url),        address for a picture, script, stylesheet, font...
//   media(url)?,       address for a video or sound (default: the real address; never relayed)
//   inject?,           HTML put first in <head> (Compass's helper script, our <base>)
//   base?(url),        what a <base href> becomes (default: asset)
// }

// ---------- relay addresses ----------

// "https://example.com:8443/a?b" -> "https/example.com:8443/a?b" (the hash stays in the browser)
const encodeTarget = (input) => {
  const u = input instanceof URL ? input : new URL(input)
  return `${u.protocol.slice(0, -1)}/${u.host}${u.pathname}${u.search}`
}

// "https/example.com/a/b" + "?q=1" -> URL | null
const decodeTarget = (rest, search = "") => {
  const m = /^(https?)\/([^/?#]+)(\/[^?#]*)?$/i.exec(String(rest || ""))
  if (!m) return null
  try {
    const url = new URL(`${m[1].toLowerCase()}://${m[2]}${m[3] || "/"}${search || ""}`)
    return url
  } catch {
    return null
  }
}

// ---------- helpers ----------

const SKIP = /^(?:#|javascript:|data:|mailto:|tel:|sms:|about:|blob:|geo:|intent:|itms|facetime|webcal:|magnet:)/i

const resolve = (value, base) => {
  const v = String(value ?? "").trim()
  if (!v || SKIP.test(v)) return null
  try {
    const u = new URL(v, base)
    return u.protocol === "http:" || u.protocol === "https:" ? u.href : null
  } catch {
    return null
  }
}

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", "#39": "'", nbsp: "\u00a0" }
const decodeEntities = (s) =>
  String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);?/gi, (all, e) => {
    const lower = e.toLowerCase()
    if (lower.startsWith("#x")) return String.fromCodePoint(parseInt(lower.slice(2), 16) || 0xfffd)
    if (lower.startsWith("#")) return String.fromCodePoint(parseInt(lower.slice(1), 10) || 0xfffd)
    return ENTITIES[lower] ?? all
  })
const escapeAttr = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;")

// ---------- CSS ----------

// url(...) and @import "..." in a stylesheet, resolved against base
const rewriteCss = (css, base, map) =>
  String(css)
    .replace(/url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)'"\s]*))\s*\)/gi, (all, dq, sq, bare) => {
      const raw = dq ?? sq ?? bare ?? ""
      const abs = resolve(raw.replace(/\\(.)/g, "$1"), base)
      if (!abs) return all
      return `url("${map(abs).replace(/["\\]/g, "\\$&")}")`
    })
    .replace(/@import\s+(["'])(.*?)\1/gi, (all, q, raw) => {
      const abs = resolve(raw, base)
      return abs ? `@import "${map(abs, { tag: "import" }).replace(/["\\]/g, "\\$&")}"` : all
    })

// "a.jpg 1x, b.jpg 2x" -> each address mapped
const rewriteSrcset = (value, base, map) => {
  const out = []
  const re = /\s*([^\s,]+(?:,(?!\s)[^\s,]*)*)(\s+[^,]*)?\s*(?:,|$)/g
  let m
  let guard = 0
  while ((m = re.exec(value)) && m[0] !== "" && guard++ < 200) {
    const abs = resolve(m[1], base)
    out.push((abs ? map(abs) : m[1]) + (m[2] ? m[2].replace(/\s+$/, "") : ""))
  }
  return out.join(", ")
}

// "5; url=/next" -> "5; url=<mapped>"
const rewriteRefresh = (content, base, map) => {
  const m = /^\s*(\d*(?:\.\d+)?)\s*(?:[;,]\s*(?:url\s*=\s*)?(["']?)([^"']*)\2)?\s*$/i.exec(String(content))
  if (!m || !m[3]) return content
  const abs = resolve(m[3], base)
  return abs ? `${m[1] || "0"}; url=${map(abs)}` : content
}

// ---------- HTML ----------

const RAW_TEXT = new Set(["script", "style", "textarea", "title", "xmp", "plaintext", "iframe", "noembed", "noframes"])
const NAV_ATTRS = { a: ["href"], area: ["href"], form: ["action"], iframe: ["src"], frame: ["src"], button: ["formaction"], input: ["formaction"] }
const ASSET_ATTRS = {
  img: ["src", "lowsrc"],
  script: ["src"],
  link: ["href"],
  input: ["src"],
  embed: ["src"],
  object: ["data"],
  track: ["src"],
  body: ["background"],
  table: ["background"],
  td: ["background"],
  th: ["background"],
  image: ["href", "xlink:href"],
}
const MEDIA_ATTRS = { video: ["src", "poster"], audio: ["src"], source: ["src"] }
const SRCSET = new Set(["img", "source"])
const DROP_ATTRS = new Set(["integrity", "ping"])

// Read the attributes of a tag body ("a href=x class='y'") -> [{ name, value, raw }]
const parseAttrs = (text) => {
  const attrs = []
  let i = 0
  const n = text.length
  while (i < n) {
    while (i < n && /[\s/]/.test(text[i])) i++
    if (i >= n) break
    const start = i
    while (i < n && !/[\s=/>]/.test(text[i])) i++
    if (i === start) {
      i++
      continue
    }
    const name = text.slice(start, i)
    let j = i
    while (j < n && /\s/.test(text[j])) j++
    let value = null
    if (text[j] === "=") {
      j++
      while (j < n && /\s/.test(text[j])) j++
      if (text[j] === '"' || text[j] === "'") {
        const q = text[j]
        const end = text.indexOf(q, j + 1)
        value = text.slice(j + 1, end < 0 ? n : end)
        j = end < 0 ? n : end + 1
      } else {
        const s = j
        while (j < n && !/\s/.test(text[j])) j++
        value = text.slice(s, j)
      }
      i = j
    }
    attrs.push({ name, lower: name.toLowerCase(), value: value === null ? null : decodeEntities(value) })
  }
  return attrs
}

// Find where a tag that starts at `start` ("<a ...") ends (the index after ">"), honoring quotes
const tagEnd = (html, start) => {
  let quote = null
  for (let i = start + 1; i < html.length; i++) {
    const c = html[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      // a quote only opens a value right after "=" (attribute values)
      let k = i - 1
      while (k > start && /\s/.test(html[k])) k--
      if (html[k] === "=") quote = c
    } else if (c === ">") return i + 1
  }
  return -1
}

const findBaseHref = (html) => {
  const m = /<base\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(html)
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3]) : null
}

const rewriteHtml = (html, ctx) => {
  const pageUrl = ctx.pageUrl
  const baseHref = findBaseHref(html)
  const base = (baseHref && resolve(baseHref, pageUrl)) || pageUrl
  const nav = (v) => {
    const abs = resolve(v, base)
    return abs ? ctx.nav(abs) : null
  }
  const asset = (v, info) => {
    const abs = resolve(v, base)
    return abs ? ctx.asset(abs, info) : null
  }
  const media = (v) => {
    const abs = resolve(v, base)
    return abs ? (ctx.media ? ctx.media(abs) : abs) : null
  }
  const out = []
  let injected = !ctx.inject
  let i = 0
  let last = 0 // copied up to here
  const n = html.length
  const inject = () => {
    if (injected) return
    out.push(ctx.inject)
    injected = true
  }

  while (i < n) {
    const lt = html.indexOf("<", i)
    if (lt < 0) break
    if (html.startsWith("<!--", lt)) {
      const end = html.indexOf("-->", lt + 4)
      i = end < 0 ? n : end + 3
      continue
    }
    if (html[lt + 1] === "!" || html[lt + 1] === "?") {
      const end = html.indexOf(">", lt)
      i = end < 0 ? n : end + 1
      continue
    }
    if (html[lt + 1] === "/") {
      const end = html.indexOf(">", lt)
      const closing = /^<\/\s*([a-z0-9]+)/i.exec(html.slice(lt, lt + 20))
      // a page with no <head> or <body> tags: put ours before the first closing tag we meet
      if (!injected && closing && /^(head|html|body)$/i.test(closing[1])) {
        out.push(html.slice(last, lt))
        last = lt
        inject()
      }
      i = end < 0 ? n : end + 1
      continue
    }
    if (!/[a-z]/i.test(html[lt + 1] || "")) {
      i = lt + 1
      continue
    }
    const end = tagEnd(html, lt)
    if (end < 0) break
    const inner = html.slice(lt + 1, end - 1)
    const nameMatch = /^[a-z][a-z0-9:-]*/i.exec(inner)
    const name = nameMatch[0].toLowerCase()
    const attrText = inner.slice(nameMatch[0].length)
    const selfClosing = /\/\s*$/.test(attrText)

    // our helper goes first thing in <head> (or right after <html>, or before the first tag)
    if (!injected && name !== "html" && name !== "head") {
      out.push(html.slice(last, lt))
      last = lt
      inject()
    }

    let changed = false
    let drop = false
    const attrs = /=|\s(integrity|ping)\b/i.test(attrText) ? parseAttrs(attrText) : []
    const get = (a) => attrs.find((x) => x.lower === a)
    for (const attr of attrs) {
      if (attr.value === null) {
        if (DROP_ATTRS.has(attr.lower)) {
          attr.remove = true
          changed = true
        }
        continue
      }
      const v = attr.value
      let next = null
      if (DROP_ATTRS.has(attr.lower)) {
        attr.remove = true
        changed = true
        continue
      }
      if (NAV_ATTRS[name]?.includes(attr.lower)) next = nav(v)
      else if (MEDIA_ATTRS[name]?.includes(attr.lower)) next = name === "video" && attr.lower === "poster" ? asset(v) : media(v)
      else if (ASSET_ATTRS[name]?.includes(attr.lower)) next = asset(v, name === "link" ? { tag: "link", rel: (get("rel")?.value || "").toLowerCase(), as: (get("as")?.value || "").toLowerCase() } : { tag: name })
      else if (attr.lower === "srcset" && SRCSET.has(name)) next = rewriteSrcset(v, base, (u) => ctx.asset(u))
      else if (attr.lower === "style" && /url\(/i.test(v)) next = rewriteCss(v, base, (u) => ctx.asset(u))
      else if (attr.lower === "target" && /^_(top|parent)$/i.test(v)) next = "_self"
      if (next !== null && next !== v) {
        attr.value = next
        changed = true
      }
    }

    if (name === "base") {
      const href = get("href")
      if (href) {
        const abs = resolve(href.value, pageUrl)
        href.value = abs ? (ctx.base ? ctx.base(abs) : ctx.asset(abs)) : href.value
        changed = true
      }
    } else if (name === "meta") {
      const equiv = (get("http-equiv")?.value || "").toLowerCase()
      if (equiv === "content-security-policy" || equiv === "content-security-policy-report-only" || equiv === "x-frame-options") drop = true
      else if (equiv === "refresh" && get("content")) {
        get("content").value = rewriteRefresh(get("content").value, base, (u) => ctx.nav(u))
        changed = true
      } else if (get("charset")) {
        get("charset").value = "utf-8"
        changed = true
      } else if (equiv === "content-type") {
        const c = get("content")
        if (c) c.value = "text/html; charset=utf-8"
        changed = true
      }
    }

    out.push(html.slice(last, lt))
    if (drop) out.push("")
    else if (changed) {
      const kept = attrs.filter((a) => !a.remove).map((a) => (a.value === null ? ` ${a.name}` : ` ${a.name}="${escapeAttr(a.value)}"`))
      out.push(`<${nameMatch[0]}${kept.join("")}${selfClosing ? " /" : ""}>`)
    } else out.push(html.slice(lt, end))
    last = end
    i = end

    if (name === "head" || name === "html") {
      if (name === "head") {
        out.push(html.slice(last, end))
        inject()
      }
    }

    // raw text: copy up to the closing tag (CSS inside <style> rewritten)
    if (RAW_TEXT.has(name) && !selfClosing) {
      const close = new RegExp(`</${name}\\s*>`, "i")
      close.lastIndex = 0
      const rest = html.slice(end)
      const m = close.exec(rest)
      const stop = m ? end + m.index : n
      if (name === "style") {
        out.push(rewriteCss(html.slice(end, stop), base, (u) => ctx.asset(u)))
        last = stop
      }
      i = stop
    }
  }
  out.push(html.slice(last))
  if (!injected) out.unshift(ctx.inject)
  return out.join("")
}

module.exports = { encodeTarget, decodeTarget, rewriteHtml, rewriteCss, rewriteSrcset, rewriteRefresh, resolve, decodeEntities, findBaseHref }
