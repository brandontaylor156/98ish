// WordPad documents are HTML, so everything that goes in (opening a file, pasting, dropping)
// passes through here first. Only WordPad's own formatting survives: a short list of tags,
// a few attributes and style properties with checked values, and pictures that are
// embedded data (no links, no scripts, no event handlers, nothing fetched from elsewhere).

// tags kept as they are
const KEEP = new Set(["p", "div", "br", "b", "strong", "i", "em", "u", "s", "strike", "span", "font", "ul", "ol", "li", "img", "sub", "sup", "h1", "h2", "h3", "blockquote"])
// tags dropped with everything inside them
const DROP = new Set(["script", "style", "iframe", "frame", "frameset", "object", "embed", "applet", "link", "meta", "title", "head", "noscript", "template", "svg", "math", "canvas", "audio", "video", "source", "track", "form", "input", "button", "select", "textarea", "option", "base", "param", "picture", "map", "area"])
// everything else (a, table, section...) is unwrapped: its text stays, the tag goes

const COLOR = /^(#[0-9a-f]{3}|#[0-9a-f]{6}|rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*(,\s*(0|1|0?\.\d+)\s*)?\)|[a-z]{3,20})$/i
const LENGTH = /^-?\d{1,4}(\.\d{1,3})?(px|pt|em|in|cm|mm|%)?$/
const FONT_NAME = /^[\w\s"',-]{1,100}$/

// the style properties WordPad uses, and what their values may look like
const STYLE_RULES = {
  "font-family": (v) => FONT_NAME.test(v),
  "font-size": (v) => LENGTH.test(v) || /^(xx-small|x-small|small|medium|large|x-large|xx-large|xxx-large|smaller|larger)$/.test(v),
  "font-weight": (v) => /^(normal|bold|bolder|lighter|[1-9]00)$/.test(v),
  "font-style": (v) => /^(normal|italic|oblique)$/.test(v),
  "text-decoration": (v) => /^(none|underline|line-through|underline line-through|line-through underline)$/.test(v),
  "text-decoration-line": (v) => /^(none|underline|line-through|underline line-through|line-through underline)$/.test(v),
  color: (v) => COLOR.test(v),
  "background-color": (v) => COLOR.test(v),
  "text-align": (v) => /^(left|right|center|justify|start|end)$/.test(v),
  "margin-left": (v) => LENGTH.test(v),
  "margin-right": (v) => LENGTH.test(v),
  "text-indent": (v) => LENGTH.test(v),
  "list-style-type": (v) => /^(disc|circle|square|decimal|lower-alpha|upper-alpha|lower-roman|upper-roman|none)$/.test(v),
  "vertical-align": (v) => /^(baseline|sub|super)$/.test(v),
}

// a style="..." value -> only the allowed declarations ("" if none)
export const cleanStyle = (style) => {
  const out = []
  for (const part of String(style || "").split(";")) {
    const colon = part.indexOf(":")
    if (colon < 0) continue
    const prop = part.slice(0, colon).trim().toLowerCase()
    const value = part.slice(colon + 1).trim().replace(/\s*!important$/i, "")
    // anything that could fetch or run something is out, whatever the property
    if (/url\s*\(|expression|javascript:|@import|\\|[<>]/i.test(value)) continue
    if (STYLE_RULES[prop]?.(value.toLowerCase())) out.push(`${prop}: ${value}`)
  }
  return out.join("; ")
}

// pictures must be embedded PNG/JPEG/GIF/WebP data
const IMAGE_SRC = /^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i

const cleanAttributes = (from, to, tag) => {
  for (const { name, value } of [...from.attributes]) {
    const attr = name.toLowerCase()
    if (attr === "style") {
      const style = cleanStyle(value)
      if (style) to.setAttribute("style", style)
    } else if (attr === "align" && /^(left|right|center|justify)$/i.test(value) && (tag === "p" || tag === "div" || /^h[1-3]$/.test(tag))) {
      to.setAttribute("align", value.toLowerCase())
    } else if (tag === "font" && attr === "face" && FONT_NAME.test(value)) to.setAttribute("face", value)
    else if (tag === "font" && attr === "size" && /^[1-7]$/.test(value.trim())) to.setAttribute("size", value.trim())
    else if (tag === "font" && attr === "color" && COLOR.test(value.trim())) to.setAttribute("color", value.trim())
    else if (tag === "img" && attr === "src" && IMAGE_SRC.test(value.trim())) to.setAttribute("src", value.trim().replace(/\s+/g, ""))
    else if (tag === "img" && attr === "alt") to.setAttribute("alt", value.slice(0, 200))
    else if (tag === "img" && (attr === "width" || attr === "height") && /^\d{1,4}$/.test(value.trim())) to.setAttribute(attr, value.trim())
    // everything else (on*, href, class, id, data-*...) is left behind
  }
}

// copy `from`'s children into `to`, cleaning as we go
const copyClean = (from, to, doc, collapse) => {
  for (const node of [...from.childNodes]) {
    if (node.nodeType === 3) {
      let text = node.nodeValue
      if (collapse) {
        // pasted web pages: their source's line breaks and indents aren't part of the text
        if (/^\s*$/.test(text) && /[\r\n]/.test(text)) continue
        text = text.replace(/[\t\r\n ]+/g, " ")
      }
      to.appendChild(doc.createTextNode(text))
      continue
    }
    if (node.nodeType !== 1) continue // comments, processing instructions
    const tag = node.localName?.toLowerCase() || ""
    if (DROP.has(tag)) continue
    if (!KEEP.has(tag)) {
      // a table cell or heading-ish block still deserves its own line
      const block = /^(td|th|tr|table|section|article|header|footer|main|aside|nav|h4|h5|h6|pre|address|figure|figcaption|dl|dt|dd|center)$/.test(tag)
      if (block) {
        const div = doc.createElement("div")
        copyClean(node, div, doc, collapse)
        if (div.childNodes.length) to.appendChild(div)
      } else copyClean(node, to, doc, collapse)
      continue
    }
    if (tag === "img" && !IMAGE_SRC.test((node.getAttribute("src") || "").trim())) continue
    const el = doc.createElement(tag)
    cleanAttributes(node, el, tag)
    if (tag !== "img" && tag !== "br") copyClean(node, el, doc, collapse)
    to.appendChild(el)
  }
}

// untrusted HTML -> safe WordPad HTML (a string). collapse squeezes HTML source whitespace
// (pasted web pages); WordPad's own documents keep their spaces and tabs
export const sanitizeHtml = (html, { collapse = false } = {}) => {
  const source = new DOMParser().parseFromString(`<!doctype html><body>${String(html ?? "")}`, "text/html")
  // build the result in an inert document, so nothing loads or runs while we work
  const doc = document.implementation.createHTMLDocument("")
  const out = doc.createElement("div")
  copyClean(source.body, out, doc, collapse)
  return out.innerHTML
}

const escapeHtml = (text) => String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")

// plain text -> paragraphs (a text file opened in WordPad, or text pasted in)
export const textToHtml = (text) => {
  const lines = String(text ?? "").replace(/\r\n?/g, "\n").split("\n")
  return lines.map((line) => `<p>${line ? escapeHtml(line) :"<br>"}</p>`).join("")
}

// WordPad HTML -> plain text, one line per paragraph (saving as a text document)
export const htmlToText = (html) => {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${sanitizeHtml(html)}`, "text/html")
  const lines = []
  let line = ""
  const flush = () => {
    lines.push(line)
    line = ""
  }
  const walk = (node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) line += child.nodeValue.replace(/ /g, " ")
      else if (child.nodeType === 1) {
        const tag = child.localName
        if (tag === "br") {
          flush()
          continue
        }
        const block = BLOCK.test(tag)
        if (block && line) flush()
        if (tag === "li") line += "• "
        walk(child)
        // an empty paragraph is an empty line; one ending in <br> already ended its line
        const holdsBlocks = [...child.children].some((c) => BLOCK.test(c.localName))
        if (block && (line || (!holdsBlocks && child.lastChild?.localName !== "br"))) flush()
      }
    }
  }
  walk(doc.body)
  if (line) flush()
  return lines.join("\r\n")
}

const BLOCK = /^(p|div|li|h1|h2|h3|blockquote|ul|ol)$/
