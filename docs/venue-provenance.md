# Venue provenance: where everything at the real venues comes from

The owner's rule (2026-10-06): "Don't add stuff that you are not aware of. If you want to add stuff in the background, add stuff that is actually there, that you can see on the map. If you don't know, don't put it."

So every object outside a venue's buildings has a source, and nothing is drawn to fill the view. This file lists the sources per venue, what was removed for being made up, what real things replaced it, and the interior guesses that still need the owner (at the end).

## Sources

| Tag | What it means | Where it lives |
|---|---|---|
| **OSM** | OpenStreetMap (ODbL), fetched by `tools/venues/fetch-osm.mjs` (the walkable crop) and `fetch-surround.mjs` (out to 500 m) | `tools/venues/osm/<id>.json`, `<id>.surround.json` |
| **Aerial** | traced on Esri World Imagery z20 tiles (reference only, never shipped) from the reference pack | `overrides/<id>.json` (`en` points), `<id>.refs.json` |
| **Canopy** | trees found by segmenting the aerial's tree canopy (`ingest-refs.mjs`; small crowns = palms) | `overrides/<id>.refs.json` `trees.add` |
| **Photo/video** | club photos, tour and drone videos, social clips noted in the reference pack's `details.json` / `floorplan.json` | reference pack (scratchpad, not committed) |
| **Terrain** | AWS Open Data Terrain Tiles (terrarium; USGS 3DEP, SRTM, GMTED, ETOPO1), by `tools/venues/horizon.py` | `tools/venues/horizon/<id>.json` |
| **GUESS** | inferred, not seen. Only kept for room layouts inside real buildings (listed below as owner questions) | |

## How it's drawn

- **The crop** (courts, fences, buildings, lots, trees within ~85 m of the courts): `build-venues.mjs` → `venues/<id>.json` → `venuegen.js` / `scenery.js`.
- **Surroundings** (`spec.surround`, `tools/venues/surround.mjs` → `park/surround.js`). These are OSM objects outside the crop, out to 450 m. The park's fog is solid at about 390 m.
  - **Buildings:** plain blocks at their mapped `height`, else `building:levels` × 3.2 m + 0.6. If neither is mapped, a modest default by type (house 5 m, garage 3 m, yes 5 m…), flagged `g: 1` in the spec.
  - **Rail bridges:** a deck on columns at 9 m (OSM has no bridge heights; SMASH's reference pack measured about 9 m).
  - **Far ground:** golf (course, greens, tees, bunkers), parks, woods, scrub, water and the big roads are painted into the far ground disc's texture (512 px on Low, 1024 otherwise).
  - **Trees:** mapped single trees and tree rows (one every 8 m along a row). Woods are drawn as flat dark-green ground, not as scattered trees.
- **Skyline** (`spec.horizon`, `tools/venues/horizon.py` → `park/horizon.js`).
  - **Marching:** for every compass degree it marches 0.6–60 km over the terrain from the courts' middle, with an eye 1.7 m up, applying Earth curvature and refraction (k = 0.13).
  - **Bands:** it keeps each stretch that rises above everything nearer, as near (< 3 km), mid (3–12 km) and far land, plus open sea where the ray reaches the ocean unblocked.
  - **Drawing:** each band is drawn on a ring 318 m around the camera, just after the sky with no depth test. Haze grows with distance (36 km scale), and the nearest band fades into the far ground's haze at its foot.
  - **Daylight:** it follows the time of day (`setDayLook`: haze takes the fog color, the land darkens at night) and the eye's height.
- **Venue Finder** (any OSM venue): OSM objects plus court basics only (courts, fences, lights where tagged, benches beside the courts). The default ring of 24 scattered trees is gone. Venue Finder has no surround or skyline yet; its `backdrop` is `{}`.
- **Riverside Park** is the fictional home park, not a real place. Its rolling hills (`build.js`) stay, because nothing there claims to be real.

## Removed for being made up (2026-10-06)

- **All seven venues:**
  - The scattered backdrop: 9 random hills, 7 mountain cones, a 40-box "skyline", rings of 14–30 palms and 18–34 trees, all placed by a random generator (`scenery.js`, `overrides/*.json` `backdrop`). Venue Finder venues got 24 of those trees by default.
  - The splat **Demo backdrop** (`splat/synth.js`: generated hills, trees and stucco blocks). A demo saved on a drive before is ignored now (`store.js listBackdrops`). Real captures and imports still work.
- **Newport:** the `golf` extra (6 random green mounds and 5 random bunkers) and the `ocean` extra (a blue disc 520 m out at 135°). The real golf course (OSM greens, tees and bunkers) and the real sea (terrain) replace them.
- **SMASH:** the hand-placed straight viaduct. OSM's two Metro C/K line bridge tracks replace it, at their real curve.
- **Whittier Narrows:** a 113 × 5 m, 5 m tall "industrial building" east of the tennis rows. The aerial shows a concrete service drive with a van parked on it, now paved.
- **Wolf + Bear:**
  - The west block drew its parking lot (cars in the aerial) as a 7 m building. It's now the studio strip plus the block west of the lot.
  - A 30 m graffiti mural on the Calvert St wall and a navy awning over the entrance: neither is in any photo. The entrance photo shows the banner over the brown "14911" doors, and the banner stays.

- **Newport (2026-10-07, the owner's "bench during the game"):** a bench 0.23 m off Court 43's sideline by its kitchen and a paddle wait board in the 4.2 m between the back-to-back baselines of Courts 35 and 43. Neither had a source; both are gone. `venues.test.js` "live courts are clear" keeps every live court's sidelines (0.3 m) and baselines (1 m) clear at every venue.
- **Every real venue's match view:** the umpire's chair by the net post (a stadium thing; no real court here has one).

## Per venue

Courts, nets, fences, light poles and court paint come from OSM plus the aerial and the club's photos at every venue (`docs/venue-realism.md`). The tables cover everything else outside.

### Los Cab Sports Village (Fountain Valley)

| Object class | Source |
|---|---|
| 35 buildings (clubhouse wings, sports buildings, neighbours) | OSM, mapped heights; roles from aerial and photos |
| Bell tower (15 m) | Photo/video (tour #6/#15) + aerial shadow |
| Maroon awnings | Photo/video |
| Stands | Photo/video |
| 420 trees | Canopy |
| Pools, cabana tents, lots | Aerial + photos |
| Surround: 193 buildings (9 with a default height), 58 areas, 34 roads | OSM |
| Skyline: the Santa Ana Mountains east (up to 2.5°), the Puente Hills and San Gabriels north; flat to the west | Terrain |

### The Tennis & Pickleball Club at Newport Beach

| Object class | Source |
|---|---|
| 11 OSM buildings | OSM |
| Clubhouse (green hip roof), lounge/terrace building, courtside restrooms cottage, small shed by the lot | Aerial: all four checked against the z20 aerial (the cottage is also OSM 1550655719) |
| Cupola tower, green awning | Photo/video (clubhouse) |
| Navy sail over the terrace | Aerial (visible) |
| Solar roof | Aerial (panels visible) |
| Stepped green bleachers | Photo/video |
| 260 trees | Canopy |
| Surround: 102 buildings (21 default height), 125 areas (the Newport Beach Country Club course: greens, tees, bunkers; no fairways are mapped), 68 roads, 209 mapped trees | OSM |
| Skyline: the sea from 164° to 281°, Catalina Island on it (230–250°, 52–59 km), the San Joaquin Hills | Terrain |

### Wolf + Bear Indoor Pickleball (Van Nuys)

| Object class | Source |
|---|---|
| Stage 4 and Stage 5 halls (the main and second halls) | Photo/video + aerial |
| Championship court and M24 rooms (in the south strip) | Photo/video; M24's position is GUESS (owner question) |
| West studio block + south strip | Aerial (corrected) |
| 12 neighbour buildings | OSM |
| 4 tree rows (Metro G Line busway corridor ×2, Calvert St north side, two street trees) | Aerial (rows placed by hand along visible trees) |
| Club banner over the "14911" doors | Photo |
| Surround: 410 buildings (3 default height), 20 roads, 44 trees | OSM |
| Skyline: the Santa Monica Mountains south, the San Gabriels and Verdugos north and north-east (up to 3.2°), the Santa Susanas north-west | Terrain |

### iPickle Whittier Narrows (South El Monte)

| Object class | Source |
|---|---|
| 16 OSM buildings (industrial park east, restroom hexagon, bunkers) | OSM |
| Clubhouse / pro shop | Aerial + photo/video |
| Warehouse east of the lawn (32 × 38 m) | Aerial (checked) |
| Canopies (white and lilac shades) | Photo/video |
| Service drive (paved) | Aerial |
| 252 trees | Canopy (plus 9 placed from photos) |
| Surround: 104 buildings (2 default height), 19 areas, 13 roads | OSM |
| Skyline: the San Gabriel Mountains north (up to 4.6°, 20–25 km), the Puente Hills south-east, the Montebello Hills west | Terrain |

### The Paseo Club (Valencia)

| Object class | Source |
|---|---|
| Main clubhouse, north wing (OSM 472562070), the building east of the pool (OSM 472562076), south wing | OSM + aerial (the south wing was GUESS in the pack; the aerial shows it) |
| 8 OSM buildings (school, retail) | OSM |
| Stadium steps / stands, cabanas, pavilions with sails, gazebo | Photo/video (tour) + aerial |
| 225 trees | Canopy |
| Surround: 119 buildings (all with mapped heights), 32 areas, 21 roads, 49 trees | OSM |
| Skyline: the hills of Valencia and the Santa Susana / San Gabriel ranges all round (up to 4.6°) | Terrain |

### Sinaloa Middle School (Simi Valley)

| Object class | Source |
|---|---|
| 34 school buildings | OSM (named, with heights) |
| 4 teal-roofed portables | Aerial (traced) |
| Covered walkway (white canopies) | Aerial + photo |
| Solar carports | Aerial |
| Cypress row west of the courts | Aerial (approximate; the row of trees along the slab) |
| 371 trees | Canopy |
| Surround: 293 houses (no heights mapped: 5 m default, flagged), 31 areas, 6 roads | OSM |
| Skyline: the Santa Susana Mountains and Simi Hills (up to 5.2°) | Terrain |

### California SMASH (El Segundo)

| Object class | Source |
|---|---|
| Club building, neighbour 821/825 Nash | OSM + aerial |
| Murals, living wall, lounge spine (inside) | Photo/video (drone fly-through, club tour) |
| Palm row (east side), street trees on Maple | Aerial + photo (rows) |
| Metro C/K line viaduct | OSM (bridge=yes light_rail, both tracks) |
| Surround: 84 buildings (4 default height), 57 roads (the 105 freeway ramps, Nash, Maple) | OSM |
| Skyline: flat coastal plain; the Palos Verdes hills south, the Santa Monica Mountains north, the Baldwin Hills and San Gabriels north-east (up to 2.1°) | Terrain |

### Bouquet Canyon Park (Santa Clarita) (2026-10-07)

A City of Santa Clarita park at 28127 Wellston Dr, Saugus, next to Bouquet Canyon Elementary. The city lists **8 outdoor pickleball courts** (santaclarita.gov, Adult Sports > Pickleball); its older park listing (film.santaclarita.gov) has a "lighted tennis court", which is what the courts were.

| Object class | Source |
|---|---|
| 8 pickleball courts in one fenced pen, two rows of four, long axis at bearing 170.4 | **Aerial** (Esri z20): four courts on each of the two old tennis courts, 8.9 m apart in each, 9.25 m across the middle, rows 18 m apart. OSM maps the two old courts as two 37 x 18.5 m "pickleball" pitches (751797805/6); the eight sit within 3 m of them |
| Court colors (blue court and kitchen, grey-green surround), black fence | Aerial (sampled, lifted out of its haze by eye) |
| Basketball court, restroom building (4.2 m), playground, the lot, five picnic tables, two bleachers by the softball field | OSM |
| 177 trees (88 small crowns drawn as conifers) | Canopy (segmented off the z19 aerial: dark green, not grass) |
| Surround: 257 buildings (houses and the school, OSM heights; 1 default), parks/pitches | OSM |
| Skyline: the hills north of Saugus up to 8.2 deg (the highest of the eight venues), the Santa Clarita valley round | Terrain |

**Not drawn:** court lights (none show in the aerial, where the softball field's poles do, and OSM has no `lit`; so no night games there), dividers between the courts (none clear in the aerial), and nothing by rule: no benches, bleachers by the courts or pro-shop kiosk (`fence.benches/bleachers/booth: false`). The softball diamond and its light poles aren't drawn (not mapped as such; the pitch is a flat area).

**Owner questions:** do the courts have lights now? Are there benches or a wait board by the gate (where)? Any windscreens?

## Interiors: the GUESS layouts (kept, need the owner)

These rooms are inside real buildings and are furnished from tour videos and photos. Which room sits where inside each building is a guess. Their contents are reasonably sourced.

**Questions for the owner** (one line each; an answer moves the room or confirms it):

- **Newport:**
  - Where are the pro shop, front desk and executive offices inside the clubhouse? We have them at the west end.
  - Are the restrooms and locker rooms in the lounge building (where we have them) or somewhere else?
  - Is there really a rooftop terrace bar on the lounge building?
- **Paseo Club:**
  - Which building holds what? We guessed the fitness floor, spin, group fitness, reformer Pilates, spa, both locker rooms (sauna and steam), the pro shop, the kids club and the cafe/bar.
  - What's upstairs (we put cardio up the stairs)?
- **Whittier Narrows:** inside the clubhouse, where are the pro shop/desk, the restrooms and the snack window? Is the fire-pit lounge east of the clubhouse?
- **Wolf + Bear:**
  - Which unit is the private court M24? We put it in the south strip west of the championship court.
  - Where are the entry and check-in (NE corner by the lot?), the spectator strip (which side), the restrooms and the pro shop/towel corner?
  - Is the second hall Stage 5?
- **SMASH:**
  - Where are the lobby and front desk, the pro shop "Gear Up", the kitchen, the restrooms with the podcast studio, and the stair up to the VIP mezzanine?
  - Is the outdoor patio at the SE corner?
- **Los Cab:**
  - Which building holds what? We guessed the front desk, membership office, lounge/billiards, cafe, locker rooms, fitness, group studios, racquetball, indoor gym, kids club, salon and spa.
  - Where is the jacuzzi?
  - Where are the stairs and elevator to the ballroom?
  - Where are the Timeless Venues lawn and hall, and the tennis courtyard cabanas?
- **Sinaloa:** is the shaded seating along the covered walkway right?

Also open:
- SMASH: Court 9's east baseline is 0.3 m from the pro shop's wall (the courts are traced; the rooms' line is a guess). A match at SMASH plays on Court 8 (`play/courtpick.js`: a clear camera). Is there a wall right there?
- Wolf + Bear: the streamed court's spectator walk starts 0.05 m off its sideline (the rail is now 0.35 m off). How much room is there really?
- Whittier: which two tennis courts carry pickleball lines? Shared use is a guess.
- Sinaloa: the cypress row's exact line.

## Refreshing the data

```
node tools/venues/fetch-surround.mjs [id ...]   # polite Overpass: 25 s apart, back-off on 429/504
python tools/venues/horizon.py [id ...]         # terrain tiles cached in tools/venues/horizon/.tiles (ignored)
node tools/venues/build-venues.mjs [id ...]
```

Tests: `node --test client/src/components/applets/pickleball/park/venues.test.js`. The test "venue truth: nothing invented behind a real venue" checks for:
- no backdrop or golf/ocean extras;
- a 360° skyline with its source;
- OSM surroundings;
- Newport's sea to the south-west;
- the San Gabriels north of Whittier;
- Newport's real golf features;
- SMASH's OSM viaduct.

Specs grew by about 25–45 KB each (lazy-loaded, about a quarter of that gzipped; the size cap is now 96 KB).
