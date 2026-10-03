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
| Read the ball | A ring on the ball marks where you'll meet it. It's orange when the contact is above the net ("it's up: attack") and pale blue when it's low ("keep it low"). It grows during a hand battle. The aim ring is colored by pace. A dot shows where the ball would really land if it's off target (red when out). |
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
