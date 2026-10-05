# Pickleball 98: Practice, and how a good player plays

The owner: "Add a practice mode, add a ball machine mode within practice mode, add other ways to practice. It should be more obvious through this process how to play. Right now, it is NOT clear how a good player would play this game correctly." And: keep the UI simple.

## What's there (2026-10-04)
- **Title screen:** Quick Match first, then **Practice** (a visible big button), then Play Online; World Tour and 2 Players under More modes. The first time Pickleball opens (no saved prefs), a small card on the title offers "New to pickleball? Take the 2-minute lesson" / "Just play".
- **Practice hub** (`practice/PracticeHub.jsx`): three big tiles.
  - **Learn to play like a pro:** ten lessons (`practice/lessons.js`) with Coach Pat, a checklist of what's done.
  - **Ball Machine:** shot type tiles + speed; More options: spin, placement, balls a minute, balls, target zones (`practice/machine.js`).
  - **Drills:** eight drills, each one goal, 1-3 minutes, up to three stars (`practice/drillbook.js`).
  - "Controls Tutorial" (the older step-by-step controls tutorial, `drills.js TUTORIAL`) stays as a small button.
- **On court** (`practice/PracticeHud.jsx`): one bar (what you're doing, progress, Pause), one fading line per shot (label + the coach's word, or a "Tip:" when the same mistake happens in 2 of the last 3 shots), "Split!" as the machine hits in the split-step drill, the results at the end (stars, in/out/net, accuracy, average mph).
- **3D** (`practice/layer.js`, through the engine's `setLayer` hook): a boxy ball machine with a hopper in place of the feeder's figure, target zones that light up with "+3", the split-step ring and your home spot.

## The lessons, and why (sources)
1. **Your first 2 minutes:** tap soft, hold hard, let go as the ball arrives; over the net and in.
2. **The two-bounce rule:** the serve and the return must bounce before anyone volleys. USA Pickleball rules summary: https://usapickleball.org/rules/summary/ and https://www.pickleheads.com/guides/two-bounce-rule-in-pickleball
3. **Serve deep:** a deep serve keeps the returner back. https://pickleball.com/docs/en/article/pickleball-strategy-guide-how-to-win-more-points-games-and-matches
4. **Return deep, then come in:** deep returns push the serving team back and make the third shot harder; then get forward. https://www.thedinkpickleball.com/pickleball-doubles-strategy-for-beginners-5-simple-tips/ and https://pickleballus.org/play/shots/serve/return/
5. **Third shot: drop, then advance:** the drop lands in the kitchen, forces an upward ball and gives the serving team time to move in. https://www.thedinkpickleball.com/how-to-move-to-the-kitchen-line-after-the-third-shot-drop/
6. **Live at the kitchen line:** no volleys in the non-volley zone, and momentum after a volley can't carry you in. https://usapickleball.org/docs/rules/USAP-Official-Rulebook.pdf and https://centercourtpickleball.com/non-volley-zone-kitchen-explained-simple-breakdown/
7. **Dink and wait:** keep dinks low, make one more dink than you want to. https://www.thedinkpickleball.com/how-to-win-dinking-rallies-in-pickleball/
8. **Attack the high ball:** attack when the ball is above net height (about 34 in at the center strap), decide by ball height, not by time. https://www.thedinkpickleball.com/3-5-to-4-0-pickleball-4-fixes-that-actually-work/
9. **In trouble? Reset:** relaxed grip, absorb rather than swing, into the kitchen; split step and get balanced before contact. https://www.thedinkpickleball.com/7-essential-tips-to-navigate-the-pickleball-transition-zone/ and https://www.thedinkpickleball.com/3-pickleball-reset-fixes-that-stop-the-pop-up/
10. **Doubles: move as a unit;** the forehand takes the middle on slow balls (on fast balls at the kitchen the diagonal player covers it). https://www.thedinkpickleball.com/who-covers-the-middle-in-pickleball-doubles/ and https://www.paddletek.com/blogs/news/doubles-positioning-pickleball
- Split-step timing (drill): land as the other player hits. See `docs/pickleball-movement.md` (Split step) and https://www.thedinkpickleball.com/the-split-step-in-pickleball-fix-your-timing-now/

## How it works
- `practice/session.js` `createSession(spec)` is a `match.practice` object (begin/tick/shot/end/returns, the same hooks the old drills use). It feeds balls from `machine.js planFeed` (a plain description: where the machine and you are, the target on your side, `{ speed }` or `{ apex }`, spin, how many hits the rally counts as played, so the two-bounce rule applies to third-shot feeds and machine serves). It follows each of your shots to its first bounce (`m.landing`), or the coach volleying it, or the point's end, and turns it into a result `{ outcome: in | out | net | miss | fault, shot, landing, fed, feet, moveIn, volley }`, labels it (`classify.js`), scores zones (`targets.js`) and the drill's or lesson's `judge`, and reports `{ type: "drill", train: true, snap, result }` events.
- The machine takes the ball back as it lands on its side (a hopper), so the rate (balls a minute) isn't held up by the point ending. Volleys wait 0.6 s before they count (a momentum kitchen fault can still come); "return and move in" waits 2.2 s to measure how far you came in.
- The doubles lesson plays real points (you + a computer partner against two Rookies, who serve) and judges each point by how much of it (from the third shot on) you stayed level with your partner.
- Engine hook (only one): `api.setLayer(layer)`; the engine calls `layer.update(match, dt, figures)` each frame (match null in the demo). Input is untouched: practice uses whatever control scheme is set.

## Tests
- `node --test client/src/components/applets/pickleball/practice/practice-hub.test.js` (13): settings, feeds (every shot type and speed lands where planned, over the net), placement/left-handers/alternate, labels and hints, zones, machine sessions (rate, counts, stats, pause), every drill to its end with stars, lesson judges, lessons completed by the stand-in, the doubles lesson.
- Browser (scratchpad `pb9-*.mjs`, vite 5390 / server 8390): phone (390x844, iPhone UA, touch) and desktop: Practice, Ball Machine with the dev stand-in for 30 s, one drill to its end, the first lesson's card and task. Screenshots in `shots/pb9/`.

## Limits
- No Erne or around-the-post drill: the game recognizes them (shot labels) but players can't jump or run around the post on purpose yet.
- The stand-in (dev autoplay) never runs in after a return or splits, so those drills only test that they run.
- "Return and move in" counts 2 m forward within 2.2 s of your return.
