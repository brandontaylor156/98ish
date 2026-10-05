# Pickleball 98: how the athletes' arms move

Written 2026-10-04 after the owner's note on the realistic athletes: "The arms of the players
still look completely creepy and unnatural." This is what was wrong, what real arms do, and how
the game now builds them. Code: `client/src/components/applets/pickleball/arms.js` (pure,
`arms.test.js`), `athlete.js` (applies it to the MakeHuman bodies), `anim.js` / `strokes.js` /
`pro.js` (where the hands are asked to go).

## 1. What was wrong (measured)

A new probe (`athlete.probeArms()`, `arms.js armMetrics`) reads the drawn bones and reports
each arm the way an anatomist would. Filmstrips of one athlete in 22 states (front and side,
close up), 336 arm-frames, before the change (`shots/pb10/before-*`, scratchpad
`pb10-film.mjs`, `pb10-stats.mjs`):

| Problem | Arm-frames | What it looked like |
| --- | --- | --- |
| Paddle wrist bent past what a wrist can do (100-160 degrees) | 154 / 336 | A broken wrist behind the paddle in ready, runs, every stroke |
| Forearm wrung past full pronation/supination (210-260 degrees) | 121 | Candy-wrapper twisting; 55% of the hand's roll was put on the forearm bone, so it twisted at the elbow |
| Bones stretched (up to 18%) | 63 | Long, rubbery arms reaching for targets set for a different skeleton |
| Elbow locked straight (under 8 degrees) | 85 | Mannequin arms: hanging straight, a straight free arm across the chest in ready, both arms crossed straight in an X in a low backhand dink |
| Humerus rotated past its range | 29 | Elbows pointing backward/up |
| Free hand never moved against its forearm | all | A rigid, mannequin hand: no wrist, fixed rotation |
| Shoulders dropped 14 degrees all the time | all | Slumped, sloping shoulders |
| Arms frozen | idle, celebrations | Nothing moved for seconds between points |
| Run: both hands clutching the paddle in front | jog, sprint | A tray carried at the belly, no arm swing at all |
| Ready: paddle at the belly, flat, free arm straight across | ready | Not a pickleball ready position |
| Drive finish: paddle in front of the face | drive | Holding up a sign |

The root causes: the paddle's orientation was dictated by anim.js without regard to the arm,
and the hand bone was simply forced onto it; the arm IK took fixed poles from a different,
narrower skeleton and stretched to reach; the free hand was copied from the rest pose; the
forearm twist went onto the forearm bone itself.

## 2. What real arms do (sources)

- **Joint ranges.** Forearm pronation about 75-85 degrees and supination 80-90 from neutral; wrist
  flexion 75-80, extension 70; radial deviation 20, ulnar 30-35; daily activity stays inside
  about 40 ulnar / 17 radial ([Eaton Hand normal ROM](https://www.eatonhand.com/nor/nor002.htm),
  [Ryu et al. functional ROM via Coupling between wrist flexion-extension and radial-ulnar
  deviation](https://www.researchgate.net/publication/8110020_Coupling_between_wrist_flexion-extension_and_radial-ulnar_deviation)).
  Used as `JOINTS` (hard) and `COMFORT` (where a hand sits when nothing makes it go further).
- **Shoulder girdle.** The scapulohumeral rhythm: of 180 degrees of arm elevation about 120 come
  from the glenohumeral joint and 60 from the scapula; the clavicle elevates up to about 15
  degrees late in elevation and rotates back ([Physiopedia: Scapulohumeral
  rhythm](https://www.physio-pedia.com/Scapulohumeral_Rhythm),
  [Orthofixar](https://orthofixar.com/special-test/scapulohumeral-rhythm/)). Used in
  `clavicleFor`: the clavicle rises past about 40 degrees of arm elevation, comes forward on
  reaches in front and across (protraction), back on a backswing (retraction), and out after a
  long reach.
- **Walking.** Arms swing out of phase with the legs (the right arm forward with the left foot),
  driven partly passively from the shoulder and partly by muscle; the elbow moves through about
  30 degrees; arm swing saves up to about 8% of the energy ([Meyns et al., Arm swing in human
  walking: what is their drive?](https://pubmed.ncbi.nlm.nih.gov/24865637/),
  [Wikipedia: Arm swing in human locomotion](https://en.wikipedia.org/wiki/Arm_swing_in_human_locomotion),
  [The elbow is the load-bearing joint during arm swing](https://pmc.ncbi.nlm.nih.gov/articles/PMC10277704/)).
  A hanging arm is never straight: the elbow rests 10-20 degrees bent (`RELAXED_ELBOW`).
- **Running.** Elbows about 90 degrees (70-110), the swing from the shoulder, forward and back,
  hands loose, not fists ([Canadian Running: proper arm
  swing](https://runningmagazine.ca/sections/training/a-runners-guide-to-proper-arm-swing/),
  [Kinetic Revolution](https://kinetic-revolution.com/running-arm-swing-for-endurance-athletes)).
  A rally run now pumps the arms (the paddle arm too when running hard), instead of carrying the
  paddle like a tray.
- **Ready position.** Paddle up in front of the chest, elbows bent and in front of the body, the
  paddle's head toward 11 o'clock (right-hander), the other hand resting on the paddle's throat;
  paddle and elbows make a triangle ([Selkirk: the best ready
  position](https://www.selkirk.com/blogs/pickleball-education/the-best-ready-position-for-pickleball),
  [Pickletip](https://www.pickletip.com/pickleball-ready-position/),
  [Sarah Ansboury: elbows on the table](https://sarahansbourypickleballacademy.com/keep-your-pickleball-elbows-on-the-table-to-avoid-tennis-elbow/)).
- **Strokes.** In a forehand the ball is met with the wrist extended (laid back) and the forearm
  near neutral to pronated; the follow-through adds humeral internal rotation and forearm
  pronation; the finish is by the other shoulder, not in front of the face ([Biomechanics and
  tennis, Elliott](https://pmc.ncbi.nlm.nih.gov/articles/PMC2577481/), [Wrist motion assessment in
  tennis players](https://pmc.ncbi.nlm.nih.gov/articles/PMC11129886/),
  [Kinematic differences between flat and topspin forehands](https://www.tandfonline.com/doi/full/10.1080/14763141.2018.1461915)).
  The grip doesn't change in a point (a continental grip): a forehand is hit with the palm's
  face, a backhand with the other, so the solver never regrips in the middle of a swing.
- **Hands.** At rest the fingers form a cascade: the index least flexed, the little finger most;
  the thumb rests flexed at its base ([Finger flexion cascade,
  JCDR 2020](https://jcdr.net/ReadXMLFile.aspx?id=13677), [Relaxed hand
  postures](https://www.researchgate.net/publication/271301878_Relaxed_hand_postures)).
  `FINGERS.relaxed`, `grip` (every finger wrapped, the index a little forward), `cup`, `fist`, `open`.
- **Skinning.** Linear blend skinning collapses a twisting joint (the candy wrapper); the usual
  cure is twist bones along the forearm and upper arm so the twist is spread along the limb, the
  way the radius turns round the ulna ([Jacobson and Sorkine, Stretchable and twistable
  bones](https://igl.ethz.ch/projects/stretchable-twistable-bones/),
  [polycount: forearm twist](https://polycount.com/discussion/87716/forearm-twist)).

## 3. How the arms are built now

- **Twist bones** (`athlete.js addTwistBones`, `arms.js splitTwistWeights`, `TWIST`): at load,
  two bones along each forearm (half and all of the hand's twist) and one at the top of each upper
  arm (taking back 60% of the humerus' roll near the shoulder) are added to the MakeHuman
  skeleton, and the skin weights are shared out by where each vertex lies along the limb. The
  forearm bone itself never twists. Clothes inherit the weights (`outfit.js` builds from them).
- **Arm solver** (`arms.js`): two-bone IK on the model's own bones, never stretched; a soft
  reach (the wrist comes up just short, the elbow never locks: `softReach`); the elbow's
  direction is chosen, not given (`chooseBend`): the swivel round the shoulder-wrist line that
  keeps the humerus, the forearm's twist and the wrist in range, the elbow and forearm out of the
  torso, near the stroke's wanted elbow and the anatomical default (`naturalBend`: down and a
  little out and back for a low hand, out to the side as the hand rises), and near last frame's
  (tracked: a few directions near last frame's; all round only when those are poor).
- **The paddle arm** (`solvePaddleArm`) has two modes, blended: *paddle-true* (the face's center
  and normal exactly where the shot needs them; the paddle's roll about its normal, the face
  behind the palm, and the elbow chosen together; used around contact, and whenever such an arm
  is comfortable, like the ready position) and *arm-first* (the wrist where the pose has it,
  relative to the shoulder; the hand turned the paddle's way as far as a comfortable wrist allows;
  the paddle follows the hand). The wrist's own move is rate-limited against its forearm, so a
  hand rides along with a fast forearm but never snaps round.
- **Carrying, not playing** (walking back, running with no ball coming): the paddle rides in a relaxed hand, thumb up, face to the side, instead of being held out flat like a tray.
- **Hands** rest relaxed with a little wrist flexion and ulnar deviation, the forearm turned as a
  resting one is (palm toward the thigh when hanging, more pronated up in front); a two-hander's
  top hand grips the handle above the bottom one. Finger shapes blend over a few frames.
- **Shoulder girdle** as above; breathing lifts it a little.
- **anim.js / strokes.js / pro.js**: the ready position raised with the head up toward 11
  o'clock; the forehand drive finishes by the other shoulder; the dink's free arm is out for
  balance at the waist; rally runs pump both arms; the arms lag a little behind the body's
  accelerations and drift a centimeter or so when standing.

## 4. Numbers

See CLAUDE.md (Pickleball 98 arms) for the before/after metrics, contact accuracy and frame cost.
