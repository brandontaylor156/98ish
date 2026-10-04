// first: each user's localStorage keys (utils/users.js), before any module reads them
import "./utils/userStorage"
import React from "react"
import ReactDOM from "react-dom/client"
import App from "./App"
import "../node_modules/98.css/dist/98.css"
import "./main.css"
import "bootstrap/dist/css/bootstrap.min.css"

ReactDOM.createRoot(document.getElementById("root")).render(<App />)

// Save the app for offline use (and installing to a phone's home screen). Only on the
// real site: a service worker would get in the way of the dev server.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}))
}
