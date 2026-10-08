// node --test client/src/components/applets/mediaPlayer/videoLib.test.js
// Media Player's library: continue-where-you-left-off, search, playlists, durations, posters.
import test from "node:test"
import assert from "node:assert/strict"
import * as V from "./videoLib.js"
import { clampZoom, pageScale, PDFJS_CDN } from "../pdfViewer/pdfCore.js"

test("resume: picks up where you stopped, not at the very start or end", () => {
  assert.equal(V.resumePoint(null, 600), 0)
  assert.equal(V.resumePoint({ t: 4 }, 600), 0) // barely started
  assert.equal(V.resumePoint({ t: 125.5 }, 600), 125.5)
  assert.equal(V.resumePoint({ t: 590 }, 600), 0) // the credits: counts as watched
  assert.equal(V.resumePoint({ t: 96 }, 100), 0) // 96%: watched
  assert.equal(V.resumePoint({ t: 60, d: 300 }), 60) // length from the saved entry
})

test("resume list: saved, cleared when finished, capped by most recent", () => {
  let r = V.withResume({}, "k1", 42.123, 600, 1000)
  assert.deepEqual(r.k1, { t: 42.1, d: 600, at: 1000 })
  r = V.withResume(r, "k1", 599, 600, 2000)
  assert.equal(r.k1, undefined) // watched to the end: starts over next time
  let many = {}
  for (let i = 0; i < V.MAX_RESUME + 5; i++) many = V.withResume(many, `v${i}`, 30, 600, i)
  assert.equal(Object.keys(many).length, V.MAX_RESUME)
  assert.equal(many.v0, undefined) // the oldest went
  assert.ok(many[`v${V.MAX_RESUME + 4}`])
  assert.equal(V.progressOf({ t: 150 }, 600), 0.25)
  assert.equal(V.progressOf({ t: 2 }, 600), 0)
})

test("durations and poster sizes", () => {
  assert.equal(V.formatDuration(75), "1:15")
  assert.equal(V.formatDuration(3725), "1:02:05")
  assert.equal(V.formatDuration(0), "0:00")
  assert.deepEqual(V.posterSize(1920, 1080), { w: 320, h: 180 })
  assert.deepEqual(V.posterSize(1080, 1920), { w: 180, h: 320 }) // a phone video, upright
  assert.deepEqual(V.posterSize(0, 0), { w: 320, h: 180 })
  assert.equal(V.posterTime(30), 1)
  assert.equal(V.posterTime(4), 0.4)
})

test("search finds songs and videos by any words, accents ignored", () => {
  const items = [
    { title: "Café del Mar", artist: "Various", name: "cafe.mp3" },
    { title: "Beach day", name: "IMG_0042.MOV" },
    { title: "Señorita", artist: "Shawn", album: "Mendes", name: "s.m4a" },
  ]
  assert.equal(V.searchMedia(items, "").length, 3)
  assert.deepEqual(V.searchMedia(items, "cafe").map((i) => i.title), ["Café del Mar"])
  assert.deepEqual(V.searchMedia(items, "img_0042").map((i) => i.title), ["Beach day"])
  assert.deepEqual(V.searchMedia(items, "senorita shawn").map((i) => i.title), ["Señorita"])
  assert.equal(V.searchMedia(items, "nothing here").length, 0)
})

test("playlists keep their order and skip what's gone; videos sort newest first", () => {
  const items = [{ key: "a", title: "A" }, { key: "b", title: "B" }, { key: "c", title: "C" }]
  assert.deepEqual(V.playlistItems(["c", "x", "a"], items).map((i) => i.key), ["c", "a"])
  assert.deepEqual(V.sortVideos([{ title: "Old", added: 1 }, { title: "New", added: 5 }, { title: "Also", added: 5 }]).map((v) => v.title), ["Also", "New", "Old"])
})

test("PDF Viewer: zoom stays sensible, pages fill the width", () => {
  assert.equal(clampZoom(10), 4)
  assert.equal(clampZoom(0.1), 0.5)
  assert.equal(clampZoom("x"), 1)
  assert.equal(pageScale(612, 360), 360 / 612)
  assert.equal(pageScale(612, 360, 2), (360 / 612) * 2)
  assert.match(PDFJS_CDN, /^https:\/\/cdn\.jsdelivr\.net\/npm\/pdfjs-dist@3\.11\.174\/build\/$/)
})
