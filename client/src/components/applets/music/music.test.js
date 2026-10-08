// Music 98: the tag reader (ID3v2.2/2.3/2.4 + v1, MP4, FLAC, Ogg) on hand-built files, and
// the library/queue logic. node --test client/src/components/applets/music/music.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { TAG_READ_ALL, guessFromName, mimeFor, parseTags, tagBytes } from "./tags.js"
import { albumKeyOf, append, dropKey, filterTracks, groupAlbums, groupArtists, insertNext, makeQueue, nextPos, prevPos, reshuffle, shuffled, sortSongs, titleOf } from "./library.js"

const enc = new TextEncoder()
const bytes = (...parts) => {
  const arrays = parts.map((p) => (typeof p === "string" ? Uint8Array.from(p, (c) => c.charCodeAt(0) & 0xff) : p instanceof Uint8Array ? p : Uint8Array.from(p)))
  const out = new Uint8Array(arrays.reduce((s, a) => s + a.length, 0))
  let i = 0
  for (const a of arrays) {
    out.set(a, i)
    i += a.length
  }
  return out
}
const be32 = (n) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
const be24 = (n) => [(n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const safe = (n) => [(n >>> 21) & 127, (n >>> 14) & 127, (n >>> 7) & 127, n & 127]
const JPEG = bytes([0xff, 0xd8, 0xff, 0xe0], new Uint8Array(40).fill(7), [0xff, 0xd9])
const MPEG_FRAME = bytes([0xff, 0xfb, 0x90, 0x64], new Uint8Array(60))

// ID3v2.3 / 2.4 frame: id, size, flags, body
const frame = (id, body, v = 3) => bytes(id, v === 4 ? safe(body.length) : be32(body.length), [0, 0], body)
const textFrame = (id, text, v = 3, encoding = 3) => frame(id, encoding === 1 ? bytes([1, 0xff, 0xfe], Uint8Array.from([...text].flatMap((c) => [c.charCodeAt(0), 0]))) : bytes([encoding], encoding === 3 ? enc.encode(text) : text), v)
const id3 = (frames, v = 3) => {
  const body = bytes(...frames)
  return bytes("ID3", [v, 0, 0], safe(body.length), body)
}

test("ID3v2.3 with UTF-8 and UTF-16 text, track/total, year, genre number, front cover", () => {
  const apic = frame("APIC", bytes([0], "image/jpeg", [0, 3], "cover", [0], JPEG))
  const tag = id3([textFrame("TIT2", "Café Song"), textFrame("TPE1", "Sigur Rós", 3, 1), textFrame("TALB", "Ágætis"), textFrame("TRCK", "3/12"), textFrame("TYER", "1999", 3, 0), textFrame("TCON", "(17)", 3, 0), textFrame("TPOS", "2/2"), apic])
  const t = parseTags(bytes(tag, MPEG_FRAME))
  assert.equal(t.format, "mp3")
  assert.equal(t.title, "Café Song")
  assert.equal(t.artist, "Sigur Rós")
  assert.equal(t.album, "Ágætis")
  assert.equal(t.track, 3)
  assert.equal(t.trackTotal, 12)
  assert.equal(t.disc, 2)
  assert.equal(t.year, "1999")
  assert.equal(t.genre, "Rock")
  assert.equal(t.picture.mime, "image/jpeg")
  assert.deepEqual([...t.picture.data.slice(0, 3)], [0xff, 0xd8, 0xff])
  assert.equal(t.picture.data.length, JPEG.length)
})

test("ID3v2.4 syncsafe frame sizes, TDRC date, album artist", () => {
  const long = "x".repeat(200) // > 127 bytes: syncsafe size differs from a plain one
  const tag = id3([textFrame("TIT2", long, 4), textFrame("TPE2", "Various", 4), textFrame("TDRC", "2021-05-03", 4)], 4)
  const t = parseTags(bytes(tag, MPEG_FRAME))
  assert.equal(t.title, long)
  assert.equal(t.albumArtist, "Various")
  assert.equal(t.year, "2021")
})

test("ID3v2.2 three-letter frames and PIC", () => {
  const f = (id, body) => bytes(id, be24(body.length), body)
  const body = bytes(f("TT2", bytes([0], "Old Tag")), f("TP1", bytes([0], "Someone")), f("PIC", bytes([0], "JPG", [3], "d", [0], JPEG)))
  const t = parseTags(bytes("ID3", [2, 0, 0], safe(body.length), body, MPEG_FRAME))
  assert.equal(t.title, "Old Tag")
  assert.equal(t.artist, "Someone")
  assert.equal(t.picture.mime, "image/jpeg")
})

test("ID3v1 at the end fills what v2 lacks", () => {
  const v1 = new Uint8Array(128)
  v1.set(bytes("TAG"), 0)
  v1.set(bytes("Tiny Title"), 3)
  v1.set(bytes("Tiny Artist"), 33)
  v1.set(bytes("Tiny Album"), 63)
  v1.set(bytes("1987"), 93)
  v1[125] = 0
  v1[126] = 7
  v1[127] = 13 // Pop
  const t = parseTags(bytes(MPEG_FRAME, v1))
  assert.equal(t.title, "Tiny Title")
  assert.equal(t.artist, "Tiny Artist")
  assert.equal(t.album, "Tiny Album")
  assert.equal(t.year, "1987")
  assert.equal(t.track, 7)
  assert.equal(t.genre, "Pop")
})

test("MP4/M4A ilst atoms", () => {
  const atom = (type, ...body) => {
    const b = bytes(...body)
    return bytes(be32(b.length + 8), type, b)
  }
  const data = (kind, value) => atom("data", be32(kind), be32(0), value)
  const ilst = atom(
    "ilst",
    atom("©nam", data(1, enc.encode("M4A Title"))),
    atom("©ART", data(1, enc.encode("M4A Artist"))),
    atom("©alb", data(1, enc.encode("M4A Album"))),
    atom("aART", data(1, enc.encode("Band"))),
    atom("©day", data(1, enc.encode("2004-01-01"))),
    atom("trkn", data(0, [0, 0, 0, 5, 0, 11, 0, 0])),
    atom("disk", data(0, [0, 0, 0, 1, 0, 2])),
    atom("covr", data(13, JPEG))
  )
  const meta = atom("meta", [0, 0, 0, 0], atom("hdlr", new Uint8Array(25)), ilst)
  const file = bytes(atom("ftyp", "M4A ", be32(0), "isom"), atom("mdat", new Uint8Array(100)), atom("moov", atom("mvhd", new Uint8Array(20)), atom("udta", meta)))
  const t = parseTags(file)
  assert.equal(t.format, "mp4")
  assert.equal(t.title, "M4A Title")
  assert.equal(t.artist, "M4A Artist")
  assert.equal(t.album, "M4A Album")
  assert.equal(t.albumArtist, "Band")
  assert.equal(t.year, "2004")
  assert.equal(t.track, 5)
  assert.equal(t.trackTotal, 11)
  assert.equal(t.disc, 1)
  assert.equal(t.picture.mime, "image/jpeg")
})

test("FLAC Vorbis comments and PICTURE block", () => {
  const comments = ["TITLE=Flac Title", "ARTIST=Flac Artist", "ALBUM=Flac Album", "TRACKNUMBER=4", "TRACKTOTAL=9", "DATE=2010", "GENRE=Jazz"].map((c) => enc.encode(c))
  const vc = bytes(le32(6), "vendor", le32(comments.length), ...comments.flatMap((c) => [le32(c.length), c]))
  const pic = bytes(be32(3), be32(10), "image/jpeg", be32(0), be32(0), be32(0), be32(0), be32(0), be32(JPEG.length), JPEG)
  const block = (type, body, last = false) => bytes([(last ? 0x80 : 0) | type], be24(body.length), body)
  const file = bytes("fLaC", block(0, new Uint8Array(34)), block(4, vc), block(6, pic, true))
  const t = parseTags(file)
  assert.equal(t.format, "flac")
  assert.equal(t.title, "Flac Title")
  assert.equal(t.artist, "Flac Artist")
  assert.equal(t.track, 4)
  assert.equal(t.trackTotal, 9)
  assert.equal(t.year, "2010")
  assert.equal(t.genre, "Jazz")
  assert.equal(t.picture.data.length, JPEG.length)
})

test("Ogg Vorbis comment packet", () => {
  const comments = ["TITLE=Ogg Title", "ARTIST=Ogg Artist"].map((c) => enc.encode(c))
  const packet = bytes([3], "vorbis", le32(4), "test", le32(2), ...comments.flatMap((c) => [le32(c.length), c]))
  const t = parseTags(bytes("OggS", new Uint8Array(40), packet))
  assert.equal(t.format, "ogg")
  assert.equal(t.title, "Ogg Title")
  assert.equal(t.artist, "Ogg Artist")
})

test("broken or empty files never throw", () => {
  assert.equal(parseTags(new Uint8Array()).title, "")
  assert.equal(parseTags(bytes("ID3", [3, 0, 0], safe(5000), [1, 2, 3])).title, "")
  assert.equal(parseTags(bytes([0, 0, 0, 40], "ftypM4A ", new Uint8Array(4))).format, "mp4")
})

test("names and types", () => {
  assert.deepEqual(guessFromName("02 - Some Song.mp3"), { track: 2, artist: "", title: "Some Song" })
  assert.deepEqual(guessFromName("Daft Punk - One More Time.m4a"), { track: 0, artist: "Daft Punk", title: "One More Time" })
  assert.deepEqual(guessFromName("07. Artist - Title - Remix.flac"), { track: 7, artist: "Artist", title: "Title - Remix" })
  assert.equal(mimeFor("a.m4a"), "audio/mp4")
  assert.equal(mimeFor("a.flac"), "audio/flac")
  assert.equal(mimeFor("a.bin", "audio/x-m4a"), "audio/mp4")
  assert.equal(mimeFor("a.mp3", "audio/mpeg"), "audio/mpeg")
})

const T = (key, title, artist, album, track = 0, extra = {}) => ({ key, title, artist, album, track, name: `${title}.mp3`, ...extra })
const LIB = [T("a", "Yellow", "Coldplay", "Parachutes", 5), T("b", "Shiver", "Coldplay", "Parachutes", 2), T("c", "Clocks", "Coldplay", "A Rush of Blood", 5), T("d", "Hey Jude", "The Beatles", "1", 21), T("e", "", "", "", 0, { name: "03 - mystery tune.mp3" })]

test("albums, artists, songs, search", () => {
  const albums = groupAlbums(LIB)
  assert.deepEqual(
    albums.map((a) => a.album),
    ["1", "A Rush of Blood", "Parachutes", "Unknown Album"] // The Beatles sorts as "Beatles"
  )
  assert.deepEqual(albums.find((a) => a.album === "Parachutes").tracks.map((t) => t.title), ["Shiver", "Yellow"])
  const artists = groupArtists(LIB)
  assert.deepEqual(artists.map((a) => a.name), ["The Beatles", "Coldplay", "Unknown Artist"])
  assert.equal(artists[1].albums, 2)
  assert.equal(titleOf(LIB[4]), "mystery tune")
  assert.deepEqual(sortSongs(LIB).map((t) => t.key), ["c", "d", "e", "b", "a"])
  assert.deepEqual(filterTracks(LIB, "cold yel").map((t) => t.key), ["a"])
  assert.deepEqual(filterTracks(LIB, "beatles").map((t) => t.key), ["d"])
  assert.equal(albumKeyOf(LIB[0]), albumKeyOf({ ...LIB[1], album: "PARACHUTES" }))
})

test("queue: start where you tapped, next/prev, repeat, shuffle keeps the current song", () => {
  const keys = ["a", "b", "c", "d"]
  let q = makeQueue(keys, "c")
  assert.equal(q.order[q.pos], "c")
  assert.equal(nextPos(q), 3)
  q = { ...q, pos: 3 }
  assert.equal(nextPos(q, "off"), null)
  assert.equal(nextPos(q, "all"), 0)
  assert.equal(nextPos(q, "one", true), 3) // ended by itself: again
  assert.equal(nextPos(q, "one", false), 0) // pressing Next with repeat-one wraps like repeat-all
  assert.equal(prevPos(q, 10), 3) // 10 s in: restart
  assert.equal(prevPos(q, 1), 2)
  assert.equal(prevPos({ ...q, pos: 0 }, 1, "all"), 3)

  let seed = 1
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  const s = makeQueue(keys, "b", true, random)
  assert.equal(s.order[0], "b")
  assert.deepEqual([...s.order].sort(), keys)
  const playing = s.order[2]
  const off = reshuffle({ ...s, pos: 2 }, false)
  assert.deepEqual(off.order, keys)
  assert.equal(off.order[off.pos], playing)
  const on = reshuffle(off, true, random)
  assert.equal(on.order[on.pos], playing)
  assert.equal(shuffled(["x"], "x")[0], "x")
})

test("queue edits: play next, add, a deleted song", () => {
  let q = makeQueue(["a", "b", "c"], "a")
  q = insertNext(q, "c")
  assert.deepEqual(q.order, ["a", "c", "b"])
  q = append(q, "z")
  assert.deepEqual(q.order, ["a", "c", "b", "z"])
  assert.equal(append(q, "z"), q)
  q = { ...q, pos: 2 }
  q = dropKey(q, "a")
  assert.deepEqual(q.order, ["c", "b", "z"])
  assert.equal(q.order[q.pos], "b")
  assert.equal(dropKey(q, "nope"), q)
})

// wave 2: big songs are kept whole as Blobs; their tags are read from the parts they live in
test("tagBytes reads a 40 MB MP3's ID3v2 and ID3v1 without the middle", async () => {
  const v1 = new Uint8Array(128)
  v1.set(bytes("TAG"), 0)
  v1.set(bytes("End Title"), 3)
  v1.set(bytes("1999"), 93)
  const tag = id3([textFrame("TPE1", "Long Mix Artist"), textFrame("TALB", "Live Set")])
  const middle = new Uint8Array(40 * 1024 * 1024) // the music: never read
  const blob = new Blob([tag, MPEG_FRAME, middle, v1])
  assert.ok(blob.size > TAG_READ_ALL)
  const read = await tagBytes(blob)
  assert.ok(read.length < 5 * 1024 * 1024, `read ${read.length} bytes`)
  const t = parseTags(read)
  assert.equal(t.artist, "Long Mix Artist")
  assert.equal(t.album, "Live Set")
  assert.equal(t.title, "End Title") // from ID3v1 at the very end
  assert.equal(t.year, "1999")
})

test("tagBytes finds an M4A's moov box after 40 MB of audio", async () => {
  const atom = (type, ...body) => {
    const b = bytes(...body)
    return bytes(be32(b.length + 8), type, b)
  }
  const data = (kind, value) => atom("data", be32(kind), be32(0), value)
  const ilst = atom("ilst", atom("©nam", data(1, enc.encode("Audiobook Ch. 1"))), atom("©ART", data(1, enc.encode("Narrator"))))
  const meta = atom("meta", [0, 0, 0, 0], atom("hdlr", new Uint8Array(25)), ilst)
  const audio = 40 * 1024 * 1024
  const mdatHead = bytes(be32(audio + 8), "mdat")
  const blob = new Blob([atom("ftyp", "M4A ", be32(0), "isom"), mdatHead, new Uint8Array(audio), atom("moov", atom("mvhd", new Uint8Array(20)), atom("udta", meta))])
  const read = await tagBytes(blob)
  assert.ok(read.length < 4096, `read ${read.length} bytes`)
  const t = parseTags(read)
  assert.equal(t.format, "mp4")
  assert.equal(t.title, "Audiobook Ch. 1")
  assert.equal(t.artist, "Narrator")
})

test("tagBytes reads small songs whole", async () => {
  const tag = id3([textFrame("TIT2", "Short")])
  const read = await tagBytes(new Blob([tag, MPEG_FRAME]))
  assert.equal(read.length, tag.length + MPEG_FRAME.length)
  assert.equal(parseTags(read).title, "Short")
})
