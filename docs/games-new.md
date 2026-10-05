# New games (2026-10-04): Boom Frenzy, Color Match, Echo Pads, Zap It!, Tetherball

Five quick games asked for by the owner. Every name, picture and sound is original (drawn in
SVG/CSS or three.js primitives, sounds synthesized with Web Audio through `utils/audio.js`);
no trademarked name appears in the UI (the Simon-style game is "Echo Pads", the Bop It-style
one "Zap It!").

| Program | Folder | Online | Inspired by |
| --- | --- | --- | --- |
| Boom Frenzy | `applets/boomfrenzy/` | no | Bomb Panic (Orangenose Studios, iPhone, 2012) |
| Color Match | `applets/colormatch/` | yes, `colormatch` (turn rules shared with the server) | the classic "color match" brain game |
| Echo Pads | `applets/echo/` | yes, `echo` (turn rules shared with the server) | the Simon electronic memory game |
| Zap It! | `applets/zapit/` | no (pass-the-phone Party mode) | Bop It |
| Tetherball | `applets/tetherball/` | yes, `tetherball` (relay, host-simulated) | playground tetherball |

Shared pieces: `utils/gameKit.js` (seeded rng, top-10 score lists per mode in localStorage,
so per user through the storage seam; tested in `gameKit.test.js`), `utils/gameSynth.js`
(tones/noise/held tones on the shared AudioContext, quiet when the game's Sound option or
"Play system sounds" is off or the taskbar is muted), `shared/quickgame/` (`useGameLoop` on
`utils/frameClock.js`, `useAutoPause` (the window losing focus or being minimized, the tab
hidden), the Paused panel, High Scores and How to Play dialogs, `Check` (a 98.css checkbox),
`QuickGame.css`). Every game opens to `shared/GameStart.jsx` (big Play, Play Online where it
exists, More modes, Options), takes keys on a computer and touch on a phone, and pauses when
its window loses focus (Desktop passes `paused={minimized || !active}`).

## 1. Boom Frenzy: what Bomb Panic was

### Research

**Which game.** The only iPhone game called "Bomb Panic" on record is **Bomb Panic by
Orangenose Studios** (the Singapore-based studio behind "Stupidness 2", "World Hardest Game:
0.02s", "0.03 seconds" and "Hardest Game Ever 2"). App Store id 509461814 (iPhone) and
510283773 (Bomb Panic HD for iPad). First released **2012-04-05/06**; version **2.0 on
2012-07-28** ("bug fix for memory issues causing crashes, optimized graphics, increased weapon
powers, changed icon"). The listing has since been removed from the App Store (the lookup API
returns nothing for both ids). App Store rating was 4.1/5 from about 2,000 ratings.

Its App Store description (quoted in full in a 2013 gameplay video's notes, copied from the
iTunes listing):

> Bomb Panic transforms the classic, childhood whack-a-mole game into a whole new intense
> experience. Game rule is simple: Whack all the bombs as fast as you can. BEWARE though, the
> game can get seriously tricky with 15 unique types of bombs. Each type of bomb have their
> special abilities that test your reaction and reflex to the limit! Just when you think you
> are good at this game, it is Panic Time! During Panic Time, a whole new intense wave of bombs
> will overwhelm you and challenges your ability to judge and react in time. To add to the
> intensity, you can activate different weapons to help you clear the bombs faster.
>
> Featuring: 15 Unique Bombs - 20 Challenging Stages - Endless Mode - 3 Powerful Weapons -
> OpenFeint (compare scores with your pals) - Simple yet addictive gameplay - Enhanced sound
> effects

Other facts found:
- A player's video notes: "The green arrow bombs made it pretty hard" (so some bombs show an
  arrow, and need something other than a plain tap).
- The title art (gameplay-demo video thumbnail): a round black cartoon bomb with big eyes and a
  curly fuse, a big wooden mallet, a sunny desert with cacti, tagline "Simply Addictive".
- Genre listed as Arcade/Action; it was compared with whack-a-mole by every listing.

Sources:
- Lonnie, "Bomb Panic - PANIC AT THE DISCO (iPhone Gameplay Video)", YouTube, 2013-05-30,
  https://www.youtube.com/watch?v=6z1ixQPdbRI (description quotes the App Store text; the
  "green arrow bombs" remark)
- MoGaming, "Bomb Panic By Orangenose Studios Gameplay Demo", YouTube,
  https://www.youtube.com/watch?v=bZFmjkuqDac (thumbnail: art style, mallet, desert)
- Soft112, "Bomb Panic 2.0", https://bomb-panic-ios.soft112.com/ (version 2.0, 2012-07-28,
  version notes, feature list)
- Metacritic, https://www.metacritic.com/game/bomb-panic/ (Orangenose Studios, 2012-04-06, iOS)
- GameRevolution, https://www.gamerevolution.com/game/bomb-panic (Arcade, 2012-07-28)
- AppStore.io developer list, https://appstor.io/developers/484852242-orangenose-studios
  (Bomb Panic and Bomb Panic HD among Orangenose's apps)
- App Store listings https://apps.apple.com/gb/app/bomb-panic/id509461814 (now 404) and the
  ids 509461814 / 510283773 (iTunes lookup returns no results: removed)

**Not found anywhere:** what each of the 15 bombs does, the weapons' names, how Panic Time is
triggered, lives, the scoring formula and the stage goals. No wiki, review or walkthrough text
survives. Those parts below are **inferred** (marked *inferred*), designed to fit the
description: a whack-a-mole field, bombs with fuses, 15 bomb types each needing a different
reaction, Panic Time waves, 3 weapons, 20 stages and Endless.

**A note on the other "bomb" game people remember.** Sorting colored bombs into matching pens
before they go off (walking bombs, drag them over a fence) is a different game: the "Bob-omb
Squad" minigame of Super Mario 64 DS (2004) and iPhone clones like Bomb Factory 2 (M2H, 2010:
"sort them by color, using the drag and drop control... let the white bombs explode for a
bonus", https://apps.apple.com/us/app/id409889214). In case that's the one being remembered,
Boom Frenzy has it too, as the **Sort Rush** mode.

### Boom Frenzy's rules (as built)

Field: a 3x3 grid of holes in a desert (4x3 on a wide screen is *not* used: the same 9 holes
everywhere so scores compare). Bombs pop out of holes with a burning fuse; whack them before
the fuse burns down. A bomb that goes off costs a heart (3 hearts; *inferred*). Whacking a
bomb scores points times the combo multiplier (combo = whacks in a row without a miss or a
blast: x1, x2 at 5, x3 at 10, x4 at 20, x5 at 35; *inferred*). Tapping an empty hole breaks
the combo but costs nothing.

The 15 bombs (*inferred* except where noted):

| # | Bomb | How to defuse it | Points |
| --- | --- | --- | --- |
| 1 | Black bomb | tap once | 10 |
| 2 | Quick bomb (red) | tap once; very short fuse | 15 |
| 3 | Helmet bomb | tap twice (the helmet flies off first) | 20 |
| 4 | Iron bomb | tap three times | 30 |
| 5 | Arrow bomb (green; the one players found hard: *found*) | swipe in the arrow's direction; a tap does nothing | 25 |
| 6 | Skull bomb | DON'T touch it; it sinks back by itself. Whacking it costs a heart | 0 (a heart lost) |
| 7 | Jumper | hops to another hole when hit the first time; hit it again there | 25 |
| 8 | Splitter | splits into two small Black bombs in other holes | 15 |
| 9 | Ghost bomb | fades in and out; only solid (tappable) when visible | 25 |
| 10 | Hold bomb (big, with a ring) | hold your finger on it until the ring fills (0.6 s) | 30 |
| 11 | Ice bomb (blue) | tap: every fuse on the field freezes for 3 s | 15 |
| 12 | Heart bomb (pink) | tap: a heart back (max 5) | 10 |
| 13 | Clock bomb | tap: every fuse burns at half speed for 4 s | 15 |
| 14 | Chain bomb (yellow, links) | tap it; if it goes off it also takes the bombs next to it (2 hearts) | 20 |
| 15 | Gold bomb | tap fast: it sinks after about 1 s (no harm if missed); worth a lot | 100 |

**Panic Time** (*inferred*): in Endless 30 s after the start and 30 s after each one ends (and
once per stage from stage 5, halfway to the goal), the sky turns red for 8 s: bombs come three
times as fast (every hole can fill), fuses are 30% shorter and every whack scores double.

**3 Weapons** (*inferred* names and powers; charged by whacking, shown as three buttons with a
charge meter; each use spends its cost from the one meter, which holds 40; bombs a weapon
kills don't charge it):
1. **Big Mallet**: clears every bomb on the field (not Skulls) and scores them.
2. **Freeze Ray**: stops every fuse and new bombs for 5 s.
3. **Fuse Snipper**: for 8 s, every bomb dies to one tap (Helmet/Iron/Hold/Arrow included).
The meter fills by 1 per whack; Big Mallet costs 40, Freeze Ray 25, Fuse Snipper 30.

**20 stages + Endless** (*inferred* goals): each stage is "whack N bombs" (N from 15 to 60)
with up to 3 stars for hearts left; each stage brings in a new bomb type until all 15 are in
(stage 1: Black; 2: Quick; 3: Helmet; 4: Arrow; 5: Skull + first Panic Time; 6: Jumper;
7: Iron; 8: Ice; 9: Ghost; 10: Splitter; 11: Hold; 12: Heart; 13: Clock; 14: Chain;
15: Gold; 16-20: everything, faster). Stages unlock in order and are remembered per user.
**Endless**: no goal; bombs speed up every 20 whacks until the hearts run out.

**Sort Rush** (the other bomb game, a More mode): red and blue bombs (green from 40 s, with a
pen across the top) walk around a yard; drag (or flick: the bomb slides on from where you let
go) each into the pen of its color before its fuse burns down. Right pen: 10 x multiplier (x2
at 6 in a row, x3 at 15, x4 at 30); wrong pen or a fuse running out: a heart. It speeds up
over time.

Controls: tap/click, swipe/drag (Arrow bombs), press-and-hold (Hold bombs), drag/flick (Sort
Rush). The hit area of each bomb is its whole cell (the cells grow up to 35% taller than wide
on an upright phone, wider in landscape, where the weapons move into a column beside the
field). Keys: 7-8-9 / 4-5-6 / 1-2-3 (or Q-W-E / A-S-D / Z-X-C) whack a hole; arrow keys swipe
the hole just picked (or the Arrow bomb with the shortest fuse); holding a hole's key holds a
Hold bomb; J / K / L fire the weapons; P or Esc pauses. A card shows each stage's new bomb
before it starts (Options > New Bomb Tips). Stars, unlocked stages and the top 10 of every
mode are kept per user (`98ish.boomfrenzy`).

## 2. Color Match

Classic (the brain-training "color match"): two cards. The left card shows a color word (its
MEANING, often printed in a misleading ink); the right card shows a color word printed in an
INK color. Does the meaning of the left word match the ink of the right word? **Yes** or
**No** (Right arrow / J = Yes, Left arrow / F = No; two big buttons on a phone). 60 seconds
(30 and 90 in Options), a 3-2-1 countdown first. Each right answer scores 50 x the multiplier;
the multiplier rises by 1 every 4 right in a row (up to x5) and drops back to x1 on a wrong
answer. About half the answers are Yes; the right word is often the left word's meaning, to
tempt a quick Yes.

Swatch (a More mode): a color name printed in a misleading ink, and 4 swatches (6 after 8
questions, 9 after 20): tap the swatch the word NAMES (the misleading ink is always among
them). Keys 1-9.

Questions come from a seed, one per index (`rules.js` `questionAt(seed, i, mode)`), so online
(`server/arcade/games/colormatch.js`, which loads the same `rules.js`) everyone gets the same
questions and the server checks each answer (in order, between GO and time's up, no faster
than 120 ms apart) and keeps the scores. Best score when the clock runs out wins (ties share
the win). Computer players answer every 1.15-1.85 s, 86% right. Quick Match pairs people by
mode and length and adds one computer player if nobody turns up. Pausing hides the cards.

## 3. Echo Pads (a Simon-style memory game)

Four pads (green, red, yellow, blue) round a gray hub, each with its own tone (G4, E4, C4,
G3) and a symbol for color-blind players (triangle, circle, square, star; Options can hide
them). The pads play a tune; repeat it; each round adds a step; the playback speeds up at 5,
9 and 13 steps. 5 seconds for each press. Modes: **Classic**, **Reverse** (repeat it
backwards), **Rewind** (forwards, then back again: a b c -> a b c b a), **Speed** (Classic,
starting fast). Keys: Q W / A S, 1-4, or the arrow keys.

Online, **Pass the Pads** (`server/arcade/games/echo.js`, rules in `echo/rules.js`): players
take turns. The first player adds a step; each next player repeats the whole tune, then adds
one of their own. A wrong press, or the turn clock running out (6 s to start, then 3.5 s
between presses), knocks you out; the last one left wins. The room may play the tune before
each turn (default) or leave it to memory; Classic or Reverse order. Everyone sees and hears
every press. Computer players repeat correctly most of the time, slipping more as the tune
grows. Leaving knocks you out.

## 4. Zap It!

It calls a move; do it before the ring runs out (1.7 s at first, 7% quicker every 5 right,
never under 0.65 s; a metronome ticks four times per call). Each call is spoken
(speechSynthesis, when the device has a voice and sound is on), has its own sound and a big
picture. **Tap it**, **Swipe it** (sideways), **Twist it** (two fingers turning 35 degrees or
more, or one finger / the mouse going most of the way round a circle), **Pull it** (drag
down), **Flick it** (fast short flick up, or a long drag up), and **Shake it** only where
motion works: Android (motion events arrive without a prompt; the first reading turns it on)
or an iPhone after Options > **Allow motion** (DeviceMotionEvent.requestPermission from that
tap). Computers never get Shake it. Recognition is pure (`zapit/gestures.js`: `classify`,
`shakeDetector`). Keys: Space/Enter tap, Left/Right swipe, Down pull, Up flick, T twist (S
shake where motion works). A wrong move or too slow ends the run.

**Party** (pass the phone, 2-6 players): "Pass the phone to Player N", I'm ready, one go each;
the most zaps wins. Solo top 10 and the party winners' scores are kept per user.

## 5. Tetherball

A ball on a rope tied to the top of a 3 m pole. Player 1 stands on the near half and winds the
rope counter-clockwise, player 2 on the far half clockwise; a player can only hit the ball on
their own half. Wind the rope all the way round in your direction (about 6.6 turns) to win
the game; matches are one game, first to 2 (default) or first to 3. The loser of a game serves
the next; a dead ball (hanging still for 2.5 s) is served again by whoever's half it's on.

Physics (`tetherball/physics.js`, pure, fixed 1/240 s steps): the ball is a point mass on an
inextensible rope that can go slack. The wrap is the ball's unwrapped azimuth since the rope
last hung straight; each turn uses the pole's circumference of rope and moves the tie point
down the pole (helix pitch 8.5 cm), so the free rope gets shorter: the same hit goes round
faster on a wound rope (angular momentum), and it unwinds when hit back. The ball bounces off
the pole and the ground. A computer-vs-computer game lasts 30-90 s with about one hit a
second.

Your player runs to the ball by themselves; you choose when to hit, how hard and how high. A
swing is open for 0.26 s; if the ball comes within reach (0.95 m, between 0.35 and 2.75 m up)
it's hit, harder for a cleaner contact. The ring on the ground lights up when the ball is in
reach. Phone: swipe across the screen (faster = harder, upward = higher), tap = a medium hit.
Computer: Space (hold for power; hold Up/Down too for high/low) or a mouse swipe. Computer
players: Easy, Medium, Hard (reaction delay, misses, power).

3D: three.js, chosen over a 2.5D canvas because the game is the rope winding round the pole,
which needs depth to read, and the scene is tiny (pole, rope tube rebuilt each frame, ball with
a blob shadow, two capsule figures with swinging arms, a playground circle, low-poly trees).
Antialias on, pixel ratio capped at 1.5 with dynamic resolution below it, the frame clock,
`releaseGpu` on context loss. The camera stands behind your half (looking a little down on an
upright phone).

Online (`server/arcade/games/tetherball.js`, relay; `tetherball/netplay.js`): the host (seat
0) runs the match with a 0.45 s history of the ball and players and sends ~30 snapshots a
second (ball, players, phase, games, the last few events). The guest's mirror flies the ball
forward from each snapshot with the same physics and eases out corrections; the guest's swing
hits the ball on its own screen at once (prediction; older snapshots don't undo it for 0.6 s)
and goes to the host (reliable relay) stamped with the host time it started; the host finds
the moment in its history the ball was in the guest's reach, hits it there and flies it
forward (`match.remoteSwing`). The host ends the game with `room:finish`. The server checks
the relay messages (`filterRelay`).

## Tests

- Unit (by file path): `client/src/components/applets/boomfrenzy/boomfrenzy.test.js`,
  `colormatch/colormatch.test.js`, `echo/echo.test.js`, `zapit/zapit.test.js`,
  `tetherball/tetherball.test.js`, `client/src/utils/gameKit.test.js`; server rules
  `server/arcade/test/newgames.test.js` (in `npm test`).
- Browser (scratchpad, vite 5381 + server 8381): `ng-boom.mjs`, `ng-colormatch.mjs`,
  `ng-echo.mjs`, `ng-zapit.mjs`, `ng-tether.mjs` (desktop, iPhone emulation with real touch
  through CDP incl. a two-finger twist, landscape; online smoke tests for Color Match, Echo Pads
  and Tetherball between a desktop and a phone), helpers in `ng-helpers.mjs`. Screenshots in
  `shots/newgames/`.

## The retro redraw (2026-10-04)

The owner's verdict on the first version: "none of those new games look retro". All five were
redrawn as mid/late-90s games with the retro kit (`utils/retro/`, `shared/retro/`; rules in
CLAUDE.md "Retro art"). Rules, controls, online play, scores and achievements are unchanged;
the games' hit areas are invisible elements over the pixel picture, with the same data
attributes as before.

| Game | Look | Logical screen (phone) |
| --- | --- | --- |
| Boom Frenzy | 256-colour desert: dithered sky (red in Panic Time), mesas, cacti, dug holes; procedural pixel bombs (dithered spheres, eyes that worry, per-type dressing), a burning pixel fuse with a flickering spark, wooden mallet with squash, 8-frame explosions, icy palette remap when frozen, Sort Rush yard with fenced pens and walking bombs | ~192 x 377 |
| Color Match | edutainment: scrolling patterned backdrop, index cards with ruled lines, words in a chunky pixel font in ink colours, coloured bevel YES/NO buttons, LED clock, Professor Hoot the owl who cheers streaks | ~230 x 450 |
| Echo Pads | an original electronic toy on a wooden desk: charcoal case, dark pads that light with a glow, silver hub with logo and red LED window, pixel symbols that stay visible unlit | ~230 x 450 |
| Zap It! | the ZAP-TRON, an original black-plastic handheld: dome ringed with timer LEDs, slider, knob, lever, T-handle and speaker that move per call, the call on a green LCD, beat lights | ~192 x 377 |
| Tetherball | PS1-era 3D: low resolution blown up, vertex snapping, dithered 15-bit-style colour, flat-shaded box kids with pixel faces, chunky textures, billboard trees/school/slide/swings, screen-door shadows, pixel HUD | ~164 x 323 |

Title screens have an animated pixel banner (attract loop); game-over panels show the score in
LED digits and a pixel high-score table. Sounds use chip voices (pulse/triangle/noise).

Tests: `node --test client/src/utils/retro/retro.test.js` (palette, dither, bitmap, sprites,
font, LED, explosions, fit, chip maths, every palette within 256). Browser (scratchpad,
vite 5385 + server 8385): `rt-boom.mjs`, `rt-colormatch.mjs`, `rt-echo.mjs`, `rt-zapit.mjs`,
`rt-tether.mjs` (the `ng-*` suites with retro selectors), `rt-perf.mjs` (4x CPU throttle),
`rt-compare.mjs` (before/after sheets in `shots/retro/`). Node previews: `retro/*-preview.mjs`.
