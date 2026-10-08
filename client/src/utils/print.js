// Printing for real: a document's own print-only copy, then the browser's print window
// (on an iPhone the share-sheet print screen: AirPrint printers, or Save to Files as a PDF).
//
//   printDocument({ title, html, css, page })   true when the print window was asked for
//
// html is put in a print-only box at the end of <body> (.os-print); main.css hides it on
// screen and, while printing (body.os-printing), hides everything else and un-pins the page
// (98ish pins html/body with position: fixed, which printed one cut-off page). css is added for
// print only; page is the @page rule's body ("size: landscape; margin: 0.5in"). The document's
// title names the PDF. Call it straight from the tap (OK in the Print dialog): iOS only opens
// its print screen inside a user gesture. Text from users must be escaped (escapeHtml) or
// sanitized (WordPad's sanitizeHtml) before it gets here.

export const escapeHtml = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

let cleanup = null

export const printDocument = ({ title = "98ish", html = "", css = "", page = "" } = {}, win = globalThis.window) => {
  const doc = win?.document
  if (!doc?.body || typeof win.print !== "function") return false
  cleanup?.()
  const area = doc.createElement("div")
  area.className = "os-print"
  area.setAttribute("aria-hidden", "true")
  const style = doc.createElement("style")
  style.textContent = `@media print {${page ? ` @page { ${page} }` : ""} ${css} }`
  const body = doc.createElement("div")
  body.className = "os-printBody"
  body.innerHTML = html
  area.append(style, body)
  doc.body.appendChild(area)
  doc.body.classList.add("os-printing")
  const oldTitle = doc.title
  doc.title = title
  const done = () => {
    win.removeEventListener("afterprint", done)
    doc.body.classList.remove("os-printing")
    area.remove()
    if (doc.title === title) doc.title = oldTitle
    if (cleanup === done) cleanup = null
  }
  cleanup = done
  // (iOS: print() returns while its print screen is still up; afterprint comes when it closes,
  // so the copy stays until then; if it never comes, the next print replaces it)
  win.addEventListener("afterprint", done)
  try {
    win.print()
  } catch {
    done()
    return false
  }
  return true
}

// a plain text document (Notepad): the file name on top, the words below, wrapped
export const textHtml = (title, text) => `<div class="os-printHead">${escapeHtml(title)}</div><pre class="os-printText">${escapeHtml(text)}</pre>`
export const TEXT_CSS = `.os-printHead { font: 10pt Arial, sans-serif; text-align: center; margin-bottom: 12pt; } .os-printText { font: 11pt "Courier New", monospace; white-space: pre-wrap; overflow-wrap: anywhere; margin: 0; }`

// a picture (Paint): as big as the page allows, keeping its shape
export const pictureHtml = (src, alt = "") => `<img class="os-printPicture" src="${escapeHtml(src)}" alt="${escapeHtml(alt)}">`
export const PICTURE_CSS = `.os-printPicture { display: block; max-width: 100%; max-height: 9.5in; margin: 0 auto; image-rendering: pixelated; }`
