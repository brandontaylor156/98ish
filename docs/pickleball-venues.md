# Pickleball 98: real-world venues (strategy, 2026-10-05)

The owner asked: "Is it possible to scrape the world map for all pickleball venues and basically build out those venues dynamically? ... play/walk around some of my favorite venues, play / drill with other people ... indoor or out ... an expansion of My Park."

**Short answer: yes, with OpenStreetMap as the only source.** OSM already traces most courts at the right size and angle, which is all a generator needs. The court-finder sites (Places2Play/USA Pickleball, Pickleheads) and Google forbid scraping or caching, so we don't touch them. This is research and a plan only; nothing is built yet.

## 1. What we measured (live Overpass queries, 2026-10-05)

| Query | Result |
|---|---|
| Features tagged `sport=*pickleball*` worldwide | **32,812** (752 nodes, 32,020 ways, 40 relations) |
| ... in the United States | **29,718**; 415 of them are `leisure=sports_centre`/`sports_hall` (indoor-ish), only 10 tagged `indoor=yes` |
| ... in California | **3,207** features, 3,156 of them individual courts (`leisure=pitch`) |
| California courts grouped into venues (courts within 60 m of each other) | **909 venues**: 377 single courts, 196 with 2-3, 213 with 4-7, 84 with 8-11, 39 with 12+ (largest 44) |
| Tags on California features | `lit` 13%, `surface` 11%, `access` 14% (302 private), `covered` 1%, `name` only **2%** (the name belongs to the enclosing park or club) |
| One real venue: everything within 200 m of the 44-court cluster in Newport Beach (courts, buildings, paths, sand, pools, roads) | 149 objects, **148 KB raw JSON in 1.9 s**. All 44 pickleball polygons measured **13.3-13.4 x 6.2 m** (regulation is 13.41 x 6.10) plus 12 tennis courts at 23.6 x 10.9, so court size and angle come straight from the polygons |
| Enclosing area for a venue name (`is_in`) | Works: found `club=sport, sport=tennis;pickleball` and `landuse=recreation_ground` (this one has no name; the fallback is the nearest named park or club, or an Overture place) |

Estimate: roughly **8-10k US venues** in OSM, comparable to Places2Play's "10,000+ locations" (which we may not copy). Coverage is best for outdoor public courts and weakest indoors.

## 2. Data sources and what their terms allow

| Source | Use it? | Why |
|---|---|---|
| **OpenStreetMap via Overpass** | **Yes, the backbone** | ODbL. Court polygons, `surface`, `lit`, `covered`, `access`, fences (`barrier=fence`), buildings (`height`, `building:levels`), trees, paths, parking, enclosing parks and clubs. Public overpass-api.de: under 10,000 queries and 1 GB a day, and a "regular application" should stay around 1/100 of that (100 queries, 10 MB a day). Identify the app (User-Agent/Referer), no parallel queries, back off 30 s on 429, cache. Commercial use needs your own server (we're not commercial). |
| ODbL obligations | Manageable | A rendered 3D venue is a **Produced Work**: it needs attribution only ("© OpenStreetMap contributors" on screen). Our **venue index file and cached venue JSON are a Derivative Database**: publish them under ODbL with attribution (they're public static files anyway). In-app corrections merged into that data stay ODbL. |
| **Overture Maps Places** | Optional, for names | CDLA-Permissive-2.0 (Foursquare items Apache-2.0 with NOTICE). Good for naming the 98% of unnamed courts ("Lifetime ...", "... Rec Center"). Overture buildings are ODbL like OSM. It's GeoParquet on S3, so we'd build an offline extract, not query it at runtime. Joining it to OSM may make the result ODbL (fine). |
| **Places2Play (USA Pickleball) / Pickleheads** | **No** | Places2Play's terms forbid downloading, storing or publishing any of its data and prohibit scraping or crawling. Pickleheads powers that directory and its site refused our fetch (403); treat it the same. At most, link out ("Find on Places2Play"). |
| **Google Places / Maps** | **No** | Paid; terms forbid scraping and caching (place IDs may be kept, coordinates for at most 30 days, everything else must be fetched live with Google attribution). Breaks "free only" and can't feed a generator. |
| **Mapillary / KartaView** street photos | Not for v1 | CC BY-SA 4.0, but Mapillary's terms restrict building place databases from it. Possibly later as an optional "real photo of this venue" link, never as textures. |
| **Satellite imagery** | **No** | Esri World Imagery needs an ArcGIS license and allows tracing for OSM only; Mapbox needs a key and limits caching; Sentinel-2 is free but 10 m pixels (a court is about 1x2 pixels). Procedural looks instead. |
| **Elevation** (AWS Terrain Tiles / Mapzen Terrarium) | Later, optional | Free, keyless, attribution required. Courts are flat; only the backdrop would use it (Phase 3). |
| **Map UI tiles**: OpenFreeMap (vector, keyless, unlimited) + MapLibre GL | Yes, lazy-loaded | No key or quota. The OSM tile server's policy doesn't suit app use; avoid it. |
| **Place search**: Nominatim | Only "search on submit", proxied | 1 request a second for the whole app, **autocomplete forbidden**, identify the app. Venue search mostly runs against our own index, so this is only for "near a city". |

## 3. Recommended architecture

**Principle: precompute what's small, generate what's big on the device, cache everything, and send the server only tiny JSON.**

1. **Venue index (built offline, shipped as a static file).** A Node script (run monthly by a GitHub Action, free) runs one Overpass query per region, clusters courts into venues (60 m rule), names each from the enclosing park/club/building, Overture or a "Courts near <road>" fallback, and writes `public/venues/index-<region>.json`. One row per venue: `id` (OSM id of the anchor), lat/lon, courts, indoor/covered/lit flags, access, name, city. About 40 bytes a venue: roughly 400 KB raw / 150 KB gzip for the US, sharded by region and lazy-loaded. Served by Vercel, so it costs no Render bandwidth. Carries "© OpenStreetMap contributors, ODbL".
2. **Venue Finder (client).** Opens from My Park ("Choose a park...") or the title screen. Baseline: **Near me** (optional location prompt; the position stays on the phone and only sorts the local index), **Favorites**, **Search** (names in the index; "near a city" goes through the server's Nominatim proxy on submit). More options »: a map view (MapLibre + OpenFreeMap, lazy, on the Finder screen only) and filters (indoor, lit, 8+ courts, public only). Each row shows name, courts, indoor/outdoor, distance, a ★ toggle, and a "N people here now" chip.
3. **Venue detail fetch (server-cached).** `GET /api/venues/:id` on Render: if the venue isn't cached, the server runs one Overpass query (`around:220` of the anchor: pitches, fences, buildings, trees, paths, parking, water, sports-centre outline), reduces it to a **compact venue spec** (local metres, rounded to 5 cm; typically 5-15 KB) and stores it in MongoDB with caps: max 15 KB a spec, 2,000 specs (~25 MB of Atlas's 512), least-recently-used eviction, refresh after 90 days. Overpass is hit at most once per venue per 90 days, serially, with a 2 s gap; well inside the 100-queries/10 MB-a-day guidance. The client keeps specs in IndexedDB (`userKey`-free, device-wide, like map tiles: add to `GLOBAL_KEYS` storage notes) so a revisit is offline and instant. Render outbound: ~10 KB a venue, negligible against 5 GB.
4. **Generator (client, pure + Node-testable).** `park/venuegen.js`: spec → the same shape `layout.js` exports today (courts with frames, pens, gates, racks, bleachers, `BOXES`/`CIRCLES`, interactables, seats, spawn, bounds, a nav graph):
   - **Courts:** each polygon's minimum bounding rectangle gives centre, yaw and size; anything 12.5-14.5 x 5.8-6.8 m is a pickleball court; tennis courts tagged `tennis;pickleball` get 2 pickleball courts each, or 4 per court when it's a dedicated conversion.
   - **Pens and fences:** OSM `barrier=fence` lines if present; otherwise adjacent courts (a shared side within 1 m) form banks, each bank gets one pen with gates on the side nearest a path.
   - **Indoor:** courts inside a `building` or `sports_centre` polygon (or tagged `indoor=yes`/`covered=yes`) get a hall: walls from the footprint, a roof, high-bay lights, sports-floor colours, no sky. "Covered" means a canopy only.
   - **Surroundings within 120 m:** extruded buildings (height from tags, else 3.5 m a level, else one level), instanced trees (`natural=tree` points, scattered inside `wood`/`park` areas), parking asphalt with stripes, footpaths, water, low walls. Beyond 120 m: a skyline ring.
   - **Furniture placed by rules:** racks by gates, bleachers along the pen side facing a path, benches and lights along banks (lights only when `lit=yes` or indoor), plus a Locker Room booth and spawn at the entrance closest to parking.
   - **Colours:** `surface:colour` if tagged, else the classic blue court / green surround (editable later).
   - **Collision and navigation:** an occupancy grid (0.5 m) built from the boxes, with a nav graph from its open cells for regulars (you still walk only by hand, per the owner's rule).
   - **Budgets:** the scene uses `build.js`'s merging (static meshes merged per material, instanced posts/trees/rack paddles). Phone target: ≤ 60 static draw calls and ≤ 60k triangles for the venue; at big venues (44 courts) only the nearest 4-6 courts get live matches, the rest are "virtual" exactly like today, and far banks are drawn as merged boxes with painted lines.
5. **Refactor that makes it possible.** Today `layout.js` is hard-coded constants (4 courts east-west, fixed pens, a hand-written route). Step one is turning it into `makeLayout(spec)` with the current park as a built-in spec (`RIVERSIDE`), and giving court frames an arbitrary yaw (`toWorld/toLocal/yawToWorld/poseToWorld` currently assume a quarter turn). `world.js`, `build.js`, `regulars.js`, `followcam.js` and the server's `COURTS = 4` then read from the layout instead of constants. This also fixes the known leftover "your park game is played at the Riverside Park venue": the match renders on the court you actually walked onto.
6. **Multiplayer at a venue** (builds on `server/park/index.js` + rooms):
   - `park:join { venue }` puts you in the fullest instance under 16 *at that venue*. The server reads that venue's court count from its own cached spec, never from the client.
   - Racks and paddle stacking, `park:up` → solo or a private room, scores, lines/emotes and the bandwidth meter all work unchanged per court.
   - The Finder shows "N here now" per venue from a cheap server summary, refreshed when the Finder opens.
   - **Friends:** "Meet me at <venue>" from 98 Messenger (a link that opens the Finder on that venue) plus an opt-in "show friends where I'm playing" (off by default).
   - **Drills with a friend:** Practice's drills (`drills.js`, `practice/`) offered on any court through the same private-room handoff (one feeds, one drills).
7. **Favorites and edits:**
   - Favorites live in localStorage through `userKey` (synced like other prefs, if desired).
   - "This isn't right" edits (court count, indoor/outdoor, surface colour, name, missing lights) go into a small per-venue override record on the server: max 20 overrides a venue, 1 KB each, rate-limited, owner-approved or applied after 2 matching suggestions. Overrides are ODbL like the rest, and each one gets a "Fix it on OpenStreetMap too" link (osm.org/edit at that spot).
   - **"Add a missing venue":** drop a pin + court count + indoor/outdoor → the generator builds a generic venue there.
   - Because edits are stored per account, they need a Delete My Account eraser step and inventory line (CLAUDE.md rule), plus Help privacy text.
8. **Attribution and privacy.**
   - A "© OpenStreetMap contributors" line in the Finder, on the venue loading card and in Help, with the ODbL note for the index file; Overture/Mapzen notices if those get used.
   - Location is asked only when you tap Near me, used on the phone, never sent or stored.
   - No real logos or club branding in generated scenes: names appear as plain text only, and private clubs get a "members' club" badge.

## 4. Phased plan (effort in focused agent-days, rough)

- **Phase 0, spike (1-2 days):** the `makeLayout(spec)` refactor plus arbitrary court yaw; a one-off script turns ONE real venue (the owner's favorite) into a spec; walk it and play on its courts in My Park. Proves the generator, frames and phone frame rate on real geometry. **Build this first.**
- **Phase 1, Finder + generator (3-5 days):**
  - the index build script and GitHub Action, the US index first, then other regions
  - the Finder screen, the `/api/venues/:id` cache with its caps, the IndexedDB cache
  - outdoor + indoor + covered generation and furniture rules; attribution, Help topic, docs
  - Node tests (court detection on real samples, pens/banks, indoor detection, nav reachability, budgets) and a browser e2e (open Finder → venue → walk → play)
- **Phase 2, people (2-4 days):** per-venue instances on the server, court count from the spec, "N here now", Meet me from Messenger, drills with a friend, a server test for bytes per venue.
- **Phase 3, fidelity (3-5 days):** night lights and time of day (already in `sky.js`), weather from the Weather app (rain = indoor suggestion, wet look, wind flags), bleachers/shade structures from tags, terrain backdrop, regional court colours, ambient sound per venue type.
- **Phase 4, community (3-5 days):** suggestions/overrides with caps and moderation, "Add a missing venue", Delete My Account eraser, Help privacy topics.

## 5. Risks and mitigations

- **Coverage gaps / mis-tagging:** many tennis courts with pickleball lines are tagged `tennis` only, and indoor venues are under-tagged (10 `indoor=yes` in the US). Mitigations: the 2-per-tennis-court rule for `tennis;pickleball`; Add-a-venue; edit suggestions; nudges to fix OSM.
- **Unnamed courts (98%):** naming from enclosing areas, Overture, then a road-based fallback; users can suggest names.
- **Private clubs (about 10% in CA):** show them with a badge; a game visit isn't trespassing, but keep branding out.
- **Phone performance at huge venues:** the live-court cap, virtual courts, LOD crowd and budgets above; measure on the real iPhone in Phase 0 (My Park itself hasn't been phone-tested yet).
- **Overpass load or downtime:** server-side cache, a serial queue, 429 back-off, a fallback instance (private.coffee / VK Maps list "no limit"), and stale-while-revalidate for cached specs. The index is static, so search never depends on Overpass.
- **Render 5 GB / Atlas 512 MB:** specs ~10 KB, capped at ~25 MB in Atlas; positions as today (~18-31 KB/min per walking person) under the existing meter.
- **Legal:** OSM/ODbL only, attribution everywhere, no scraping of court-finder sites or Google.

## 6. Open questions for the owner

1. Which 2-3 favorite venues should Phase 0 build first (name or address)? Indoor or outdoor?
2. Is a real map in the Finder worth ~250 KB lazy-loaded, or is a "Near me / Search / Favorites" list enough?
3. Should venue rooms be friends-only by default, or open to anyone at that venue (strangers walking around)?
4. Should regulars (computer players) populate real venues, or only when no people are there?
5. Who approves edit suggestions: you (an admin list), or automatic after 2 matching suggestions?
6. US first, or worldwide from day one (the index grows to roughly 500 KB gzip for the world)?

## Sources
- Overpass API and its usage policy: https://wiki.openstreetmap.org/wiki/Overpass_API
- ODbL Produced Work vs Derivative Database: https://osmfoundation.org/wiki/Licence/Attribution_Guidelines, https://wiki.openstreetmap.org/wiki/Open_Data_License/Use_Cases
- Overture licensing: https://docs.overturemaps.org/attribution/, https://docs.overturemaps.org/guides/places/
- Places2Play (terms prohibit storing or scraping its data): https://www.places2play.org/search
- Google Maps Platform service terms (caching limits): https://cloud.google.com/maps-platform/terms/maps-service-terms
- Mapillary licence: https://en.wikipedia.org/wiki/Mapillary, https://www.mapillary.com/osm
- Esri World Imagery terms: https://www.esri.com/en-us/legal/terms/web-site-service, https://wiki.openstreetmap.org/wiki/Esri
- Terrain Tiles (Mapzen/AWS): https://registry.opendata.aws/terrain-tiles/
- Nominatim usage policy: https://operations.osmfoundation.org/policies/nominatim/
- OpenFreeMap: https://simonwillison.net/2024/Sep/28/openfreemap/
- Measurements: Overpass queries run 2026-10-05 (OSM base 2026-10-06T02:01Z); scripts were in the session scratchpad `venues/`.
