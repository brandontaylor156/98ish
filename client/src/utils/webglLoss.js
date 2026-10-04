// WebGL context loss for the three.js games (iOS drops a backgrounded page's context).
//
// Call releaseGpu(scene) from the "webglcontextlost" handler. It disposes every geometry,
// material, texture and shadow map the scene holds while the context is gone (WebGL ignores
// the delete calls then), so three.js uploads them fresh into the restored context on the
// next render. Without it, anything uploaded before the loss and disposed after the restore
// is deleted against the new context: "WebGL: INVALID_OPERATION: delete: object does not
// belong to this context". The objects themselves stay usable.
export const releaseGpu = (...roots) => {
  const seen = new Set()
  const tex = (t) => {
    if (t?.isTexture && !seen.has(t)) {
      seen.add(t)
      t.dispose()
    }
  }
  for (const root of roots) {
    if (!root) continue
    tex(root.background)
    tex(root.environment)
    root.traverse((o) => {
      if (o.geometry && !seen.has(o.geometry)) {
        seen.add(o.geometry)
        o.geometry.dispose()
      }
      if (o.isLight && o.shadow?.map) {
        o.shadow.map.dispose()
        o.shadow.map = null
      }
      for (const m of [].concat(o.material || [])) {
        if (!m || seen.has(m)) continue
        seen.add(m)
        for (const k in m) tex(m[k])
        for (const k in m.uniforms || {}) tex(m.uniforms[k]?.value)
        m.dispose()
      }
    })
  }
}
