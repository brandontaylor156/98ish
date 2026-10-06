// Post-processing for a real venue on High (docs/venue-realism.md, round 3): a soft bloom on
// the lights (only what's brighter than paint ever gets: hall LEDs, lamp heads, the sun's
// glints on car paint and glass), 4x MSAA on the edges (FXAA blurred the surface grain away),
// a mild vignette. Colors stay honest: the
// scene renders linear into a half-float target, the tone curve and sRGB happen once (the
// OutputPass, with the renderer's own tone mapping and exposure, read every frame), and the
// bloom threshold sits above the brightest paint so painted surfaces aren't lifted.
// Medium and Low draw straight to the screen as before.

import * as THREE from "three"
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js"
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js"
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js"
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js"
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js"

// a gentle darkening toward the corners (applied after the tone curve, in display space)
const VignetteShader = {
  uniforms: { tDiffuse: { value: null }, amount: { value: 0.18 } },
  vertexShader: "varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
  fragmentShader:
    "uniform sampler2D tDiffuse; uniform float amount; varying vec2 vUv; void main() { vec4 c = texture2D(tDiffuse, vUv); vec2 d = vUv - 0.5; float v = 1.0 - amount * smoothstep(0.25, 0.75, dot(d, d) * 2.0); gl_FragColor = vec4(c.rgb * v, c.a); }",
}

export const createPost = (scene, { bloom = 0.22, threshold = 1.15, vignette = 0.12 } = {}) => {
  let composer = null
  let renderPass = null
  let bloomPass = null
  let owner = null
  let last = ""
  const size = new THREE.Vector2()
  const build = (renderer, camera) => {
    composer?.dispose()
    owner = renderer
    renderer.getSize(size)
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: 4 })
    composer = new EffectComposer(renderer, rt)
    renderPass = new RenderPass(scene, camera)
    composer.addPass(renderPass)
    // (half resolution: a soft glow, at a quarter of the cost)
    bloomPass = new UnrealBloomPass(new THREE.Vector2(Math.max(1, size.x / 2), Math.max(1, size.y / 2)), bloom, 0.45, threshold)
    composer.addPass(bloomPass)
    composer.addPass(new OutputPass())
    const vig = new ShaderPass(VignetteShader)
    vig.uniforms.amount.value = vignette
    composer.addPass(vig)
    last = ""
  }
  return {
    render(renderer, camera) {
      if (!composer || owner !== renderer) build(renderer, camera)
      renderPass.camera = camera
      renderer.getSize(size)
      const pr = renderer.getPixelRatio()
      const key = `${size.x}x${size.y}@${pr}`
      if (key !== last) {
        composer.setPixelRatio(pr)
        composer.setSize(size.x, size.y)
        bloomPass.resolution.set(Math.max(1, (size.x * pr) / 2), Math.max(1, (size.y * pr) / 2))
        last = key
      }
      composer.render()
    },
    dispose() {
      composer?.dispose()
      bloomPass?.dispose?.()
      composer = null
    },
  }
}
