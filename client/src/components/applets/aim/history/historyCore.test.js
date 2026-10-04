// node --test client/src/components/applets/aim/history/historyCore.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { REACTIONS, applyReaction, fitWithin, formatDuration, fromServer, lastStatus, mergeMessages, newestIncoming, pickVoiceType, previewText, reactionCounts, roomCk, sendFailure, tempId, waveform } from "./historyCore.js"

const msg = (id, time, extra = {}) => ({ id, time, text: id, from: "Bob", mine: false, ...extra })

test("merging keeps one copy per id, in time order, and keeps what only this device knows", () => {
  const list = [msg("a", 1), msg("c", 3)]
  const merged = mergeMessages(list, [msg("b", 2), msg("c", 3, { r: { bob: "heart" } })])
  assert.deepEqual(merged.map((m) => m.id), ["a", "b", "c"])
  assert.deepEqual(merged[2].r, { bob: "heart" })
  // older ones scrolled back in go first
  assert.deepEqual(mergeMessages(merged, [msg("z", 0)]).map((m) => m.id), ["z", "a", "b", "c"])
  // the preview picture and "Delivered" survive a copy from the server without them
  const withThumb = mergeMessages([msg("p", 5, { thumb: "data:image/jpeg;base64,AA", deliveredAt: 9, held: false })], [msg("p", 5, { held: true })])
  assert.equal(withThumb[0].thumb, "data:image/jpeg;base64,AA")
  assert.equal(withThumb[0].held, false)
  assert.equal(mergeMessages(list, []), list, "nothing new: the same list")
})

test("server messages: reactions are complete, rooms get their own conversation", () => {
  const m = fromServer({ id: "x", ck: "bob", conv: "Bob", from: "Bob", mine: false, text: "hi", time: 5 })
  assert.equal(m.r, undefined)
  assert.equal(m.held, false)
  const merged = mergeMessages([{ ...m, r: { me: "lol" } }], [m])
  assert.equal(merged[0].r, undefined, "a reaction taken back elsewhere goes here too")
  const live = fromServer({ id: "y", from: "Alice", text: "x", time: 1 }, { meKey: "alice", ck: "bob", conv: "Bob" })
  assert.deepEqual([live.mine, live.ck, live.conv], [true, "bob", "Bob"])
  assert.equal(roomCk("98ish Lobby"), "#98ishlobby")
})

test("reactions: one per person, counted in picker order, yours marked", () => {
  assert.equal(REACTIONS.length, 6)
  let m = msg("a", 1)
  m = applyReaction(m, "alice", "lol")
  m = applyReaction(m, "bob", "heart")
  m = applyReaction(m, "carol", "lol")
  assert.deepEqual(reactionCounts(m.r, "alice").map((c) => [c.id, c.count, c.mine]), [["heart", 1, false], ["lol", 2, true]])
  m = applyReaction(m, "alice", "wow") // changing it replaces the old one
  assert.deepEqual(reactionCounts(m.r, "alice").map((c) => [c.id, c.count]), [["heart", 1], ["lol", 1], ["wow", 1]])
  m = applyReaction(m, "alice", null)
  assert.equal(m.r.alice, undefined)
  assert.deepEqual(reactionCounts(null, "x"), [])
})

test("the line under your last message: Read, Delivered, waiting, or nothing", () => {
  const fmt = (t) => `T${t}`
  const mine = (id, time, extra) => msg(id, time, { mine: true, from: "Alice", ...extra })
  assert.deepEqual(lastStatus([msg("a", 1), mine("b", 2)], { at: 2, when: 7 }, { formatTime: fmt }), { kind: "read", text: "Read T7" })
  assert.equal(lastStatus([msg("a", 1), mine("b", 2)], { at: 1, when: 7 }, { formatTime: fmt }), null, "read an earlier one only")
  assert.equal(lastStatus([mine("b", 2), msg("a", 3)], { at: 3, when: 7 }), null, "they wrote after you")
  assert.equal(lastStatus([mine("b", 2, { deliveredAt: 5 })], null).text, "Delivered")
  assert.equal(lastStatus([mine("b", 2, { held: true })], null, { name: "Bob" }).text, "Bob will get it when they sign on")
  assert.equal(lastStatus([mine(tempId(), 2)], { at: 9 }), null, "still sending")
  assert.equal(lastStatus([mine("b", 2), { id: "s", system: true, time: 3, text: "Bob signed off" }], { at: 2, when: 4 }, { formatTime: fmt }).text, "Read T4")
  assert.equal(newestIncoming([msg("a", 1), mine("b", 2), { id: "s", system: true }]).id, "a")
})

test("voice: waveform digits, durations and the recording format", () => {
  const samples = new Float32Array(400).map((_, i) => (i < 200 ? 0.1 : 0.8) * (i % 2 ? 1 : -1))
  const wf = waveform(samples)
  assert.equal(wf.length, 40)
  assert.match(wf, /^[0-9]+$/)
  assert.ok(wf.startsWith("1") && wf.endsWith("9"))
  assert.equal(waveform(new Float32Array(0)), "0".repeat(40))
  assert.equal(formatDuration(7.4), "0:07")
  assert.equal(formatDuration(65), "1:05")
  // iPhone records AAC in MP4; Chrome may only have WebM/Opus
  assert.equal(pickVoiceType((t) => t.startsWith("audio/mp4")), "audio/mp4;codecs=mp4a.40.2")
  assert.equal(pickVoiceType((t) => t === "audio/webm;codecs=opus"), "audio/webm;codecs=opus")
  assert.equal(pickVoiceType(() => false), "")
})

test("pictures fit 1600 px; previews and failures say what happened", () => {
  assert.deepEqual(fitWithin(4032, 3024, 1600), { width: 1600, height: 1200 })
  assert.deepEqual(fitWithin(800, 600, 1600), { width: 800, height: 600 })
  assert.equal(previewText({ media: { k: "image" } }), "📷 Picture")
  assert.equal(previewText({ media: { k: "audio" } }), "🎤 Voice message")
  assert.equal(previewText({ text: "hi" }), "hi")
  assert.match(sendFailure("image", { ok: false, resting: true }), /^Picture couldn't be sent: online storage is resting/)
  assert.match(sendFailure("audio", null), /^Voice message couldn't be sent: online storage is resting/)
  assert.match(sendFailure("image", { ok: false, error: "That picture is too big to send." }), /couldn't be sent: that picture is too big/)
})
