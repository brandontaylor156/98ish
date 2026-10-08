// Players v3: a photo face's shape file (pl-face-<id>.bin, written by tools/build-faces.mjs).
// Pure (no three.js; faces.test.js reads the shipped files with it). Layout: a u32 header length,
// a JSON header ({ v, unit, eyes: { l, r }, teeth, lods: { hi, med } }, padded to 4 bytes), then
// per level of detail: the moved Body vertices' indices (u16), their offsets (i16 x unit meters)
// and new normals (i8 / 127), the lashes' offsets (i16, every Brows vertex) and the teeth's (i16,
// every Teeth vertex), each array 4-byte aligned.
export const parseFaceShape = (buf) => {
  const hl = new DataView(buf).getUint32(0, true)
  const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 4, hl)))
  const base = 4 + hl
  const lods = {}
  for (const [k, L] of Object.entries(h.lods))
    lods[k] = {
      count: L.count,
      brows: L.brows,
      idx: new Uint16Array(buf, base + L.idx, L.count),
      pos: new Int16Array(buf, base + L.pos, L.count * 3),
      nrm: new Int8Array(buf, base + L.nrm, L.count * 3),
      lash: new Int16Array(buf, base + L.lash, L.brows * 3),
      teeth: L.teeth || 0,
      tooth: L.tooth !== undefined ? new Int16Array(buf, base + L.tooth, (L.teeth || 0) * 3) : null,
    }
  return { unit: h.unit, eyes: h.eyes, teeth: h.teeth, lods }
}
