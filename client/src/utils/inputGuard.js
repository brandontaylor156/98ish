// Taps that stop working: the shell's safety net, and ?tapdebug=1 to see where taps go.
//
// The owner saw every button stop responding on his iPhone, after going in and out of the
// Home Screen app, turning the phone, or a long while. Whatever a tap was caught by, the
// pieces that can catch one are reset here when the page comes back to the front, is shown
// again from the back/forward cache, or the phone turns (installInputGuard, from main.jsx):
//   - INPUT_RESET ("98ish:input-reset") goes to everything that holds a press: popup drags
//     (hooks/useFloating.js ends the drag and puts the box back on screen), the desktop
//     icons' drag, long presses (hooks/useLongPress.js), the 98ish keyboard's held keys.
//     Listen with onInputReset(fn).
//   - click swallowers (swallowNextClick: after a tap opens a window, after a long press,
//     after waking a screen saver) are dropped, so none outlives its moment.
//   - a page scrolled by the phone (iOS can leave the fixed page shifted after turning) goes
//     back to 0, so what's drawn is where taps land.
//   - modal layers (a dialog's see-through backdrop, the desktop's dialog layer...) whose
//     dialog can't be seen (off screen, hidden, never drawn) stop catching taps
//     (data-input-stuck). A layer with a dialog on screen is left alone; its dialog is just
//     put back on screen. The same check runs when a tap lands on a bare layer.
//   - three taps in a row on buttons with no click to follow (something cancelled them all)
//     run the reset by themselves.
// ?tapdebug=1 (remembered on that browser, ?tapdebug=0 turns it off) shows a few lines at the
// bottom of the screen: for each tap, the element at that point (document.elementFromPoint)
// and the layer it's in, whether a click followed, plus every reset and stuck layer. The log
// is also kept in sessionStorage "98ish.tapLog" (and window.__tapLog).

export const INPUT_RESET = "98ish:input-reset"

// layers that cover their window or the whole screen while a dialog is up
export const MODAL_LAYERS = ".desktopDialogLayer, .globalMenuLayer, .shellLayer, .runLayer, .powerDim, .dialogBackdrop, .tm-modal"
// what counts as the layer's dialog
const BOXES = "[data-floating], .dialog, .window, .lockDialog"

export const onInputReset = (fn, win = globalThis.window) => {
  if (!win) return () => {}
  const handler = (e) => fn(e.detail)
  win.addEventListener(INPUT_RESET, handler)
  return () => win.removeEventListener(INPUT_RESET, handler)
}

// ---- click swallowing ----

const swallowers = new Set()
// Swallow the next click (the one a phone sends at the end of a tap that already did its
// job), for at most `ms`. Returns the release.
export const swallowNextClick = (ms = 600, win = globalThis.window) => {
  const handler = (event) => {
    event.stopImmediatePropagation()
    event.preventDefault()
    release()
  }
  const release = () => {
    win.removeEventListener("click", handler, { capture: true })
    clearTimeout(timer)
    swallowers.delete(release)
  }
  win.addEventListener("click", handler, { capture: true })
  const timer = setTimeout(release, ms)
  swallowers.add(release)
  return release
}
export const pendingSwallowers = () => swallowers.size

// ---- stuck layers (pure parts, unit tested) ----

const overlap = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top))

// Can someone see (and so answer) a box? At least 24 x 24 px of it on screen.
export const boxOnScreen = (box, view) => {
  if (!box || !(box.width > 0) || !(box.height > 0)) return false
  const w = Math.min(box.right, view.right) - Math.max(box.left, view.left)
  const h = Math.min(box.bottom, view.bottom) - Math.max(box.top, view.top)
  return w >= 24 && h >= 24
}

// A layer is stuck when it covers a real part of the screen but none of its dialogs can be
// seen: every tap there would go to an invisible box.
export const layerStuck = (layer, boxes, view) => {
  if (!layer || overlap(layer, view) < 0.25 * (view.right - view.left) * (view.bottom - view.top)) return false
  return !boxes.some((b) => boxOnScreen(b, view))
}

// ---- the DOM side ----

let debug = null // { lines: [], el }
const DEBUG_KEY = "98ish.tapDebug"
const LOG_KEY = "98ish.tapLog"

const describe = (el) => {
  if (!el || !el.tagName) return String(el)
  const id = el.id ? `#${el.id}` : ""
  const cls = typeof el.className === "string" && el.className.trim() ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : ""
  const label = el.getAttribute?.("aria-label") || (el.tagName === "BUTTON" ? el.textContent.trim().slice(0, 16) : "")
  return `${el.tagName.toLowerCase()}${id}${cls}${label ? `[${label}]` : ""}`
}
const layerOf = (el) => {
  const layer = el?.closest?.(`${MODAL_LAYERS}, .mobileWindow, .desktopWindow, .taskbar, .startArea, .kb98, .selLayer, .contextMenuLayer, .lockScreen, .ssOverlay`)
  return layer ? describe(layer) : "desktop"
}

export const tapLog = (line) => {
  const at = new Date().toTimeString().slice(0, 8)
  const text = `${at} ${line}`
  try {
    const list = JSON.parse(sessionStorage.getItem(LOG_KEY) || "[]")
    list.push(text)
    sessionStorage.setItem(LOG_KEY, JSON.stringify(list.slice(-200)))
  } catch {
    // no storage
  }
  if (typeof window !== "undefined") (window.__tapLog ||= []).push(text)
  if (!debug) return
  if (globalThis.console) console.log(`[tap] ${text}`)
  debug.lines.push(text)
  if (debug.lines.length > 10) debug.lines.shift()
  if (!debug.el?.isConnected) {
    debug.el = document.createElement("pre")
    debug.el.id = "tapDebug"
    debug.el.style.cssText =
      "position:fixed;left:0;right:0;bottom:calc(var(--taskbar-h, 30px) + env(safe-area-inset-bottom));z-index:2147483647;margin:0;padding:2px 4px;font:10px/1.3 monospace;background:#ffffe1e8;color:#000;pointer-events:none;white-space:pre-wrap;max-height:40vh;overflow:hidden"
    document.body.appendChild(debug.el)
  }
  debug.el.textContent = debug.lines.join("\n")
}

const viewRect = () => ({ left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight })

const visibleBox = (el) => {
  const s = getComputedStyle(el)
  if (s.visibility === "hidden" || s.display === "none" || Number(s.opacity) < 0.05) return null
  return el.getBoundingClientRect()
}

// Put every dialog back on screen, and let taps through layers whose dialog can't be seen.
// Returns the layers it let through.
export const checkLayers = (why = "check") => {
  if (typeof document === "undefined") return []
  const view = viewRect()
  document.querySelectorAll("[data-floating=on]").forEach((el) => el._floating?.refit?.())
  const freed = []
  document.querySelectorAll(MODAL_LAYERS).forEach((layer) => {
    const style = getComputedStyle(layer)
    if (style.pointerEvents === "none" || style.visibility === "hidden" || style.display === "none") return
    // inside a hidden window (minimized, another user's lock screen): not in the way
    if (!layer.getClientRects().length) return
    const boxes = [...layer.querySelectorAll(BOXES)].map(visibleBox).filter(Boolean)
    const stuck = layerStuck(layer.getBoundingClientRect(), boxes, view)
    if (stuck && !layer.hasAttribute("data-input-stuck")) {
      layer.setAttribute("data-input-stuck", why)
      freed.push(layer)
      tapLog(`STUCK layer let through (${why}): ${describe(layer)} with ${boxes.length} box(es), none on screen`)
    } else if (!stuck && layer.hasAttribute("data-input-stuck")) layer.removeAttribute("data-input-stuck")
  })
  return freed
}

// The reset itself (also exported for the Task Manager-style "unfreeze" and tests)
export const resetInput = (why = "reset") => {
  if (typeof window === "undefined") return
  swallowers.forEach((release) => release())
  if (window.scrollX || window.scrollY) window.scrollTo(0, 0)
  const scroller = document.scrollingElement
  if (scroller && (scroller.scrollTop || scroller.scrollLeft)) scroller.scrollTop = scroller.scrollLeft = 0
  window.dispatchEvent(new CustomEvent(INPUT_RESET, { detail: why }))
  tapLog(`reset: ${why}${document.visibilityState === "hidden" ? " (hidden)" : ""}`)
  // after the phone has finished turning / the page has been laid out again
  setTimeout(() => checkLayers(why), 400)
}

let installed = false
export const installInputGuard = (win = globalThis.window) => {
  if (installed || !win?.document) return
  installed = true
  const doc = win.document
  try {
    const q = new URLSearchParams(win.location.search).get("tapdebug")
    if (q === "0") localStorage.removeItem(DEBUG_KEY)
    else if (q !== null) localStorage.setItem(DEBUG_KEY, "1")
    if (localStorage.getItem(DEBUG_KEY)) debug = { lines: [], el: null }
  } catch {
    // no storage
  }

  doc.addEventListener("visibilitychange", () => resetInput(`page ${doc.visibilityState}`))
  win.addEventListener("pageshow", (e) => e.persisted && resetInput("pageshow"))
  win.addEventListener("orientationchange", () => resetInput("orientationchange"))
  win.screen?.orientation?.addEventListener?.("change", () => resetInput("orientation"))

  // each tap: where it landed, and whether a click came of it
  let tap = null
  let quiet = 0 // taps in a row on buttons that got no click
  const BUTTONISH = "button, a[href], [role=button], [role=menuitem], [role=tab], summary, label, input[type=checkbox], input[type=radio]"
  win.addEventListener(
    "pointerdown",
    (e) => {
      if (e.pointerType === "mouse" || !e.isPrimary) return
      const top = doc.elementFromPoint(e.clientX, e.clientY)
      // a tap on a bare modal layer: is its dialog still there to answer? (and a layer let
      // through earlier whose dialog has turned up since catches taps again)
      if (top?.matches?.(MODAL_LAYERS) || doc.querySelector("[data-input-stuck]")) checkLayers("tap on a layer")
      const button = top?.closest?.(BUTTONISH)
      const surface = top?.closest?.("[data-touch-surface], canvas, .kb98, .selLayer")
      tap = { x: e.clientX, y: e.clientY, at: performance.now(), clicked: false, watch: !!button && !surface && !button.disabled, top }
      if (debug) tapLog(`tap ${Math.round(e.clientX)},${Math.round(e.clientY)} -> ${describe(top)} in ${layerOf(top)}${top !== e.target ? ` (target ${describe(e.target)})` : ""}`)
    },
    true
  )
  win.addEventListener(
    "click",
    () => {
      if (tap) tap.clicked = true
    },
    true
  )
  win.addEventListener(
    "pointerup",
    (e) => {
      const t = tap
      if (!t || e.pointerType === "mouse" || !e.isPrimary) return
      if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > 10 || performance.now() - t.at > 700) return void (tap = null)
      setTimeout(() => {
        if (t.clicked) return void (quiet = 0)
        if (debug) tapLog(`  no click after the tap on ${describe(t.top)}`)
        if (!t.watch) return
        quiet++
        if (quiet >= 3) {
          quiet = 0
          resetInput("three taps on buttons without a click")
        }
      }, 450)
    },
    true
  )
  if (debug) {
    win.addEventListener("resize", () => tapLog(`resize ${win.innerWidth}x${win.innerHeight}`))
    tapLog(`tap debug on (${win.innerWidth}x${win.innerHeight}, ${navigator.userAgent.match(/OS [\d_]+|Chrome\/\d+|Version\/[\d.]+/)?.[0] || ""}${win.navigator.standalone ? ", Home Screen app" : ""})`)
  }
}
