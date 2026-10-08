# Pickleball 98 vs. the PPA Tour: measured from match footage (2026-10-08)

The owner: "Medium is fine, but whatever is ultra realistic. Watch a pickleball match on the PPA
tour YouTube." The physics/PPA-play round (docs/pickleball-physics.md) was calibrated from papers
and published stats; this round measured real PPA Tour broadcasts and checked and tuned the game
against them. The footage was downloaded privately for analysis (yt-dlp, kept in the session
scratchpad, never committed or redistributed, no frames used as art).

**Short version:** with the same measuring method applied to the footage and to the game, the
game's players already move like the tour's (speeds, accelerations, how fast teams get to the
kitchen line, reaction) and its shots fly at the tour's speeds; the clear difference was the pace
between points (6 s in the game, ~13 s on tour). Medium is now real life: the game clock runs at
1x (it always did) and the between-points routine is the tour's (~13 s, a tap hurries it). What
broadcast footage could not measure reliably is listed in section 6.

## 1. The footage

| match | event | kind | URL | analyzed |
|---|---|---|---|---|
| Johns/Tardio v Daescu/Alshon | 2026 PPA National Championships, final | men's doubles | https://www.youtube.com/watch?v=6U1Y3o8EGOU | 2:00-27:00 |
| Waters/Bright vs Black/Todd | Veolia Atlanta Pickleball Championships, semifinal | women's doubles | https://www.youtube.com/watch?v=kO6ZG66S1a0 | 2:00-27:00 |
| Bright/Patriquin v Johnson/Johnson | 2026 PPA National Championships, final | mixed doubles | https://www.youtube.com/watch?v=xwuMxd__5-o | 2:00-27:00 |
| Federico Staksrud v Hunter Johnson | 2026 PPA National Championships, final | men's singles | https://www.youtube.com/watch?v=suwqL7Rk7NU | 2:00-27:00 |

All four from the official PPA Tour channel: 1280x720, 60 fps, the broadcast's own sound.
100 minutes of broadcast, of which 3,540 s were the main (end) camera.

## 2. How it was measured

The repo's own tools were reused; scratchpad scripts glue them together (`scripts/` there:
stage0.py, calib.py, stage1.py, ballcol.py, tracklets.mjs, rally.mjs, refit.mjs, agg2.mjs,
stance.mjs, sheets.py).

1. **The main camera.** Broadcasts cut between the fixed end camera (high behind one baseline)
   and sideline, close-up and replay shots. Every 0.1 s is scored against the most common view
   (64x36 thumbnails, correlation; a clean split at 0.6). Main-camera windows: 827 s of 1,500 in
   the men's final, 1,159 in the women's semi, 660 in the mixed final, 889 in the singles final.
2. **The court.** Rough corner taps, then every painted line is snapped to the white paint and
   the homography solved over ~450 snapped points (RANSAC): 0.8-1.1 px RMS. The camera is
   recovered with Real Ball's `cameraFromHomography`: 2.75 m up, 3.9 m behind the baseline; the
   net tape projects exactly onto the picture's tape. It drifts <= 5 px over a match (0.1 m on
   the near half, 0.25 m far). Resolution: ~50 px/m on the near half, ~10 px/m on the far half.
3. **Players.** MediaPipe's person detector + Pose Landmarker (the model Twin Replay uses) on
   crops at 10 fps, then Twin Replay's tracker (`twin/core/tracker.js`: feet through the
   homography, Hungarian assignment, one-euro smoothing) per window. Movement numbers use the
   near-half players only (5x the resolution), positions smoothed over 0.5 s, speed over 0.4 s.
4. **The ball.** Real Ball's detector at its 640 px analysis size loses the 4-5 px ball during
   dinks, so a color-first finder ran at the full 1280x720, 60 fps (a saturated yellow-green
   blob that differs from the same pixel 0.2 s before and after; static yellow ads and the score
   bug drop out; shoes are masked with the player boxes; 27-37 ms a frame), linked into smooth
   image tracklets.
5. **Hits.** Paddle pops in the sound (Twin Replay's `onsets.js`) are the candidates. Bounces,
   shoes, voices and the crowd pop too (most pops inside rallies are 0.2-0.4 s apart), and the
   sound alone doesn't separate them: a classifier on band energies and decay, trained on
   pops the ball's flight had confirmed, did no better than the base rate (precision 0.75 at
   75% hits). So a Viterbi picks the hits: every flight between two chosen pops must be explained
   by the game's own ball physics (Real Ball's `fitFlight`: drag, Magnus, the bounce), start at a
   player (a fit from each player's spot), cross the net and end at a player on the other side;
   a rally starts with a serve from behind the baseline. Then every flight is refitted with both
   ends anchored (hitter and receiver: a single camera leaves depth and height trading off along
   the ray).
6. **Checks by hand.** One long men's rally was labeled from the ball track and full-resolution
   frame sheets (ball circled, 12-15 fps): the automatic chain found 12 of its 14 first hits and
   added 2 that weren't (the serve's bounce taken for the return, a pop mid-flight). Elsewhere
   the chain is worse, and its serve-to-return gap (0.70 s median) is physically impossible
   (a serve needs ~1.2 s to reach the returner): the chain's shot-by-shot timing is NOT used;
   only its serves (between-points time) and the hand-labeled rally are.
7. **Statistics.** Medians with p10-p90 and a bootstrap 90% interval of the median ("CI").
   Ball numbers count only refitted flights that pass strict checks (rms < 2.5 px, >= 10 points,
   both ends within 0.8-1.0 m of the players): 64 of 2,179 flights in the doubles matches, 22 of 960 in the singles.

## 3. Real vs. the game

The game's side comes from `tools/rallysim.mjs` (computer Pro doubles, rally scoring, 4-6 games),
which now measures exactly what the footage measures (`observedKind` classes shots the way a
camera sees them; speed95/acc95 use the footage's smoothing). Doubles = the three doubles
matches pooled.

| measure | PPA Tour (median, CI, n) | game Pro before | game Pro after |
|---|---|---|---|
| between points: last hit to the next serve | **13.1 s** (10.7-15.4, n=143; men 14.1, women 8.7, mixed 18.5) | 5.9 s | **13.1 s** (Medium/Slow; Fast keeps ~6 s) |
| players' speed (95th percentile of each rally, near half) | 3.31 m/s (3.16-3.47, n=301) | 3.34 | 3.34 |
| acceleration (95th percentile, 0.4 s) | 4.9 m/s^2 (4.7-5.4, n=301) | 5.3 | 5.3 |
| returning team reaches the kitchen line, after the return | 1.6 s (1.5-2.0, n=25) | 1.52 | 1.52 |
| serving team reaches the line, after the serve | 4.85 s (3.85-7.65, n=58) | 4.03 | 4.03 |
| reaction: still player moving > 1.2 m/s after the far contact | 0.30 s (0.20-0.35, n=70) | 0.27 | 0.27 |
| dink speed | 14.5 mph (11.6-17.8, n=14) | 14.7 | 14.7 |
| dink, hit to bounce | 0.84 s (0.67-0.94, n=9) | 0.85 | 0.85 |
| drive speed (from the back) | 43.1 mph (38.7-46.4, n=9) | 43.5 | 43.5 |
| firm shot at the net (21-33 mph class) | 24.5 mph (23.9-30.7, n=6) | 24.2 | 24.2 |
| soft from the back (drops, resets) | 23.6 mph (22.5-25.1, n=10) | 21.5 | 21.5 |
| return speed | 33.7 mph (30.3-50.9, n=8) | 31.6 | 31.6 |
| game clock at the default speed | real time | 1x (no setting) | Medium = 1x |

Men's singles (Staksrud v Johnson), against the game's computer Pro singles:

| measure | PPA Tour (median, CI, n) | game before | game after |
|---|---|---|---|
| between points | **16.8 s** (12.5-18.4, n=53) | 5.9 s | **15.5 s** (+2.5 s singles serve routine) |
| players' speed (95th percentile, near half) | 4.07 m/s (3.71-4.30, n=54) | 3.89 | 3.89 |
| acceleration | 6.2 m/s^2 (5.5-6.6, n=54) | 6.1 | 6.1 |
| drive speed | 42.5 mph (40.3-58.4, n=10) | (doubles 43.5) | |
| serve speed | 52.5 mph (35-57, n=4: too few) | 41.5 | not changed |

Hand-labeled rally (men's final, 22 s, the first 14 hits): serve to return 1.24 s (game 1.12),
return to third shot 1.20 s (game 1.58), third to fourth 1.09 s; then a firm hands exchange at
the net at 0.35-0.54 s a hit (game: firm at net 0.40 s, fast 0.23 s) and dinks/resets ~0.9-1.5 s
(game dinks 1.10 s).

Reading it:
- **Movement already matched.** The previous round's choice of human (not superhuman) speeds
  and reactions holds up against the tour: every movement number is inside the footage's
  interval. Nothing moves your player for you (unchanged).
- **Shot speeds already matched** where the footage could measure them (dinks, drives, firm
  volleys, drops, returns), and a dink's flight time (0.84 vs 0.85 s) confirms the game's clock
  and ball run at real speed.
- **The pace between points did not**: the game rushed to the next serve in 6 s; on tour it's
  13 s (walk back, the score call, the server's routine), varying a lot by match. Medium now plays
  the real routine.
- **Possibly different, not changed (too uncertain):** the tour's returns looked flatter (apex
  1.69 m, CI 1.57-1.76, n=8, vs the game's 2.13 m) and the return-to-third gap in the one
  labeled rally was shorter (1.20 vs 1.58 s). The same fits put return contacts at ~1.35 m,
  higher than real, so the footage apex is probably biased; worth a hand-labeled check of more
  returns before tuning.

## 4. What changed

- `match.js`: `REAL_ROUTINE` (match option `routine: "real"`): the point sinks in for 4.0 s, a
  walk back at 1.4 m/s (was a brisk 2.0), the score call once everyone is in place (>= 3.2 s from
  the point's start, at most 9 s), then a computer server's own routine of 3.6 s +-1.5 s (singles +2.5 s) on top
  of their level's `serveWait`. A tap still skips the wait, now also during a computer server's
  routine (`press`). Practice, the title's demo, online games and Game speed Fast keep the quick
  routine; tests and the simulator default to quick (seeded matches are unchanged).
- `engine.js` / `menus.jsx` / `Pickleball.jsx`: **Game speed** in Settings: Slow (0.8x clock) /
  **Medium (real life)** (default) / Fast (1.2x, quick routine). Local games only; online games
  run at 1x.
- `tools/rallysim.mjs`: timing (hit-to-hit gaps, rally seconds, between points from the last
  hit), ball flight (apex, net clearance, flight to the bounce), movement (kitchen arrival, speed95,
  acc95, reaction, depth by shot number), `observedKind`, `--routine=real`.
- Tests: `ppa.test.js` (7): between points with the real routine 11.5-15 s (singles 13.5-18 s)
  and the quick one < 7 s, singles speed, Pro movement inside the tour's bands, shot speeds in the measured bands, observedKind,
  a tap hurrying a computer server, the Game speed defaults.

## 5. Speed settings: "Medium"

What existed: the four levels (Rookie/Club/Pro/Legend), Timing (Relaxed/Normal/Strict: the swing
window), Slow-mo on speed-ups (Focus), the ball machine's Slow/Medium/Fast feeds, Graphics
Low/Medium/High. There was no game-speed setting: the game always ran at 1x.

Decision: a new **Game speed** setting whose **Medium** is real life and the default: the clock at
1x and the tour's between-points routine. Slow (0.8x) is for learning, Fast (1.2x, quick between
points) for an arcade feel. Levels stay as they were (Pro/Legend are the tour's movement and shot
speeds; Club and Rookie are slower, softer and less consistent, as the previous round set them).
The ball machine's own Slow/Medium/Fast are unchanged (its Medium feeds 30-32 mph, a club drive).

## 6. What couldn't be measured reliably

- **Shot-by-shot timing and shots per rally** from automatic hit finding: pops are mostly not
  hits, and the physics chain confuses bounces with hits. Shots per rally keep the published
  PPA numbers (1,184 rallies, docs/pickleball-physics.md); the hand-labeled rally is one rally.
- **Ball heights and net clearance**: a single end camera 2.75 m up leaves a far ball's height
  and depth trading off; contact heights came out too high (dinks ~1.1 m), so apex and clearance
  numbers are biased and not used for tuning.
- **Split-step timing**: needs foot contact at 30+ fps; at 10 fps the players' speed at the far
  side's contact (median 1.0 m/s, n=471) only says that many are still moving then.
- **Far-half players**: 10 px/m behind the net mesh; movement numbers use the near half only.
- **The women's semifinal's ball**: on its green court the color finder kept almost nothing that
  passed the checks (0 flights); its movement and between-points numbers are used.
- **Serve speeds and depths**: too few clean serves (n=3); the published 35-50 mph stays.

## For the animation work

Measured on the near-half players (MediaPipe world landmarks; its absolute scale runs small: an
upright hip-to-ankle reads 0.74 m, so use the ratios). n = pose samples.
- **Upright reference:** hips above the ankles 0.74 (0.69-0.76) in MediaPipe units (n=285
  player-windows).
- **Ready at the kitchen line while the other side hits:** hips at **90%** of upright (73-100%),
  knees **156 deg** (144-167; ~25 deg of bend), feet **0.55** apart (0.21-0.77; ~0.65 m in real
  units, wider than shoulders) (n=190).
- **Ready at the baseline while the other side hits:** lower, hips at **85%** (63-99%), knees
  150 deg (124-164), feet 0.47 apart (n=248).
- **Ready in transition:** hips 89%, knees 153 deg, feet 0.44 (n=78).
- **At their own contact:** at the kitchen hips 87% (69-99%), knees 156 deg, feet 0.54 (wide:
  dinks and volleys are played from a wide base) (n=179); at the baseline 92%, knees 150 deg,
  feet 0.38 (n=239: groundstrokes come up out of the crouch); in transition 88%, knees 153, feet
  0.39 (n=53).
- **Speeds:** each player's 95th-percentile speed in a rally 3.3 m/s (men 3.6, mixed 3.5, women
  3.2; singles 4.1), acceleration 4.9 m/s^2 over 0.4 s (men 5.3, women 4.3, singles 6.2): short
  bursts, not sprints.
- **Reaction:** a player standing still starts moving (> 1.2 m/s) 0.30 s after the far contact
  (0.20-0.35).
- **Split step:** not resolvable at 10 fps; at the far side's contact players are often still
  drifting (median 1.0 m/s), so a split step should not freeze the feet: a small hop that keeps
  some momentum.
- **Kitchen arrival:** the returning team is at the line 1.6 s after the return (a walk-jog
  forward, through the return's flight), the serving team 4.9 s after the serve (they wait for the
  third shot, then move up in stages).
- **Contact heights:** not reliable from the single camera (section 6).

## Where I am / next steps

- Done: the measurements above, the real between-points routine, Game speed, tests, docs.
- Done (2026-10-08, the athletes' movement round, `docs/pickleball-log.md`): the animation notes
  above are in the game. Ready stances by court position at the other side's contact (hips 0.88-0.90
  at the kitchen, 0.87 in transition, 0.82-0.83 at the baseline; kitchen feet 0.64 m with motion
  matching), a lighter split step that keeps momentum, reaction 0.30 s (Pro) / 0.28 (Legend), the
  serving team at the line 4.75 s after the serve (was 4.07; moves up in stages), returners 1.55 s,
  speed95 3.17 m/s, acc95 5.24, a real overhead set-up. Not matched: knee angles (133-136 vs 156:
  the footage's knees are likely read straight from the end camera, and a 90%-tall, 0.65 m-wide
  stance can't straighten past ~140 in a rigid leg), the far-contact speed (0.40 vs 1.0 m/s), own
  contact at the baseline (hips 0.80 vs 0.92).
- Next (if wanted): hand-label 20-30 more rallies with `sheets.py` (full-resolution frames with
  the ball circled are readable at 12-15 fps) to measure shot-by-shot timing, returns and shots
  per rally properly; a second camera angle (sideline replays) would fix ball heights.
