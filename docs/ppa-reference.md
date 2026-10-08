# Pickleball 98 vs. the PPA Tour: measured from match footage (2026-10-08)

The owner: "Medium is fine, but whatever is ultra realistic. Watch a pickleball match on the PPA
tour YouTube." The physics/PPA-play round (docs/pickleball-physics.md) was calibrated from papers
and published stats; this round measured real PPA Tour broadcasts and tuned the game against them.
The footage was downloaded privately for analysis (yt-dlp, kept in the session scratchpad, never
committed or redistributed, no frames used as art).

DRAFT: numbers below are filled in from the analysis (scratchpad `an/*/`).

## 1. The footage

| match | event | kind | URL | analyzed |
|---|---|---|---|---|
| Johns/Tardio v Daescu/Alshon | 2026 PPA National Championships, final | men's doubles | https://www.youtube.com/watch?v=6U1Y3o8EGOU | 2:00-27:00 |
| Waters/Bright vs Black/Todd | Veolia Atlanta Pickleball Championships, semifinal | women's doubles | https://www.youtube.com/watch?v=kO6ZG66S1a0 | 2:00-27:00 |
| Bright/Patriquin v Johnson/Johnson | 2026 PPA National Championships, final | mixed doubles | https://www.youtube.com/watch?v=xwuMxd__5-o | 2:00-27:00 |
| Federico Staksrud v Hunter Johnson | 2026 PPA National Championships, final | men's singles | https://www.youtube.com/watch?v=suwqL7Rk7NU | 2:00-27:00 |

All from the official PPA Tour channel, 1280x720 at 60 fps (AV1), the broadcast's own sound.

## 2. How it was measured

The repo's own tools were reused; the scratchpad scripts glue them together.

1. **The main camera.** Broadcasts cut between the fixed end camera (high behind one baseline)
   and sideline/close-up/replay shots. Every 0.1 s is scored against the most common view
   (64x36 thumbnails, correlation); the main camera's windows are kept (score >= 0.6:
   827 s of 1,500 in the men's final, 1,159 in the women's semi).
2. **The court.** Four rough corner taps, then every painted line is snapped to the white paint
   and the homography solved over ~450 snapped points (RANSAC): 0.8-1.1 px RMS. The camera is
   recovered from the homography with Real Ball's `cameraFromHomography` (2.75 m high, 3.9 m
   behind the baseline; the net tape projects exactly onto the picture's tape). The camera
   drifts <= 5 px over a match (0.1 m near, 0.25 m far). Resolution: ~50 px/m on the near half,
   ~10 px/m on the far half (behind the net).
3. **Players.** MediaPipe's person detector + Pose Landmarker (the model Twin Replay uses) on
   crops at 10 fps, then Twin Replay's tracker (`twin/core/tracker.js`: feet through the
   homography, Hungarian assignment, one-euro smoothing) per window.
4. **The ball.** Real Ball's detector at the analysis size (640 px) loses a 4-5 px ball during
   dinks, so a color-first finder ran at the full 1280x720, 60 fps: a saturated yellow-green
   blob that differs from the same pixel 0.2 s before and after (static yellow ads and the score
   bug drop out); shoes are masked with the player boxes. Candidates are linked into smooth image
   tracklets.
5. **Hits.** Paddle pops in the sound (Twin Replay's `onsets.js`) are candidates; bounces, shoe
   squeaks, voices and the crowd pop too (most pops inside rallies are 0.2-0.4 s apart), and their
   sound alone doesn't tell them apart (a classifier on band energies and decay was no better than
   chance). So a Viterbi chooses which pops are hits: every flight between two chosen hits must be
   explained by the game's own ball physics (Real Ball's `fitFlight`: drag, Magnus, the bounce),
   start at a player (a fit from each player's spot, the best kept), cross the net and end at a
   player on the other side; a rally starts with a serve from behind the baseline.
6. **Checks.** Hand-labeled from the ball track and the frames:
7. **Statistics.** Medians with p10-p90 and a bootstrap 90% interval of the median; only flights
   that fit well (rms < 3 px, >= 8 points, starting within 1.3 m of a player) count, and a gap
   between two hits counts only when the first flight arrives at the next hitter.

## 3. Real vs. the game

## 4. What changed

## 5. Speed settings: "Medium"

## 6. What couldn't be measured reliably

## For the animation work

## Where I am / next steps
