# Maps 98 (2026-10-07)

A 98-style maps app: search places, see where you are, directions to drive, walk or bike with every turn written out, follow along, and hand off to Apple Maps (Google Maps off Apple devices) for spoken navigation. Program "Maps 98" (`applets/maps/`, app `maps`, group Accessories, also Internet; DOS `maps`/`map`/`directions`; icon `public/assets/program_icons/maps.svg`, an original drawing; Help topic `maps`). Owner's ask: "There should be a maps app within 98ish that is 98ish themed; clicking directions in Pickleball 98 should go there."

## Opening it from another program: `openMaps`
```js
import { openMaps } from "../../../utils/maps"   // client/src/utils/maps.js (small, eager)
openMaps({ name: "Los Cab Sports Village", lat: 33.7173, lon: -117.9861, directions: true })
```
- `lat`, `lon` (required, WGS84 degrees); `name` and `address`/`detail` (optional, the card's two lines); `directions: true` opens straight into directions from your location (the location prompt comes from the tap that called it; without a location it asks where you're starting); `mode`: `"drive"` (default for directions), `"walk"` or `"bike"`.
- Returns `false` and opens nothing when the coordinates aren't valid.
- It dispatches the shell's program-open event (`98ish:couple-open`, CoupleBridge): a new window gets `handoff: { id, dest, directions, mode }`; an open Maps 98 comes forward and gets the same handoff through `98ish:couple-view`, so it never opens twice.
- **Pickleball 98** (2026-10-07): Real Games' **Directions** (the courts list and a session at a known venue) call `openMaps({ name, lat, lon, address, directions: true })`. A session at your own place (no coordinates) keeps the Apple/Google links.
- Already wired: Buddy Locator's **Directions** on a buddy's card (was an Apple/Google Maps link).
- **Pickleball 98's where & when sheet** (2026-10-08): a real venue or a Venue Finder court (never a made-up arena) shows **Directions** under its name (`play/meet.js placeDirections`): a real venue sends its full name, VENUE_LIST position and Real Games' street address; a Venue Finder court its title, position and town. Checked again: Real Games' courts list and sessions already called `openMaps({ name, lat, lon, address, directions: true })`.
- **98 Messenger's "Meet me at" cards** (2026-10-08): **Directions** on the card calls `openMaps` with the card's name, position and address (`docs/messenger.md`).
- Browser (scratchpad `r8loc.mjs`): the sheet shows Directions for California SMASH, none for an arena, and the tap opens Maps 98 on "California SMASH Pickleball & Social Club, 815 N Nash St, El Segundo"; `r8meet.mjs`: a card's Directions opens Maps 98 in directions mode on Los Cab.

## Services (all free, no key) and their terms
- **Map:** OpenFreeMap vector tiles with the `liberty` style (as Buddy Locator; `MAP_STYLE` from `locator/LocatorMap.jsx`), MapLibre GL loaded only when Maps 98 opens. Credit shown by the style and in the footer.
- **Search: Photon** (`photon.komoot.io`, komoot's public instance over OpenStreetMap data): fair use, no bulk/heavy use. Maps 98 searches as you type only after 3+ letters and 0.5 s of no typing, caches answers (80), and sends at most one request a second (`gate("photon")`). The "near" bias is rounded to 0.1 degree (~10 km) so it doesn't reveal where you are.
- **Search fallback: Nominatim** (`nominatim.openstreetmap.org`): its usage policy allows at most 1 request per second, no autocomplete, an identifying Referer/User-Agent, and caching. Maps 98 calls it only for an explicit Search (never type-ahead) when Photon fails or finds nothing, gated to 1.1 s, cached. Browsers send the page's Referer (they can't set a User-Agent).
- **Directions: Valhalla on FOSSGIS's public server** (`valhalla1.openstreetmap.de`, the server openstreetmap.org's own Directions uses from the browser; CORS `*`): `auto`, `pedestrian` and `bicycle` costing with written English instructions (`directions_options.language`), polyline6 shape. FOSSGIS asks for fair use (no heavy/commercial loads, about 1 request a second): routes are cached (30) and gated to 1 a second. Chosen over the OSRM demo (car only, no instructions text) and OpenRouteService (needs a key).
- Reverse lookup for dropped pins: Photon `/reverse`.
- Privacy: Help's third-party table lists Photon/Nominatim and Valhalla (what they get: the search text with a ~10 km area; a route's two ends). Nothing is stored on the 98ish server; recent places (12) and the last travel mode are in localStorage `98ish.maps` (per user through the storage seam). No new server store, so no account eraser step.

## Code
- `mapsCore.js` (pure, tested): Photon/Nominatim URL builders and result shaping (`placeFromPhoton`, `placeFromNominatim`), `cleanDest`, `routeRequest`/`routeUrl`, `decodePolyline` (precision 6), `shapeRoute` (time, distance, units, `line` [[lon, lat]], `steps` with text/type/distance/start point), `durationText`, `distanceText` (ft/mi or m/km by the browser's region), `progressOn` (nearest route point, the next step, metres to it, metres off the route), `appleMapsUrl` (`daddr`, `dirflg` d/w; Apple's links have no cycling flag) and `googleMapsUrl`, `createCache`, `addRecent`.
- `mapsStore.js`: `searchPlaces(q, { near, explicit })`, `placeAt(lat, lon)`, `findRoute(from, to, mode, { metric })` with the gates and caches above; offline and 429 messages; prefs.
- `MapsMap.jsx`: the map (red 98 pin, blue "you" dot, navy route line with a white casing, numbered result squares; touch-and-hold or right-click drops a pin; `fly`, `fitRoute`, `center`).
- `Maps.jsx`: baseline = search box + Search + ◎ (where am I) + the map; recent places when the box is empty; a place's card has **Directions** and **Open in Apple Maps**; directions show Drive/Walk/Bike, From, the time and distance, **Start** (follows you with `watchPosition`, shows the next turn and the distance to it, keeps you in view) and the steps (collapsed on phones). Menus: File (Where Am I?, Clear), Directions (modes, Directions to Here, Open in Apple/Google Maps), Help. Phones: map on top, card under it (max 52%).
- Limits: it follows you only while 98ish is open on screen (iPhone pages can't track in the background), no voice; Apple Maps is the handoff for that. No traffic, no transit.

## Tests
- `node --test client/src/components/applets/maps/maps.test.js` (6: polyline6, route shaping/progress/words, request costing/units, Photon/Nominatim shaping and the ~10 km rounding, destinations and Apple/Google links, cache/recents).
- Real services once from Node through the app's store (scratchpad `maps-real.mjs`): Photon found "Irvine Spectrum Center"; Valhalla drive 13 min 8.2 mi (10 steps, ~1 s), walk 1 hr 52 min, bike 34 min; reverse lookup named the street.
- Browser at 390x844 (scratchpad `maps.mjs`, geolocation granted and set): search -> results on the map and in the list -> card with an Apple Maps link -> Directions 13 min · 8.2 mi -> Walk -> Start shows the next turn -> an `openMaps` handoff moves the open window to a new place with directions (one window).
