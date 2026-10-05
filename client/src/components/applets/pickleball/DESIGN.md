# Pickleball 98: how it should play

Pickleball 98 used to give you four shot buttons: topspin, slice, soft and lob, plus a power
key. A player's feedback was blunt: "that's not what pickleball is." Real pickleball is
finesse first, then a sudden switch from slow to fast. This document sums up how points are
actually played at a good level and how each idea maps to a mechanic in the game. Sources are
listed at the end.

## How a point goes (intermediate to pro)

1. **Serve and return deep.** Pros almost never miss either one: 99.3% of serves and 97.6% of
   returns go in (PPA, 2023). The two-bounce rule keeps the serving team back. The returner hits
   deep and runs to the kitchen line.
2. **The third shot.** The serving team is stuck at the baseline while the other team is at
   the net.
   - **The drop** is a soft arc that lands in the kitchen. It's low enough that nobody can
     attack it, which buys time to move up.
   - **The drive** is hard and low. It forces a weak fourth shot, and then the serving team
     drops the fifth.
   - Pros now drive about half their third shots (51% in 2024, up from 38% in 2023). Amateurs
     drop more. Drop success in drills is 70-80% at 3.5 and 85-90% at 4.0.
3. **The transition zone** is the area between the baseline and the kitchen. About a third of
   points end there (32%), because balls come at your feet while the other team hits down.
   - Move up in stages: hit, take two or three steps, then split-step as the opponent makes
     contact.
   - When a hard ball comes at you, **reset** it: a compact, slightly open paddle that soaks
     up the pace and drops the ball back into the kitchen.
4. **Dinking.** Once both teams are at the line, they dink.
   - Cross-court dinks are safest. The diagonal gives more court, and the net is lowest in
     the middle: 34 in at the center against 36 in at the sidelines.
   - A good dink clears the net by 2-4 in, lands in the kitchen and bounces no higher than
     the net. Above about 6 in of clearance, it can be attacked.
   - Patience wins: wait for a ball you can meet above the net.
5. **The speed-up** is a sudden hard shot from a ball you meet above the net. You aim it at
   the body: the paddle-side hip or shoulder ("chicken wing"), or down the middle.
   - A speed-up hit from below the net has to travel upward. It either sails long or arrives
     high, where the other side counters it.
   - Disguise matters more than raw pace.
6. **Hand battles.** Players at the net stand about 14 ft apart. A 30-45 mph ball leaves
   0.2-0.3 s to react, close to the human limit.
   - Ready position means the paddle is up and you're ready on the backhand side.
   - Your choices are to block or reset soft, or to counter hard if you're ready.
7. **Rare shots.**
   - Lobs are surprises, and risky.
   - An ATP (around the post) and an Erne (a volley from outside the sideline next to the
     kitchen) are highlight-reel rare.
8. **Doubles.** Partners move as a unit, "connected by a 10 ft rope." The forehand in the
   middle usually takes middle balls.
9. **Levels.**
   - Beginners bang the ball, pop it up and stay back. Rallies run about 6 shots at DUPR
     2.5-3.0.
   - 3.5 players dink but get impatient and speed up balls that aren't up.
   - 4.5+ players and pros are patient. They kill hard balls with resets and attack only what
     is up. Rallies run about 8-11 shots, 57% of pro rallies are 9 shots or fewer, and about
     3% reach 30+.
   - About 64% of points end in unforced errors, 20% in winners and 16% in forced errors.

## How it maps to the game

| Concept | Mechanic |
|---|---|
| Finesse vs pace | ONE hit control. How long you hold it is the **pace** (`shots.js` `paceOf`). A quick tap is soft (pace under 0.36), a long hold is hard (0.66 and up), and in between is firm. You let go to swing, and timing it so the ball arrives SWING_LEAD later grades the shot. |
| Placement | A **target** on their court. On desktop you point the mouse at their court. On a gamepad the right stick aims. On touch you put a finger on their court, or drag from where you touched. With no aim, the target is what a sensible player would do (`ai.js` `autoTarget`), and the movement keys nudge it while you hold (2P keyboard). |
| Shot types | Nobody picks a shot from a menu. `planIntent` reads pace, target and position. Soft at the line is a **dink**, soft from farther back is a **drop**, and soft against a fast ball is a **reset**. Soft but deep is a **lob** (it has to go up). Firm makes a **roll**, punch or counter. Hard makes a **drive**, **speed-up**, **counter** or **put-away**. |
| Hard from below the net | Hard shots keep their pace (`solveDrive`). If that pace can't clear the net and still land on target, the ball is lifted just enough to clear and carries long. It sails out, or it reaches them high (`assessBall`). |
| Attackable or not | `assessBall` measures how high the ball gets where the other side can reach it: in the air in front of a player at their kitchen line (1.15-4 m from the net), or off a bounce near the line. Above `ATTACK_H` (net + 9 cm) the ball can be hit down. Above 1.25 m it's a pop-up. Every shot gets a label: "Unattackable dink", "Dink floats up", "Popped up!", "Great drop", "Great reset", "Speed-up!", "Speed-up from low", "Counter!", "Put-away!", "Into the net", "Long!", "Around the post!", "ERNE!". |
| Touch errors | Soft shots miss upward and long (a float) more often than into the net. Late timing floats the ball. Absorbing a hard ball (a reset) or digging out a ball at your feet multiplies the error. |
| Read the ball | A ring on the ball marks where you'll meet it. It's orange when the contact is above the net ("it's up: attack") and pale blue when it's low ("keep it low"). It grows during a hand battle. The aim is a small target dot colored by pace (mouse, keys, Classic touch). No ball-path arc (removed in pb11: the owner wanted his swipe drawn, not the ball's path); Swipe shows the finger's own trail on the screen instead (`swipetrail.js`). |
| Hand battles | A hard ball (over 10.5 m/s) at a player within 4.6 m of the net. The swing is compact (SWING_LEAD_FAST 0.07 s instead of 0.13), and firm or hard back makes a counter. Holding early is "paddle up": let go on the beat to counter, or tap late to block soft. The meter flashes "hands!". Optional slow motion on Rookie and in practice. With the light assist on, a reflex block (late and floaty) happens if you don't swing. |
| Computer players | They choose a target and a pace through the same model. **Rookie** bangs and pops up, stays back and speeds up anything. **Club** drops and dinks, but gets itchy after about 3 dinks and speeds up low balls. **Pro and Legend** are patient: they attack only balls that are up, using a pace that will land (`paceThatFits`), and they roll from low at the feet. They reset hard balls and counter balls at the tape. Hands are a reaction time: a ball that arrives faster than that leaves them late, or beats them. |
| Movement | Teams move up behind a good soft shot. They stay back or step into the transition zone after a poor one, and follow a drive in a step. Partners share one depth and each covers a half. The split step animates on every opponent contact. |
| Feedback and teaching | Shot labels; end-of-match stats (unattackable dink %, pop-ups, speed-ups and counters). The tutorial follows a point: touch, aim, serve, deep return, third-shot drop, dinking patience, speed-up the high ball, hand battle, transition reset, rules. New drills: Deep returns, Dink or attack?, Hand battle, Transition resets. |

## Sources

- PPA Tour, "By the numbers: serves and returns"; "Third-shot drives are on the rise";
  "Keeping third shots in play".
- pickleball-research.com/outcomes (where and how points end).
- The Dink: dink technique and net clearance, 3-height rules, speed-up, countering at the
  kitchen, third-shot drop by level, middle coverage, Erne rules, pro 2019 vs 2022.
- Scientific American, "Pickleball physics explained" (reaction time at the net).
- pickleballsplay.com (the transition zone); Spintip (partner movement).

## Touch controls: Classic and Swipe (pb7, 2026-10-04)

What the popular phone racket games do (checked 2026-10-04):

- **Tennis Clash** (Wildlife): swipe to hit when the ball comes; the faster the swipe, the
  harder the shot; the farther, the deeper; a lob is a short swipe then hold and release
  (a bar sets the height). Movement there is a tap on the court. (gamezebo.com Tennis Clash
  guide; en.androidguias.com/tennis-clash-tricks)
- **Virtua Tennis Challenge** (SEGA): gesture swipes for topspin, slice, lob and drop, plus
  virtual pad schemes; reviewers found the swipe scheme unreliable (two-finger slice read as
  topspin) and preferred the virtual pad. (Wikipedia; gamezebo.com review)
- **Wii Sports tennis**: the player only times the swing; movement is automatic. (StrategyWiki)
- Pickleball games on the App Store/Play (Pickleball 3D, Pickleball Stars, Pocket Pickleball)
  advertise "simple swipe controls" and "intuitive" controls without detail; a Pickleball 3D
  review complains the movement felt wrong. (apps.apple.com, play.google.com)

The owner ruled out automatic movement ("I do NOT want auto assisted moving"), so both
schemes keep the move pad (left or right) and differ only in how you hit:

- **Classic:** touch their court to aim, hold for pace, let go as the ball comes.
- **Swipe** (Tennis Clash's idea without its auto-movement): finger down anywhere off the pad
  (the paddle comes up), swipe up toward the target, lift as the ball comes: angle = across,
  length = depth, speed = pace; a tap is a soft touch shot; a slow long swipe is a lob (soft
  aimed deep, which the shot model already plays as a lob). `touchplay.js`.

Playtest (Node, `pb7-playtest.mjs` in the session scratchpad; 40 singles games to 11 vs Club,
same seeds, same manual-movement model: 0.28 s reaction, a stand spot off by N(0, 0.3 m),
release timing N(0, 70 ms); Classic: pace from a held interval with Weber noise
N(0, 0.2 x hold + 25 ms) and pressing early enough, tap-aim N(0, 0.5 m) x N(0, 0.9 m); Swipe:
pace N(0, 0.14) around the intended pace, angle/length aim about N(0, 0.45 m) x N(0, 0.7 m)):

| scheme | shots/rally | points won | your errors/shot |
|---|---|---|---|
| Classic | 4.03 | 31.1% | 0.138 |
| Swipe | 4.66 | 36.6% | 0.085 |

Against Rookie: 3.42 vs 3.86 shots/rally, 50.8% vs 62.2% points. With Classic's aim error set
equal to Swipe's, Classic still trailed (4.17 shots/rally, 0.118 errors/shot); changing the
Weber fraction (0.12) or Swipe's pace noise (0.22) moved little. Honest limits: these numbers
come from assumed human noise, not from people; they say Swipe is at least not worse and
likely easier because pace needs no early press. Swipe is marked recommended; both stay.

## The sound (pb11, 2026-10-04)

The owner: "Make the pickleball sound effect sound more like an actual pickleball, do research."

### What a real pickleball sounds like

| Sound | Numbers | Source |
|---|---|---|
| Paddle hit: the "pop" | A short impulse with a strong tone near **1250 Hz**: a strongly radiating "membrane" mode of the paddle face. | "Understanding pickleball noise at the source: the vibroacoustics of the pickleball paddle and ball", JASA 155 (3 suppl.) A328, 2024: https://pubs.aip.org/asa/jasa/article/155/3_Supplement/A328/3301337 |
| Paddle materials | The first membrane mode sits at **980-1477 Hz**. Graphite-polymer faces ring higher with less damping (they ring longer); wood rings lower and more damped. | Bacon, Dobbs, Allen, Patchett, "Characterizing the vibroacoustic response of pickleball paddles through impact testing and laser Doppler vibrometry", 2025: https://doi.org/10.1177/17543371251393306 |
| Timing and level | Centered at **1000-1200 Hz**. The impulse's onset and decay take **1-2 ms**, with a **10-20 ms** ringing tail. About 20 dB louder than tennis. | Preliminary analysis of 79 pickleball noise consultant reports, Proceedings of Meetings on Acoustics 54, 040009 (2024): https://pubs.aip.org/asa/poma/article-pdf/doi/10.1121/2.0001965/20217957/040009_1_2.0001965.pdf |
| Contact time, spectrum | Contact lasts about **2 ms**. "80% of the total power" is below about 750 Hz, while the perceived peak is about 1.2 kHz. Little above 2 kHz. Peaks of 99-106 dB near the paddle. Foam faces are about 10 dB quieter. | Tennis Warehouse University, "The Physics of Pickleball Noise": https://twu.tennis-warehouse.com/learning_center/pickleball/pickleballnoise.php |
| Low band | Each paddle shows narrow-band noise at **200-500 Hz** and a peak around **1 kHz**. | Crystal Instruments, paddle noise characterization (2024): https://www.crystalinstruments.com/blog/2024/1/5/pickleball-paddle-noise-characterization-with-coco-80x-and-post-analyzer-dec-2023 |
| Duration | Contact on the order of **4 ms**; total noise about **35 ms**. | Pickleball Science, "Pickleball noise fundamentals": https://pickleballscience.org/acoustic-fundamentals/ |
| Quiet gear | A standard paddle measures 85+ dBA at about 1,100-1,200 Hz. The first USA Pickleball Quiet Category paddles measure under 80 dBA and under 600 Hz. Outdoor balls (harder, with smaller holes) are louder than indoor ones. | USA Pickleball Quiet Category coverage: https://gammasports.com/blogs/pickleball/gamma-sports-products-awarded-noise-reduced-designation-by-usa-pickleball-as-part-of-quiet-category-launch ; https://www.paddletek.com/blogs/news/noise-issue-pickleball |
| At a distance | About 70 dBA at 100 ft (tennis about 40-55). | Spendiarian & Willis, via https://thehustle.co/one-mans-quest-to-make-pickleball-quiet |

**Measured here.** A CC0 field recording of two outdoor games (Freesound #547092, "PickleBall.m4a" by fkunze, https://freesound.org/people/fkunze/sounds/547092/, CC0 1.0) was analyzed (onsets, 40 ms spectra, envelopes).
- **Paddle hits:** its impacts whose spectrum peaks at 1.1-1.5 kHz (n=55) average a peak at **1289 Hz**. The bands above fall -10 dB at 1.6 kHz, -14 at 2 kHz, -18 at 3.15 kHz and -20 at 4 kHz. The bands below sit 5-8 dB under the peak. They drop 20 dB in a median **10 ms**.
- **Bounces:** the impacts peaking at 550-950 Hz (presumably bounces on the hard court, n=56) average a peak at **750 Hz**, fall off above 1 kHz, and drop 20 dB in 9 ms.
- A second CC0 recording (#825456) was dominated by insects at 5.5-6 kHz and was not used. Nothing from the recordings is shipped.

No measurements were found for the net, the fence or the bounce alone. Those are modeled from their physics (a mesh's low thud and cord rattle; chain link's long inharmonic ring) and from the recording's low-peaked impacts.

### How the game makes them (`pbsound.js`, pure; `audio.js` plays them)

- **Modal synthesis**, not samples. A paddle hit is made of:
  - the membrane mode (the paddle design's core: 1080-1440 Hz, see `PADDLE_CORES`; graphite and raw carbon higher and longer, the thick polymer core lower and deader);
  - two weaker, shorter plate modes (x1.62, x2.58) and a 380 Hz body mode;
  - the contact click (one cycle over the contact time: 4.2 ms on a dink, down to about 1.6 ms on a put-away, so hard hits excite more of the high modes);
  - a broadband crack around the mode;
  - a bright tick from the holed plastic ball.
- **The mix** (`CAL`) was fitted to the recording's average spectra by a random search. The fitted drive matches the recording's bands to within a few dB from 630 Hz to 6.3 kHz.
- **Shots** (`shotFamily`):
  - dink, drop and reset: soft, about 15 dB under a put-away;
  - block and volley: shorter (a braced face rings less);
  - lob: a longer push, rounder;
  - smash: +1.5 dB and brighter.
- **Contact** (`contactOf`, from the timing grade):
  - perfect: the sweet spot (cleaner, a little louder);
  - early or late: off-center (the mode 5% lower, deader, more thud);
  - very early or very late: the edge (10% lower, with a clack at 2.85 kHz).
- **Variation:** each hit varies by a seeded random (mode +-2%, decay +-10%) and a +-1.2% playback rate.
- **Bounce:** a 730 Hz shell mode, plus a 1.9 kHz partial and a 260 Hz thud, about 9 dB under a hit.
- **Net:** a 420 Hz "fwump", a mesh rustle and 3-6 tiny cord clicks. **Tape:** the same plus a sharp 980 Hz tick.
- **Fence:** a 180 Hz thud and seven inharmonic wire modes (1.2-5.4 kHz, 30-100 ms) with a clatter. This one is new: `match.js` emits `fence` when a flying ball reaches it.
- **Paddle taps** between points (at the middle of between.js's tap): two damped faces.
- **Distance:** the listener is your player (the camera when nobody here plays).
  - Gain is `(4/d)^0.6`: -6.5 dB at 14 m, gentler than 1/r so the far side still reads.
  - A slight high cut: 15 kHz / (1 + d/7), at least 3.5 kHz.
  - A pan from the side of the screen.
- **Room:** a short stereo impulse response per venue (park 0.25 s; stadium 0.8 s, wetter) through one ConvolverNode.
- **Latency:** a render takes about 0.15 ms. Each sound is rendered once into an AudioBuffer (4 variations per quantized key, 160 keys kept). It starts at `ctx.currentTime` on the shared context, through `masterOutput` (the taskbar volume). Captured in Chrome, the onset comes within 0.1 ms of the scheduled time.

**Old vs new** (`shots/pb11/audio/`: `*-old.wav`, `*-new.wav`, `rally-new.wav`, `compare.png`, `compare.json`):
- **Old hit:** band-passed noise plus a sine sliding from 1.25-1.55 kHz down to 700 Hz over 70-100 ms. It was in the right register, but it took 33-37 ms to fall 20 dB (70+ ms to fall 40), its pitch fell (a "pew"), and it had no low thump or broadband crack.
- **Old bounce:** sat at 450 Hz.
- **New hit:** falls 20 dB within 2-5 ms and 40 dB by 12-18 ms dry (the venue's room adds the tail). Its spectrum follows the recording's shape, and it peaks at the paddle's mode (1230 Hz on the composite paddle).
- **New bounce:** peaks at about 700 Hz.
