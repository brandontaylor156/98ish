// Ambient occlusion for a real venue on High (docs/venue-realism.md, round 2): three.js's GTAO
// pass darkens corners, the feet of walls, under benches, between courts and fences, the way
// light really falls off there. It costs a normal/depth pass and a blur, so it's High only.
// Things you see through (chain-link, decals, glows: no depth write) are hidden from its
// normal pass, or they'd throw dark boxes.

import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { GTAOPass } from "three/examples/jsm/postprocessing/GTAOPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"

export const createAO = (scene) => {
  let composer = null
  let renderPass = null
  let gtao = null
  let owner = null
  const size = new THREE.Vector2()
  let last = ""
  const hidden = []
  const build = (renderer, camera) => {
    composer?.dispose()
    owner = renderer
    renderer.getSize(size)
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 })
    composer = new EffectComposer(renderer, rt)
    renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)
    gtao = new GTAOPass(scene, camera, size.x, size.y)
    gtao.updateGtaoMaterial({ radius: 0.8, distanceExponent: 1.4, thickness: 1.5, scale: 1.25, samples: 12, distanceFallOff: 1 })
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 5, rings: 2, samples: 8 })
    gtao.blendIntensity = 0.9
    // its normal/depth pass sees only solid things
    const render = gtao.render.bind(gtao)
    gtao.render = (...args) => {
      scene.traverse((o) => {
        const m = o.material
        if (o.visible && (o.isPoints || o.isSprite || (m && !Array.isArray(m) && (m.transparent || m.depthWrite === false)))) (o.visible = false), hidden.push(o)
      })
      try {
        render(...args)
      } finally {
        for (const o of hidden.splice(0)) o.visible = true
      }
    }
    composer.addPass(gtao)
    composer.addPass(new OutputPass())
    last = ""
  }
  return {
    render(renderer, camera) {
      if (!composer || owner !== renderer) build(renderer, camera)
      renderPass.camera = camera
      gtao.camera = camera
      renderer.getSize(size)
      const key = `${size.x}x${size.y}@${renderer.getPixelRatio()}`
      if (key !== last) {
        composer.setPixelRatio(renderer.getPixelRatio())
        composer.setSize(size.x, size.y)
        last = key
      }
      composer.render()
    },
    dispose() {
      composer?.dispose()
      gtao?.dispose?.()
      composer = null
    },
  }
}
