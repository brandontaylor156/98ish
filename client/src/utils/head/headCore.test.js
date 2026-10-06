import test from "node:test"
import assert from "node:assert/strict"
import { ARKIT, N, PACKET_BYTES, encodePacket, decodePacket, isNewer, rateGate, fromMediaPipe, anglesFromMatrix, chooseSource, voiceMouth, idleFace, toRenderMap, checkHeadFile, chunkHead, headAssembler, headId, HEAD_MAX_BYTES } from "./headCore.js"

test("52 ARKit names, a 59-byte packet that round-trips weights and pose", () => {
  assert.equal(N, 52)
  assert.equal(new Set(ARKIT).size, 52)
  const w = new Float32Array(N).map((_, i) => i / 51)
  const b = encodePacket({ weights: w, yaw: 30, pitch: -12, roll: 5, seq: 65535, source: "voice" })
  assert.equal(b.length, PACKET_BYTES)
  const d = decodePacket(b)
  assert.equal(d.seq, 65535)
  assert.equal(d.source, "voice")
  for (let i = 0; i < N; i++) assert.ok(Math.abs(d.weights[i] - w[i]) <= 1 / 255)
  assert.ok(Math.abs(d.yaw - 30) < 0.8 && Math.abs(d.pitch + 12) < 0.8 && Math.abs(d.roll - 5) < 0.8)
  // out-of-range values are clamped, junk is refused
  const c = decodePacket(encodePacket({ weights: [2, -1, NaN], yaw: 400 }))
  assert.equal(c.weights[0], 1)
  assert.equal(c.weights[1], 0)
  assert.equal(c.weights[2], 0)
  assert.ok(c.yaw > 89)
  assert.equal(decodePacket(new Uint8Array(10)), null)
  assert.equal(decodePacket(new Uint8Array(PACKET_BYTES)), null) // kind 0
})

test("seq ordering survives the wrap; the rate gate caps frames", () => {
  assert.ok(isNewer(5, 4))
  assert.ok(!isNewer(4, 5))
  assert.ok(isNewer(2, 65534)) // wrapped
  assert.ok(isNewer(0, null))
  const gate = rateGate(20)
  let sent = 0
  for (let t = 0; t < 1000; t += 5) if (gate(t)) sent++
  assert.equal(sent, 20)
  // after a stall: one frame, not a burst
  assert.ok(gate(5000))
  assert.ok(!gate(5001))
})

test("MediaPipe categories map by name; matrix angles", () => {
  const w = fromMediaPipe([
    { categoryName: "_neutral", score: 1 },
    { categoryName: "jawOpen", score: 0.7 },
    { categoryName: "cheekPuff", score: 0.3 },
  ])
  assert.ok(Math.abs(w[ARKIT.indexOf("jawOpen")] - 0.7) < 1e-6)
  const m = toRenderMap(w)
  assert.ok(Math.abs(m.mouthCheekPuff - 0.3) < 1e-6)
  assert.equal(m.cheekPuff, undefined)
  // identity -> no rotation; a 30-degree yaw about Y
  const id = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  assert.deepEqual(Object.values(anglesFromMatrix(id)).map((v) => Math.round(v) + 0), [0, 0, 0])
  const a = (30 * Math.PI) / 180
  const yawM = [Math.cos(a), 0, -Math.sin(a), 0, 0, 1, 0, 0, Math.sin(a), 0, Math.cos(a), 0, 0, 0, 0, 1]
  assert.equal(Math.round(anglesFromMatrix(yawM).yaw), 30)
})

test("falls back from face to voice to idle", () => {
  assert.equal(chooseSource({ cameraOn: true, faceAt: 900, now: 1000 }), "face")
  assert.equal(chooseSource({ cameraOn: true, faceAt: 0, voiceLevel: 0.2, now: 1000 }), "voice") // face lost
  assert.equal(chooseSource({ cameraOn: false, voiceLevel: 0.2, now: 1000 }), "voice")
  assert.equal(chooseSource({ cameraOn: false, voiceLevel: 0.01, now: 1000 }), "idle")
  const loud = voiceMouth(0.4, 0.7)
  const quiet = voiceMouth(0.02, 0.7)
  assert.ok(loud[ARKIT.indexOf("jawOpen")] > 0.5)
  assert.equal(quiet[ARKIT.indexOf("jawOpen")], 0)
  assert.ok(voiceMouth(0.4, 0.2)[ARKIT.indexOf("mouthFunnel")] > loud[ARKIT.indexOf("mouthFunnel")]) // darker -> rounder
  // idle blinks now and then
  let blinked = false
  for (let t = 0; t < 5; t += 0.02) if (idleFace(t)[ARKIT.indexOf("eyeBlinkLeft")] > 0.9) blinked = true
  assert.ok(blinked)
})

test("head files: checked, chunked over the call and put back together", () => {
  assert.equal(checkHeadFile(new Uint8Array(0)).ok, false)
  assert.equal(checkHeadFile(new Uint8Array([1, 2, 3])).ok, false)
  assert.equal(checkHeadFile(new Uint8Array(HEAD_MAX_BYTES + 1).fill(0x50)).ok, false)
  const zip = new Uint8Array(70000)
  zip[0] = 0x50
  zip[1] = 0x4b
  for (let i = 2; i < zip.length; i++) zip[i] = (i * 31) & 0xff
  assert.equal(checkHeadFile(zip, ["me/offset.ply", "me/skin.glb"]).ok, true)
  assert.equal(checkHeadFile(zip, ["me/skin.glb"]).ok, false)
  const chunks = chunkHead(zip)
  assert.equal(chunks.length, 5)
  const asm = headAssembler()
  // out of order, with a duplicate
  const order = [3, 0, 4, 1, 1, 2]
  let done = null
  for (const i of order) done = asm.push(chunks[i]) || done
  assert.deepEqual(done, zip)
  assert.equal(headId(zip), headId(zip.slice()))
  assert.notEqual(headId(zip), headId(chunks[0]))
  // a forged total that would exceed the cap is refused
  const evil = new Uint8Array(9)
  evil[0] = 2
  new DataView(evil.buffer).setUint32(5, 100000, true)
  assert.equal(headAssembler().push(evil), null)
})
