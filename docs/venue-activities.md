# My Park activities: tennis, hoops, the gym, the TV

The owner (2026-10-09): "Add like, other fun activities to do at each venue, like tennis at wherever tennis courts are, basketball at the indoor basketball at Los Cab. The ability to work out and make it like, fun where working out is a game... Ability to watch tv at the lobby/gym/wherever gym." Everything lives inside Pickleball 98 > My Park (the owner's rule: no separate pickleball programs), it's played mostly on iPhones, and **nothing is invented at a real venue**: an activity is offered only where the venue really has its place. Not yet tried on a real iPhone.

## What's where, and why (the sources)

`park/acts/spots.js` finds each activity's spot from the venue's own data; `ACT_SOURCES` lists the rooms and TVs and the source of each. A place without a source isn't offered (the owner questions are below and in `docs/venue-provenance.md`).

| Venue | Tennis | Hoops | Work out | Watch TV |
|---|---|---|---|---|
| Los Cab | 13 courts (OSM pitches, 4 with pickleball lines) | the indoor gym (the owner's word; the pack's floorplan "Indoor basketball / badminton gym", tour video #12-13, #60): one regulation court drawn in the middle of the room the pack puts it in | fitness centre (pack floorplan "Fitness centre (cardio + weights)", tour #2, #5, #18-24) | lobby (pack: "... beige walls, TV", tour #72-73); fitness centre (pack: "treadmill rows facing TVs": now drawn, `tvs: true`) |
| Newport | 12 courts (OSM) | none | none | none: the lounge's TV isn't in the pack (owner question) |
| Wolf + Bear | none | none | none | none |
| Whittier Narrows | 12 courts (OSM's tennis; the other 4 slabs it tags tennis are the pickleball courts) | none | none | under the shade roof (pack: "steel shade roof along the PB pens, couches and chairs, string lights, TV") |
| Paseo Club | 11 lit courts (OSM) | none: OSM's basketball pitch lies where the aerial shows the pickleball pen (owner question) | fitness floor and performance centre (OSM: The Paseo Club, leisure=fitness_centre, sport=...fitness...; pack: "Main fitness floor") | lobby (pack "... brochure racks, TV"), fitness floor (pack "treadmills/ellipticals facing windows, dark floor, TVs": drawn), cafe and bar (pack "bar counter, TVs") |
| Sinaloa | none | 8 outdoor courts (OSM pitches) | none (OSM's "Gym" is the school's building: not open to walk in) | none |
| SMASH | none | none | none | lobby video wall (pack "big video wall"), bar (pack "many TVs"), by the courts (pack "large TVs on columns along the spine") |
| Bouquet Canyon | none | 1 outdoor court (OSM pitch) | none | none |

Which room sits where inside a building is the reference packs' guess (as for every room: `docs/venue-provenance.md`, "Interiors"). Riverside (the made-up park) and Venue Finder venues: tennis and basketball where their map data has the courts (`spots.js` reads any spec's courts); no rooms.

## The way in

Walk up to it: the park's one context button (top right on a phone) says **Play tennis**, **Shoot hoops**, **Work out** or **Watch TV** (`world.js actionFor`: an activity's spot wins when it's nearer than the park's own thing there). It opens a small sheet: the 2-3 ways to play, a friend near you as one more ("Play Ava"), the rest under **More options »** (the computer's level; the quick set's move; Real workout). While one runs, the park HUD steps aside for the activity's (`acts/ActivityHud.jsx`): the score top left, **Leave** top right where the one button was, the move pad's zone along the bottom where a thumb rests (sideways: the left 42%), and the rest of the screen for the swipe or the beat. **Leave** puts you back where you started.

`world.js setActivity(run)`: `me.mode` "act"; the activity moves your player from your own move pad (nothing moves your player for you: tennis and hoops are both walked/run by hand), draws its things into the park's scene, holds the camera (`run.shot`), and drives bodies (`b.drive() -> { sit, frame, mood, gear, seat }` posed by anim.js like a match player). The park carries on round you. `acts/gear.js` puts a racket in the hand (tennis) or nothing (hoops, the gym, the TV). New anim.js moods: `shoot`, `dribble`, `squat`, `curl`, `press`, `row`, `jack`, `watch` (a rep's phase from the beat: `mood.p`).

## Tennis (`acts/tennis.js`, `acts/tennisRun.js`)

- **The ball and court:** a 57 g, 6.7 cm ball with drag (k 0.0203/m) and topspin lift (w x v), a hard-court bounce (75%, topspin kicks on), the net 0.914 m in the middle and 1.07 m at the posts with a tape you can clip, singles lines (23.77 x 8.23 m). A shot is solved (`planShot`: the launch angle by bisection, a little slower if it has to clear the net) to land where your swipe aims: within 20 cm in Node.
- **You:** run with the move pad (up is toward the net); **swipe up** to hit (`touchplay.js readSwipe`: the angle aims across, how far up goes deep or short, the swipe's speed is the pace). The swing is armed for 0.65 s: swipe a little early and the racket meets the ball when it's in reach (1.45 m to the side). Timing (armed about 0.28 s before is best), stretch and pace set your error; a fast incoming ball is harder to control. Serve: swipe up (the diagonal box; two faults lose the point; a let is replayed).
- **The game:** vs the computer, first to 4 games, no-ad (at 40-40 the next point wins), the serve changing with the game; **Rally challenge**: the computer feeds you, how many in a row. Levels (More options): Easy / Normal / Hard (speed 3.9 / 4.8 / 5.8 m/s, reaction 0.38 / 0.26 / 0.14 s, misses 14 / 7 / 3.5% a shot, aiming nearer the lines and deeper at higher levels).
- **What you see:** behind you, inside the pen (a court nobody plays at is a fenced bank the walkers go round; the lens stays inside it, and higher when pulled in), tipped so you stand in the lower part of the picture and the far court shows; a yellow ring where their shot will bounce, a blue one where yours does; the ball's shadow; synthesized sounds (strings, the bounce, the net: `acts/sound.js`).
- **Measured** (Node, a person-like stand-in thumb with a 0.45 s reaction and a 0.5 m positioning error, 6 matches a level): Easy won 4 of 6, 6.5 shots a point, 6 minutes a match; Normal 6 of 6, 18 shots, 11 min; Hard 3 of 6, 35 shots, 20 min. The stand-in is steadier than a thumb (it hardly ever misses), so real points will be shorter; rally challenge best 22 in 3 minutes.

## Shoot hoops (`acts/hoops.js`, `acts/hoopsRun.js`)

- **The ball:** a size 7 (radius 0.119 m) with drag; the floor gives a regulation bounce (a 1.8 m drop comes back to 1.22 m); the rim is a torus (0.23 m to its 2 cm tube's middle) that gives back 58%; the backboard 66%. Through the hoop is the ball crossing the rim's plane downward inside it; a **swish** touches neither rim nor board. The court as `courtkit.js` (outdoor) and `propkit.js` (the gym's court and hoop prop) draw it: rims 12.4 m from the middle, 3.05 m up.
- **The shot:** a jump shot released at 2.35 m on a 51° arc; the speed that drops through the rim (aimed 7 cm past its middle: more room at the back) is solved, then the swipe makes it: half way up the zone is just right, and the middle eighth (about 20 px either side on a phone) is all just right; past that, 2.2% faster or slower per tenth; the angle aims (a dead zone round straight up). A power meter with its green band shows while you swipe. On a computer: hold Space, let go. A perfect swipe goes in 98% from 2.5 m, 91% from the free-throw line, 74% from the three-point line; a tenth too long, 26% from the line.
- **Modes:** **Shoot around** (makes, streaks, swishes; the half you stand on is the hoop you shoot at), **Around the World** (seven rings round the key, 4.6 m out, baseline to baseline: stand in the bright one, make it to move on), **H-O-R-S-E** vs the computer (the computer walks to a spot, 2.4-6.8 m out, and shoots with a hand's wobble: from the free-throw line 59 / 37 / 24% at Hard / Normal / Easy; it gives you room on your shot) or a friend. Rules: a make sets the shot, the other must make it from the same ring or take a letter; the setter keeps setting until they miss.
- **What you see:** you dribble while you walk (the ball bounces at your side twice a second), set and jump on a shot (the `shoot` mood), the ball's flight, rims and glass, the net swaying on a swish, the ball passed back; the camera behind the shooter looking at the rim (under the gym's ceiling). Los Cab's indoor court: lines (`courtline` props just over the room's floor) and a hoop at each end of a regulation court in the middle of the gym.

## Work out (`acts/workout.js`, `acts/workoutRun.js`)

- **A rhythm game:** each move is reps on a beat: squats, curls, shoulder presses (a rep every two beats), rows (swipe down), jumping jacks (every beat), treadmill sprints (two taps a beat, on the gym's nearest treadmill). The notes slide to a ring; tap when they reach it (judged when the finger lands, not when it lifts): **Perfect** within 70 ms, **Good** within 150 ms, else a **Miss**; a tap between notes doesn't count against you. A streak multiplies the points (x1.5 at 10, x2 at 20, up to x3). A kick on each rep's beat, a hat between, a count-in.
- **Today's workout:** five moves (20 s each, 4 s rests), the order and tempos from the date: the same for everyone today, a new one tomorrow (`todaysPlan`; no treadmill in the gym, no sprints). **Quick set:** one move for 30 s (pick it under More options).
- **Your player** does the reps in the gym (the moods' phase follows the beat), on the treadmill's belt for sprints (the camera then from behind and above, clear of the machines).
- **Real workout** (More options, opt-in): the front camera counts real reps instead of taps: MediaPipe's Pose Landmarker (lite, Twin Replay's `poseModel.js`, loaded on first use), about 9 frames a second on the phone; `repSignal`/`repCounter` turn the landmarks into a 0-1 signal per move from the body's own lengths (hips to knees for squats, wrists past elbows for curls, hands over the head for presses and jacks, hands to the waist for rows, a knee up for sprints) with hysteresis; a counted rep is a hit with more room (0.22 / 0.6 s). No picture leaves the phone; MediaPipe's own usage ping (`odml.pa.googleapis.com/v1/log`) is dropped on the page once the camera's been turned on (`blockTelemetry`: verified, no request went out). The camera stops when the workout ends or you leave.
- **Fitness and gains** (`acts/stats.js`): a workout of 8 reps or more counts; levels Getting started / Warming up (2) / Regular (5) / Fit (10) / Strong (20) / Beast mode (40), days in a row, best score. After a workout your player is one build stronger for 30 minutes ("pumped"), and for good from Fit (`gainsLook`: slim -> athletic -> strong; Locker Room > Trophies > **Show my gains** turns it off). My Park's look follows at once (`Pickleball.jsx myParkInfo`).

## Watch TV (`acts/tv.js`, `acts/tvRun.js`)

- You sit on a seat that faces the set within 3.5 m (`seatFor`), or stand in front of it watching (`watch` mood); the camera looks at the set over your shoulder, the set in the upper part of the picture, the remote along the bottom.
- **Live:** a friend's game, live (Live Broadcast's `bc:list`, this venue's first): **Watch** opens Live Broadcast's watch screen. **My videos:** the videos on drive C: (Media Player's My Videos; highlight reels you add there) play **on the set itself** (a video texture on its screen), with Pause and Stop. **YouTube / With Ava:** opens Watch Together (YouTube's own embed, synced with your partner or a buddy; needs 98 Messenger). Idle, a 98ish TV test card. Never a broadcast.

## With your partner or a buddy

- The sheet shows **Play Ava** / **Rally with Ava** (tennis), **H-O-R-S-E with Ava**, **Work out with Ava** when they're near you (Together's `nearestPal`). It's a Together ask (`server/park/together.js` kinds `tennis`, `horse`, `workout`: signed on both sides, never between people who block each other, within 30 m, the asks' rate limits); a **Yes** makes a private room of the new relay game **parkact** (`server/arcade/games/parkact.js`, settings `{ act, mode, venue, spot, seed, level }`), seats both and starts it; both get `park:act { kind, roomId, spot, mode, seed, host, with, name, look }` and both screens start on that spot. They stay in the park (nothing frees or holds a pickleball court).
- **Tennis:** the asker hosts and runs the game; snapshots 8 a second (`room:snap`, ~190 bytes); the guest moves its own player on its own screen and sends where it is about 11 times a second (`room:input`, ~23 bytes), its swings reliably (`room:relay`); the guest's camera from its own end. A co-op rally is the rally challenge with both of you.
- **H-O-R-S-E:** whoever shoots sends the launch (both screens fly the same ball: `hoops.js` is deterministic) and how it came out (the shooter's screen decides); where the shooter stands 2.5 times a second while it's their shot (the relay takes 4 messages a second).
- **Workout:** the same plan (the host's day), started in step (the guest says hello until the host says where it is: clocks within 0.1 s in the test), scores once a second; side by side in the gym; each screen judges its own reps.
- **Network** (measured, two phones): tennis about 90 KB a minute host -> guest and 18 KB guest -> host; H-O-R-S-E about 45 bytes a shot; a workout ~20 bytes a second each way. A friend leaving ends it on the other screen ("Ava left."). `parkact`'s `filterRelay` takes only its own message types, numbers rounded, strings cut to 60 characters, two levels of nesting, 2 KB.

## Storage and privacy

Nothing new is stored on the server: the parkact room and the asks live in memory while you play (no Delete My Account step needed). Your record (tennis wins and best rally, hoops makes, streaks and swishes, Around the World, H-O-R-S-E, workouts, fitness) is in Pickleball 98's settings (`prefs.actStats`, `actGains`, `actLevel`, `actMove`) on this device, per user through `userKey`. Help: Games > Pickleball 98 > "Tennis, hoops, the gym and the TV"; privacy: device storage and third parties (the camera's pose model).

## Found on the way: My Park's picture on an upright phone

The walk camera's lens shift (2026-10-09, "my hand is in the way") called `camera.setViewOffset(1000, 1000, ...)`; three.js's `setViewOffset` also sets the camera's aspect to fullWidth / fullHeight, so every upright phone's picture was drawn with aspect 1: about twice as tall as it should be (a 16:9 TV looked square, everyone tall and thin). The offset is now in the picture's own pixels, the aspect reset when it's cleared and on resize (`world.js setLensShift`). This changes the look of all of My Park on phones (correct proportions; a narrower view across); worth a look on the iPhone.

## Measured

- **Phone frame rate** (headless Chrome, 390x844, 4x CPU, GPU flags `--use-angle=d3d11`, Medium, this loaded machine; standing at the spot vs doing it): Los Cab tennis 22.4 -> 17.5 fps (the view down the court takes in much of the village's courts and two athletes every frame); Los Cab's gym hoops 27.1 -> 30.2; Los Cab fitness centre workout 27.7 -> 23.7; Sinaloa hoops 35.0 -> 33.9; SMASH lobby TV 16.4 -> 31.9 (a close view of a wall). Desktop (no throttle) 60 fps in each. Needs the real iPhone.
- **Shots** (session scratchpad `act/shots/`, temporary): `t1-*` (tennis: walk up, the sheet, the start behind the baseline, a rally with the swipe trail and the bounce ring), `t2-*` (two phones: Ava's sheet with Play ActBen, Ben's ask, both ends of the rally), `h-loscab-*` / `h-sinaloa-*` (hoops: the gym, a perfect release, H-O-R-S-E's letters), `horse2-*`, `w-loscab-*` (workout: jumping jacks with the lane, the treadmill sprint, the end card), `work2-*` (side by side), `cam-on.png` (Real workout: the camera chip and preview), `tv-smash-*` / `tv-loscab-*` (a video on the set), `landscape-*`.

## Tests

- `node --test client/src/components/applets/pickleball/park/acts/acts.test.js` (9): spots only at sourced places at all eight venues, every spot on open ground and reachable from the arrival (a flood fill), the context button picks it, Los Cab's gym court (hoops 28 m court apart, the lines), the gyms' TVs only where the packs have them; tennis (shots land where aimed and clear the net, topspin dips, the net's height, the serve box, the swipe's aim, no-ad scoring and first to 4, a computer-vs-computer match ends, nothing moves your player, a serve by swipe, the rally challenge with a stand-in thumb, the snapshot puts the guest's game in the same place); hoops (the bounce, the ideal shot from three spots, the rim and a swish, the board, make rates for good / short / long / wide swipes and by level, Around the World, H-O-R-S-E's rules, the free-shoot record); workout (today's plan per date, the windows, misses, the streak multiplier, the rep's phase, the result, real reps from synthetic landmarks for squats and presses, a camera rep's wider window); stats (each activity's record, a workout needs 8 reps, fitness levels and days in a row, the pump wearing off, gains for good, gains off); TV (channels, what's live sorted with this venue first, your videos, Watch Together's sign-on, the seat that faces the set).
- `node --test server/park/test/acts.test.js` (2, in root `npm test`): ask -> no -> nothing; ask -> yes -> a playing parkact room for both, both told who hosts; H-O-R-S-E asked the other way round; the room's settings and the relay's checks.
- Browser (session scratchpad `act/`, vite 5302 / server 8302, `bt.mjs` with the machine-wide Chrome lock): `tennis1.mjs`, `tennis2.mjs` (two phones signed on as buddies: the ask, yes, both screens, the same ball within ~0.3 m, one leaves), `hoops1.mjs [venue]`, `horse2.mjs` (two phones: shots, results and letters the same on both), `workout1.mjs` (today's workout, a full quick sprint set, the end card and the stats), `work2.mjs`, `cam1.mjs` (Real workout with Chrome's fake camera: the model loads, frames read, nothing sent), `tv1.mjs [venue] [tv]` (a recorded test video imported to My Videos plays on the set; pause; live; Watch Together off when signed off), `fps.mjs`, `aspect*.mjs` (the aspect bug).

## Owner questions

- Los Cab's indoor gym: how many courts, and which way do they run? (We drew one regulation court in the middle of the room the pack calls the gym; that room's place in the building is the pack's guess.) Is it basketball and badminton both?
- Los Cab's fitness centre: are the TVs over the mirror wall facing the treadmills (as drawn), or elsewhere?
- Newport's clubhouse lounge has a TV drawn: is there one? (Not offered until we know.)
- The Paseo Club: OpenStreetMap has a basketball court just south of the pickleball pen, where the aerial shows pickleball: is there a basketball court at the club? Which room has the bar's TVs?
- SMASH: which of the TVs by the courts can you watch from a seat?
- Sinaloa and Bouquet: can the public use the basketball courts (Sinaloa's are a school's)?
- Whittier: is the shade roof's TV on, and what does it show?

## Left

- Tennis rallies at Hard run long against the steady stand-in; tune with the owner's thumbs. Tennis's phone frame rate is the lowest of the four (17.5 at 4x): if it's low on the iPhone, cull the far courts' live games while you play.
- The athletes swing a pickleball stroke with a racket (no tennis-specific strokes: forehand/backhand drives and an overhead serve from anim.js); the jump shot and the workout moves are procedural moods, not motion capture.
- H-O-R-S-E with a friend has no "call your shot"; a bank shot counts like any make.
- Real workout: rows from the front camera are a rough signal; sprints count knee lifts. Twin Replay's worker still lets MediaPipe's usage ping through (it's in a worker: `blockTelemetry` covers the page only).
- Watch TV: Twin Replay's 3D replays don't play on a set (they need the game's own engine); Live opens the watch screen rather than playing on the set.

## Leisure: swimming, the hot tub, food and drinks, the drinks machine (2026-10-09)

The owner: "Swimming wherever there are pools", "Hanging out at the hot tub", "Ordering food at the bar or drinks or at the clubhouse/restaurant", and "Fun little Easter eggs where you can get a drink from a vending machine and then give it to a player and he gives you the keys to his car", then "the ability to drive". Lives in `client/src/components/applets/pickleball/park/leisure/`; the open world's part is in `client/src/roam/` through `host98.js`. Not yet tried on a real iPhone.

**What's where** (`leisure/spots.js LEISURE_SOURCES`; the sources and what's not offered: `docs/venue-provenance.md` "Leisure"): pools at Los Cab (the 50 m pool, the lap pool) and the Paseo Club; the hot tub at Los Cab; food and drinks at Los Cab Cafe, Newport's clubhouse bar and social lawn bar, Whittier's snack window, Paseo's cafe and bar, SMASH's bar and restaurant; drinks fridges at Los Cab Cafe, SMASH's lobby, Wolf + Bear's spectator strip. Newport's OSM pool and spa are a neighbour's (not offered).

**The way in:** the park's one context button at a pool's edge (within 1.6 m of it, or in it), the tub, a counter or a machine (`leisureAt`), checked before the park's benches and loungers and before an activity unless that's nearer (`world.js actionFor`). The sheets are bottom sheets (Together's `pkTgSheet` look); the menu rows are 48 px.

### Swim (`leisure/swimRun.js`, `leisure/poses.js`, `leisure/water.js`)
- **Swim** gets in at the edge nearest you; **Cannonball!** jumps off the deck in a tuck (0.8 s arc), a splash (drops + a ring), under for 0.7 s, up treading. The move pad swims on the camera's frame (freestyle 1.15 m/s, 1.6 m/s with the pad pushed all the way), letting go treads water, **Float** lies you on your back; the pool's outline keeps you 0.45 m off its walls (sliding along them). **Get out** climbs out on the deck nearest you.
- **A length / Laps** where it's a lap pool (lanes, or 20 m+): from the nearer wall in your lane, a 3-2-1, the clock; Los Cab's 50 m pool is one length, Paseo's 22.5 m two. At the far wall the camera swings round so "up the pad" swims you home (you still swim yourself: the owner's rule). Best per pool in `prefs.leisure.best`.
- **The body in the water** is a pose made whole (`swimPose`, `tuckPose`; the world's `animate` takes `drive().pose`): freestyle face down along the way you swim, the body rolling, the arms pulling under and coming over the water in turn, a flutter kick, a breath to the side every other stroke; treading upright with the head and shoulders out; floating on your back. The pool is drawn level with the deck, so whatever is under the surface is under the ground and hidden: what shows is what's above the water.
- **The water:** one flat mesh per pool on its own outline (a hair over the painted pool, lane lines showing through) with a shader of three moving waves, the sky by the view angle (Fresnel), the sun's glint, caustic lines, and up to 6 rings (strokes, splashes); the tub's disc foams (bubbles) and steams (7 soft sprites, 3 on Low). Splash drops are one instanced mesh. Measured cost on the phone (4x CPU, Los Cab's pool deck): 30.4 / 31.4 fps with the water, 28.4 / 29.6 without (noise).
- **With a friend near you:** **Swim with Ava** (both get in, each sees the other swim: park:pos act 5 = swimming, the remote's pose from their speed) and **Race Ava** (lap pools: lanes 0 and 1, the same start when the yes arrives, each times their own swim and the time goes round as `park:fx { lap }`; the end card says who won).

### The hot tub (`leisure/tubRun.js`)
- Six seats round the bench inside (`spots.js`), the free one nearest you; with a friend two side by side (`tubPair`). On the bench, shoulders at the water, arms along the rim (`tubPose`); the camera low and a few metres out, drifting round at 0.045 rad/s; the hangout's lo-fi comes on (`prefs.parkMusic`, put back after). park:pos act 6 = in the tub; people online see you sitting in it.

### Food and drinks (`leisure/menu.js`, `leisure/held.js`)
- Menus by place: bar (draft beer, red and white wine, lemonade, half & half, sparkling water, burger, fries, fish tacos, a wrap), cafe (two smoothies, iced and hot coffee, lemonade, a wrap, fries), snack window, and the machine (Fizz orange soda, lemon-lime pop, water, a sports drink). Original names, no brands, no alcohol. 2-14 chips from **Casino 98's chip bank** (`casino/bank.js`: the house refills you under 5, as at the tables).
- What you buy is in your hand (`held.js`: a cup with a straw, a coffee cup, a can, a bottle, a burger, fries, tacos, a wrap, a few shapes each, in the paddle's holder; the paddle hides) and carried at the waist (anim.js mood `carry`); **Sip** / **Bite** lifts it to your mouth (`sip`, 1.7 s), 4-6 times until it's gone; **×** puts it down. Everyone in the park sees it (`park:hold`, kept on the server with you for whoever joins; `park:fx` "sip").
- **One for Ava too** (a friend near you): asked first (Together kind `treat`); a yes puts it in their hand, and only then is it paid for.

### The drinks machine's easter egg: Vince's keys (`leisure/parkside.js`)
- At venues with a sourced machine (Los Cab, SMASH, Wolf + Bear), **Vince** (a regular with his own seeded look and a cap) stands by it, turning to face you when you're near, **fanning himself** every few seconds (anim.js mood `fan`) and saying he's hot ("Left my water bottle in the car. Again."); holding a cold one from the machine he notices it. Walk up with a machine drink and the button says **Give Vince your Fizz** ("He looks thirsty"; a drink from a bar won't do). He thanks you, sips it, and hands you his keys: the **Found!** card ("Vince's car keys"; **Drive it now** / **Later**), the achievement **Keys to the Sundowner**.
- **Kept per account:** `prefs.parkFinds.keys` on the device, `98ish.roam.unlocks` for the open world (through `host98.unlocks()`), and on the server when signed on (`server/park/finds.js`, collection `parkfinds`, one tiny record per account: `park:finds` / `park:find`; merged both ways when you sign on; **Delete My Account** erases it: step "park finds"). He hands them over once; after that he just thanks you.
- **The car:** the **Sundowner GT** (an original grand tourer, `roam/render/carmodel.js` `sundowner`: long hood, set-back cabin, fastback to a ducktail, sunset orange with gold pinstripes and a dark lip; top speed 40 m/s) in the Paseo Club's lot in Explore Valencia (`towns/valencia.js keyCar`: the north stall of the venue's aerial-traced east row by the way out). **Drive it now** opens Valencia beside it from any venue (`startRoam(..., { start: "keyCar" })`). `docs/open-world.md` "Cars".

### Storage, network, privacy
- Device: `prefs.leisure` (best swim times, how many swims, soaks and orders), `prefs.parkFinds`, `98ish.roam.unlocks`. Account: `parkfinds`. Memory only: what's in a hand (`park:hold`), the swim/tub acts. Network: an item id when it changes, a sip, a splash, a race's time; asks as Together's. Help: games.js "Swimming, the hot tub, food and drinks", the Explore topic's Sundowner line, privacy topics (server table, deletion, device keys).

### Measured (scratchpad `leis/`: vite 5301 / server 8301; phone 390x844, GPU flags, 4x CPU)
- One phone at Los Cab (`l1.mjs`): the tub (in, music on, out, music back off), a cannonball (splash, the achievement), swimming (1.6 m/s), treading, floating, a length in 28.0 s (before the speeds were lowered; now ~31 s), the cafe (9 chips: 1,000 -> 991, sips), the fridge, Vince ("Whew. Hot one today."), Give Vince your Fizz, the keys card, saved (prefs, roam unlocks, achievements), Drive it now -> Valencia beside the Sundowner, "Get in the Sundowner GT", driving. Paseo (`l1.mjs paseo`): two lengths in 43.7 s, the cafe. Every venue walked (`l3.mjs`): each place's button, Vince at SMASH and Wolf + Bear, nothing at Sinaloa.
- Two phones signed on as buddies (`l2.mjs`): **Race**: Ava 34.8 s, Ben 57.4 s, each sees the other's time; **hot tub together**: seats tub0 and tub1, each sees the other soaking; **a treat**: Ben asked "LsAva wants to buy you a fresh lemonade", yes, Ben holds it, Ava's chips 1,000 -> 988 (hers and his).
- Frame rate (phone, 4x CPU, a loaded machine): swimming at Los Cab 27.2-28.2 fps, at Paseo 46.8; in the tub 23.7 (one phone), 13.0 with two phones rendering at once.

### Tests
- `node --test client/src/components/applets/pickleball/park/leisure/leisure.test.js` (9): only at sourced places and reachable from the arrival; where you are; the poses (head out, body under, the arm over the water part of the stroke, the tuck, the tub); swimming (turning, speed, never out of the pool in 2,000 steps, lanes, a whole two-length swim); the cannonball; the tub's seats and pair; the menu and the chips (refill, short, refund, sips); Together's words; Vince (hot lines, only a machine drink, keys once, none without a machine).
- `server/park/test/leisure.test.js` (6, in `npm test`): park:hold, park:fx (sip, splash, lap; nonsense refused), the Together kinds' data, a treat's ask/yes/no, park finds (per account, known finds only, kept once, erased with the account), finds over the sockets (signed on only).

### Owner questions
- The Paseo Club: is one of the two small pools beside the main pool a hot tub (and which)?
- Los Cab's two outdoor vending machines by the fitness building and Newport's by the courts: are they real? (Not offered until we know.)
- Whittier: where in the clubhouse is the snack window?
- ~~Bars: beer and wine?~~ Answered 2026-10-09: yes. The bars and Paseo's cafe and bar serve a draft beer and red and white wine (`menu.js` `beer`, `wine`, `white`; held as a pint and a wine glass).

### Left
- No diving board or underwater view; the body under the water is hidden (the pool is level with the deck), not seen through it.
- The swim is freestyle only (no breaststroke or backstroke); laps don't keep you in your lane.
- Vince is drawn as a cheap mannequin when he's past the athletes' budget (like any regular); his look is the same everywhere.
- No buff from food (an energy boost for a rally challenge was optional).
- The Sundowner, like the Turbo 98, has its stripes only while driven (parked cars are instanced plain).

**Owner answers (2026-10-09):** Paseo has a hot tub (one of the small pools by the main pool; `spots.js` `tub.area`), Los Cab's and Newport's outdoor vending machines are real and now sell drinks, beer and wine at the bars, and food trucks for Whittier (to do: a food-truck model and the `truck` menu, which is already in `menu.js`).
