# Testing in detail
Moved from CLAUDE.md on 2026-10-05 (CLAUDE.md keeps the short version).

- **Unit tests:**
  - Root `npm test` runs the server and arcade tests (all passing on 2026-10-04 incl. `server/notes/test`, Do Not Disturb in `server/push/test` and `server/aim/test/history.test.js`; the Compass relay and isolation tests are in `server/web/test`, the usage meter in `server/meter/test`; `server/push/test` fakes web-push; `server/account/test/delete.test.js` checks every store is emptied for the deleted account and untouched for others, and the socket flow incl. a half-way failure and retry).
  - Persistence and account deletion: `node --test client/src/utils/keepSafe.test.js`; browser scripts `del-persist.mjs` (guest notes, sync default on + notice, a photo uploads within seconds, site storage wiped then sign on brings photos back, a new phone gets them) and `del-account.mjs` (the confirmation, wrong password, done screen, buddy list updated, device erased, name free; phone run keeping files) with `del-helpers.mjs` (`clearSiteData` uses CDP `Storage.clearDataForOrigin`).
  - Address Book and search: `node --test client/src/components/applets/addressbook/vcard.test.js` and `client/src/utils/search.test.js`; browser scripts `ab-e2e.mjs`, `ab-search.mjs`, `ab-phone.mjs` (with `ab-helpers.mjs`).
  - The service worker's push handlers and the Notification Center store: `node --test client/src/utils/sw.test.js`.
  - App unit tests run by FILE path: `node --test path/to/x.test.js`. A folder path fails on Windows.
- **Browser tests:** playwright-core with system Chrome. Scripts live in the session scratchpad, which is temporary, so recreate them as needed.
  - Several agents at once: take the machine-wide Chrome lock first (`mkdir %TEMP%\98ish-chrome.lock`, atomic; wait and retry if it exists; treat it as stale after 15 minutes) and remove it when the script ends, even on failure. Give each agent its own vite cache dir (a scratch vite config with `cacheDir`) when worktrees share `node_modules` through a junction.
  - The 2026-10-07 phone-shell round (frozen taps, popups, printing, pickers, Virtual PC) used: `freeze.mjs` (stuck states, then a tap on Start: an invisible dialog's layer, a dialog left off screen, a drag/long press/held Delete when the app is put away, three no-click taps, `?tapdebug=1`), `center.mjs`, `wp-explore.mjs [landscape]`, `save-apps.mjs`, `print.mjs` (stubs `window.print`, checks the print copy, renders a PDF), `pickers.mjs`, `vpc.mjs` (needs the network: v86 from jsDelivr), `aw-explore.mjs`, `taskbar.mjs`, `notch.mjs` (CDP `Emulation.setSafeAreaInsetsOverride`). Visibility is faked by redefining `document.visibilityState`/`hidden` and dispatching `visibilitychange` + `pagehide`/`pageshow`.
  - Playwright WebKit: the installed build is `ms-playwright/webkit-2359` while playwright-core asks for a newer one; launch it with `executablePath` pointing at `webkit-2359/Playwright.exe`.
  - Ports: vite on 5199 (`cd client && npx vite --port 5199 --strictPort`), chat server `COUPLES_TEST_CLOCK=1 PORT=8000 node server.js`.
  - Set localStorage `98ish.bootScreen=off` and `98ish.helper=off`. With `98ish.helper=off`, Floppy and the Welcome window stay away.
  - Phone-emulation tests that type into forms: set `keyboard: "phone"` in `98ish.settings`, or the 98ish keyboard covers the page's buttons.
  - Push tests (`push-*`): the service worker only registers in a production build, so `vite build` with `VITE_SOCKET_URL` and serve it with `vite preview`; start the server with test VAPID keys. Push needs a normal profile (`chromium.launchPersistentContext`; Chrome turns the Push API off in incognito contexts) and `context.grantPermissions(["notifications"])`. Headless Chrome subscribes with Google's push service and the server's sends are accepted, but delivery back to an automated browser is unreliable (it arrived in 1 of 4 runs), so tests fall back to handing the message to the service worker with CDP `ServiceWorker.deliverPushMessage`. Headless also keeps no shown notifications (`getNotifications()` is empty).
  - Call tests (`call-*`): launch Chrome with `--use-fake-device-for-media-stream --use-fake-ui-for-media-stream`, two contexts in one browser. `window.__call` exposes the call state (`get()`, `peer()`, `start`, `answer`, `hangUp`). Under memory pressure Chrome's fake camera sometimes isn't found by the second context; the app falls back to voice with a notice, and the tests then press Camera On.
- **Discipline:**
  - Restart both servers after merging new code, so you don't test stale code.
  - Run each suite once, and investigate only failures that repeat.
  - The machine has 7.7 GB of RAM. Run at most 3 agents, one Chrome at a time, and kill leftover headless Chrome.
- **Deploy checks:**
  - Render CLI: `render.exe deploys list srv-davi6cm7bikc73e5k5ig -o json --confirm`.
  - Vercel: check `https://98ish.vercel.app/sw-manifest.json` for the new chunk names.
