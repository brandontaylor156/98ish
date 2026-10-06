// Instant Replay Reels: the broadcast graphics, in 98ish's style (navy title bars, silver
// panels, the pixel font where it's loaded). Layout math is pure (tested); draw* paint a 2D
// canvas context.

export const layout = (W, H) => {
  const pad = Math.round(Math.min(W, H) * 0.04)
  const bugW = Math.round(W * 0.3)
  const bugH = Math.round(H * 0.1)
  return {
    pad,
    bug: { x: pad, y: pad, w: bugW, h: bugH },
    badge: { x: W - pad - Math.round(W * 0.2), y: pad, w: Math.round(W * 0.2), h: Math.round(H * 0.075) },
    lower: { x: pad, y: H - pad - Math.round(H * 0.13), w: W - pad * 2, h: Math.round(H * 0.13) },
    banner: { x: Math.round(W * 0.2), y: Math.round(H * 0.4), w: Math.round(W * 0.6), h: Math.round(H * 0.2) },
    title: { size: Math.round(H * 0.09), sub: Math.round(H * 0.04) },
    text: Math.round(H * 0.034),
  }
}

const FONT = '"Pixelated MS Sans Serif", "MS Sans Serif", Tahoma, Arial, sans-serif'

const panel = (g, r, { title = null, fill = "#c0c0c0" } = {}) => {
  g.fillStyle = fill
  g.fillRect(r.x, r.y, r.w, r.h)
  // 98 bevel
  g.fillStyle = "#ffffff"
  g.fillRect(r.x, r.y, r.w, 2)
  g.fillRect(r.x, r.y, 2, r.h)
  g.fillStyle = "#000000"
  g.fillRect(r.x, r.y + r.h - 2, r.w, 2)
  g.fillRect(r.x + r.w - 2, r.y, 2, r.h)
  if (title) {
    const th = Math.max(14, Math.round(r.h * 0.32))
    const grad = g.createLinearGradient(r.x, 0, r.x + r.w, 0)
    grad.addColorStop(0, "#000080")
    grad.addColorStop(1, "#1084d0")
    g.fillStyle = grad
    g.fillRect(r.x + 3, r.y + 3, r.w - 6, th)
    g.fillStyle = "#ffffff"
    g.font = `bold ${Math.round(th * 0.72)}px ${FONT}`
    g.textBaseline = "middle"
    g.fillText(title, r.x + 8, r.y + 3 + th / 2)
    return th + 3
  }
  return 0
}

// score bug: the game and the moment's number
export const drawBug = (g, L, { title = "Highlights", line = "" } = {}) => {
  const off = panel(g, L.bug, { title })
  g.fillStyle = "#000"
  g.font = `${Math.round(L.text * 0.95)}px ${FONT}`
  g.textBaseline = "middle"
  g.fillText(line, L.bug.x + 10, L.bug.y + off + (L.bug.h - off) / 2)
}

// a speed badge (top right)
export const drawBadge = (g, L, text) => {
  if (!text) return
  panel(g, L.badge, { fill: "#ffffe1" })
  g.fillStyle = "#000"
  g.font = `bold ${Math.round(L.text * 1.05)}px ${FONT}`
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.fillText(text, L.badge.x + L.badge.w / 2, L.badge.y + L.badge.h / 2)
  g.textAlign = "left"
}

// lower third: what the moment is
export const drawLower = (g, L, { title, sub }) => {
  const off = panel(g, L.lower, { title })
  g.fillStyle = "#000"
  g.font = `${L.text}px ${FONT}`
  g.textBaseline = "middle"
  g.fillText(sub || "", L.lower.x + 12, L.lower.y + off + (L.lower.h - off) / 2)
}

// the line-call banner (challenge)
export const drawCall = (g, L, text, verdict) => {
  const r = L.banner
  g.fillStyle = verdict === "in" ? "rgba(0,110,40,0.92)" : verdict === "out" ? "rgba(170,0,0,0.92)" : "rgba(40,40,40,0.92)"
  g.fillRect(r.x, r.y, r.w, r.h)
  g.fillStyle = "#fff"
  g.font = `bold ${Math.round(r.h * 0.42)}px ${FONT}`
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.fillText(text, r.x + r.w / 2, r.y + r.h / 2)
  g.textAlign = "left"
}

// title and end cards (a 98 desktop-teal ground with a window)
export const drawCard = (g, W, H, L, { title, lines = [] }) => {
  g.fillStyle = "#008080"
  g.fillRect(0, 0, W, H)
  const r = { x: Math.round(W * 0.12), y: Math.round(H * 0.2), w: Math.round(W * 0.76), h: Math.round(H * 0.6) }
  const off = panel(g, r, { title: "Pickleball 98 · Instant Replay" })
  g.fillStyle = "#000"
  g.textAlign = "center"
  g.textBaseline = "middle"
  g.font = `bold ${L.title.size}px ${FONT}`
  g.fillText(title, r.x + r.w / 2, r.y + off + (r.h - off) * 0.32)
  g.font = `${L.title.sub}px ${FONT}`
  lines.slice(0, 5).forEach((t, i) => g.fillText(t, r.x + r.w / 2, r.y + off + (r.h - off) * (0.55 + i * 0.1)))
  g.textAlign = "left"
}

// fit a w x h source into W x H (contain, centered)
export const contain = (w, h, W, H) => {
  const k = Math.min(W / w, H / h)
  const dw = Math.round(w * k)
  const dh = Math.round(h * k)
  return { x: Math.round((W - dw) / 2), y: Math.round((H - dh) / 2), w: dw, h: dh }
}
