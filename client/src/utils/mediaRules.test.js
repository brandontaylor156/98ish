// node --test client/src/utils/mediaRules.test.js
// Wave 2 "keep uploads as they are": what kind a file is, how it's kept, the caps and the
// device-only note.
import test from "node:test"
import assert from "node:assert/strict"
import * as R from "./mediaRules.js"
import * as S from "./driveStore.js"

const MB = 1024 * 1024

test("kinds: songs, videos and PDFs are recognized by type or name", () => {
  assert.equal(R.mediaKindOf({ name: "Song.mp3", type: "audio/mpeg" }), "song")
  assert.equal(R.mediaKindOf({ name: "voice.m4a", type: "" }), "song")
  assert.equal(R.mediaKindOf({ name: "track.flac", type: "" }), "song")
  assert.equal(R.mediaKindOf({ name: "a.mp4", type: "audio/mp4" }), "song") // an audio-only MP4
  assert.equal(R.mediaKindOf({ name: "IMG_0042.MOV", type: "video/quicktime" }), "movie")
  assert.equal(R.mediaKindOf({ name: "clip.webm", type: "" }), "movie")
  assert.equal(R.mediaKindOf({ name: "Ticket.PDF", type: "" }), "pdf")
  assert.equal(R.mediaKindOf({ name: "x", type: "application/pdf" }), "pdf")
  assert.equal(R.mediaKindOf({ name: "notes.txt", type: "text/plain" }), null)
  assert.equal(R.mediaKindOf({ name: "photo.jpg", type: "image/jpeg" }), null)
})

test("the type kept with a file (iPhone sometimes sends none)", () => {
  assert.equal(R.mediaMime({ name: "IMG_1.MOV", type: "" }), "video/quicktime")
  assert.equal(R.mediaMime({ name: "a.pdf", type: "application/octet-stream" }), "application/pdf")
  assert.equal(R.mediaMime({ name: "a.webm", type: "video/webm;codecs=vp9" }), "video/webm")
  assert.equal(R.mediaMime({ name: "a.mp4", type: "video/mp4" }), "video/mp4")
})

test("full-length audio is kept as it is: small inline, big on the device (no 30 s WAV)", () => {
  // a 5-minute MP3 (~5 MB): a data URL in the drive, can sync
  const small = R.planMediaStore({ kind: "song", size: 5 * MB, name: "Song.mp3" })
  assert.deepEqual(small, { ok: true, store: "inline", deviceOnly: false, note: null })
  // an hour-long mix (~80 MB): kept whole on this device, with the note
  const mix = R.planMediaStore({ kind: "song", size: 80 * MB, name: "Mix.mp3" })
  assert.equal(mix.ok, true)
  assert.equal(mix.store, "device")
  assert.equal(mix.deviceOnly, true)
  assert.match(mix.note, /Mix\.mp3 \(80 MB\) is kept on this device only/)
  assert.match(mix.note, /aren't synced or included in backups/)
})

test("PDFs and videos are accepted, within honest caps", () => {
  assert.equal(R.planMediaStore({ kind: "pdf", size: 300 * 1024, name: "menu.pdf" }).store, "inline")
  assert.equal(R.planMediaStore({ kind: "pdf", size: 50 * MB, name: "manual.pdf" }).store, "device")
  assert.equal(R.planMediaStore({ kind: "movie", size: 7 * MB, name: "clip.mp4" }).store, "inline")
  assert.equal(R.planMediaStore({ kind: "movie", size: 1500 * MB, name: "trip.mov" }).store, "device")
  // the 8 MB line: sync's per-file limit is 12 MB of text (= 9 MB of bytes)
  assert.equal(R.planMediaStore({ kind: "movie", size: R.INLINE_MEDIA_BYTES, name: "a" }).store, "inline")
  assert.equal(R.planMediaStore({ kind: "movie", size: R.INLINE_MEDIA_BYTES + 1, name: "a" }).store, "device")
  assert.ok(Math.ceil((R.INLINE_MEDIA_BYTES * 4) / 3) + 64 < 12 * MB)
})

test("caps: too big, empty, not media, no room, no IndexedDB", () => {
  const big = R.planMediaStore({ kind: "movie", size: 3 * 1024 * MB, name: "film.mp4" })
  assert.equal(big.ok, false)
  assert.match(big.error, /film\.mp4 is 3 GB\. Videos can be up to 2 GB\./)
  assert.match(R.planMediaStore({ kind: "song", size: 301 * MB, name: "x.mp3" }).error, /Songs can be up to 300 MB/)
  assert.match(R.planMediaStore({ kind: "pdf", size: 201 * MB, name: "x.pdf" }).error, /PDFs can be up to 200 MB/)
  assert.match(R.planMediaStore({ kind: "pdf", size: 0, name: "x.pdf" }).error, /empty/)
  assert.match(R.planMediaStore({ kind: "exe", size: 10, name: "x.exe" }).error, /isn't a song, video or PDF/)
  // the browser says only 100 MB are free: a 90 MB video doesn't fit with room to spare
  const room = R.planMediaStore({ kind: "movie", size: 90 * MB, name: "v.mp4", free: 100 * MB })
  assert.equal(room.ok, false)
  assert.match(room.error, /only has room for 80 MB more/)
  assert.equal(R.planMediaStore({ kind: "movie", size: 50 * MB, name: "v.mp4", free: 100 * MB }).ok, true)
  // a private window without IndexedDB: small files still fit, big ones can't
  assert.equal(R.planMediaStore({ kind: "song", size: 3 * MB, name: "s.mp3", canDevice: false }).ok, true)
  assert.match(R.planMediaStore({ kind: "song", size: 30 * MB, name: "s.mp3", canDevice: false }).error, /larger storage/)
})

test("sizes and titles read well", () => {
  assert.equal(R.sizeText(512), "1 KB")
  assert.equal(R.sizeText(80 * MB), "80 MB")
  assert.equal(R.sizeText(1536 * MB), "1.5 GB")
  assert.equal(R.titleFromName("Movie_Night.MOV"), "Movie Night")
  assert.match(R.DEVICE_ONLY_LINE, /On this device only \(over 8 MB/)
})

test("a big file's text in the drive is a short media reference", () => {
  const ref = S.mediaRef({ key: "mabc123", mime: "video/quicktime", size: 734003200 })
  assert.equal(ref, "98ish-media:mabc123;video/quicktime;734003200")
  assert.ok(ref.length <= S.INLINE_MAX) // kept inline in the index, never a big content
  assert.deepEqual(S.parseMediaRef(ref), { key: "mabc123", mime: "video/quicktime", size: 734003200 })
  assert.equal(S.isMediaRef(ref), true)
  assert.equal(S.isMediaRef("data:audio/mpeg;base64,AAAA"), false)
  assert.equal(S.parseMediaRef("98ish-media:../x;a;1"), null)
  // its size counts the real bytes (Drive C: Properties, quota)
  assert.equal(S.byteSize(ref), 734003200)
  const key = S.newMediaKey(5000)
  assert.match(key, /^m[\w]+$/)
  assert.ok(S.parseMediaRef(S.mediaRef({ key, mime: "application/pdf", size: 5000 })))
})
