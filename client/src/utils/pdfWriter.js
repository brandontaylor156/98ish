// A small PDF writer for pages that are JPEG pictures (Scanner 98), with no library: a PDF
// 1.4 file whose every page shows one JPEG as it is (DCTDecode, so the JPEG bytes go in
// untouched), with a correct cross-reference table so every reader opens it (pdf.js, iPhone
// Files/Books, Acrobat, printers). Pure: bytes in, bytes out (pdfWriter.test.js).

const ascii = (s) => {
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff
  return out
}

// a PDF string literal of plain ASCII (anything else becomes "?"; ( ) \ escaped)
export const pdfString = (s) =>
  `(${String(s ?? "")
    .replace(/[^\x20-\x7e]/g, "?")
    .replace(/[\\()]/g, (c) => `\\${c}`)})`

// the date as a PDF date: D:YYYYMMDDHHmmSSZ (UTC)
export const pdfDate = (d = new Date()) => {
  const two = (n) => String(n).padStart(2, "0")
  return `D:${d.getUTCFullYear()}${two(d.getUTCMonth() + 1)}${two(d.getUTCDate())}${two(d.getUTCHours())}${two(d.getUTCMinutes())}${two(d.getUTCSeconds())}Z`
}

// A JPEG's size and color channels from its SOF marker -> { width, height, components } | null
export const jpegInfo = (bytes) => {
  if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let i = 2
  while (i + 9 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++
      continue
    }
    const marker = bytes[i + 1]
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2
      continue
    }
    const len = (bytes[i + 2] << 8) | bytes[i + 3]
    // SOF0..SOF15 except DHT (C4), JPG (C8), DAC (CC)
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (bytes[i + 5] << 8) | bytes[i + 6], width: (bytes[i + 7] << 8) | bytes[i + 8], components: bytes[i + 9] }
    }
    i += 2 + len
  }
  return null
}

// The page size in points (1/72 inch) for a picture: 8.5 inches across a portrait page, 11
// across a landscape one, the other side by the picture's shape
export const pageSizeFor = (width, height) => {
  if (!(width > 0 && height > 0)) return { w: 612, h: 792 }
  if (height >= width) return { w: 612, h: Math.round((612 * height) / width * 100) / 100 }
  return { w: 792, h: Math.round((792 * height) / width * 100) / 100 }
}

// pages: [{ jpeg: Uint8Array, width?, height? }] (size read from the JPEG when left out)
// -> Uint8Array, the whole PDF file
export const makePdf = (pages, { title = "Scan", producer = "98ish Scanner 98", date = new Date() } = {}) => {
  if (!pages?.length) throw new Error("A PDF needs at least one page.")
  const chunks = []
  const offsets = [] // object number -> byte offset
  let length = 0
  const push = (part) => {
    const bytes = typeof part === "string" ? ascii(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  // object numbers: 1 catalog, 2 pages, 3 info, then 3 per page (page, contents, image)
  const pageObj = (i) => 4 + i * 3
  const startObj = (n) => {
    offsets[n] = length
    push(`${n} 0 obj\n`)
  }
  push("%PDF-1.4\n")
  push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a])) // binary marker comment

  startObj(1)
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n")
  startObj(2)
  push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageObj(i)} 0 R`).join(" ")}] >>\nendobj\n`)
  startObj(3)
  const stamp = pdfDate(date)
  push(`<< /Title ${pdfString(title)} /Producer ${pdfString(producer)} /Creator ${pdfString(producer)} /CreationDate ${pdfString(stamp)} /ModDate ${pdfString(stamp)} >>\nendobj\n`)

  pages.forEach((page, i) => {
    const info = jpegInfo(page.jpeg)
    if (!info) throw new Error(`Page ${i + 1} isn't a JPEG picture.`)
    const width = page.width || info.width
    const height = page.height || info.height
    const size = pageSizeFor(width, height)
    const n = pageObj(i)
    const content = `q\n${size.w} 0 0 ${size.h} 0 0 cm\n/Im${i} Do\nQ\n`
    startObj(n)
    push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${size.w} ${size.h}] /Resources << /XObject << /Im${i} ${n + 2} 0 R >> /ProcSet [/PDF /ImageC /ImageB] >> /Contents ${n + 1} 0 R >>\nendobj\n`)
    startObj(n + 1)
    push(`<< /Length ${content.length} >>\nstream\n${content}endstream\nendobj\n`)
    startObj(n + 2)
    const space = info.components === 1 ? "/DeviceGray" : info.components === 4 ? "/DeviceCMYK" : "/DeviceRGB"
    push(`<< /Type /XObject /Subtype /Image /Width ${info.width} /Height ${info.height} /ColorSpace ${space} /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`)
    push(page.jpeg)
    push("\nendstream\nendobj\n")
  })

  const count = 4 + pages.length * 3 // objects 0..count-1
  const xrefAt = length
  let xref = `xref\n0 ${count}\n0000000000 65535 f \n`
  for (let n = 1; n < count; n++) xref += `${String(offsets[n]).padStart(10, "0")} 00000 n \n`
  push(xref)
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xrefAt}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const c of chunks) {
    out.set(c, at)
    at += c.length
  }
  return out
}
