// A Visual Basic 98 program as a file (.vb98 on the drive, and what "Send in Messenger"
// shares): one small JSON.
//   { v: 1, kind: "vb98", name, form: { caption, width, height, backColor },
//     controls: [{ type, name, left, top, width, height, ...props }],
//     code: "VB source", blocks: Blockly workspace JSON | null, mode: "code" | "blocks" }
// Pure, so the server checks a shared program with the same rules.

import { CONTROL_TYPES, validName } from "./controls.js"

export const MAX_BYTES = 256 * 1024
export const MAX_CONTROLS = 120
export const MAX_CODE = 100 * 1024
export const MAX_PICTURE = 120 * 1024 // one picture (a data URL); the designer shrinks photos to fit
export const FORM_LIMITS = { minW: 120, maxW: 1200, minH: 80, maxH: 1200 }

export const blankProject = (name = "Project1") => ({
  v: 1,
  kind: "vb98",
  name,
  form: { caption: "Form1", width: 320, height: 240, backColor: "#c0c0c0" },
  controls: [],
  code: "",
  blocks: null,
  mode: "code",
})

const clampNum = (v, lo, hi, d) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d
}
const cleanStr = (v, max) => String(v ?? "").slice(0, max)
const COLOR = /^(#[0-9a-f]{3,8}|transparent)$/i

// returns { ok: true, project } with every field checked and clamped, or { ok: false, error }
export const validateProject = (input) => {
  let p = input
  if (typeof p === "string") {
    if (p.length > MAX_BYTES * 1.5) return { ok: false, error: "That program is too big (256 KB at most)." }
    try {
      p = JSON.parse(p)
    } catch {
      return { ok: false, error: "That isn't a Visual Basic 98 program." }
    }
  }
  if (!p || typeof p !== "object" || p.kind !== "vb98") return { ok: false, error: "That isn't a Visual Basic 98 program." }
  if (!Array.isArray(p.controls) || p.controls.length > MAX_CONTROLS) return { ok: false, error: `A form can hold up to ${MAX_CONTROLS} controls.` }
  const f = p.form || {}
  const project = {
    v: 1,
    kind: "vb98",
    name: cleanStr(p.name || "Project1", 60) || "Project1",
    form: {
      caption: cleanStr(f.caption ?? "Form1", 80),
      width: clampNum(f.width, FORM_LIMITS.minW, FORM_LIMITS.maxW, 320),
      height: clampNum(f.height, FORM_LIMITS.minH, FORM_LIMITS.maxH, 240),
      backColor: COLOR.test(f.backColor || "") ? f.backColor : "#c0c0c0",
    },
    controls: [],
    code: cleanStr(p.code, MAX_CODE),
    blocks: p.blocks && typeof p.blocks === "object" ? p.blocks : null,
    mode: p.mode === "blocks" ? "blocks" : "code",
  }
  const names = new Set()
  for (const c of p.controls) {
    const def = CONTROL_TYPES[c?.type]
    if (!def) return { ok: false, error: `Unknown control type "${String(c?.type).slice(0, 30)}".` }
    if (!validName(c.name)) return { ok: false, error: `"${String(c.name).slice(0, 40)}" isn't a valid control name.` }
    const key = c.name.toLowerCase()
    if (names.has(key)) return { ok: false, error: `Two controls are called "${c.name}".` }
    names.add(key)
    const out = {
      type: c.type,
      name: c.name,
      left: clampNum(c.left, -2000, 4000, 0),
      top: clampNum(c.top, -2000, 4000, 0),
      width: clampNum(c.width, 4, 4000, def.size[0]),
      height: clampNum(c.height, 4, 4000, def.size[1]),
      visible: c.visible !== false,
      enabled: c.enabled !== false,
    }
    for (const [prop, dflt] of Object.entries(def.defaults)) {
      const v = c[prop]
      if (v === undefined) out[prop] = dflt
      else if (typeof dflt === "boolean") out[prop] = !!v
      else if (typeof dflt === "number") out[prop] = clampNum(v, -100000, 100000, dflt)
      else if (Array.isArray(dflt)) out[prop] = Array.isArray(v) ? v.slice(0, 500).map((x) => cleanStr(x, 200)) : []
      else if (/color/i.test(prop)) out[prop] = COLOR.test(String(v)) ? v : dflt
      else if (prop === "picture" || prop === "costume") {
        const s = String(v)
        if (/^data:image\/(png|jpeg|gif|webp);base64,/.test(s)) {
          if (s.length > MAX_PICTURE) return { ok: false, error: `${c.name}'s picture is too big (${Math.round(MAX_PICTURE / 1024)} KB at most).` }
          out[prop] = s
        } else out[prop] = cleanStr(s, 16) // an emoji or a few letters
      }
      else out[prop] = cleanStr(v, 2000)
    }
    project.controls.push(out)
  }
  if (JSON.stringify(project).length > MAX_BYTES) return { ok: false, error: "That program is too big (256 KB at most). Use smaller pictures." }
  return { ok: true, project }
}

export const serializeProject = (project) => JSON.stringify(project)
export const FILE_EXT = ".vb98"
export const fileNameFor = (project) => `${String(project.name || "Project1").replace(/[\\/:*?"<>|]/g, "").slice(0, 50) || "Project1"}${FILE_EXT}`
