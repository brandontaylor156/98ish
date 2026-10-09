// The small JPEG-pages PDF writer: a valid structure every reader accepts.
// node --test client/src/utils/pdfWriter.test.js
import test from "node:test"
import assert from "node:assert/strict"
import { jpegInfo, makePdf, pageSizeFor, pdfDate, pdfString } from "./pdfWriter.js"

// the smallest thing jpegInfo reads as a JPEG: SOI, an APP0, a SOF0 with the size, EOI
const fakeJpeg = (width, height, components = 3) =>
  new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 255, width >> 8, width & 255, components, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1, 0xff, 0xd9])

const text = (bytes) => Array.from(bytes, (b) => String.fromCharCode(b)).join("")

test("jpegInfo reads a JPEG's size from its SOF marker, and refuses other things", () => {
  assert.deepEqual(jpegInfo(fakeJpeg(1700, 2200)), { width: 1700, height: 2200, components: 3 })
  assert.deepEqual(jpegInfo(fakeJpeg(8, 9, 1)), { width: 8, height: 9, components: 1 })
  assert.equal(jpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47])), null)
  assert.equal(jpegInfo(null), null)
})

test("strings and dates are written the PDF way", () => {
  assert.equal(pdfString("Scan (1) \\ é"), "(Scan \\(1\\) \\\\ ?)")
  assert.equal(pdfDate(new Date(Date.UTC(2026, 9, 8, 21, 5, 3))), "D:20261008210503Z")
  assert.deepEqual(pageSizeFor(850, 1100), { w: 612, h: 792 })
  assert.deepEqual(pageSizeFor(1100, 850), { w: 792, h: 612 })
})

test("a three-page PDF: header, one page object per picture, a cross-reference table that points at every object", () => {
  const pages = [fakeJpeg(1700, 2200), fakeJpeg(2200, 1700), fakeJpeg(1000, 1414, 1)].map((jpeg) => ({ jpeg }))
  const pdf = makePdf(pages, { title: "Scan 2026-10-08", date: new Date(Date.UTC(2026, 9, 8)) })
  const s = text(pdf)
  assert.ok(s.startsWith("%PDF-1.4\n"))
  assert.ok(s.endsWith("%%EOF\n"))
  assert.equal((s.match(/\/Type \/Page\b/g) || []).length, 3)
  assert.match(s, /\/Type \/Pages \/Count 3 \/Kids \[4 0 R 7 0 R 10 0 R\]/)
  assert.match(s, /\/Title \(Scan 2026-10-08\)/)
  // pages are 8.5 in across portrait, 11 in across landscape
  assert.match(s, /\/MediaBox \[0 0 612 792\]/)
  assert.match(s, /\/MediaBox \[0 0 792 612\]/)
  // the pictures go in as they are
  assert.equal((s.match(/\/Filter \/DCTDecode/g) || []).length, 3)
  assert.match(s, /\/Width 1000 \/Height 1414 \/ColorSpace \/DeviceGray/)
  // startxref points at "xref", and every entry points at "n 0 obj"
  const startxref = Number(s.match(/startxref\n(\d+)\n%%EOF\n$/)[1])
  assert.equal(s.slice(startxref, startxref + 4), "xref")
  const [, first, count] = s.slice(startxref).match(/^xref\n(\d+) (\d+)\n/)
  assert.equal(Number(first), 0)
  assert.equal(Number(count), 4 + 3 * 3)
  assert.match(s, new RegExp(`/Size ${count} /Root 1 0 R /Info 3 0 R`))
  const entries = s.slice(startxref).split("\n").slice(2, 2 + Number(count))
  assert.equal(entries[0], "0000000000 65535 f ")
  entries.slice(1).forEach((line, i) => {
    assert.match(line, /^\d{10} 00000 n $/, "20-byte entries")
    const at = Number(line.slice(0, 10))
    assert.equal(s.slice(at, at + `${i + 1} 0 obj`.length), `${i + 1} 0 obj`)
  })
  // each stream's /Length is its real length
  for (const m of s.matchAll(/\/Length (\d+) >>\nstream\n/g)) {
    const start = m.index + m[0].length
    assert.match(s.slice(start + Number(m[1]), start + Number(m[1]) + 11), /^\n?endstream/)
  }
})

test("no pages, or a page that isn't a JPEG, is refused", () => {
  assert.throws(() => makePdf([]), /at least one page/)
  assert.throws(() => makePdf([{ jpeg: new Uint8Array([1, 2, 3]) }]), /isn't a JPEG/)
})
