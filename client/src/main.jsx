// first: each user's localStorage keys (utils/users.js), before any module reads them
import "./utils/userStorage"
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { fsReady } from "./utils/fs"
import { installTouchGuard } from "./utils/touchGuard"
import { installInputGuard } from "./utils/inputGuard"
import "../node_modules/98.css/dist/98.css"
import "./main.css"
import "bootstrap/dist/css/bootstrap.min.css"

// The drive's folders load from this browser's storage first (usually a few milliseconds;
// the first start after an update moves the old drive over, which can take a moment)
// no phone "hold" menus outside text boxes and reading areas (utils/touchGuard.js)
installTouchGuard()
// taps that stop working: resets on coming back / turning the phone, ?tapdebug=1 (utils/inputGuard.js)
installInputGuard()

const rootEl = document.getElementById("root")
const slow = setTimeout(() => {
  if (!rootEl.childElementCount) rootEl.innerHTML = '<div class="fsLoading" role="status">Loading your files...</div>'
}, 300)

fsReady.finally(() => {
  clearTimeout(slow)
  rootEl.innerHTML = ""
  ReactDOM.createRoot(rootEl).render(<App />)
})

// Save the app for offline use (and installing to a phone's home screen). Only on the
// real site: a service worker would get in the way of the dev server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js")
      .then((reg) => {
        // an iPhone Home Screen app can stay open for days: look for a new version whenever
        // it comes back to the front (and hourly), not only on a cold start
        const check = () => reg.update().catch(() => {})
        document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && check())
        setInterval(check, 60 * 60 * 1000)
      })
      .catch(() => {})
  })
  // A new version took over (sw.js skipWaiting + clients.claim), but this page still runs the
  // old code. Reload onto it at a moment that interrupts nothing: right away if 98ish is in the
  // background, otherwise the next time it's put away (switching apps, locking the phone).
  let hadController = !!navigator.serviceWorker.controller
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (!hadController) return void (hadController = true) // the first install, not an update
    if (document.visibilityState === "hidden") return location.reload()
    const onHide = () => document.visibilityState === "hidden" && location.reload()
    document.addEventListener("visibilitychange", onHide)
  })
}
