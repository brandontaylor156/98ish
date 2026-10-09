// A QR code encoder with no library (ISO/IEC 18004; the tables and the structure follow
// Project Nayuki's public-domain-style reference, rewritten here). Pure: tested with
//   node --test client/src/components/applets/qrcode/qrEncode.test.js
//
//   encodeQr(text, { ecc = "M", minVersion = 1, mask = null }) ->
//     { version, size, ecc, mask, mode, modules: boolean[size][size] (true = dark) }
//
// Modes: numeric (digits only), alphanumeric (0-9 A-Z space $%*+-./:), otherwise bytes
// (UTF-8, which every phone camera reads). Versions 1-40, error correction L/M/Q/H, the mask
// chosen by the standard's penalty rules. Throws when the text is too long for a QR code.

export const ECC = { L: { ordinal: 0, bits: 1 }, M: { ordinal: 1, bits: 0 }, Q: { ordinal: 2, bits: 3 }, H: { ordinal: 3, bits: 2 } }

const ECC_PER_BLOCK = [
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]
const NUM_BLOCKS = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

const ALNUM = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:"
export const MODES = {
  numeric: { indicator: 0x1, countBits: [10, 12, 14] },
  alphanumeric: { indicator: 0x2, countBits: [9, 11, 13] },
  byte: { indicator: 0x4, countBits: [8, 16, 16] },
}
const countBits = (mode, version) => MODES[mode].countBits[version <= 9 ? 0 : version <= 26 ? 1 : 2]

// modules in the symbol that carry data (codewords x 8 + remainder bits)
export const rawDataModules = (ver) => {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}
export const dataCodewords = (ver, ecc) => Math.floor(rawDataModules(ver) / 8) - ECC_PER_BLOCK[ECC[ecc].ordinal][ver] * NUM_BLOCKS[ECC[ecc].ordinal][ver]

// ---- bits ----

const utf8 = (text) => [...new TextEncoder().encode(text)]

export const chooseMode = (text) => (/^\d*$/.test(text) ? "numeric" : [...text].every((c) => ALNUM.includes(c)) ? "alphanumeric" : "byte")

// the data bits (mode, count, payload) for one segment, without the version-dependent count
const payloadBits = (text, mode) => {
  const bits = []
  const put = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  if (mode === "numeric") {
    for (let i = 0; i < text.length; i += 3) {
      const chunk = text.slice(i, i + 3)
      put(Number(chunk), chunk.length * 3 + 1)
    }
    return { bits, count: text.length }
  }
  if (mode === "alphanumeric") {
    for (let i = 0; i < text.length; i += 2) {
      if (i + 1 < text.length) put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11)
      else put(ALNUM.indexOf(text[i]), 6)
    }
    return { bits, count: text.length }
  }
  const bytes = utf8(text)
  for (const b of bytes) put(b, 8)
  return { bits, count: bytes.length }
}

// ---- Reed-Solomon over GF(256), polynomial 0x11D ----

const gfMul = (x, y) => {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}
export const rsDivisor = (degree) => {
  const result = new Array(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = gfMul(root, 0x02)
  }
  return result
}
export const rsRemainder = (data, divisor) => {
  const result = divisor.map(() => 0)
  for (const b of data) {
    const factor = b ^ result.shift()
    result.push(0)
    divisor.forEach((coef, i) => (result[i] ^= gfMul(coef, factor)))
  }
  return result
}

// data codewords -> all codewords, split into blocks with their error correction and interleaved
export const addEcc = (data, ver, ecc) => {
  const o = ECC[ecc].ordinal
  const numBlocks = NUM_BLOCKS[o][ver]
  const eccLen = ECC_PER_BLOCK[o][ver]
  const rawCodewords = Math.floor(rawDataModules(ver) / 8)
  const numShort = numBlocks - (rawCodewords % numBlocks)
  const shortLen = Math.floor(rawCodewords / numBlocks)
  const divisor = rsDivisor(eccLen)
  const blocks = []
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const dat = data.slice(k, k + shortLen - eccLen + (i < numShort ? 0 : 1))
    k += dat.length
    const block = dat.concat(rsRemainder(dat, divisor))
    if (i < numShort) block.splice(shortLen - eccLen, 0, -1) // a gap so the columns line up
    blocks.push(block)
  }
  const out = []
  for (let i = 0; i < blocks[0].length; i++) blocks.forEach((b, j) => i !== shortLen - eccLen || j >= numShort ? out.push(b[i]) : null)
  return out
}

// ---- the symbol ----

export const alignmentPositions = (ver) => {
  if (ver === 1) return []
  const size = ver * 4 + 17
  const numAlign = Math.floor(ver / 7) + 2
  const step = ver === 32 ? 26 : Math.ceil((ver * 4 + 4) / (numAlign * 2 - 2)) * 2
  const result = [6]
  for (let pos = size - 7; result.length < numAlign; pos -= step) result.splice(1, 0, pos)
  return result
}

const formatBits = (ecc, mask) => {
  const data = (ECC[ecc].bits << 3) | mask
  let rem = data
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
  return ((data << 10) | rem) ^ 0x5412
}
export const FORMAT_BITS = formatBits
const versionBits = (ver) => {
  let rem = ver
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
  return (ver << 12) | rem
}

export const MASKS = [
  (x, y) => (x + y) % 2 === 0,
  (x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
]

// the fixed patterns of a version (finders, timing, alignment, the dark module, room for format
// and version info): { modules, isFunction }
export const drawFunctionPatterns = (ver) => {
  const size = ver * 4 + 17
  const modules = Array.from({ length: size }, () => new Array(size).fill(false))
  const isFunction = Array.from({ length: size }, () => new Array(size).fill(false))
  const set = (x, y, dark) => {
    modules[y][x] = dark
    isFunction[y][x] = true
  }
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0)
    set(i, 6, i % 2 === 0)
  }
  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -4; dx <= 4; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dy))
        const x = cx + dx
        const y = cy + dy
        if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4)
      }
  }
  finder(3, 3)
  finder(size - 4, 3)
  finder(3, size - 4)
  const align = alignmentPositions(ver)
  const n = align.length
  for (let i = 0; i < n; i++)
    for (let j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
    }
  // reserve the format areas (written for real later) and the dark module
  drawFormat(set, size, 0)
  if (ver >= 7) {
    const bits = versionBits(ver)
    for (let i = 0; i < 18; i++) {
      const bit = ((bits >>> i) & 1) === 1
      const a = size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      set(a, b, bit)
      set(b, a, bit)
    }
  }
  return { modules, isFunction, size }
}

const drawFormat = (set, size, bits) => {
  const bit = (i) => ((bits >>> i) & 1) === 1
  for (let i = 0; i <= 5; i++) set(8, i, bit(i))
  set(8, 7, bit(6))
  set(8, 8, bit(7))
  set(7, 8, bit(8))
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i))
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i))
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i))
  set(8, size - 8, true)
}

// where codeword bits go, in order: [[x, y], ...] (right to left in two-column strips, up and down)
export const dataPositions = (isFunction) => {
  const size = isFunction.length
  const out = []
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5
    for (let vert = 0; vert < size; vert++)
      for (let j = 0; j < 2; j++) {
        const x = right - j
        const upward = ((right + 1) & 2) === 0
        const y = upward ? size - 1 - vert : vert
        if (!isFunction[y][x]) out.push([x, y])
      }
  }
  return out
}

// ---- the penalty for a mask (lower is better) ----

const penalty = (m) => {
  const size = m.length
  let score = 0
  const lines = []
  for (let y = 0; y < size; y++) lines.push(m[y])
  for (let x = 0; x < size; x++) lines.push(m.map((row) => row[x]))
  for (const line of lines) {
    // runs of five or more
    let run = 1
    for (let i = 1; i <= size; i++) {
      if (i < size && line[i] === line[i - 1]) run++
      else {
        if (run >= 5) score += 3 + (run - 5)
        run = 1
      }
    }
    // finder-like 1:1:3:1:1 with four light on a side
    for (let i = 0; i + 11 <= size; i++) {
      const p = [true, false, true, true, true, false, true]
      const at = (k) => line[i + k]
      const core = (o) => p.every((v, k) => at(o + k) === v)
      if (core(0) && !at(7) && !at(8) && !at(9) && !at(10)) score += 40
      if (!at(0) && !at(1) && !at(2) && !at(3) && core(4)) score += 40
    }
  }
  for (let y = 0; y + 1 < size; y++) for (let x = 0; x + 1 < size; x++) if (m[y][x] === m[y][x + 1] && m[y][x] === m[y + 1][x] && m[y][x] === m[y + 1][x + 1]) score += 3
  let dark = 0
  for (const row of m) for (const v of row) if (v) dark++
  const total = size * size
  const k = Math.ceil(Math.abs(dark * 20 - total * 10) / total) - 1
  return score + k * 10
}

// ---- putting it together ----

export const encodeQr = (text, { ecc = "M", minVersion = 1, maxVersion = 40, mask = null } = {}) => {
  if (!ECC[ecc]) throw new Error(`Unknown error correction level ${ecc}`)
  const str = String(text ?? "")
  const mode = chooseMode(str)
  const { bits: payload, count } = payloadBits(str, mode)
  let version = 0
  for (let v = Math.max(1, minVersion); v <= maxVersion; v++) {
    const need = 4 + countBits(mode, v) + payload.length
    if (count < 2 ** countBits(mode, v) && need <= dataCodewords(v, ecc) * 8) {
      version = v
      break
    }
  }
  if (!version) throw new Error("That's too much text for a QR code.")
  const capacity = dataCodewords(version, ecc) * 8
  const bits = []
  const put = (value, n) => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1)
  }
  put(MODES[mode].indicator, 4)
  put(count, countBits(mode, version))
  bits.push(...payload)
  put(0, Math.min(4, capacity - bits.length))
  put(0, (8 - (bits.length % 8)) % 8)
  for (let pad = 0xec; bits.length < capacity; pad ^= 0xec ^ 0x11) put(pad, 8)
  const data = []
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((b, v) => (b << 1) | v, 0))

  const codewords = addEcc(data, version, ecc)
  const base = drawFunctionPatterns(version)
  const positions = dataPositions(base.isFunction)
  const placed = base.modules.map((row) => row.slice())
  positions.forEach(([x, y], i) => {
    placed[y][x] = i < codewords.length * 8 ? ((codewords[i >>> 3] >>> (7 - (i & 7))) & 1) === 1 : false
  })

  const withMask = (k) => {
    const m = placed.map((row) => row.slice())
    for (const [x, y] of positions) if (MASKS[k](x, y)) m[y][x] = !m[y][x]
    drawFormat((x, y, dark) => (m[y][x] = dark), base.size, formatBits(ecc, k))
    return m
  }
  let best = null
  for (let k = 0; k < 8; k++) {
    if (mask !== null && k !== mask) continue
    const m = withMask(k)
    const score = penalty(m)
    if (!best || score < best.score) best = { mask: k, modules: m, score }
  }
  return { version, size: base.size, ecc, mask: best.mask, mode, modules: best.modules, data, codewords }
}

// draw onto a canvas 2D context: dark modules, a 4-module quiet zone, `scale` pixels a module
export const drawQr = (ctx, qr, scale = 8, { dark = "#000", light = "#fff", border = 4 } = {}) => {
  const full = (qr.size + border * 2) * scale
  ctx.canvas.width = full
  ctx.canvas.height = full
  ctx.fillStyle = light
  ctx.fillRect(0, 0, full, full)
  ctx.fillStyle = dark
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) ctx.fillRect((x + border) * scale, (y + border) * scale, scale, scale)
}

// an SVG of the code (for printing and saving)
export const qrSvg = (qr, { border = 4, dark = "#000", light = "#fff" } = {}) => {
  const n = qr.size + border * 2
  let path = ""
  for (let y = 0; y < qr.size; y++) for (let x = 0; x < qr.size; x++) if (qr.modules[y][x]) path += `M${x + border},${y + border}h1v1h-1z`
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><rect width="${n}" height="${n}" fill="${light}"/><path d="${path}" fill="${dark}"/></svg>`
}
