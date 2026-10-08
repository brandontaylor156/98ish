# Pickleball 98: how pros move, and how our players do it

Research done on 2026-10-04 for the owner's request: "Research how real pro pickleball players move. Use Anna Leigh Waters and Ben Johns as your two top inspos for movement". It covers the research, the motion spec it became, what our players did wrong, and the measured results. The code is in `client/src/components/applets/pickleball/`: `pro.js` holds the numbers, plus `anim.js`, `strokes.js` and `locomotion.js`.

No motion capture of either player exists under a license we could use. Everything is procedural or keyframed from the material below, on top of the CC0 assets already in the game (see `CREDITS.md`). No real names appear in the game: the two playing styles are "Compact all-court" and "Aggressive two-hander".

## 1. Research

### Who
- **Ben Johns plays right-handed with a one-handed backhand.** He is 1.85 m tall. https://en.wikipedia.org/wiki/Ben_Johns
- **Anna Leigh Waters plays right-handed**, with a two-handed backhand. She is 1.68 m tall.
  - Handedness and height: https://en.wikipedia.org/wiki/Anna_Leigh_Waters
  - Two-handed backhand: https://pickleballunion.com/anna-leigh-waters-two-handed-backhand/

### Ready position
- **Paddle and arms.** The paddle is out in front at about chest height, elbows slightly bent and in front of the body. The tip points a little to the backhand side, about 11 o'clock for a right-hander. A two-handed player rests the second hand loosely on the handle. https://www.selkirk.com/blogs/pickleball-education/the-best-ready-position-for-pickleball
- **Stance at the kitchen.** Feet shoulder-width or wider, knees bent, weight on the balls of the feet, no leaning back. https://www.thedinkpickleball.com/stance-kitchen-tips/
- **Getting low.** Get low from the knees and hips, not the back. Hips go back, knees track over the toes, and the back is never angled forward more than the shins. https://www.thedinkpickleball.com/pickleball-knee-bend-stop-bending-your-back-to-get-low/
- **Ben Johns' paddle height.** He holds it around waist height, "maybe a touch higher", with the face neutral. https://proxrpickleball.com/blogs/blog/rethinking-the-pickleball-ready-position-lessons-from-the-pros-2
  - Another source has his tip up toward 10 to 11 o'clock: https://thepickleballgang.com/ben-johns-backhand-roll/
- **Anna Leigh Waters' stance.** She keeps her feet wide all match and holds the paddle high, which suits a two-handed backhand. https://www.thedinkpickleball.com/master-this-framework-to-develop-faster-hands-in-pickleball/

### Split step
- **Timing.** Land as you hear the other player's paddle, on the balls of the feet, knees absorbing. Lift up slightly rather than crash forward. https://www.thedinkpickleball.com/the-split-step-in-pickleball-fix-your-timing-now/
- **Shape.** A small hop timed to the opponent's contact, landing about shoulder-width. The hips drop 5 to 10 cm, which is "not a deep athletic squat". https://www.playwitharti.com/blogs/news/pickleball-transition-zone-footwork

### Footwork at the kitchen line
- **Shuffles.** Side shuffles with the chest to the net and the feet never crossing. https://www.thedinkpickleball.com/how-to-improve-pickleball-footwork-5-pro-drills/
- **Crossover and drop step.** A crossover step reaches wide balls. A drop step goes 45 degrees back with the hitting foot. https://usapickleball.org/blog/advanced-pickleball-footwork-crossover-and-drop-steps-at-the-kitchen-line/
- **Wide dinks.** Use an inside-foot cross-step, then recover to the middle. https://www.thedinkpickleball.com/wide-pickleball-dink-mistakes-and-how-to-fix-them-fast/
- **Lunges.** A lunge adds about 46 cm of reach. The front knee tracks over the second toe. https://www.thedinkpickleball.com/how-to-improve-pickleball-footwork-5-pro-drills/
- **Erne.** The sequence and the legality rules are at https://www.thedinkpickleball.com/erne-pickleball-setup-jump-legal-landing-explained/ (computer players have played Ernes and around-the-post shots since 2026-10-07; a person can hit an ATP too).

### Transition zone and resets
- **Moving in.** From the baseline to the kitchen (about 4.3 m) takes 4 to 6 steps, with a split at each opponent contact: 2 steps, split, 2 steps, split.
- **Reset posture.** Paddle in front of the sternum, low and forward.
- Source for both: https://www.playwitharti.com/blogs/news/pickleball-transition-zone-footwork
- **Ben Johns' push drop.** His knees bend so the hips drop toward the court. The paddle stays inside the lead leg, then the weight goes forward. https://www.thedinkpickleball.com/the-push-drop-ben-johns-uses-to-get-to-the-net-every-time/

### Dinks
- **Pendulum.** The shoulder drives the stroke, the wrist stays stable, and the elbow is quiet. The swing is compact so the player can recover at once. Weight is on the forefoot. https://www.pickletip.com/pendulum-dinking/
- **Ben Johns' backhand roll.** He gets low from the knees and drops the paddle below the ball. He swings up at about 40 degrees, with the forearm going from 90 degrees to full extension. https://primetimepickleball.com/how-to-hit-the-backhand-roll-with-ben-johns/
- **Anna Leigh Waters' backhand dink.** Her dink and her speed-up start from the same setup. https://www.thedinkpickleball.com/pro-analysis-the-real-reason-anna-leigh-waters-is-unbeatable/
- **Biomechanics.** High-level players flex the thigh more during the dink. Knee angle didn't differ between levels. Journal of Sports Sciences, 2025: https://pubmed.ncbi.nlm.nih.gov/40563204/

### Drives, speed-ups and hand battles
- **Ben Johns' drive.** Power comes from turning the hips and torso, not the wrist. He stays low, swings low to high, and makes contact out in front. https://pickleball.com/news/how-to-hit-a-topspin-drive-like-ben-johns
- **Anna Leigh Waters' two-handed backhand.** Her hands touch on the handle, and her feet move from the back foot to the front. The swing is a compact C-shaped low-to-high loop with contact out front. She uses it for drives, dinks, resets and blocks. https://pickleballunion.com/anna-leigh-waters-two-handed-backhand/
- **Anna Leigh Waters' hands and movement.** Her speed-ups and hands are fast. She is "always balanced", gets to top speed quickly and recovers quickly. https://www.thedinkpickleball.com/pro-analysis-the-real-reason-anna-leigh-waters-is-unbeatable/ and https://pickleball.com/people/why-is-anna-leigh-waters-so-dominant-zane-navratil-explains
- **Hand battles.** The paddle stays in front of the sternum. Each shot is a small punch with almost no backswing, and the paddle goes straight back to the chest. Knees bent, no jumping. https://www.thedinkpickleball.com/6-pickleball-hands-battle-habits-that-win-exchanges/

### Serve, return and overheads
- **Serve rules and motion.** The serve is underhand, with contact below the waist. https://www.pickleheads.com/guides/pickleball-serving-rules
  - Weight goes from the back foot to the front, low to high: https://www.thedinkpickleball.com/pickleball-serve-footwork-stance-load-weight-transfer/
- **Overheads.** Turn sideways and shuffle back. The other arm points at the ball and the elbow is about at ear height. Finish across the body. https://www.thedinkpickleball.com/overhead-smash-pickleball-technique-the-complete-guide/

### Numbers we could stand behind
- **Court.** 6.10 x 13.41 m with a 2.13 m kitchen. https://pickleballscience.org/how-fast-is-a-pickleball-serve/
- **Shot and ball.** Drives near the net reach about 72 km/h, and reaction time from 4.3 m is about 0.2 s. https://www.scientificamerican.com/article/pickleball-physics-explained-from-balls-and-paddles-to-shots/
- **Pro doubles points.**
  - Points last 10.7 s on average.
  - About 9.6 m covered per point.
  - 71% of shots come from the transition zone.
  - Source: https://www.tandfonline.com/doi/full/10.1080/24748668.2025.2457223
- **No joint angles published for pros.** Coaching describes the posture in words. The angles in the spec below are our reading of those words: knees "bent" with the back parallel to the shins, and a hip drop of 5 to 10 cm.

## 2. The motion spec (`pro.js`)
All values are for a right-hander and are mirrored for a left-hander.

| What | Spec | Where |
| --- | --- | --- |
| Ready at the kitchen: stance (ankle to ankle) | 0.58 m all-court, 0.62 m two-hander, ~0.64 m at the other side's contact (PPA footage ~0.65 m; 2026-10-08, was 0.50 / 0.56) | `READY.net.*.stance` |
| Ready at the kitchen: height | hips ~90% of upright at the other side's contact (PPA footage), knees ~25-45 deg; was 35-45 deg of knee from the coaching | `READY.*.crouch` |
| Ready at the kitchen: trunk | 23-24 deg forward, hips 7 cm back (back about parallel to the shins) | `lean`, `back` |
| Ready paddle | face about 1.15 m, 12-13 cm below the shoulders, about 0.4 m in front of the neck, tip to the backhand side; two-hander 8 cm higher with the other hand on the handle | `hand`, `tip` |
| Transition / baseline ready | by distance from the net (`ZONES`, blended): transition hips ~89%, baseline LOWER than the kitchen, ~85%, on a narrower base (PPA footage; was higher at the baseline) | `READY.mid`, `READY.base`, `readyFor(style, depth)` |
| Split step | leaves the court 0.13 s before the other side's contact; 3 cm hop; lands 3 cm wider each side; hips sink 2.5 cm (was 6); 0.36 s in all; not mid-sprint (over 2.2 m/s); computer players keep the momentum going the ball's way (match.js `SPLIT_BRAKE`) | `SPLIT`, `shouldSplit` |
| Kitchen footwork | slow moves at the net use cadence x 1.5, so the strides are shorter | `quickSteps` |
| Crossover | sideways over 2.1 m/s with more than 0.9 m to go: hips open 43 deg, feet free to cross, shoulders turned back 32 deg toward the net; stays on above 1.4 m/s | `CROSS`, `footworkFor` |
| Lunge / step out | contact more than 0.6 m to the side, or low and more than 0.75 m ahead: near foot out to 0.8 x the contact's side offset (low ball, up to 0.8 m) or 0.6 x (higher ball, up to 0.55 m); hips 75% of the way over the front foot; drops only after the front foot lands; front knee 80-100 deg, back knee under 45 deg | `LUNGE`, `lungePlan` |
| Low balls | hinge at the hips first (up to 52 deg of trunk), then the knees; stroke crouch arrives with the ball, not before | `anim.js` |
| Dink | a pendulum from the shoulder with the paddle in line with the arm; take-back about 10 cm; short lift that stops | `strokes.js` |
| Drive | take-back at about the ball's height (wrist under 1.2 m), unit turn 41 deg, finish in front of the other shoulder; hips 5 cm back, then 7 cm forward through contact; the front foot steps in from a standstill | `strokes.js`, `WEIGHT`, `stepIn` |
| Overhead | sideways ~57 deg as soon as the lob is read, the other hand pointing at the ball, a drop step back for a ball over or behind, the jump, the landing in the knees, through square with the smash | `OVERHEAD_SET`, `overheadTurn`, `dropStep`, `landingSink` |
| Two-hander | both hands on the handle (8.5 cm apart) from take-back to the high finish over the paddle shoulder; one hand only when stretching wider than 0.85 m | `twoHanded` |
| Punch / counter | 11 cm cock, short push, 0.22 s reset; hand battles 40% shorter still | `STYLES`, `styleTimes` |
| Running | runs lower (pelvis 3.5 cm down); less bob in runs and shuffles | `locomotion.js` |

## 3. What our players did wrong, compared with pros
These come from filmstrips made before the change (`shots/pb5/pre-*`) and the Node metrics.
- **"Sitting on a chair" at the kitchen.** Knees were bent 66 deg with the trunk nearly upright (11 deg). The paddle face was at shoulder height, in front of the face. Pros hinge at the hips with the chest over the knees and hold the paddle between the waist and the chest.
- **Feet too narrow and knees caving in.** The stance was 0.42 m, and the knees looked knock-kneed in front views.
- **Split step too late.** It started at the other side's hit and landed 132 ms after it. Pros land on the contact.
- **Strides at the kitchen.** Small moves were taken at 3.5 steps/s with 25 cm strides, where pros take quick small steps. Fast wide moves were giant side-shuffles; pros use a crossover.
- **Deep squats on low balls.** Dinks and resets dropped the pelvis to 0.55 m with the knees at 110 deg and the paddle hanging between the legs.
- **Lunges with both knees bent.** Both knees bent to about 85 deg instead of a long back leg.
- **Tennis-style drives.** The drive take-back held the paddle up by the head, and hand battles used big swings.
- **No two-handed backhand.**
- **No left-handers.**

## 4. Results

### Node
Pro doubles, 3 x 90 s, `pb5-metrics.mjs`.

| Metric | Before | After |
| --- | --- | --- |
| Ready at the kitchen: stance / knees / trunk | 0.42 m / 66 deg / 11 deg | 0.52 m / 43 deg / 24 deg |
| Ready paddle face height (below the shoulders) | 1.25 m (-0.01 m) | 1.16 m (0.13 m) |
| Split landing vs the other side's contact (median, p10-p90) | +132 ms (+127..+140) | -12 ms (-20..+5) |
| Slow moves at the net: steps/s, stride | 3.46, 0.25 m | 4.62, 0.19 m |
| Paddle face to ball at contact (median / p90) | 3.7 / 10.5 cm | 2.3 / 6.0 cm |
| Arm turn outside swings (p99, deg/frame) | upper 7.9, forearm 9.5 | 6.8, 8.7 |
| Straight-run head bob at 3 / 4.5 m/s | 3.4 / 5.3 cm (old: 3.5 / 4.0) | 2.1 / 2.1 cm |
| updateAnim cost per player-frame | 26-27 us | 28-29 us |

### Browser
Skinned athletes, `pb5-rally.mjs`.
- **Contact.** Paddle face to ball at contact, median 4.9-5.5 cm (before 4.8-5.8).
- **Holding the paddle.** Paddle in the hand: 0 mm.
- **Planted feet.** Ball-of-foot drift p99 2.1-3.5 mm (the original code measures 2.7-3.2).
- **Ready at the kitchen in play.** Stance 0.52-0.54 m, knees 43-45 deg, trunk 23-24 deg.
- **Frame rate.** 60 fps on desktop and phone.
- **With 4x CPU throttle.** 21 fps after vs 16 fps before (on a busy machine).

## 5. Left- and right-handed
- **Saved with the look.** The Locker Room's Plays and Pro style choices are saved in the look as `plays: right|left` and `backhand: one|two`, with `LOOK_VERSION` 3.
  - Looks saved before this (v1 or v2) play right-handed with one hand.
  - The server's look check allows both fields and keeps an older browser's version number.
- **The match.** `p.hand` and `p.twoHand` come from the look. They decide:
  - the forehand/backhand label;
  - the server's ball hand;
  - the computer's targets: speed-ups at the paddle-side hip and lobs over the backhand side;
  - who takes a ball down the middle in doubles (the player whose forehand is in the middle).
- **The animation.** It is worked out for a right-hander and mirrored, so every part follows the hand: strokes and sides, ready, serve, the arm swing while running, two-handed backhands and celebrations.
- **Computer players.** Kenji plays left-handed: 1 of the 10 characters, so about 10%. Rosa and Sam are two-handers.

## 6. Limitations
- **Not tried on a real phone.**
- **Very low balls close to the body** (under 35 cm, within 0.5 m) still need a deep knee bend to reach. The match decides where contact happens, so the animation can't move the player further back.
- **No Erne or ATP animation.** The match has no such shots.
- **Movement speed.** The split while running only dips the hips: the AI's movement, which is the physics, decides the actual speed.
- **The guest stand-in in online tests** often lets serves double-bounce. The original code does the same, so this isn't a regression.

## 7. Motion capture and motion matching (2026-10-04)
After "the walking mechanics suck, it looks like a cheap video game", the footwork is no longer
procedural on Medium/High: the legs, hips and trunk are real motion capture, picked frame by
frame by motion matching (the technique of Clavet's "Motion Matching and the Road to
Next-Gen Animation", GDC 2016, and Holden et al.'s "Learned Motion Matching", 2020), with
inertialization (Bollo, GDC 2018). Sources and licenses: `client/.../pickleball/CREDITS.md`.

- **Data.** 100STYLE (CC BY 4.0): Neutral (relaxed: between points), BentKnees (athletic: a
  rally), Rushed (a brisk walk back), StartStop (stops). 100STYLE's "runs" are jogs under 2 m/s,
  so CMU adds real running, cutting and stopping at 2-5 m/s (basketball subject 102, 127, 104,
  16, 09, 35, 128, 143), turning while walking (69) and two gestures (79). 23 minutes, mirrored at
  load: 83,580 searchable frames.
- **Pipeline** (`tools/build-motion.mjs`, Node built-ins only): BVH and ASF/AMC parsers, a
  canonical skeleton with the game's proportions, rest-pose alignment per bone (bone direction +
  a twist hint), root extraction (hips projected, facing smoothed), floor fit, foot-contact
  labels, quantized and gzipped (2.9 MB).
- **Runtime** (`mm/`): features = the root's position and facing 0.2/0.4/0.7 s ahead + both
  ankles' positions and velocities + the hips' velocity, normalized per group; a bounding-box
  accelerated search every 0.1 s (High) or 0.2 s (Medium), staggered between players; a jump
  only for a clearly better match; inertialization (half-life 0.12 s); the trajectory predicted
  with the match's own rule (12 m/s^2 toward the velocity the player wants, easing into a goal);
  root adaptation (the drawn body follows the animation's own root motion, pulled to the game's
  position: never more than 12-20 cm away, 3 cm when a stroke is coming); foot locking on the
  point that touched first, settling steps when a pinned foot falls behind, a lunge or a step-in
  as a pinned reach; a pelvis drop for reach; soft two-bone leg IK with the captured knee
  direction. The facing is the animation's; the search asks for the one `facingFor` picks, and a
  fast move is always run facing forward (turn and run for a lob).
- **On top** (anim.js): the ready position's forward lean, a wider stance (feet step out to the
  pro stance: measured 0.47 m, knees 41 deg, trunk 21 deg at the kitchen), the crouch for low
  balls, the split step's hop, every stroke (strokes.js) with its shoulder turn and bend at the
  waist; the captured arms swing on runs and hang between points; moods; between-point acts.
- **Between points and after the game** (`between.js`): partners tap paddles after each point
  as they pass; a glance at the partner every few seconds; a paddle twirl or a wipe of the hand on
  the shorts while waiting; the returner waits low and swaying; after the last point everyone
  walks to the net and taps paddles with the player across (match.js `walkToNet`). The big
  celebration and the frustrated arms-out are captured gestures (`mm/gesture.js`).
- **Pro behaviours covered:** relaxed walk back (paddle down), walking up with the partner,
  paddle taps, twirl, wipe on shorts, glance at partner, returner crouch, return-and-run with a
  real deceleration, split step on every opponent contact, kitchen shuffles (side steps, no
  crossing), turn and run for lobs, sprints and hard stops, lunges (a pinned reach with the back
  leg long), strokes and two-handers as before, celebrations and frustration, end-of-game taps.
  **Not yet:** a server bouncing the ball before serving (the ball is drawn by the engine),
  a captured crossover step (the CrossOver style was looked at but not used: too stylized; fast
  lateral moves use captured side runs or turn and run), a drop step specific to lobs (the
  turn comes from the captured cuts).
