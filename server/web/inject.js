// The small script Compass puts first in every relayed page. The page runs sandboxed
// (an opaque origin, see index.js), so the script:
//  - tells Compass (the parent window) the page's real address, title, favicon and whether it
//    has a password box, and asks Compass to open links (so each tab keeps its own history);
//  - sends what the relay can't rewrite through it: links and forms made by scripts,
//    fetch/XMLHttpRequest/sendBeacon/EventSource, window.open, history.pushState, and
//    navigations the Navigation API lets it catch (location = "...");
//  - stands in for document.cookie and localStorage, which an opaque origin doesn't have
//    (cookies go to the session's jar on the server);
//  - answers Compass's find-in-page, zoom and stop.
// Everything in it must work on its own: it is turned into a string.

function compassPage(CFG) {
  "use strict"
  if (window.__compassPage) return
  window.__compassPage = true
  var W = window
  var D = document
  var top = (function () {
    try {
      return W.parent !== W && W.parent === W.top
    } catch (e) {
      return false
    }
  })()
  var send = function (msg) {
    msg.__compass = 1
    try {
      if (W.parent !== W) W.parent.postMessage(msg, "*")
    } catch (e) {}
  }

  // ---- addresses ----
  var PREFIX = CFG.prefix // https://server/api/web/r/<sid>/<mode>/
  var RAW = CFG.raw // https://server/api/web/x/<sid>/
  var SERVER = CFG.server // https://server
  var realUrl = function (href) {
    // a relay address back to the real one
    var s = String(href)
    var p = s.indexOf(PREFIX) === 0 ? PREFIX : s.indexOf(RAW) === 0 ? RAW : null
    if (!p) return s
    var rest = s.slice(p.length)
    var m = /^(https?)\/([^/?#]+)(.*)$/.exec(rest)
    return m ? m[1] + "://" + m[2] + (m[3] && m[3][0] === "/" ? m[3] : "/" + (m[3] || "")) : s
  }
  var absolute = function (u) {
    try {
      var url = new URL(String(u), D.baseURI)
      // the page asked for its "own" origin by name (location.origin is the relay server's)
      if (url.origin === SERVER && url.pathname.indexOf("/api/web/") !== 0) url = new URL(url.pathname + url.search + url.hash, CFG.url)
      return url
    } catch (e) {
      return null
    }
  }
  var toRelay = function (u, raw) {
    var url = absolute(u)
    if (!url) return u
    var href = url.href
    if (href.indexOf(PREFIX) === 0 || href.indexOf(RAW) === 0) return href
    if (url.protocol !== "http:" && url.protocol !== "https:") return u
    return (raw ? RAW : PREFIX) + url.protocol.slice(0, -1) + "/" + url.host + url.pathname + url.search + url.hash
  }
  var realOf = function (u) {
    var url = absolute(u)
    return url ? realUrl(url.href) : String(u)
  }
  var here = function () {
    return realUrl(location.href)
  }
  var samePage = function (a, b) {
    return String(a).split("#")[0] === String(b).split("#")[0]
  }

  // ---- reports to Compass ----
  var favicon = function () {
    var links = D.querySelectorAll("link[rel~='icon' i], link[rel='apple-touch-icon' i]")
    for (var i = 0; i < links.length; i++) if (links[i].href) return realOf(links[i].getAttribute("href"))
    try {
      return new URL("/favicon.ico", CFG.url).href
    } catch (e) {
      return ""
    }
  }
  var lastReport = ""
  var report = function (phase) {
    if (!top) return
    var msg = {
      type: "page",
      phase: phase,
      url: here(),
      title: D.title || "",
      favicon: favicon(),
      password: !!D.querySelector("input[type=password]"),
      zoom: currentZoom,
      tok: CFG.tok,
    }
    var key = JSON.stringify(msg)
    if (key === lastReport && phase !== "load") return
    lastReport = key
    send(msg)
  }
  var navigate = function (url, how) {
    // Compass opens it (its own history); without Compass, go there directly
    if (top) send({ type: "navigate", url: url, how: how || "link" })
    else location.href = toRelay(url)
  }

  // ---- links ----
  W.addEventListener(
    "click",
    function (e) {
      if (e.defaultPrevented || e.button > 1) return
      var a = e.target && e.target.closest ? e.target.closest("a[href], area[href]") : null
      if (!a) return
      var raw = a.getAttribute("href") || ""
      if (/^\s*javascript:/i.test(raw)) return
      var real = realOf(raw)
      if (!/^https?:/i.test(real)) return
      if (samePage(real, here()) && real.indexOf("#") >= 0) {
        // a jump within this page
        e.preventDefault()
        location.hash = real.split("#")[1]
        return
      }
      e.preventDefault()
      if (a.hasAttribute("download")) return send({ type: "download", url: real, name: a.getAttribute("download") || "" })
      var target = (a.getAttribute("target") || "").toLowerCase()
      var newTab = e.button === 1 || e.ctrlKey || e.metaKey || e.shiftKey || target === "_blank" || (target && target !== "_self" && target !== "_top" && target !== "_parent")
      if (newTab) send({ type: "open", url: real })
      else navigate(real, "link")
    },
    false
  )
  W.addEventListener("auxclick", function (e) {
    if (e.button !== 1) return
    var a = e.target && e.target.closest ? e.target.closest("a[href]") : null
    if (!a) return
    e.preventDefault()
    send({ type: "open", url: realOf(a.getAttribute("href")) })
  })

  // ---- forms ----
  var fixForm = function (form, submitter) {
    var action = (submitter && submitter.getAttribute && submitter.getAttribute("formaction")) || form.getAttribute("action") || ""
    var real = action ? realOf(action) : here()
    form.setAttribute("action", toRelay(real))
    if (submitter && submitter.hasAttribute && submitter.hasAttribute("formaction")) submitter.setAttribute("formaction", toRelay(real))
    var target = (form.getAttribute("target") || "").toLowerCase()
    if (target && target !== "_self") form.setAttribute("target", "_self")
    return real
  }
  W.addEventListener("submit", function (e) {
    if (e.defaultPrevented) return
    var form = e.target
    if (!form || form.tagName !== "FORM") return
    var real = fixForm(form, e.submitter)
    var method = ((e.submitter && e.submitter.getAttribute && e.submitter.getAttribute("formmethod")) || form.getAttribute("method") || "get").toLowerCase()
    if (method === "get" && top) {
      // a search box: Compass opens the result (its own history entry)
      e.preventDefault()
      var url = new URL(real)
      url.search = new URLSearchParams(new FormData(form, e.submitter || undefined)).toString()
      navigate(url.href, "form")
    } else if (top) send({ type: "loading", url: real })
  })
  var nativeSubmit = HTMLFormElement.prototype.submit
  HTMLFormElement.prototype.submit = function () {
    fixForm(this)
    return nativeSubmit.call(this)
  }

  // ---- requests made by scripts: through the relay, as-is ----
  // Never with credentials: the relay keeps the site's cookies itself, and it never allows
  // credentialed CORS (a page asking for credentials: "include" would otherwise just fail)
  var nativeFetch = W.fetch
  if (nativeFetch) {
    W.fetch = function (input, init) {
      try {
        if (input instanceof Request) input = new Request(new Request(toRelay(input.url, true), input), { credentials: "omit" })
        else input = toRelay(input, true)
        init = Object.assign({}, init || {}, { credentials: "omit" })
      } catch (e) {}
      return nativeFetch.call(W, input, init)
    }
  }
  try {
    Object.defineProperty(XMLHttpRequest.prototype, "withCredentials", { configurable: true, get: function () { return false }, set: function () {} })
  } catch (e) {}
  var nativeOpen = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (method, url) {
    var args = Array.prototype.slice.call(arguments)
    args[1] = toRelay(url, true)
    return nativeOpen.apply(this, args)
  }
  if (navigator.sendBeacon) {
    var nativeBeacon = navigator.sendBeacon.bind(navigator)
    navigator.sendBeacon = function (url, data) {
      return nativeBeacon(toRelay(url, true), data)
    }
  }
  if (W.EventSource) {
    var NativeES = W.EventSource
    W.EventSource = function (url) {
      return new NativeES(toRelay(url, true))
    }
    W.EventSource.prototype = NativeES.prototype
  }
  W.open = function (url) {
    if (url) send({ type: "open", url: realOf(url) })
    return null
  }

  // ---- history: pushState addresses stay relay addresses ----
  ;["pushState", "replaceState"].forEach(function (name) {
    var native = history[name]
    history[name] = function (state, title, url) {
      var r = native.call(history, state, title, url === undefined || url === null ? url : toRelay(url))
      setTimeout(function () {
        report("history")
      }, 0)
      return r
    }
  })
  W.addEventListener("popstate", function () {
    report("history")
  })
  W.addEventListener("hashchange", function () {
    report("history")
  })

  // ---- location = "..." and other navigations (where the Navigation API exists) ----
  if (W.navigation && W.navigation.addEventListener) {
    W.navigation.addEventListener("navigate", function (e) {
      try {
        var dest = e.destination && e.destination.url
        if (!dest || e.hashChange || e.downloadRequest || e.formData) return
        if (dest.indexOf(PREFIX) === 0 || dest.indexOf(RAW) === 0) return
        if (!/^https?:/.test(dest) || !e.cancelable) return
        e.preventDefault()
        navigate(realOf(dest), "script")
      } catch (err) {}
    })
  }

  // ---- document.cookie (kept on the server, mirrored here) ----
  var jar = {}
  String(CFG.cookies || "")
    .split(/;\s*/)
    .forEach(function (pair) {
      if (!pair) return
      var i = pair.indexOf("=")
      jar[i < 0 ? "" : pair.slice(0, i)] = i < 0 ? pair : pair.slice(i + 1)
    })
  try {
    Object.defineProperty(D, "cookie", {
      configurable: true,
      get: function () {
        return Object.keys(jar)
          .map(function (k) {
            return k ? k + "=" + jar[k] : jar[k]
          })
          .join("; ")
      },
      set: function (text) {
        text = String(text)
        var first = text.split(";")[0]
        var i = first.indexOf("=")
        var name = i < 0 ? "" : first.slice(0, i).trim()
        var value = i < 0 ? first.trim() : first.slice(i + 1).trim()
        var gone = /;\s*max-age\s*=\s*(-\d+|0)\b/i.test(text) || (/;\s*expires\s*=([^;]+)/i.test(text) && Date.parse(/;\s*expires\s*=([^;]+)/i.exec(text)[1]) < Date.now())
        if (gone) delete jar[name]
        else jar[name] = value
        try {
          if (nativeFetch) nativeFetch.call(W, CFG.cookieUrl, { method: "POST", headers: { "content-type": "text/plain" }, body: JSON.stringify({ url: here(), cookie: text }), keepalive: true })
        } catch (e) {}
      },
    })
  } catch (e) {}

  // ---- localStorage / sessionStorage stand-ins (for this page view) ----
  var memoryStorage = function () {
    var data = {}
    // the methods live on the prototype, so Object.keys(localStorage) lists only stored keys (none here)
    return Object.create({
      get length() {
        return Object.keys(data).length
      },
      key: function (i) {
        return Object.keys(data)[i] || null
      },
      getItem: function (k) {
        return Object.prototype.hasOwnProperty.call(data, k) ? data[k] : null
      },
      setItem: function (k, v) {
        data[k] = String(v)
      },
      removeItem: function (k) {
        delete data[k]
      },
      clear: function () {
        data = {}
      },
    })
  }
  ;["localStorage", "sessionStorage"].forEach(function (name) {
    var ok = false
    try {
      ok = !!W[name] && (W[name].length, true)
    } catch (e) {}
    if (!ok) {
      try {
        Object.defineProperty(W, name, { configurable: true, value: memoryStorage() })
      } catch (e) {}
    }
  })

  // ---- find in page ----
  var marks = []
  var current = -1
  var clearMarks = function () {
    for (var i = 0; i < marks.length; i++) {
      var m = marks[i]
      var parent = m.parentNode
      if (!parent) continue
      parent.replaceChild(D.createTextNode(m.textContent), m)
      parent.normalize()
    }
    marks = []
    current = -1
  }
  var showMark = function () {
    for (var i = 0; i < marks.length; i++) marks[i].style.background = i === current ? "#ff9632" : "#ffff00"
    if (marks[current]) marks[current].scrollIntoView({ block: "center" })
  }
  var find = function (query) {
    clearMarks()
    if (!query || !D.body) return 0
    var q = query.toLowerCase()
    var walker = D.createTreeWalker(D.body, NodeFilter.SHOW_TEXT, {
      acceptNode: function (node) {
        var p = node.parentNode
        if (!p || /^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|OPTION)$/.test(p.nodeName)) return NodeFilter.FILTER_REJECT
        return node.nodeValue.toLowerCase().indexOf(q) >= 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP
      },
    })
    var nodes = []
    while (walker.nextNode() && nodes.length < 500) nodes.push(walker.currentNode)
    for (var n = 0; n < nodes.length && marks.length < 1000; n++) {
      var node = nodes[n]
      var text = node.nodeValue
      var lower = text.toLowerCase()
      var at = 0
      var frag = D.createDocumentFragment()
      var idx
      while ((idx = lower.indexOf(q, at)) >= 0) {
        frag.appendChild(D.createTextNode(text.slice(at, idx)))
        var mark = D.createElement("mark")
        mark.setAttribute("data-compass-find", "")
        mark.style.cssText = "background:#ffff00;color:#000;padding:0;margin:0"
        mark.textContent = text.slice(idx, idx + q.length)
        frag.appendChild(mark)
        marks.push(mark)
        at = idx + q.length
      }
      frag.appendChild(D.createTextNode(text.slice(at)))
      node.parentNode.replaceChild(frag, node)
    }
    current = marks.length ? 0 : -1
    showMark()
    return marks.length
  }

  // ---- zoom ----
  var currentZoom = 1
  var setZoom = function (z) {
    currentZoom = Math.max(0.25, Math.min(5, Number(z) || 1))
    D.documentElement.style.zoom = currentZoom === 1 ? "" : String(currentZoom)
  }

  // ---- messages from Compass ----
  W.addEventListener("message", function (e) {
    if (e.source !== W.parent || !e.data || e.data.__compass !== 1) return
    var d = e.data
    if (d.type === "find") {
      var count = d.query === lastQuery && marks.length ? marks.length : find(d.query)
      lastQuery = d.query
      if (d.step && marks.length) {
        current = (current + d.step + marks.length) % marks.length
        showMark()
      }
      send({ type: "found", query: d.query, count: count, index: current })
    } else if (d.type === "findClear") {
      clearMarks()
      lastQuery = ""
    } else if (d.type === "zoom") {
      setZoom(d.zoom)
      report("zoom")
    } else if (d.type === "stop") {
      try {
        W.stop()
      } catch (err) {}
    } else if (d.type === "hello") report("hello")
  })
  var lastQuery = ""
  if (CFG.zoom && CFG.zoom !== 1) {
    if (D.documentElement) setZoom(CFG.zoom)
  }

  // ---- when to report ----
  report("start")
  D.addEventListener("DOMContentLoaded", function () {
    if (CFG.zoom && CFG.zoom !== 1) setZoom(CFG.zoom)
    report("ready")
    var title = D.querySelector("title")
    if (title && W.MutationObserver) new MutationObserver(function () { report("title") }).observe(title, { childList: true, characterData: true, subtree: true })
  })
  W.addEventListener("load", function () {
    report("load")
  })
  W.addEventListener("pagehide", function () {
    if (top) send({ type: "unload" })
  })
  // titles set by scripts after load (single-page sites)
  setInterval(function () {
    report("poll")
  }, 2000)
}

// The <script> for a page: config is JSON (with "<" escaped so it can't close the tag)
const injectScript = (cfg) => `<script>(${compassPage.toString()})(${JSON.stringify(cfg).replace(/</g, "\\u003c").replace(/[\u2028\u2029]/g, "")});</script>`

module.exports = { injectScript, compassPage }
