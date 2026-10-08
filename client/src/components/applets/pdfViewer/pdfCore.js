// PDF Viewer's numbers, pure (pdfCore.test.js)

// pdf.js (Mozilla, Apache-2.0), pinned. 3.11 is the last line with a plain script build that
// runs on older iPhones (4.x needs Safari 17.4's Promise.withResolvers).
export const PDFJS_VERSION = "3.11.174"
export const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build/`

export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4
export const clampZoom = (z) => Math.round(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Number(z) || 1)) * 100) / 100

// the scale that makes a page `pageWidth` points wide fill `width` CSS pixels, times the zoom
export const pageScale = (pageWidth, width, zoom = 1) => (pageWidth > 0 && width > 0 ? (width / pageWidth) * clampZoom(zoom) : 1)
