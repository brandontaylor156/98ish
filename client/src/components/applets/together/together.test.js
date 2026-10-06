// Watch Together's pure parts: link parsing, the clock offset, where the video should be,
// and what a player does to catch up. node --test client/src/components/applets/together/together.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { canControl, clock, decide, DRIFT_SEEK, expectedPos, offsetFrom, parseStart, parseYouTube, peopleLine, SEEK_LEAD, userJumped } from "./syncCore.js"

test("YouTube links in every shape", () => {
  const id = "dQw4w9WgXcQ"
  for (const s of [
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtube.com/watch?feature=share&v=${id}`,
    `https://m.youtube.com/watch?v=${id}&list=PL1`,
    `https://music.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/shorts/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube.com/live/${id}?si=x`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `  ${id}  `,
  ])
    assert.equal(parseYouTube(s)?.id, id, s)
  assert.equal(parseYouTube(`https://youtu.be/${id}?t=42`).start, 42)
  assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${id}&t=1m5s`).start, 65)
  assert.equal(parseYouTube(`https://www.youtube.com/watch?v=${id}`).start, 0)
  for (const bad of ["", "hello", "https://vimeo.com/123456", "https://www.youtube.com/watch?v=short", "https://example.com/watch?v=dQw4w9WgXcQ"]) assert.equal(parseYouTube(bad), null, bad)
  assert.equal(parseStart("1h2m3s"), 3723)
  assert.equal(parseStart("90"), 90)
  assert.equal(parseStart("junk"), 0)
})

test("clock offset: the fastest round trip wins", () => {
  assert.equal(offsetFrom([]), 0)
  // device clock 5 s behind the server: server time = device time + 5000
  const samples = [
    { t0: 1000, t1: 1400, server: 6150 }, // slow trip (400 ms), lopsided
    { t0: 2000, t1: 2040, server: 7020 }, // fast trip: midpoint 2020 -> offset 5000
    { t0: 3000, t1: 3300, server: 8050 },
  ]
  assert.equal(offsetFrom(samples), 5000)
  assert.equal(offsetFrom([{ t0: 5, t1: 1, server: 9 }]), 0) // nonsense ignored
})

test("expected position moves with server time and speed", () => {
  const st = { playing: true, pos: 10, at: 1_000_000, rate: 1 }
  assert.equal(expectedPos(st, 1_002_500), 12.5)
  assert.equal(expectedPos({ ...st, rate: 2 }, 1_002_500), 15)
  assert.equal(expectedPos({ ...st, playing: false }, 1_009_000), 10)
  assert.equal(expectedPos(null, 5), 0)
})

test("catching up: small drift is left alone, big drift seeks ahead, play/pause follow", () => {
  assert.deepEqual(decide({ expected: 30, actual: 30.3, shouldPlay: true, isPlaying: true }), {})
  const behind = decide({ expected: 30, actual: 28, shouldPlay: true, isPlaying: true })
  assert.equal(behind.seek, 30 + SEEK_LEAD)
  // paused: lands exactly
  assert.equal(decide({ expected: 30, actual: 40, shouldPlay: false, isPlaying: false }).seek, 30)
  // just seeked: give it a moment
  assert.deepEqual(decide({ expected: 30, actual: 28, shouldPlay: true, isPlaying: true, sinceSeekMs: 500 }), {})
  // buffering a little behind: wait instead of seeking again
  assert.deepEqual(decide({ expected: 30, actual: 29, shouldPlay: true, isPlaying: false, buffering: true }), {})
  assert.deepEqual(decide({ expected: 30, actual: 30, shouldPlay: true, isPlaying: false }), { play: true })
  assert.deepEqual(decide({ expected: 30, actual: 30, shouldPlay: false, isPlaying: true }), { pause: true })
  assert.ok(DRIFT_SEEK <= 0.6)
})

test("a scrub on YouTube's own bar is told apart from normal playback", () => {
  const base = { last: 20, elapsedMs: 1000, rate: 1, wasPlaying: true, sinceSeekMs: 10_000 }
  assert.equal(userJumped({ ...base, actual: 21 }), false)
  assert.equal(userJumped({ ...base, actual: 21.8 }), false)
  assert.equal(userJumped({ ...base, actual: 75 }), true)
  assert.equal(userJumped({ ...base, actual: 5 }), true)
  assert.equal(userJumped({ ...base, actual: 75, sinceSeekMs: 800 }), false) // our own seek
  assert.equal(userJumped({ ...base, last: null, actual: 75 }), false)
})

test("who controls, clocks, people", () => {
  assert.equal(canControl({ anyone: true, hostKey: "a" }, "b"), true)
  assert.equal(canControl({ anyone: false, hostKey: "a" }, "b"), false)
  assert.equal(canControl({ anyone: false, hostKey: "a" }, "a"), true)
  assert.equal(clock(65), "1:05")
  assert.equal(clock(3725), "1:02:05")
  assert.equal(peopleLine([{ name: "Rosie" }, { name: "Theo" }]), "Rosie and Theo")
  assert.equal(peopleLine([{ name: "A" }, { name: "B" }, { name: "C" }, { name: "D" }, { name: "E" }]), "A, B, C and 2 more")
})
