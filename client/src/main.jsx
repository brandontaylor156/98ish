// first: each user's localStorage keys (utils/users.js), before any module reads them
import "./utils/userStorage"
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import { fsReady } from "./utils/fs"
import "../node_modules/98.css/dist/98.css"
import "./main.css"
import "bootstrap/dist/css/bootstrap.min.css"

// The drive's folders load from this browser's storage first (usually a few milliseconds;
// the first start after an update moves the old drive over, which can take a moment)
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
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}))
}
