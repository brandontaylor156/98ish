// Color Picker's color math: hex <-> RGB <-> HSL / HSV, and the text people copy. Pure,
// tested in colorMath.test.js. RGB channels 0-255; H in degrees 0-359; S, L, V in 0-100.

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

export const parseHex = (text) => {
  const t = String(text ?? "").trim().replace(/^#/, "")
  if (/^[0-9a-f]{3}$/i.test(t)) return { r: parseInt(t[0] + t[0], 16), g: parseInt(t[1] + t[1], 16), b: parseInt(t[2] + t[2], 16) }
  if (/^[0-9a-f]{6}$/i.test(t)) return { r: parseInt(t.slice(0, 2), 16), g: parseInt(t.slice(2, 4), 16), b: parseInt(t.slice(4, 6), 16) }
  return null
}
export const toHex = ({ r, g, b }) => `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, "0")).join("")}`.toUpperCase()

export const rgbToHsl = ({ r, g, b }) => {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  let h = 0
  let s = 0
  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4
    h *= 60
  }
  return { h: Math.round(h) % 360, s: Math.round(s * 100), l: Math.round(l * 100) }
}

export const hslToRgb = ({ h, s, l }) => {
  const S = clamp(s, 0, 100) / 100
  const L = clamp(l, 0, 100) / 100
  const k = (n) => (n + h / 30) % 12
  const a = S * Math.min(L, 1 - L)
  const f = (n) => L - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)))
  return { r: Math.round(f(0) * 255), g: Math.round(f(8) * 255), b: Math.round(f(4) * 255) }
}

export const rgbToHsv = ({ r, g, b }) => {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const d = max - Math.min(R, G, B)
  let h = 0
  if (d) h = (max === R ? (G - B) / d + (G < B ? 6 : 0) : max === G ? (B - R) / d + 2 : (R - G) / d + 4) * 60
  return { h, s: max ? (d / max) * 100 : 0, v: max * 100 }
}

export const hsvToRgb = ({ h, s, v }) => {
  const S = clamp(s, 0, 100) / 100
  const V = clamp(v, 0, 100) / 100
  const f = (n) => {
    const k = (n + h / 60) % 6
    return V - V * S * Math.max(0, Math.min(k, 4 - k, 1))
  }
  return { r: Math.round(f(5) * 255), g: Math.round(f(3) * 255), b: Math.round(f(1) * 255) }
}

export const rgbText = ({ r, g, b }) => `rgb(${r}, ${g}, ${b})`
export const hslText = (rgb) => {
  const { h, s, l } = rgbToHsl(rgb)
  return `hsl(${h}, ${s}%, ${l}%)`
}

// black or white text on this color, whichever reads better (WCAG relative luminance)
export const textOn = ({ r, g, b }) => {
  const lin = (c) => {
    const v = c / 255
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  return L > 0.179 ? "#000000" : "#FFFFFF"
}

// Windows 98's Color dialog's 48 basic colors
export const BASIC = [
  "#FF8080", "#FFFF80", "#80FF80", "#00FF80", "#80FFFF", "#0080FF", "#FF80C0", "#FF80FF",
  "#FF0000", "#FFFF00", "#80FF00", "#00FF40", "#00FFFF", "#0080C0", "#8080C0", "#FF00FF",
  "#804040", "#FF8040", "#00FF00", "#008080", "#004080", "#8080FF", "#800040", "#FF0080",
  "#800000", "#FF8000", "#008000", "#008040", "#0000FF", "#0000A0", "#800080", "#8000FF",
  "#400000", "#804000", "#004000", "#004040", "#000080", "#000040", "#400040", "#400080",
  "#000000", "#808000", "#808040", "#808080", "#408080", "#C0C0C0", "#400040", "#FFFFFF",
]
