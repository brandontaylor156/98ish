// A PostCSS step for Accessibility Options (client/src/utils/a11y.js), run on every CSS
// file Vite loads (98.css and Bootstrap too), so no app has to do anything:
//   1. Text size: interface font sizes follow --text-scale (1 at Normal):
//        font-size: 11px  ->  font-size: calc(11px * var(--text-scale, 1))
//      (sizes from 6px to 18px and up to 1.15rem, also inside the `font` shorthand; bigger
//      display type such as game scores is left as designed)
//   2. Title bars grow with the text: calc(100% - 25px), what an app's body takes under
//      the 25px title bar, becomes calc(100% - var(--title-h, 25px))
//   3. Less motion: every @media (prefers-reduced-motion: reduce) block also applies when
//      Accessibility Options turns motion off (html.a11y-motion-reduce)
// A file can opt out of the font scaling with a /* a11y: fixed-text */ comment.

const SCALE = "var(--text-scale, 1)"
const MOTION = "html.a11y-motion-reduce"

const scaled = (value) => {
  const m = String(value).trim().match(/^(\d*\.?\d+)(px|rem)$/)
  if (!m) return null
  const n = Number(m[1])
  if (m[2] === "px" ? n < 6 || n > 18 : n > 1.15) return null
  return `calc(${m[1]}${m[2]} * ${SCALE})`
}

const fixedText = (node) => {
  const root = node.root()
  if (root.__a11yFixed === undefined) root.__a11yFixed = /a11y:\s*fixed-text/.test(root.toString().slice(0, 4000))
  return root.__a11yFixed
}

const motionSelector = (sel) => {
  const s = sel.trim()
  if (s.startsWith(":root")) return MOTION + s.slice(5)
  if (/^html(?![\w-])/.test(s)) return MOTION + s.slice(4)
  return `${MOTION} ${s}`
}

const a11yCss = () => ({
  postcssPlugin: "98ish-a11y",
  Declaration(decl) {
    if (decl.value.includes("--text-scale") || decl.value.includes("--title-h")) return
    if (decl.value.includes("100% - 25px")) decl.value = decl.value.replace(/100% - 25px/g, "100% - var(--title-h, 25px)")
    if (decl.prop === "font-size") {
      if (fixedText(decl)) return
      const next = scaled(decl.value.replace(/\s*!important$/, ""))
      if (next) decl.value = next + (/!important$/.test(decl.value) ? " !important" : "")
    } else if (decl.prop === "font" && !decl.value.includes("var(")) {
      if (fixedText(decl)) return
      decl.value = decl.value.replace(/(^|\s)(\d*\.?\d+(?:px|rem))(?=\s|\/)/, (all, space, size) => space + (scaled(size) || size))
    }
  },
  AtRule: {
    media(at) {
      if (at.__a11y) return
      at.__a11y = true
      const params = at.params.replace(/\s+/g, " ").trim()
      if (!/^\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)$/.test(params)) return
      const copies = []
      at.each((node) => {
        if (node.type !== "rule") return
        const copy = node.clone()
        copy.selectors = node.selectors.map(motionSelector)
        copies.push(copy)
      })
      if (copies.length) at.after(copies)
    },
  },
})
a11yCss.postcss = true

export default a11yCss
