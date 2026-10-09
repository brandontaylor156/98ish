// QR Code's encoder: node --test client/src/components/applets/qrcode/qrEncode.test.js
// Known vectors (the "HELLO WORLD" 1-M example from the QR standard's tutorials, format
// strings from the standard's table), then every code read back by a small independent reader
// below (format info, unmasking, de-interleaving, Reed-Solomon check, the text) across modes,
// versions 1-40, all four levels and all eight masks. The browser test also reads them with jsQR.
import test from "node:test"
import assert from "node:assert/strict"
import { encodeQr, rsDivisor, rsRemainder, FORMAT_BITS, drawFunctionPatterns, dataPositions, MASKS, rawDataModules, dataCodewords, alignmentPositions } from "./qrEncode.js"

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"
const NUM_BLOCKS = { L: [1, 1, 1, 1, 1, 2, 2, 2, 2, 4], M: [1, 1, 1, 2, 2, 4, 4, 4, 5, 5], Q: [1, 1, 2, 2, 4, 4, 6, 6, 8, 8], H: [1, 1, 2, 4, 4, 4, 5, 6, 8, 8] }

// ---- an independent reader (no error correction: it checks the codewords are all right) ----
const readQr = (modules, blocksFor) => {
  const size = modules.length
  const version = (size - 17) / 4
  // format: the first copy, in the standard's bit order
  const spots = []
  for (let i = 0; i <= 5; i++) spots.push([8, i])
  spots.push([8, 7], [8, 8], [7, 8])
  for (let i = 9; i < 15; i++) spots.push([14 - i, 8])
  let read = 0
  spots.forEach(([x, y], i) => (read |= (modules[y][x] ? 1 : 0) << i))
  // the second copy must agree
  let second = 0
  for (let i = 0; i < 8; i++) second |= (modules[8][size - 1 - i] ? 1 : 0) << i
  for (let i = 8; i < 15; i++) second |= (modules[size - 15 + i][8] ? 1 : 0) << i
  assert.equal(second, read, "both format copies agree")
  assert.equal(modules[size - 8][8], true, "the dark module")
  let ecc = null
  let mask = null
  for (const e of ["L", "M", "Q", "H"]) for (let k = 0; k < 8; k++) if (FORMAT_BITS(e, k) === read) (ecc = e), (mask = k)
  assert.ok(ecc, "format info is a valid code word")
  // finders
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    assert.equal(modules[cy][cx], true)
    assert.equal(modules[cy - 2][cx], false)
    assert.equal(modules[cy - 3][cx], true)
  }
  const { isFunction } = drawFunctionPatterns(version)
  const bits = dataPositions(isFunction).map(([x, y]) => (modules[y][x] !== MASKS[mask](x, y) ? 1 : 0))
  const total = Math.floor(rawDataModules(version) / 8)
  const cw = []
  for (let i = 0; i < total; i++) cw.push(bits.slice(i * 8, i * 8 + 8).reduce((b, v) => (b << 1) | v, 0))
  // de-interleave
  const numBlocks = blocksFor(version, ecc)
  const eccLen = (total - dataCodewords(version, ecc)) / numBlocks
  const numShort = numBlocks - (total % numBlocks)
  const shortLen = Math.floor(total / numBlocks)
  const blocks = Array.from({ length: numBlocks }, (_, j) => ({ data: [], ecc: [], dataLen: shortLen - eccLen + (j < numShort ? 0 : 1) }))
  let k = 0
  const maxData = shortLen - eccLen + 1
  for (let i = 0; i < maxData; i++) for (const b of blocks) if (i < b.dataLen) b.data.push(cw[k++])
  for (let i = 0; i < eccLen; i++) for (const b of blocks) b.ecc.push(cw[k++])
  const divisor = rsDivisor(eccLen)
  for (const b of blocks) assert.deepEqual(rsRemainder(b.data, divisor), b.ecc, "Reed-Solomon codewords check out")
  const data = blocks.flatMap((b) => b.data)
  // the text
  const dbits = data.flatMap((byte) => [7, 6, 5, 4, 3, 2, 1, 0].map((i) => (byte >>> i) & 1))
  let p = 0
  const take = (n) => {
    let v = 0
    for (let i = 0; i < n; i++) v = (v << 1) | dbits[p++]
    return v
  }
  const mode = take(4)
  const band = version <= 9 ? 0 : version <= 26 ? 1 : 2
  let text = ""
  if (mode === 1) {
    let n = take([10, 12, 14][band])
    while (n > 0) {
      const d = Math.min(3, n)
      text += String(take(d * 3 + 1)).padStart(d, "0")
      n -= d
    }
  } else if (mode === 2) {
    let n = take([9, 11, 13][band])
    while (n > 1) {
      const v = take(11)
      text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45]
      n -= 2
    }
    if (n) text += ALNUM[take(6)]
  } else if (mode === 4) {
    const n = take([8, 16, 16][band])
    const bytes = []
    for (let i = 0; i < n; i++) bytes.push(take(8))
    text = new TextDecoder().decode(new Uint8Array(bytes))
  } else assert.fail(`unknown mode ${mode}`)
  return { text, ecc, mask, version }
}

// block counts the reader uses (an independent copy of the standard's table for versions 1-10;
// larger versions are worked out from the encoder's capacity)
const blocksFor = (version, ecc) => {
  if (version <= 10) return NUM_BLOCKS[ecc][version - 1]
  return null
}

test("known vector: HELLO WORLD, version 1-M", () => {
  const qr = encodeQr("HELLO WORLD", { ecc: "M" })
  assert.equal(qr.version, 1)
  assert.equal(qr.mode, "alphanumeric")
  assert.deepEqual(qr.data, [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17])
  assert.deepEqual(qr.codewords.slice(16), [196, 35, 39, 119, 235, 215, 231, 226, 93, 23])
})

test("format strings match the standard's table", () => {
  assert.equal(FORMAT_BITS("M", 0).toString(2).padStart(15, "0"), "101010000010010")
  assert.equal(FORMAT_BITS("L", 0).toString(2).padStart(15, "0"), "111011111000100")
  assert.equal(FORMAT_BITS("H", 7).toString(2).padStart(15, "0"), "000100000111011")
})

test("capacities and alignment positions match the standard", () => {
  assert.equal(dataCodewords(1, "L"), 19)
  assert.equal(dataCodewords(1, "H"), 9)
  assert.equal(dataCodewords(5, "Q"), 62)
  assert.equal(dataCodewords(10, "M"), 216)
  assert.equal(dataCodewords(40, "L"), 2956)
  assert.equal(dataCodewords(40, "H"), 1276)
  assert.deepEqual(alignmentPositions(2), [6, 18])
  assert.deepEqual(alignmentPositions(7), [6, 22, 38])
  assert.deepEqual(alignmentPositions(32), [6, 34, 60, 86, 112, 138])
  assert.deepEqual(alignmentPositions(40), [6, 30, 58, 86, 114, 142, 170])
  // the biggest text that fits: 2,953 bytes at L
  assert.equal(encodeQr("x".repeat(2953), { ecc: "L" }).version, 40)
  assert.throws(() => encodeQr("x".repeat(2954), { ecc: "L" }), /too much/)
})

test("read back: modes, levels and every mask (versions 1-10)", () => {
  const samples = ["", "0", "01234567", "HELLO WORLD", "HTTPS://98ISH.VERCEL.APP/", "https://98ish.vercel.app/?open=sheets", "Café ☕ — 98ish ✓", "WIFI:T:WPA;S:Home;P:p@ss,word;;", "1".repeat(60)]
  for (const ecc of ["L", "M", "Q", "H"])
    for (const text of samples) {
      const qr = encodeQr(text, { ecc })
      const back = readQr(qr.modules, blocksFor)
      assert.equal(back.text, text)
      assert.equal(back.ecc, ecc)
      assert.equal(back.mask, qr.mask)
    }
  for (let mask = 0; mask < 8; mask++) {
    const qr = encodeQr("mask test 98ish", { mask })
    assert.equal(readQr(qr.modules, blocksFor).mask, mask)
  }
  // a version with the most blocks in the range (5 blocks at 10-M, short and long ones)
  const long = "a".repeat(200)
  const qr = encodeQr(long, { ecc: "M" })
  assert.equal(qr.version, 10)
  assert.equal(readQr(qr.modules, blocksFor).text, long)
})

test("read back: big versions with version info", () => {
  // the reader needs the block count: version 20-M has 16 blocks, 40-L has 25 (the standard)
  const big = { "20M": 16, "40L": 25, "27Q": 34 }
  for (const [v, ecc, text] of [[20, "M", "y".repeat(600)], [40, "L", "z".repeat(2900)], [27, "Q", "ABC123".repeat(150)]]) {
    const qr = encodeQr(text, { ecc, minVersion: v })
    assert.equal(qr.version, v)
    const back = readQr(qr.modules, () => big[`${v}${ecc}`])
    assert.equal(back.text, text)
    // version info: the 18-bit code in both corners (bit 0..5 of version 7+ in the top-right)
    const size = qr.size
    const versionRead = Array.from({ length: 18 }, (_, i) => (qr.modules[Math.floor(i / 3)][size - 11 + (i % 3)] ? 1 : 0) << i).reduce((a, b) => a | b, 0)
    assert.equal(versionRead >>> 12, v)
  }
})
