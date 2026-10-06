import test from "node:test"
import assert from "node:assert/strict"
import { exifDate, parseExifTime, dateFromName, photoTime, onThisDay, clusters, rangeTitle, dailyNotice, memoriesOf } from "./memoriesCore.js"
import { fitWithin, isUnseen, unseenCount, activityText, membersText, canRemoveItem, canRemoveComment, retryDelay, isHardError, queueText, likeText } from "./albumsCore.js"

// A JPEG with an EXIF block: IFD0 (DateTime + a pointer to the Exif IFD) and an Exif IFD
// (DateTimeOriginal, optionally OffsetTimeOriginal), in either byte order
const jpegWithExif = ({ little = true, original = "2023:07:14 18:30:05", ifd0Time = "2020:01:01 00:00:00", offset = null } = {}) => {
  const tiff = []
  const u16 = (n) => (little ? [n & 255, n >> 8] : [n >> 8, n & 255])
  const u32 = (n) => (little ? [n & 255, (n >> 8) & 255, (n >> 16) & 255, n >>> 24] : [n >>> 24, (n >> 16) & 255, (n >> 8) & 255, n & 255])
  const str = (s) => [...s].map((c) => c.charCodeAt(0)).concat(0)
  // layout: header(8) | IFD0 (2 + 2*12 + 4 = 30) | Exif IFD (2 + n*12 + 4) | strings
  const exifCount = offset ? 2 : 1
  const ifd0At = 8
  const exifAt = ifd0At + 30
  const dataAt = exifAt + 2 + exifCount * 12 + 4
  const s0 = str(ifd0Time)
  const s1 = str(original)
  tiff.push(...(little ? [0x49, 0x49] : [0x4d, 0x4d]), ...u16(42), ...u32(ifd0At))
  tiff.push(...u16(2))
  tiff.push(...u16(0x0132), ...u16(2), ...u32(s0.length), ...u32(dataAt))
  tiff.push(...u16(0x8769), ...u16(4), ...u32(1), ...u32(exifAt))
  tiff.push(...u32(0))
  tiff.push(...u16(exifCount))
  tiff.push(...u16(0x9003), ...u16(2), ...u32(s1.length), ...u32(dataAt + s0.length))
  if (offset) {
    const so = str(offset)
    tiff.push(...u16(0x9011), ...u16(2), ...u32(so.length), ...u32(dataAt + s0.length + s1.length))
    tiff.push(...u32(0), ...s0, ...s1, ...so)
  } else tiff.push(...u32(0), ...s0, ...s1)
  const app1 = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff]
  const len = app1.length + 2
  // SOI, an APP0 first (like most cameras), then APP1, then SOS
  const app0 = [0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0]
  return new Uint8Array([0xff, 0xd8, ...app0, 0xff, 0xe1, len >> 8, len & 255, ...app1, 0xff, 0xda, 0, 2]).buffer
}

test("EXIF: DateTimeOriginal in both byte orders, with a time zone offset, and junk", () => {
  const want = new Date(2023, 6, 14, 18, 30, 5).getTime()
  assert.equal(exifDate(jpegWithExif({ little: true })), want)
  assert.equal(exifDate(jpegWithExif({ little: false })), want)
  assert.equal(exifDate(jpegWithExif({ offset: "-07:00" })), Date.UTC(2023, 6, 15, 1, 30, 5))
  // no DateTimeOriginal (blank): falls back to IFD0's DateTime
  assert.equal(exifDate(jpegWithExif({ original: "    :  :     :  :  " })), new Date(2020, 0, 1).getTime())
  assert.equal(exifDate(new Uint8Array([1, 2, 3, 4]).buffer), null)
  assert.equal(exifDate(new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0, 2]).buffer), null)
  assert.equal(exifDate(new ArrayBuffer(0)), null)
  // a truncated file never throws
  assert.equal(exifDate(jpegWithExif().slice(0, 40)), null)
  assert.equal(parseExifTime("2023:02:30 10:00:00") !== null, true, "the parser leaves calendar checks to Date")
  assert.equal(parseExifTime("1800:01:01 00:00:00"), null)
})

test("dates from camera-style file names", () => {
  assert.equal(dateFromName("IMG_20240305_142210.jpg"), new Date(2024, 2, 5, 14, 22, 10).getTime())
  assert.equal(dateFromName("PXL_20231224_090102345.jpg"), new Date(2023, 11, 24, 9, 1, 2).getTime())
  assert.equal(dateFromName("Screenshot 2022-08-01 at 10.15.30.png"), new Date(2022, 7, 1, 10, 15, 30).getTime())
  assert.equal(dateFromName("beach 2021-06-19.jpg"), new Date(2021, 5, 19, 12).getTime())
  assert.equal(dateFromName("PHOTO0001.jpg"), null)
  assert.equal(dateFromName("IMG_20230231.jpg"), null, "no February 31st")
  assert.equal(dateFromName("call 5551234567.jpg"), null)
})

test("photoTime: saved taken date, then the name, then when the file changed", () => {
  assert.equal(photoTime({ meta: { taken: 1000 }, name: "IMG_20240305.jpg", mtime: 5 }), 1000)
  assert.equal(photoTime({ meta: {}, name: "IMG_20240305.jpg", mtime: 5 }), new Date(2024, 2, 5, 12).getTime())
  assert.equal(photoTime({ name: "PHOTO0001.jpg", mtime: 5 }), 5)
})

const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime()

test("On this day: the same date in earlier years, newest year first", () => {
  const now = at(2026, 10, 5, 9)
  const photos = [at(2025, 10, 5, 8), at(2025, 10, 5, 20), at(2023, 10, 5), at(2026, 10, 5, 7), at(2024, 10, 6), at(2022, 9, 5)].map((time, i) => ({ id: i, time }))
  const groups = onThisDay(photos, now)
  assert.deepEqual(groups.map((g) => [g.year, g.yearsAgo, g.items.length]), [[2025, 1, 2], [2023, 3, 1]])
  assert.deepEqual(dailyNotice(photos, now), { title: "Memories: On this day", text: "3 photos from 2 years", count: 3 })
  assert.equal(dailyNotice(photos, at(2026, 1, 1)), null)
  assert.deepEqual(dailyNotice([{ time: at(2024, 10, 5) }], now).text, "1 photo from 2 years ago")
})

test("trips and days out: split by gaps, small groups skipped, newest first, titles", () => {
  const trip = [at(2025, 7, 3, 9), at(2025, 7, 3, 15), at(2025, 7, 4, 10), at(2025, 7, 4, 18), at(2025, 7, 5, 11), at(2025, 7, 6, 9)]
  const dayOut = Array.from({ length: 9 }, (_, i) => at(2025, 9, 20, 10) + i * 600_000)
  const few = [at(2025, 8, 1), at(2025, 8, 2)]
  const photos = [...trip, ...dayOut, ...few].map((time) => ({ time }))
  const out = clusters(photos)
  assert.deepEqual(out.map((c) => [c.kind, c.items.length, c.days]), [["day", 9, 1], ["trip", 6, 4]])
  assert.equal(out[0].title, "Saturday, September 20, 2025")
  assert.equal(out[1].title, "July 3 – 6, 2025")
  assert.equal(rangeTitle(at(2025, 3, 30), at(2025, 4, 2)), "Mar 30 – Apr 2, 2025")
  assert.equal(rangeTitle(at(2024, 12, 30), at(2025, 1, 2)), "Dec 30, 2024 – Jan 2, 2025")
  const m = memoriesOf(photos, at(2026, 7, 4))
  assert.equal(m.onThisDay.length, 1)
  assert.equal(m.trips.length, 2)
})

test("albums: badge, activity lines, permissions, retry timing", () => {
  const albums = [
    { id: "a", lastBy: "tina", lastByName: "Tina", lastWhat: "added 3 photos", changedAt: 200, members: [{ key: "me", name: "Me" }, { key: "tina", name: "Tina" }] },
    { id: "b", lastBy: "me", lastWhat: "commented: hi", changedAt: 300, members: [{ key: "me", name: "Me" }] },
    { id: "c", lastBy: "sam", lastByName: "Sam", lastWhat: "liked a photo", changedAt: 100, members: [] },
    { id: "d", lastBy: null, lastWhat: "A member deleted their account", changedAt: 500, members: [] },
  ]
  const seen = { c: 150 }
  assert.equal(isUnseen(albums[0], seen, "me"), true)
  assert.equal(isUnseen(albums[1], seen, "me"), false, "my own change isn't news")
  assert.equal(isUnseen(albums[2], seen, "me"), false, "seen since")
  assert.equal(unseenCount(albums, seen, "me"), 1)
  assert.equal(activityText(albums[0], "me"), "Tina added 3 photos")
  assert.equal(activityText(albums[1], "me"), "You commented: hi")
  assert.equal(activityText(albums[3], "me"), "A member deleted their account")
  assert.equal(membersText(albums[0], "me"), "With Tina")
  assert.equal(membersText(albums[1], "me"), "Only you so far")
  assert.equal(membersText({ members: ["a", "b", "c", "d", "e"].map((k) => ({ key: k, name: k.toUpperCase() })) }, "me"), "With A, B and 3 others")
  const album = { owner: "own" }
  assert.equal(canRemoveItem(album, { by: "me" }, "me"), true)
  assert.equal(canRemoveItem(album, { by: "x" }, "me"), false)
  assert.equal(canRemoveItem(album, { by: "x" }, "own"), true)
  assert.equal(canRemoveComment(album, { by: "x" }, "own"), true)
  assert.equal(canRemoveComment(album, { by: "x" }, null), false)
  assert.deepEqual([1, 2, 3, 10, 20].map(retryDelay), [30_000, 60_000, 120_000, 30 * 60_000, 30 * 60_000])
  assert.equal(isHardError({ ok: false, status: 413 }), true)
  assert.equal(isHardError({ ok: false, status: 503, resting: true }), false)
  assert.equal(isHardError({ ok: false, offline: true }), false)
  assert.equal(queueText([{}, {}, { error: "too big" }]), "2 waiting to upload, 1 couldn't be added")
  assert.deepEqual(fitWithin(4032, 3024, 2048), { w: 2048, h: 1536 })
  assert.deepEqual(fitWithin(100, 50, 2048), { w: 100, h: 50 })
  assert.equal(likeText({ likes: ["me", "tina"] }, "me", { tina: "Tina" }), "You and Tina liked this")
  assert.equal(likeText({ likes: ["a", "b", "c", "d"] }, "me", {}), "a, b and 2 more liked this")
})
