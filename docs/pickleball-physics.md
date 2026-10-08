# Pickleball 98: ball physics and how the game is played (2026-10-07)

The owner asked for "realistic physics, both pickleball physics as far as speed ... and how the
ball behaves", and play "how the top PPA pros actually play", keeping the speed settings. This
round rebuilt the ball, paddle and net physics from published measurements, changed the shot
model so every miss comes from the paddle and physics, and rewrote the computer players'
decisions around PPA pro patterns, then checked it all against real pro statistics with a rally
simulator. Animation and the athletes' look are not part of this round (another agent owns
them).

Files: `physics.js` (ball kinds, aero, bounce, net cord, paddle), `shots.js` (shot plans,
touch errors), `ai.js` (levels, decisions, positioning), `match.js` (strike, body hits, dodging,
stacking, kitchen braking), `rules.js` (refBody), `tools/rallysim.mjs` (the simulator), tests
`ballphysics.test.js`, `proplay.test.js` (+ updates in `pickleball.test.js`, `touch.test.js`,
`feel.test.js`, `gamefeel.test.js`).

## 1. The ball

| | outdoor ball | indoor ball | source |
|---|---|---|---|
| diameter | 74 mm (2.91 in) | 74 mm | Equipment Standards: 2.874-2.972 in |
| mass | 26.0 g | 23.2 g | Equipment Standards: 22.1-26.5 g (0.78-0.935 oz) |
| holes | 40 small | 26 large | Equipment Standards: 26-40; rulebook 3.C (larger holes customarily indoor) |
| drag coefficient Cd | 0.31, +0.002 per m/s over 5 m/s (cap +0.05) | 0.44 (same slope) | Lindsey 2025: outdoor 0.33 +/- 0.08, indoor 0.45 +/- 0.09, "constant or increases slightly with velocity"; Steyn et al. 2025: outdoor 0.30 +/- 0.02 |
| lift coefficient | 0.20 S topspin, 0.12 S backspin, 0.16 S side; cap 0.20 | 0.22 / 0.14 / 0.18; cap 0.22 | Steyn et al. 2025: Cl = 0.195 S (S = r w / v, 0.03-0.3 measured); Lindsey 2025: topspin lift stronger than backspin's |
| terminal velocity | ~17.5 m/s | ~13.5 m/s | from the above |
| spin decay | (0.10 + 0.02 v) per second: ~70-80% of the spin left after a 1 s flight | (0.12 + 0.022 v) | no pickleball measurement found; estimate (the holes drag on the shell) |
| court restitution | e = 0.70 - 0.01 vn (0.64 at the drop test's 6 m/s impact) | e = 0.705 - 0.011 vn | calibrated: 78 in drop -> 30-34 in rebound (Equipment Standards); harder impacts lose more |
| court friction | 0.45 | 0.40 | estimate: a hard plastic ball grips far less than felt (tennis ~0.6-0.8, Cross) |

Notes:
- **The brief said Cd ~0.4-0.6.** The two free-flight studies of real balls (2024-25) both
  measured lower values for the outdoor ball (0.30-0.33), and ~0.45 for the indoor ball; the
  game follows the measurements. 0.4-0.6 is the range older articles assume (NASA's smooth
  sphere 0.5); the old game used 0.48.
- **Which ball:** outdoor everywhere except My Park's indoor halls (`layout.spec.indoor`: Wolf +
  Bear, California SMASH...), where the regulars' games and your park games use the indoor
  ball (`createMatch({ ball })`, `m.ball.kind`; online both sides set it from the room's venue).
- **Bounce and spin** (`impact`): the normal impulse uses the speed-dependent restitution; the
  friction impulse at the contact point either ends the slip (rolling) or, if it can't (Coulomb
  limit mu * normal impulse), slides. Consequences, all tested: topspin kicks forward and comes
  off lower; slice skids through at the same pace and height as a flat ball (it can't take more
  than mu * N); a steep slice dink is grabbed and checks up; a tilted spin axis (sidespin) jumps
  sideways at the bounce; vertical-axis spin curves the flight.
- **Integrator:** fixed 240 Hz midpoint steps (`STEP`), plain JavaScript numbers, no wall-clock
  input: the same seed plays the same match step for step (`ballphysics.test.js` determinism),
  which online play (host-authoritative snapshots) and replays rely on. Near the net plane the
  step is split 4x (`flyWithNet`) so a fast ball can't skip through the cord.

## 2. The net

USA Pickleball rulebook 2026, 3.B: 36 in at the sidelines (3.B.6), 34 in at the center (3.B.7),
posts 22 ft apart (3.B.2), a 2 in tape on top (3.B.4). The game's net sags as a parabola between
those heights. The top is now a **cord** (radius 1.2 cm under the tape) that the ball collides
with like any surface (restitution 0.25, friction 0.3: a soft, sagging cord): a ball clipped on
top rolls over (a net-cord winner), one struck square drops back, and a ball below the tape goes
into the mesh and dies. The old net used fixed rules of thumb (keep 55% of the speed, pop up).
A serve that touches the net and lands in the box plays on (7.E: "with or without touching the
net"; there have been no lets since 2021). Balls round the outside of the post are good (13.C).

## 3. The paddle

- **Restitution:** USA Pickleball's PBCoR test fires a ball at ~60 mph at the paddle; the limit
  is 0.43 since Nov 2025 (0.44 before). That's the collision's own COR; a hand-held paddle
  recoils (effective mass ~0.17 kg at the sweet spot against the 26 g ball), so the ball "sees"
  an apparent COR e_A = (e - m/M) / (1 + m/M) = 0.24 at 60 mph (`PADDLE_COR`), a little higher on
  slow contacts (`paddleCorAt`: 0.30 at 10 m/s), and less off the sweet spot. Outgoing speed along
  the face normal = e_A x incoming + (1 + e_A) x face speed: a still paddle blocks a 45 mph
  speed-up back at ~11 mph; a full 21 m/s face (`MAX_PADDLE_SPEED`, ~47 mph at the sweet spot)
  sends a ball off at ~55-65 mph. (The old model used 0.42 "apparent", too lively.)
- **Spin:** textured faces make spin by friction during the 3-5 ms dwell (friction 0.32, the
  impulse model: the contact is far shorter than any flight, so it's treated as instantaneous).
  Capped at 2,300 rpm (`MAX_SPIN`): USA Pickleball's new certification caps paddles at 2,100 rpm
  from Oct 2026 (UPA-A since 2024); a pro serve off a tee measured 2,273 rpm.
- **What sets the shot:** the paddle's face angle and velocity (`paddleFor` solves them for the
  wanted ball: a normal push, a brush along the face for top/back spin, and a sideways brush
  for sidespin). Every error is applied to the paddle, never to the ball's result: face angle
  (yaw and pitch), push (a share of the face speed **plus a grip error proportional to the
  incoming ball's speed**: a firmer or softer hand changes the rebound, which is why soaking up a
  45 mph speed-up is hard and a dink off a dink is easy), contact offset (a deader ball).

## 4. Shots

- **Soft shots are planned by net clearance** (`solveShot({ clear })`, `SOFT_CLEAR`): a dink
  crosses ~0.17-0.29 m (6-11 in) over the tape and drops into the kitchen, a reset off a hard ball
  ~0.30 m (more margin: a miss should float, not net), a drop from the back ~0.28-0.43 m and lands
  1.5-2.0 m past the net. The solver finds the elevation (and matched speed) that both clears by
  that much and lands on the target. A third-shot drop from the baseline launches at ~10-11 m/s
  and 24-30 degrees. Steyn et al. 2025 found successful drops at 10.9-16 m/s and 12.5-22.5
  degrees; their model's net is 2 in lower than the real one (32/34 in), which flattens the
  window, so ours runs a few degrees steeper.
- **Touch** (`plan.wobble`): a soft shot's "touch error" (the old apex error in meters) is played
  as the paddle face opening or closing (`TOUCH_PITCH` 0.22 rad per m) and pushing firm or short
  (`TOUCH_PUSH` 0.35 per m); a late contact opens the face (`LATE_PITCH`). A closed face finds
  the net, an open face or too much push floats it up and long, where it can be attacked.
- **Low balls can't be driven down:** a hard swing at a ball below the tape keeps its pace and is
  lifted just enough to clear (`solveDrive`), so it lands deep or long, or reaches the other side
  high. A firm volley met below the tape is played as a topspin roll, not a punch.
- **Rolls / dippers:** brushed up hard (~1,700-2,000 rpm) at 15-25 mph so they clear the tape
  rising and dip.
- **Overheads** come down at 40-60 mph; speed-ups 35-55; serves 27-47 mph from soft to full.

## 5. Rules (checked against the 2026 USA Pickleball rulebook)

Everything that was already right stays: the two-bounce rule (10.A), double bounce (10.B), out
(10.C.1), kitchen volleys including a partner's contact (11.A.1), momentum into the kitchen even
after the ball is dead (11.A.2), volley serve (7.C: upward arc, paddle head below the wrist,
contact below the waist), serve placement and the kitchen line being short (7.E), side-out and
rally scoring (14.A: either side can win the game point under 2026 rally scoring), no lets.
New or fixed:
- **The ball hits a player = that player's fault** (10.C.3; on the serve 7.E.4 server's partner
  -> server's fault, 7.E.5 receiving side before the bounce -> theirs). `rules.js refBody`,
  `match.js bodyCheck`: a standing capsule (0.19 m, head 0.11 m); the hitter is skipped for
  0.25 s as the ball leaves. Computer players now step out of the way of a ball they aren't
  going to play (`dodgeFor`) and play any ball coming at their body even if it's going out.
- **Both feet outside before a volley** (11.A.3): the position check at contact; computer
  volleyers brake (14 m/s^2) so their toes stop at the kitchen line (no instant stops).
- **Erne:** a volley from just outside the sideline level with the kitchen is legal (the zone
  runs sideline to sideline, 11.A), and the AI uses it (below).

## 6. How the computer plays (PPA pro patterns)

Real pro numbers used (PPA stats wraps by Jim Ramsey; The Dink; pickleball.com):
- shots per rally in championship finals: 9.8-14.8 by match; 13.6 at the 2019 US Open and 10.65
  / 10.8 in two 2022 PPA finals; rallies of 9 shots or fewer 42% (2019) -> 57% (2022); 30+ shot
  rallies 7.7% -> 2.9-3.8% (Ramsey, "Pro pickleball 2019 vs 2022", 1,184 rallies);
- third shots 42-80% drops by match (2023 Masters: mixed 79%, men's 42%, women's 80%); drives
  converted at 53% vs drops 45% in one study; after a third-shot drive the fifth shot is a drop
  66% of the time, a firm volley 31% (Ramsey 2024, 371 drives);
- speed-ups win the rally ~55-58% (2023 Masters: 56% overall; one match 25-19 = 56%);
- deep returns win ~70% of rallies at 3.5+ vs ~50% for short ones (Gandhi 2024, ~2,000 rallies);
- volleys into the net are the most common pro error; dinks into the net/wide a few a match.

What the AI does now (`ai.js aiShot`, `planTeam`, `homeFor`; `match.js`):
- **Serve** deep with pace (Pro ~41 mph, Legend ~42; Rookie softer and safer), mostly
  middle/backhand; faults come from the paddle (a few % at the top, ~10% for Rookies).
- **Return** deep and unhurried, then the returning side comes to the kitchen line.
- **Third shot by situation:** base drop rate by level, but a short or sitting return
  (+20-25%) or returners who haven't come in (+20%) get driven, a low one dropped more.
- **Fifth shot after a drive:** a drop from the transition zone (~68%), or a drive if it sits up.
- **The dink battle:** cross-court by default, at the backhand, the top of the bounce (no more
  scooping balls off the court: dinks are met at 0.44-0.6 m, was 0.18-0.36). A dink met at
  about thigh height or above (`attackH`: Pro 0.50 m, Legend 0.48, Club 0.55, Rookie 0.40) gets
  attacked, a little lower once they're itchy (`patience`, `impatience`): from below the tape a
  roll or a flick at the paddle-side hip (a ball at someone's body doesn't have to land in:
  `paceThatFits({ bodies })`), from above it a speed-up, from up high a put-away at the feet or
  through the middle (`gap`). Against a ball machine it's a drill: they keep dinking.
- **Hand battles:** counter a hard ball met around the tape, reset one below it; how long a
  player needs (`hands`) grows with the ball's speed (beaten below 62% of that, late below it),
  and a ball jammed into the body is harder to play (`jam`).
- **Transition:** reset into the kitchen when caught in the middle against net players, drive
  one that sits up. Lobs stay rare (~0.5% of shots).
- **Doubles teamwork:** partners hold their serve/return positions until their side has hit
  (nobody walks across the serve); computer teams **stack** (Pro 60%, Legend 70% of games: each
  keeps the side that puts a forehand in the middle; the stacked partner waits off the court and
  they switch after the first shot); the net player **poaches** a ball at net height in the
  partner's half (then they switch sides); partners move as a unit toward the ball.
- **Erne and ATP:** a ball coming down the line over the kitchen can be taken from outside the
  sideline (Pro/Legend); a ball pulled wide past the post can go round it.
- **Levels** differ by consistency (face/touch/aim), decisions (patience, attack height, drop
  rate) and shot quality (power, serve pace), not superhuman speed: court speed 3.2/3.7/4.1/4.25
  m/s, reactions 0.30/0.22/0.17/0.15 s (Rookie/Club/Pro/Legend).
- **Nothing moves your player** (owner's rule): every change above applies to computer players
  only; your partner never takes a ball in your half.

## 7. The speed settings

All kept, and each now sits on real numbers:
- **Levels** (Rookie, Club, Pro, Legend): Rookies serve and drive ~30-35 mph, Club ~37-40, Pro
  ~41-45, Legend ~42-47 (`power`, `serve`); rally lengths ~4 / 6 / 11 / 12 shots.
- **Ball machine speeds** (Slow / Medium / Fast): unchanged feeds (drives 25 / 32 / 40 mph,
  volleys 25 / 30 / 36), now flown with the new ball.
- **Timing** (Relaxed / Normal / Strict) and **Focus** slow-motion: unchanged.
Ask the owner if "speed settings" meant something else (no game-speed option existed).

## 8. Measurements: before -> after

All-computer doubles, rally scoring to 11, 16 games a level (~300 points each), the same seeds
before and after: eginner (0 points): rally {"mean":null,"median":null,"p90":null,"max":null,"upTo4":null,"upTo9":null,"tenPlus":null,"twentyPlus":null}
 mix {}
 mph 
 third {} fifth-after-drive {}
 serve {"mph":null,"faultPct":0,"depthFromBaseline":{"median":null,"p90":null}} return {"median":null,"p90":null,"within2m":0}
 bounce apex ; drive flight null s
 dink phase {"ralliesWithDinks":null,"dinksMean":null,"attacksPerRally":null,"firstAttackWins":0}
 contact height after 
 ends {}
intermediate (0 points): rally {"mean":null,"median":null,"p90":null,"max":null,"upTo4":null,"upTo9":null,"tenPlus":null,"twentyPlus":null}
 mix {}
 mph 
 third {} fifth-after-drive {}
 serve {"mph":null,"faultPct":0,"depthFromBaseline":{"median":null,"p90":null}} return {"median":null,"p90":null,"within2m":0}
 bounce apex ; drive flight null s
 dink phase {"ralliesWithDinks":null,"dinksMean":null,"attacksPerRally":null,"firstAttackWins":0}
 contact height after 
 ends {}
pro (0 points): rally {"mean":null,"median":null,"p90":null,"max":null,"upTo4":null,"upTo9":null,"tenPlus":null,"twentyPlus":null}
 mix {}
 mph 
 third {} fifth-after-drive {}
 serve {"mph":null,"faultPct":0,"depthFromBaseline":{"median":null,"p90":null}} return {"median":null,"p90":null,"within2m":0}
 bounce apex ; drive flight null s
 dink phase {"ralliesWithDinks":null,"dinksMean":null,"attacksPerRally":null,"firstAttackWins":0}
 contact height after 
 ends {}
legend (0 points): rally {"mean":null,"median":null,"p90":null,"max":null,"upTo4":null,"upTo9":null,"tenPlus":null,"twentyPlus":null}
 mix {}
 mph 
 third {} fifth-after-drive {}
 serve {"mph":null,"faultPct":0,"depthFromBaseline":{"median":null,"p90":null}} return {"median":null,"p90":null,"within2m":0}
 bounce apex ; drive flight null s
 dink phase {"ralliesWithDinks":null,"dinksMean":null,"attacksPerRally":null,"firstAttackWins":0}
 contact height after 
 ends {}.
"Before" is commit cbb819a run with the same simulator. Shots count the serve (as the PPA stats
wraps do).

| measure | Club before → after | Pro before → after | Legend before → after |
|---|---|---|---|
| shots a rally, mean | 7.2 → 5.8 | 12.8 → 10.9 | 11.2 → 10.9 |
| median / p90 | 6 / 13 → 5 / 11 | 10 / 25 → 9 / 21 | 9 / 20 → 8 / 23 |
| rallies of 9 shots or fewer | 76.6% → 86% | 47.5% → 51.3% | 53.6% → 57.7% |
| rallies of 20+ | 1.4% → 0.6% | 17.2% → 13.9% | 11.3% → 13.3% |
| rallies of 30+ | 0% → 0% | 6.9% → 3% | 2.7% → 3.3% |
| third shots that are drops | 58% → 47% | 59% → 50% | 64% → 51% |
| serve speed, median mph | 35.6 → 36.6 | 35.9 → 41.5 | 35.8 → 42.1 |
| serve faults | 0% → 4.4% | 0% → 2.3% | 0% → 2.7% |
| serve lands, m inside the baseline (median) | 1.33 → 1.22 | 1.3 → 1.07 | 1.31 → 0.96 |
| return lands, m inside the baseline (median) | 1.58 → 1.93 | 1.49 → 1.55 | 1.49 → 1.51 |
| drive speed, median (p10-p90) mph | 43.4 (35.9-51.1) → 38.7 (32.3-47.7) | 44.1 (37.1-50.5) → 43.5 (37-49.9) | 45.6 (37.6-52.2) → 46.4 (39-54.8) |
| speed-up speed, median mph | 44.5 → 38.9 | 45.4 → 44.7 | 46.4 → 47.5 |
| overhead speed, median mph | 44.7 → 50.1 | 44.2 → 54.4 | 47.5 → 56.9 |
| dink speed, median mph | 15.2 → 14.3 | 14.8 → 14.4 | 14.9 → 14.5 |
| drop speed, median mph | 23.1 → 21.6 | 23.1 → 22.3 | 23.4 → 22.5 |
| serve bounce (apex, m) | 0.73 → 0.58 | 0.72 → 0.49 | 0.72 → 0.48 |
| dink met at (m, p10-median) | 0.2-0.37 → 0.43-0.49 | 0.18-0.36 → 0.44-0.48 | 0.23-0.36 → 0.44-0.48 |
| dinks per rally with dinks | 4 → 3.3 | 7.5 → 4.4 | 5.1 → 4 |
| first speed-up wins the rally | 45.5% → 69.2% | 59.6% → 62.5% | 71.3% → 59.2% |
| rally ends: winners (incl. body hits) | 19% → 13% | 29% → 30% | 45% → 37% |
| rally ends: into the net | 40% → 65% | 42% → 48% | 23% → 34% |
| rally ends: long or wide | 42% → 19% | 30% → 20% | 31% → 27% |
| rally ends: dinks into the net | 14% → 15% | 11% → 5% | 6% → 3% |
| rally ends: serve or return errors | 4% → 8% | 1% → 4% | 0% → 4% |

Real pro reference (PPA championship finals): 10.65 / 10.8 shots a rally (2022), 13.6 (2019),
9.8-14.8 by match; 57% of rallies 9 shots or fewer (2022), 42% (2019); third shots 42-80% drops
by match; speed-ups win ~56%; serves mostly 35-50 mph; drives and speed-ups 40-60; volleys into the
net the most common error.

Reading it:
- **Pro and Legend now match the 2022 pro game** (10.9 shots, 51-58% of rallies 9 or fewer, 3%
  of rallies 30+ shots), where
  before Pro played like 2019 (12.8, 47.5%) with a 92-shot outlier, and Legend won 45% of its
  rallies with speed-up winners (it had no real defense against them).
- **Nobody was a machine before:** 0% serve faults at every level and almost no return errors;
  now 2-3% at the top (Club ~4%, Rookie ~10%).
- **Serves** were all ~36 mph whatever the level; now Rookie ~35, Club ~37, Pro ~41, Legend ~42,
  deeper at the top, and they skid low off the court (bounce apex 0.72 -> 0.48 m: a hard topspin
  serve on a hard plastic ball).
- **Dinks are met at the top of the bounce** (0.44-0.48 m) instead of scooped off the court (p10
  was 0.18 m), and dink rallies are about half as long (7.5 -> 4.4 dinks at Pro).
- **Third shots** are now about half drops, half drives at Pro/Legend (the men's tour since 2023),
  chosen by the return (short or sitting: drive; deep and low: drop).
- **Overheads** come down at ~54-57 mph (was ~44-47); drives and speed-ups stay in the 40-55 band.
- **How rallies end:** into the net up (the pro tour's most common error), dinks into the net down
  (11 -> 5% at Pro), winners about the same at Pro (29 -> 30%) and down at Legend (45 -> 37%).

Other checks (scratchpad scripts, not in the repo):
- A person (the stand-in with real button timing, jitter 0.05 s) with a computer partner wins
  ~59% of points against Club and ~47% against Pro; their errors are mostly speed-ups long.
- Browser smoke (scratchpad `phys/smoke.mjs`, vite 5304 / server 8304, headless Chrome): Quick Match
  plays, Practice's ball machine feeds and records, Twin Replay's demo plays (the `playTwin` hook),
  My Park courts play at Riverside (outdoor ball) and Wolf + Bear (indoor ball), no page errors. The
  online room started and both sides kept the same score, but the headless stand-ins didn't return
  serves on either side; the same script on the base code (cbb819a) does exactly the same, so it's
  the harness (`netplay.test.js` passes). Worth a real two-device check.
- Frame sequences (0.1 s of game time apart, Pro doubles, the computer on every player; scratchpad
  `phys/frames/`): a dink rally and a third-shot drop at 390x844 and 1280x720, with contact sheets.
- Computer teams stack in most Pro/Legend games; ~28 poaches in 6 Legend games; Ernes are rare
  (about 1 in 6 Pro games, as on tour) and round-the-post shots rarer still.

## 9. Left / next

- **Not felt on a real iPhone.** The physics is measured against data, not against the owner's
  hands: the soft game may feel harder (resets of hard balls now fail more, as they do for real).
- **Drop launch angles** run ~24-30 degrees vs Steyn's 12.5-22.5 (their net is lower); real drop
  speeds of 24-36 mph vs our ~22 mph median.
- **Dinks** at ~14 mph sit at the top of the 5-15 mph range; a slower, loopier dink option would
  be more varied.
- **Spin decay** is an estimate (no pickleball measurement found); **court friction** too.
- **Long rallies:** 30+ shot rallies are now 3-3.3% at Pro/Legend (2022 tour 2.9-3.8%; Pro was
  6.9%), but 20+ shot rallies (13-14%) may still be a little common.
- **Ernes and ATPs** are rare (as on tour) and only the computer plans them; a person can do
  either by moving there themselves (the rules allow both).
- The ball's look doesn't change between the indoor and outdoor ball (the texture shows 26 holes).
- The animation's contact predictor (`strokes.js` predictContact, owned by the athletes round) flies
  the outdoor ball even indoors: add `kind: ball.kind` to its ball copy (strokes.js ~line 520) when
  that round lands (a few cm of swing timing at indoor venues; the match itself is right).
- Not done: wind, temperature (cold balls bounce lower), court surface differences beyond the
  ball kind, a drop serve (the volley serve only).

## Sources

- USA Pickleball, 2026 Official Rulebook (3.A court, 3.B net, 3.C ball, 3.D paddle, 7 serve, 10
  rally situations, 11 non-volley zone, 13 net, 14.A rally scoring); hosted copy:
  https://pickleballcanada.org/wp-content/uploads/2026/03/2026-Official-Rulebook-EN.pdf
- USA Pickleball Equipment Standards Manual (ball: 2.874-2.972 in, 0.78-0.935 oz, 26-40 holes,
  30-34 in bounce from 78 in on granite), summarized at
  https://olaben.com/blogs/olaben-blog/standard-size-of-a-pickleball
- USA Pickleball, PBCoR paddle test (limit 0.44 -> 0.43 Nov 2025; spin limit 2,100 rpm for
  certifications from Oct 2026): https://usapickleball.org/?p=62320 and
  https://usapickleball.org/?p=63852
- C. Lindsey (2025), Pickleball aerodynamics, Tennis Warehouse University (86 free-flight
  trajectories; Cd outdoor 0.33, indoor 0.45; topspin lift > backspin):
  https://twu.tennis-warehouse.com/learning_center/pickleball/pickleball_aerodynamics.php
- D. Steyn, T. Mithrush, C. Koentges, S. Andrews, A. Plourde (2025), Executing a Successful Third
  Shot Drop in Pickleball (Cd 0.30, Cl = 0.195 S; drop windows): arXiv:2501.00163 /
  SportRxiv
- K. Emond, W. Sun, T. Swartz (2024), Pickleball Flight Dynamics, arXiv:2409.19000
- Pickleball Science, spin and serve speeds: https://pickleballscience.org/pickleball-topspin-aerodynamics/
- The Dink, Rachel Rohrabacher 2,273 rpm serve; USAP spin test:
  https://thedinkpickleball.com/rachel-rohrabacher-rips-a-2-273-rpm-serve-in-extreme-slow-mo/ ,
  https://pickleballeffect.com/resources/usaps-new-spin-rate-test/
- Pickleball.com (2025), pro serve speeds (Ben Johns 68.35 mph, Anna Bright 56.5):
  https://pickleball.com/culture/how-fast-is-a-pickleball-serve-see-exact-serve-mph-of-top-pros-like-ben-johns-and-anna-bright ;
  Guinness: fastest legal serve 70 mph (Zane Navratil, 2024)
- J. Ramsey, PPA stats wraps: Masters finals 2023 https://ppatour.com/stats-wrap-post-masters-finals/ ;
  Red Rock Open 2024 https://www.ppatour.com/stats-wrap-championship-sunday-at-the-selkirk-red-rock-open/ ;
  Third shot drives, what happens next (2024) https://ppatour.com/third-shot-drives-what-happens-next/
- J. Ramsey (2022), Pro pickleball 2019 vs 2022, The Dink: https://thedinkpickleball.com/pro-pickleball-2019-vs-2022
- J. Gandhi (2024), Do deep returns win more rallies?, The Dink:
  https://www.thedinkpickleball.com/do-deep-returns-win-more-rallies-what-about-drives-vs-drops/
- R. Cross, The bounce of a ball / friction on courts (Am. J. Phys.), for the impulse-friction
  bounce model (sliding vs rolling at the contact).
