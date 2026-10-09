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

Los Cab's ballroom balcony (2026-10-08): no new objects; its railing now opens at the ballroom's two glass doors (it ran across them) and the clubhouse wall opens there at that floor.

#### Los Cab, fidelity round (2026-10-08): the owner's seven photos

Sources: `refs/loscab/owner/` (photos 1-7; from "/10" carousels), the pack's z20 aerial, a z18 aerial for the surroundings (`refs/loscab/wide/`), OSM. The oblique drone photo (7) solved from 16 court corners at 2.4 px rms (`refs/loscab/points.json`); photos 1 and 2 by hand poses in `photos.json` (too few clear features). Positions as en (m east, north of the pack's anchor).

| Object | Built | Method, uncertainty | Source |
|---|---|---|---|
| Partitions | low partitions between the pairs of courts in the village's two blocks, none inside a pair: 14 (2 in the west block, 12 in the east), from the pen's fence at a row's outer end to 1 m past the baselines on the centre aisle | Rule `fence.pairDividers`: between side-by-side neighbours whose sidelines are more than 2.8 m apart (pairs stand 2.0-2.2 m apart, pairs 3.3-4.9 m); checked court by court against drone photo 7 (partitions between 32 / 44, 52 / 62; none in 44 / 52 or 62 / 70) | Owner photo 7 |
| Partition build | 1.2 m to the top of a thick green cap (`#2e7a57`), black mesh, galvanized posts ~2.5 m apart, a green-painted concrete curb 0.28 m along the foot | Photo 1: the curb ~0.28 m (owner); the people beside the fence give 1.0-1.5 m to the cap (±0.2 m); colours from photos 1 and 7 | Owner photos 1, 2 |
| Before | 3 m windscreened fences round both blocks and 0.9 m screens between every pair of neighbours (33) | | |
| Village perimeter | the same low fence on the north side (along the deck) and at both blocks' ends on the cross-walkway; the other sides keep the pack's 3 m black chain-link with windscreens to 2.2 m | Photos 1, 2 (looking over a low fence from the deck), 7 (a low fence with banners at the walkway); photos 2 and 4 show tall black screens by the white building and the tennis court | Owner photos |
| Centre aisle | a black portable net barrier (~0.9 m) on white posts along the aisle between the two rows, one per block | Drone photo 7 (posts with white feet along the aisle), night photo 5 | Owner photos 5, 7 |
| Light poles | 86 white poles: one in every gap between side-by-side courts and outside each row's end courts, two along each gap 4.5 m from the row's middle, a T arm along the gap with two flat LED heads (8.5 m, the pack's estimate, unmeasured) | Drone photo 7 (poles stand in the green between courts near the kitchen lines), photos 2, 3, 5 (T arms, two flat heads). Before: 51 double-head poles round the blocks' outsides every 9 m | Owner photos |
| Cross-walkway | painted dark blue `#26386e`, x 21.9..27.3 | Drone photo 7, photo 4 | Owner photos |
| Spectator deck | a wood deck 3.1 m up along the village's north side, x 20..48.9, n 67.3..70.3: planks, a brown fascia, black posts every 3.6 m, a black vertical-bar railing; walkable | The aerial's brown strip (x 20..49, n 66.2..69.3, set 1 m north to clear the village's fence); height from photo 1 (the people under it: 2.6-3.4 m); look from photos 1, 2, 6 | Aerial + owner photos |
| Deck stairs | open steel stairs (black stringers, wood treads, black rails) rising east to the deck's west end, x 14.3..20 at n 68.8 | Photo 1 (they rise east along the deck); the spot is the aerial's lighter landing at x 18-22: **GUESS** within a few metres | Owner photo + aerial |
| Tennis pens' south fence | 4.0 m behind the tennis baselines (n ~70.3), was 6 m by rule (it ran across the deck) | Aerial (the fence line south of the tennis row) | Aerial |
| The white building's court side | plain white (`#ecebe6`), no windows (was beige with mission windows) | Photos 2, 5, 7 | Owner photos |
| Sign | "LOS CABALLEROS SPORTS VILLAGE" in red serif capitals (~0.6 m letters, ~12 m long) high on that wall's west end, facing the courts: our own rendering of the venue's name | Photos 2 and 5 (letter height and length read off photo 5, ±30%) | Owner photos |
| Freeway overpass | the Warner Ave and Harbor Blvd bridges (OSM `bridge=yes`) as decks with parapets on piers, 6.5 m a layer (a flagged default: OSM has no clearance) | OSM; photo 2 sees the overpass behind the trees | OSM + owner photo |
| Power lines | the 66 kV lines along the Santa Ana River and into the substation east of the channel (OSM `power=line`, `tools/venues/osm/loscab.power.json`): a pole with a cross-arm at every mapped vertex, three sagging wires; 20 m (a flagged default) | OSM; photo 2 sees lines and a tower behind the courts | OSM + owner photo |
| Surroundings' roofs | 189 of the 193 OSM buildings get their roof colour off the z18 aerial; 118 (the houses north of Warner) hip roofs, the industrial blocks flat | `surround-roofs.py` (as at Bouquet) | Aerial + OSM |

Not changed: trees (the canopy's 420: palms by default, as the photos show palms and eucalyptus round the village; the eucalyptus aren't told apart yet), courts and colours (photo 7's dark blue `#2f5284` / kitchen `#5292dc` / green `#587654` agree with the pack's albedo within the overcast light).

**Owner questions (Los Cab, 2026-10-08):**
- The rest of the "/10" carousels, especially a photo of the stairs from further back (where along the deck are they?) and one along the south side by the white building.
- How tall are the low partitions to the top of the green cap (we have 1.2 m) and how tall are the light poles (8.5 m)?
- Does the deck run the whole north side of the east block or stop near x 49 (as the aerial's brown strip does)? Is the lighter strip west of it (x -3..20) a walkway on the ground?
- Do the white tube dividers between the south pod's courts still stand (the pack saw them; no new photo shows the pod)?
- Is the centre aisle's net barrier there every day or only at events (photo 7 is a tournament)?

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
| Chamfered pen corners (1.8 m legs, `fence.chamfer`) | Aerial (every pen's corners cut at 45 degrees; the pack: "45-degree cut corners on every pen") (2026-10-08) |
| 252 trees | Canopy (plus 9 placed from photos) |
| Surround: 104 buildings (2 default height), 19 areas, 13 roads | OSM |
| Skyline: the San Gabriel Mountains north (up to 4.6°, 20–25 km), the Puente Hills south-east, the Montebello Hills west | Terrain |

### The Paseo Club (Valencia)

| Object class | Source |
|---|---|
| Main clubhouse, north wing (OSM 472562070), the building east of the pool (OSM 472562076), south wing | OSM + aerial (the south wing was GUESS in the pack; the aerial shows it) |
| Clubhouse footprint: one L (2026-10-08) | OSM 472562074's main block (west jogs, the NW notch, the recessed porch on the east side) + the south arm's tile wing as the aerial shows it (e 10..17, n 15..28.6). OSM's outline also takes in the patio and the pergola south of the arm, which the aerial shows open |
| Clubhouse roofs: the long main hip (9 m), the lower west wing, the small NW part, the south arm's hip, a 10 m gable front over the entrance | Aerial (roof planes and ridges) + tour 0:12 (the taller gable over the door). Heights: OSM 9.0 m for the building; the parts' split is read off the aerial |
| North building: a U round a paved court open to the south | OSM 472562070 + aerial (it was one rectangle) |
| Main entrance (dark wood doors) on the fountain walk, the tiered fountain just before it, the gated cream stucco wall across the courtyard (n 14.6) | Tour 0:04 and 0:12 (gate on the walk's axis, the fountain a few metres before the doors) + aerial (the wall's line, the courtyard's trees) |
| Slatted pergola (e 17.6..21, n 11..23.4) and a small tile-roofed ramada beside it | Aerial (light slats; a small red tile roof). Their posts are by rule (one every 3.5 m) |
| Paved patio south of the clubhouse | Aerial |
| The club's lot west of the courts, its stall rows, 60 % full | Aerial (rows traced) + tour 0:00 (the drone shows it about that full). OSM maps only its aisles (889992214/5, 623455853) |
| Angled stalls in the club's lot (2026-10-08): the long middle double row leans 15 degrees, the short west row 18 degrees the other way, the curb row along the courts 14 degrees; the other six rows stay square | Aerial, measured two independent ways on `refs/paseo/aerial.jpg` (scratchpad `paseo/angles.py`: the dominant edge direction of the cars in each row's stall band; `paseo/cars.py`: the long axis of each white car's blob). Only rows where both agree within about 5 degrees lean (middle row 101-109 vs 104-110, west row 68 vs 76, curb row 78 vs 71-81 degrees from the row line); rows where they disagree or the cars are too few stay square. Override `angle` on the row -> spec `k`, `scenery.js rowStalls` |
| The north-east lot by the clubhouse (2026-10-08): the paved lot between the club's lot's driveway and the clubhouse, north of the courts, six stall rows (the angled pair by the north-east edge, three facing south, the east edge, both sides of the planter island, the row along the courts), 60 % full | Aerial (outline and rows traced at full resolution, `paseo/ne_trace.py`; about 20 cars on ~33 stalls, the same share as the club's lot); OSM's aisle loop through it (889992215) is the road already drawn. The rows measured square (83-90 degrees). The spawn's 12 m keeps cars off the arrival |
| Scrub of the wash east of the trail | Aerial + tour 0:00 (the river wash's chaparral and riparian trees), drawn as flat ground like the surround's woods |
| Chamfered pen corners (2.5 m legs) | Aerial + tour 1:28-2:16 (the pack: "chain-link + chamfered pens") |
| No pro-shop kiosk (`fence.booth: false`) | The club's pro shop is a room in the clubhouse (tour 6:18); the rule's kiosk by the arrival had no source |
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
| Cypress row west of the courts | Aerial (the row of trees along the slab's west fence; moved 5.6 m east onto it on 2026-10-08, it had stood on the dirt path) |
| 278 trees | Canopy (2026-10-08: the field north of the slab and the lawn of the north courtyard cleared: the tree finder had read open grass as a 6 m grid of trees; the photo from court 2 sees the field and the hills) |
| One school lot (OSM 1292473661), three stall rows, a quarter of its 141 stalls taken (2026-10-08) | OSM (the lot and its two parking aisles 644908998/644909001) + aerial z19 (a double row with a planter strip between the aisles, one row south of the middle aisle, the grass island). Occupancy: our choice for when people play there (after school, weekends); the school-day aerial shows about 50 cars. Before: OSM's two overlapping lots and a hand-drawn one each laid their own stalls (433 stalls, about 215 cars) |
| No windscreens, no pro-shop kiosk | Photos (bare galvanized chain-link) + the pack ("looks wrong: windscreens"); the kiosk stood in the lot by rule |
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

| Court lights, benches, the paddle wait board, windscreens on the pen fence | **Owner** (2026-10-07: "courts are lit at night", "there are benches and a wait board", windscreens yes). Their exact spots aren't mapped or resolved in the aerial: light poles stand by rule along the pen's long sides, benches by rule outside the pen (clear of the gates and racks), the wait board outside the east fence on the lot side (approximate) |

**Not drawn:** bleachers by the courts and a pro-shop kiosk (`fence.bleachers/booth: false`). The softball diamond and its light poles aren't drawn (not mapped as such; the pitch is a flat area).

**Owner questions (answered 2026-10-07):** lights yes, benches and a wait board yes, windscreens yes.

#### Bouquet, fidelity round (2026-10-08): the owner's two photos

Sources: `refs/bouquet/owner/` (the owner's wide shot from behind court 5 and the partition shot, the first of a 7-photo carousel), a z20 Esri aerial fetched for the pack (`refs/bouquet/aerial.jpg`, 200 x 160 m) and a z18 one for the surroundings (`refs/bouquet/wide/`), USGS 3DEP terrain. Poses solved with `compare.mjs solve` (`refs/bouquet/points.json`): the wide shot from 11 court features at 4.9 px rms (camera 1.7 m up, 102 degrees across), the partition shot from 7 (two court corners, two net posts each on two courts, the partition's west end) at 8.4 px. Measurements in the solved views by back-projecting pixels onto the ground and up vertical lines (scratchpad `meas.py`); "s" runs across the courts (east), "t" along them (south), from the courts' middle.

| Object | Measured | Method, uncertainty | Source |
|---|---|---|---|
| The pen | 36.6 x 36.6 m (a standard 120 x 120 ft double tennis enclosure): 1.71 m beside the outer sidelines, 2.62 m behind the baselines | The court-aligned aerial: the windscreens' shadows fall north-west, so the west and north fences are the dark bands' inner edges, the south and east their outer edges (s -19.6..17.2, t -21.1..~15); the wide shot's fence foot projects to s -19.5 (±0.3 m). Before: 3.8 / 3.9 m all round, by rule | Aerial + owner photo |
| Perimeter fence | 3.65 m (12 ft) chain-link; black windscreen from 0.15 to 3.0 m on the west, north and south sides; galvanized posts ~3 m apart | Wide shot, the west fence 9.8 m out: top 3.65 m, screen top 3.03 m, screen foot 0.14 m (±0.15 m; the far-left edge of an ultra-wide frame reads 3.3/2.9); the north-west corner's 3.66 m top projects onto the photo's corner within 3 px | Owner photo |
| East side | the same height, bare chain-link (a mid rail) | The wide shot sees the parked car in the lot through it; the aerial's east band is thin | Owner photo + aerial |
| Partitions | a cross: one across the pen between the two rows (t -2.93, west fence to east fence), one down its middle between the two old tennis courts (s -1.26: courts 2 / 3 and 6 / 7). None between the two courts of one old tennis court | Both photos show the cross partition; the aerial shows both lines; the wide shot sees a fence on the middle line (its foot projects to s -2.5 at 15 m) and none between courts 5 and 6 | Owner photos + aerial |
| Partition build | 1.52 m (5 ft) to the top rail, a mid rail at ~0.8 m, a bottom rail; black vinyl mesh; galvanized posts ~0.09 m every ~3 m | Partition shot: 1.57 m top rail and 0.84 m mid rail at the second post (2 m from the camera); the wide shot's ratio to the rows gives 1.45-1.67 m; post feet project onto t -2.82 / -2.86 (the line is at -2.93) without being fitted. ±0.15 m. The caller's first reading was ~1.2 m against the nets | Owner photos |
| Light poles | single shoebox heads on ~8 m galvanized poles along the west and east fences, one every 6.1 m | Heads fitted on the fence lines: 7.8 m at t -10, 8.3 m at t -4.3 (west), one on the east fence at t -16; the 6.1 m rule puts poles within 1 m of all three. Count between them is the rule's (14) | Owner photo |
| Shade alcove | a light flat metal roof (~3.2 m) on dark posts over a 2.8 x 6.4 m alcove off the west fence where the cross partition ends; the pen's fence opens into it; a blue bench and a dark one under it, facing the courts | Aerial (a dark box s -22.4..-19.6, t -7..-0.6) + partition shot (no screen across the opening, the benches at the fence line, the roof near the fence top) | Aerial + owner photo |
| Benches | only those two (the rule's benches round the pen are gone) | Partition shot | Owner photo |
| Colours | courts and kitchens one blue `#3f72a8`, surround `#80957a`, galvanized `#8e9592`, screens `#1c1f1e` | The sunlit bright mode of each paint's hue class in both photos (scratchpad `hues.py`), between the evening wide shot and the overexposed midday one; the aerial's hazy `#46668a` / `#5f6e5c` read too dark and grey | Owner photos |
| Pines | the 132 canopy trees west of the lot are Aleppo-type pines (a new `pine` kind: a tall leaning trunk bare for half its height, upswept limbs, the crown in dark clumps, ~13 m); the trees east of the lot stay broad-leaf | Both photos: pines on the north, west and south, about twice the poles' height; broad-leaf trees beyond the lot on the right | Owner photos + canopy |
| Hillside | the hills round the park from the USGS 3DEP terrain (`tools/venues/terrain.py`: a 15 m grid to 450 m, -12 to +80 m); the far ground is lifted onto it (flat under the walkable crop, blended over 25 m), its base colour the hillside's dry grass `#a8986a` | Terrain tiles; colour from the wide shot's hillside (the aerial is a green-season one) | Terrain + owner photo |
| Houses round the park | 257 OSM buildings (256 with mapped heights): 170 hip roofs and 87 flat, each roof's colour read off the z18 aerial | `tools/venues/surround-roofs.py`: a footprint's two halves along its long axis differ by more than 9 (0-255) in brightness = two slopes = hip (under 1,500 m2); rise 5:12 over its width, at most 3 m; colour the footprint's median. OSM's height is the ridge | Aerial + OSM |

**Owner questions (Bouquet, 2026-10-08):**
- The other six photos of the carousel ("1 of 7"): a shot of the east side and the lot, and one from the north fence looking south, would settle the south fence's screen and the poles' count.
- Is the partition down the middle (between courts 2 / 3 and 6 / 7) really there, full length? The photos see it only from 15 m away.
- How many light poles, and do the east ones match the west ones? (We have one every 6.1 m on both long sides.)
- Is the south fence windscreened like the west and north (no photo sees it)? Does the alcove hold just the two benches?
- Where do the wait board and the gates stand? (The wait board is still approximate, outside the east fence.)

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
- **Paseo Club (2026-10-08):** which room is where in the new L (we put the lobby inside the entrance on the fountain walk, the pro shop in the south arm, the kids club by the pool porch)? Is the small tile roof in the south courtyard open (a ramada) or a room? (The NE lot by the clubhouse is drawn now, from the aerial: a parking lot with six stall rows. Is it members' or staff parking?)
- **Whittier (2026-10-08):** which court is "1"? A photo shows cards 1 and 3 on neighbouring net posts of one row; we assumed the south-east pen's south row (1 = PB16).
- **Wolf + Bear (2026-10-08):** a photo from behind a court's baseline in the main hall shows a wall close on the left and cards 12 and 14 on the far wall over that court and the next one: our 2x5 has 12 and 14 in the middle and south rows of the east column. Which way do the numbers run, and how much room is behind the baselines (the photo's camera stands about 1 m behind our west wall)?

Also open:
- SMASH: Court 9's east baseline is 0.3 m from the pro shop's wall (the courts are traced; the rooms' line is a guess). A match at SMASH plays on Court 8 (`play/courtpick.js`: a clear camera). Is there a wall right there?
- Wolf + Bear: the streamed court's spectator walk starts 0.05 m off its sideline (the rail is now 0.35 m off). How much room is there really?
- Whittier: which two tennis courts carry pickleball lines? Shared use is a guess.
- Sinaloa: the cypress row's exact line.

## Refreshing the data

```
node tools/venues/fetch-surround.mjs [id ...]   # polite Overpass: 25 s apart, back-off on 429/504
python tools/venues/horizon.py [id ...]         # terrain tiles cached in tools/venues/horizon/.tiles (ignored)
python tools/venues/terrain.py <id>             # the ground's shape to 450 m (venues with terrain: true)
python tools/venues/surround-roofs.py <id> <refs>/<id>/wide   # roofs off a z18 aerial (refs/tools/tiles.py ... 960 960 18)
node tools/venues/build-venues.mjs [id ...]
```

Los Cab's power lines (`osm/loscab.power.json`) came from one Overpass query (`way[power=line]` and poles within 700 m, 2026-10-08).

Tests: `node --test client/src/components/applets/pickleball/park/venues.test.js`. The test "venue truth: nothing invented behind a real venue" checks for:
- no backdrop or golf/ocean extras;
- a 360° skyline with its source;
- OSM surroundings;
- Newport's sea to the south-west;
- the San Gabriels north of Whittier;
- Newport's real golf features;
- SMASH's OSM viaduct.

Specs grew by about 25–45 KB each (lazy-loaded, about a quarter of that gzipped; the size cap is now 96 KB).
