# Tournaments in Pickleball 98 (Real Games > Tournaments, My Park's 🏆 chip)

Built 2026-10-09 after the owner's "add the ability to sign up for a tournament like CAPA at Los Cab or iPickle at Whittier Narrows". Everything lives inside Pickleball 98 (no separate program).

## Names and the trademark rule
Every event has an ORIGINAL 98ish name; no real organizer's or venue's event name, logo or branding, and the UI says "98ish's own events, made up for the game: not affiliated with the venue or any real tournament" (a unit test refuses CAPA/iPickle/PPA/APP/MLP/USA Pickleball in names). The broadcast-style score bug follows the LAYOUT of the owner's reference frame (`98ish-reference/venues/refs/loscab/owner/owner-2026-10-09-8-tournament-court4.png`: event name over two team rows, scores in a teal block, the round under) with our own colors and no marks.

## The schedule (`client/src/components/applets/pbclub/tourneyCore.js`, pure; the server imports it)
Weekly, California time (`TZ = America/Los_Angeles`, DST-safe `instantOf`): Fountain Valley Fall Classic (Los Cab, Sat 10:00), Narrows Open (Whittier, Sun 14:00), Back Bay Invitational (Newport, Fri 18:00), Van Nuys Night Slam (Wolf + Bear, Thu 19:30), Valencia Twilight Cup (Paseo, Wed 18:00), Beach Cities Indoor Open (SMASH, Tue 19:00), Simi Schoolyard Shootout (Sinaloa, Sat 16:00), Canyon Country Classic (Bouquet, Sun 10:00), Riverside Nightly (every day 20:00). Ids are `<event>-<yyyymmdd>` (`parseId` checks the weekday). An event is only a schedule entry until someone signs up; then the server stores it.

## Rules
- Divisions: `d30` Doubles 3.0-3.5 (computer level intermediate), `d40` Doubles 4.0+ (pro), `mx` Mixed Doubles (a label; nothing checks), `s` Singles Open. Each event offers 2-3.
- Sign up (`canEnter`): one entry per person per tournament (as captain or partner), 16 per division, before the start. Doubles: a buddy partner (invited; they Accept/Decline) or a computer partner; an invitation not accepted by the start becomes a computer partner.
- The draw (`draw`, at the start): sign-up order = seeds (1 v n, top seeds apart: `seedOrder`), computer teams (original names) fill to 4/8/16. Deterministic from the record's server-side `seed`.
- Rounds (`progress`): computer-vs-computer matches play themselves at once (seeded); each round's deadline is `start + (r+1) * 30 min`. When it passes unplayed: vs computers, the computers go through; people vs people: the side that checked in (`here`, or made the room) goes through, else drawing lots. Results (`report`): a player in the match, before the deadline, a valid game to 11 win by 2 (`validScore`); first result stands. The same record + time give the same bracket anywhere.
- Trophies (`trophiesOf`): champion (place 1) and runner-up (2) per division, for players with accounts; given once (`awarded`).

## Server (`server/tourney/`)
- `index.js` routes (POST, Bearer = 98 Messenger token) `/list`, `/get`, `/enter`, `/withdraw`, `/partner`, `/here`, `/room`, `/report`; `store.js` MongoDB `pbtourneys` ({ id, start, status, members, doc, rev }, rev-checked writes) and `pbtrophies` ({ key, list }), or memory. Mounted at `/api/tourney`; a 1-minute sweep draws started events, settles rounds and awards trophies; records go 14 days after the start.
- Live: `pb:changed { kind: "tourney", id, by, partner? }` (PbClubBridge refreshes `utils/tourney.js`, a partner invitation goes in the Notification Center). Push (category `pickleball`): partner invitation, "<event> has started: your first match", "You won the <event>!". Deep link `?open=program&name=Pickleball%2098&tourney=<id>`.
- Caps: 16 teams × ≤ 4 divisions (a record ≤ ~30 KB, usually 2-5 KB), 6 upcoming sign-ups per account, 300 stored records, 14-day retention, 60 trophies per shelf; ~1 MB of Atlas at most for a busy month. Traffic: JSON on demand.
- Delete My Account step `tournaments` (inventory line in `server/account/index.js`): sign-ups for events that haven't started removed (an invited partner gets a computer partner); in started/finished ones the person becomes "Deleted player" (`eraseFrom`); the trophy shelf deleted.
- `TOURNEY_TEST_CLOCK=1` (never on Render; refused when `RENDER` is set): `POST /api/tourney/test-clock { ms }` moves the tournament clock for browser tests.

## Client
- `utils/tourney.js` (store, session from AimContext; trophies also kept on the device in `98ish.tourney.trophies`, per user).
- `pbclub/Tournaments.jsx` (+ `Tournaments.css`): the week's list (yours first), a tournament (sign up: division buttons, partner picker; invitation Accept/Decline; Withdraw; live: your next match with **Play now** / **Make a room** / **Join the room (CODE)** / **We're here**, More options > Report a score; the bracket per division as compact score bugs scrolling sideways; champions). `pbclub/ScoreBug.jsx` (+ `.css`) is the bug, also used in the match.
- Pickleball 98 (`Pickleball.jsx`): `startTourney(spec)` (vs computers: a local match at the event's venue, `venueBuilds.venueFor(venue, "now")`, Riverside = the park arena, names from the bracket; vs people: the online lobby with a preset format/venue, the room's code posted with `/room`, or `joinCode`); `reportTourney` from `onGameOver` (local or online) and a note on the result card; in a tournament match the regular score bug is replaced by the tournament bug (event, teams, serve dot, round + score call). My Park: a 🏆 chip (top right) when the venue has a tournament today, live, or yours; the park menu's **Tournaments here...** opens the same panel filtered to the venue. Locker Room > **Trophies** tab.
- Help: `pickleball-club` "Tournaments" section; privacy tables in `support.js` (what's kept, deletion).

## Tests
- `node --test client/src/components/applets/pbclub/tourney.test.js` (4: schedule/DST/ids/original names; the draw; progress/report/walkovers/lots/trophies/determinism; erasing).
- `server/tourney/test/tourney.test.js` (3, in root `npm test`: schedule, partner invite + push, refusals (twice, partner taken, SmarterChild, unknown, blocked, wrong division, singles partner), the sweep's draw + pushes, reports, walkover, final, trophies once; people vs people with a room code and check-in deciding; caps + Delete My Account).
- Browser (scratchpad `voice/tourney.mjs`, vite 5302 / server 8302 with `TOURNEY_TEST_CLOCK=1`, accounts from `register.mjs`): two emulated iPhones sign up for tonight's Riverside Nightly (singles), the clock jumps to the start, Ava taps **Play now**, plays (autoplay + fast-forward) and the result goes in by itself ("You won 11-0. The Riverside Nightly bracket is updated."), Ben's bracket shows it; no sideways scroll at 390 px, no page errors. Shots `shots/tourney/`.

## Left
- Players host their own tournaments (only the house schedule now). Doubles with two people on a team against computers is played by one of them (the partner is computer-run in that game). Results between people are trusted (first report stands; no confirm step). Event-day tents/spectators at Los Cab (owner's photo) not added yet.
