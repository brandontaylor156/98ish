// Come Over's pure parts: presence throttling and gliding, the privacy filters, desktop
// snapshots, the text diff and caret moves for shared Notepad, and the pixel runs for shared
// Paint (with real Yjs documents for the convergence and per-person undo).
// node --test client/src/components/applets/hangout/hangout.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as Y from "yjs"
import { throttle, glide, isPrivate, mayFollow, desktopSnapshot, textEdit, moveCaret, diffPixels, applyRuns, packRuns, unpackRuns, listNames, initials, toUnit } from "./hangoutCore.js"
import { throughDelta } from "./sharedText.js"

test("presence is throttled to 15 a second, keeping the latest spot", () => {
  let t = 0
  const timers = []
  const sent = []
  const push = throttle((v) => sent.push(v), 15, { now: () => t, later: (fn, ms) => (timers.push({ fn, at: t + ms }), timers.length), cancel: () => {} })
  push({ x: 0.1 })
  assert.deepEqual(sent, [{ x: 0.1 }], "the first goes at once")
  for (let i = 1; i <= 10; i++) {
    t += 5
    push({ x: 0.1 + i / 100 })
  }
  assert.equal(sent.length, 1, "60 moves a second within the gap: held")
  t = timers[0].at
  timers[0].fn()
  assert.deepEqual(sent.at(-1), { x: 0.2 }, "then one trailing send with the latest spot")
  // over a simulated second of 120 Hz moves, at most ~15 sends
  sent.length = 0
  timers.length = 0
  for (let i = 0; i < 120; i++) {
    t += 1000 / 120
    push({ x: i })
    while (timers.length && timers[0].at <= t) timers.shift().fn()
  }
  assert.ok(sent.length <= 16 && sent.length >= 13, `sent ${sent.length}`)
})

test("remote cursors glide (frame-rate independent) and map to any screen size", () => {
  const a = glide({ x: 0, y: 0 }, { x: 100, y: 0 }, 45)
  assert.ok(Math.abs(a.x - 50) < 0.5, "half the way in one half-life")
  const twoSteps = glide(glide({ x: 0, y: 0 }, { x: 100, y: 0 }, 22.5), { x: 100, y: 0 }, 22.5)
  assert.ok(Math.abs(twoSteps.x - a.x) < 0.5, "same result at twice the frame rate")
  assert.deepEqual(glide(null, { x: 5, y: 6 }, 16), { x: 5, y: 6 })
  assert.deepEqual(toUnit(195, 844, 390, 844), { x: 0.5, y: 1 })
  assert.deepEqual(toUnit(-5, 2000, 390, 844), { x: 0, y: 1 })
})

test("privacy: private programs never show in a snapshot, and only safe programs can be followed", () => {
  assert.equal(isPrivate("Mail"), true)
  assert.equal(isPrivate("passwords"), true)
  assert.equal(isPrivate("notepad"), false)
  // default-deny: 98 Messenger's Buddy List window has no program id; IM windows are aim-*
  assert.equal(isPrivate(undefined), true)
  assert.equal(isPrivate("aim-im"), true)
  assert.equal(isPrivate("control"), true)
  assert.equal(mayFollow("notepad"), true)
  assert.equal(mayFollow("aim"), false)
  assert.equal(mayFollow("photos"), false)
  const snap = desktopSnapshot({
    screen: { w: 1000, h: 800 },
    wallpaper: { color: "#008080", image: "data:image/png;base64,AAAA" },
    windows: [
      { app: "notepad", name: "todo.txt - Notepad", icon_url: "/assets/program_icons/notepad.svg", x: 100, y: 80, width: 500, height: 400, active: true },
      { app: "mail", name: "Inbox - 98ish Mail", x: 0, y: 0, width: 600, height: 500 },
      { app: "paint", name: "closed", closed: true },
    ],
  })
  assert.equal(snap.wallpaper.image, "", "no picture data in a snapshot")
  assert.equal(snap.windows.length, 2)
  assert.deepEqual([snap.windows[0].title, snap.windows[0].x, snap.windows[0].w], ["todo.txt - Notepad", 0.1, 0.5])
  assert.deepEqual([snap.windows[1].app, snap.windows[1].title, snap.windows[1].icon], ["private", "Private window", ""])
})

test("textEdit finds the one change a keystroke or paste made", () => {
  assert.deepEqual(textEdit("hello", "hello!"), { at: 5, remove: 0, insert: "!" })
  assert.deepEqual(textEdit("hello world", "hello brave world"), { at: 6, remove: 0, insert: "brave " })
  assert.deepEqual(textEdit("abc", "ac"), { at: 1, remove: 1, insert: "" })
  assert.deepEqual(textEdit("aaa", "aa"), { at: 2, remove: 1, insert: "" })
  assert.deepEqual(textEdit("select me", "X"), { at: 0, remove: 9, insert: "X" })
  assert.equal(textEdit("same", "same"), null)
  // an emoji is never split
  const e = textEdit("a😀b", "a😃b")
  assert.equal("a😀b".slice(0, e.at) + e.insert + "a😀b".slice(e.at + e.remove), "a😃b")
})

test("carets move the right way through someone else's edit", () => {
  assert.equal(moveCaret(10, { at: 2, remove: 0, insert: "abc" }), 13)
  assert.equal(moveCaret(1, { at: 2, remove: 0, insert: "abc" }), 1)
  assert.equal(moveCaret(5, { at: 2, remove: 5, insert: "" }), 2)
  // a Yjs delta: retain 3, insert "xy", delete 2
  const delta = [{ retain: 3 }, { insert: "xy" }, { delete: 2 }]
  assert.equal(throughDelta(1, delta), 1)
  assert.equal(throughDelta(3, delta), 5)
  assert.equal(throughDelta(4, delta), 5)
  assert.equal(throughDelta(8, delta), 8)
})

test("two people typing into a shared text at once both keep their words (Yjs + textEdit)", () => {
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on("update", (u, o) => o !== "b" && Y.applyUpdate(b, u, "a"))
  b.on("update", (u, o) => o !== "a" && Y.applyUpdate(a, u, "b"))
  const type = (doc, before, after) => {
    const ed = textEdit(before, after)
    const t = doc.getText("t")
    doc.transact(() => {
      if (ed.remove) t.delete(ed.at, ed.remove)
      if (ed.insert) t.insert(ed.at, ed.insert)
    }, "local")
  }
  type(a, "", "Shopping: milk")
  type(b, b.getText("t").toString(), "Shopping: milk, eggs")
  type(a, a.getText("t").toString(), "TODAY Shopping: milk, eggs")
  assert.equal(a.getText("t").toString(), "TODAY Shopping: milk, eggs")
  assert.equal(b.getText("t").toString(), a.getText("t").toString())
  // per-person undo: A's undo removes only A's words
  const um = new Y.UndoManager(a.getText("t"), { trackedOrigins: new Set(["local"]), captureTimeout: 0 })
  type(a, a.getText("t").toString(), a.getText("t").toString() + " [A]")
  type(b, b.getText("t").toString(), b.getText("t").toString() + " [B]")
  um.undo()
  assert.equal(b.getText("t").toString(), "TODAY Shopping: milk, eggs [B]")
})

test("Paint ops: only changed pixels travel, and applying them redraws the picture", () => {
  const w = 40
  const h = 30
  const white = new Uint8ClampedArray(w * h * 4).fill(255)
  const after = new Uint8ClampedArray(white)
  // a short red line
  for (let x = 5; x < 15; x++) {
    const p = (12 * w + x) * 4
    after[p] = 255
    after[p + 1] = 0
    after[p + 2] = 0
  }
  const runs = diffPixels(white, after)
  assert.deepEqual(runs.slice(0, 2), [12 * w + 5, 10])
  assert.equal(runs.length, 12)
  const packed = packRuns(runs)
  assert.ok(packed.length < 80, `packed ${packed.length} chars`)
  assert.deepEqual(unpackRuns(packed), runs)
  const copy = new Uint8ClampedArray(white)
  applyRuns(copy, unpackRuns(packed))
  assert.deepEqual(copy, after)
  assert.deepEqual(diffPixels(after, after), [])
})

test("a shared picture: two people's strokes merge, and undo takes back only your own", async () => {
  const { render } = await import("./sharedPaint.js")
  const w = 20
  const h = 10
  const stroke = (x, color) => {
    const before = new Uint8ClampedArray(w * h * 4).fill(255)
    const after = new Uint8ClampedArray(before)
    const p = (5 * w + x) * 4
    after[p] = color[0]
    after[p + 1] = color[1]
    after[p + 2] = color[2]
    return packRuns(diffPixels(before, after))
  }
  const a = new Y.Doc()
  const b = new Y.Doc()
  a.on("update", (u, o) => o !== "remote" && Y.applyUpdate(b, u, "remote"))
  b.on("update", (u, o) => o !== "remote" && Y.applyUpdate(a, u, "remote"))
  const um = new Y.UndoManager(a.getArray("ops"), { trackedOrigins: new Set(["local-paint"]), captureTimeout: 0 })
  a.transact(() => a.getArray("ops").push([{ by: "ann", r: stroke(2, [255, 0, 0]) }]), "local-paint")
  b.transact(() => b.getArray("ops").push([{ by: "ben", r: stroke(7, [0, 0, 255]) }]), "local-paint")
  const px = (s, x) => Array.from(s.data.slice((5 * w + x) * 4, (5 * w + x) * 4 + 3))
  let pic = render(w, h, b.getArray("ops").toArray())
  assert.deepEqual([px(pic, 2), px(pic, 7)], [[255, 0, 0], [0, 0, 255]])
  um.undo()
  pic = render(w, h, b.getArray("ops").toArray())
  assert.deepEqual([px(pic, 2), px(pic, 7)], [[255, 255, 255], [0, 0, 255]], "Ann's stroke gone, Ben's stays")
})

test("names", () => {
  assert.equal(listNames(["Ann"]), "Ann")
  assert.equal(listNames(["Ann", "Ben", "Cat"]), "Ann, Ben and Cat")
  assert.equal(initials("rosie_m"), "RM")
})
