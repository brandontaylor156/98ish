import { useEffect } from "react"
import { useMediaQuery } from "./useMediaQuery"
import { a11yRoot } from "../utils/a11y"

// Puts Accessibility Options on <html>: classes (a11y-hc, a11y-hc-black, a11y-text,
// a11y-motion-reduce, a11y-big-targets...) and CSS variables (--text-scale, --title-h, the
// high contrast colors). On <html> rather than .os-root so the lock screen, the boot screen
// and anything drawn into document.body follow too. Styles: src/a11y.css.
export const useA11yRoot = (settings, mobile) => {
  const systemReduced = useMediaQuery("(prefers-reduced-motion: reduce)")
  const { classes, vars } = a11yRoot(settings, { systemReduced, mobile })
  const key = JSON.stringify([classes, vars])
  useEffect(() => {
    const html = document.documentElement
    for (const [name, on] of Object.entries(classes)) html.classList.toggle(name, !!on)
    const old = (html.dataset.a11yVars || "").split(",").filter(Boolean)
    for (const name of old) if (!(name in vars)) html.style.removeProperty(name)
    for (const [name, value] of Object.entries(vars)) html.style.setProperty(name, value)
    html.dataset.a11yVars = Object.keys(vars).join(",")
  }, [key])
}
