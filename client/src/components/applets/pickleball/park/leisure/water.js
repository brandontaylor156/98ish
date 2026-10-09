// My Park leisure: water on the real pools and in the hot tub (three.js). Cheap enough for a
// phone: one flat mesh per pool (the pool's own outline), one disc in the tub, and a shader of a
// few moving sine waves for the surface's slope, the sky's reflection by the angle you look at it
// (Fresnel), the sun's glint, bright caustic lines, and rings where someone swims or splashes.
// The tub's water bubbles (the same shader, foaming) and steams (a few soft sprites). Splashes are
// a burst of drops (one instanced mesh for all).
//
//   const water = createWater(scene, { pools: [spot], tubs: [spot], quality })
//   water.step(dt, { camera, sunDir, light })   water.ripple(x, z, k)   water.splash(x, z, size)
//   water.dispose()

import * as THREE from "three"

const MAX_RIPPLES = 6
const VERT = /* glsl */ `
  varying vec3 vWorld;
  #include <fog_pars_vertex>
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    vec4 mvPosition = viewMatrix * w;
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`
const FRAG = /* glsl */ `
  uniform float uTime;
  uniform vec3 uShallow;
  uniform vec3 uDeep;
  uniform vec3 uSky;
  uniform vec3 uSunDir;
  uniform float uLight;
  uniform float uFoam;
  uniform float uOpacity;
  uniform vec4 uRipples[${MAX_RIPPLES}];
  varying vec3 vWorld;
  #include <fog_pars_fragment>
  void main() {
    vec2 p = vWorld.xz;
    float t = uTime;
    // the surface's slope from a few moving waves (metres; a calm pool)
    vec2 g = vec2(0.0);
    g += vec2(0.9, 0.4) * cos(dot(p, vec2(0.9, 0.4)) * 2.1 + t * 1.3) * 0.05;
    g += vec2(-0.5, 0.85) * cos(dot(p, vec2(-0.5, 0.85)) * 3.3 + t * 1.7) * 0.035;
    g += vec2(0.2, -1.0) * cos(dot(p, vec2(0.2, -1.0)) * 5.1 + t * 2.3) * 0.02;
    // rings: someone swimming, a splash (x, z, start time, strength)
    for (int i = 0; i < ${MAX_RIPPLES}; i++) {
      vec4 r = uRipples[i];
      if (r.w <= 0.0) continue;
      float age = t - r.z;
      if (age < 0.0 || age > 3.0) continue;
      vec2 d = p - r.xy;
      float dist = length(d) + 1e-4;
      float front = age * 1.6;
      float k = exp(-pow((dist - front) * 3.0, 2.0)) * r.w * (1.0 - age / 3.0);
      g += d / dist * cos((dist - front) * 14.0) * k * 0.35;
    }
    vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
    vec3 v = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    vec3 col = mix(uShallow, uDeep, 0.35 + 0.3 * fres);
    // caustic-like bright lines on the floor, seen through
    float c = sin(p.x * 3.1 + g.x * 9.0 + t * 0.9) * sin(p.y * 2.7 - g.y * 9.0 + t * 0.7);
    col += vec3(0.55, 0.8, 0.9) * smoothstep(0.82, 1.0, abs(c)) * 0.18 * (1.0 - fres);
    col = mix(col, uSky, fres * 0.75);
    // the sun's glint
    vec3 h = normalize(uSunDir + v);
    col += vec3(1.0, 0.96, 0.88) * pow(max(dot(n, h), 0.0), 180.0) * 1.6 * step(0.0, uSunDir.y);
    // the hot tub's foam: little bubbles boiling up
    if (uFoam > 0.0) {
      vec2 q = p * 9.0;
      vec2 cell = floor(q);
      vec2 f = fract(q) - 0.5;
      float h1 = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453);
      float life = fract(t * (0.6 + h1) + h1 * 7.0);
      float b = smoothstep(0.32 * life + 0.02, 0.0, length(f - (vec2(h1, fract(h1 * 9.1)) - 0.5) * 0.5)) * (1.0 - life);
      col = mix(col, vec3(0.94, 0.98, 1.0), clamp(b * 1.6 * uFoam, 0.0, 0.85));
    }
    col *= uLight;
    gl_FragColor = vec4(col, uOpacity + fres * (1.0 - uOpacity));
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

const makeMaterial = ({ shallow, deep, foam = 0, opacity = 0.84 }) =>
  new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uShallow: { value: new THREE.Color(shallow) },
        uDeep: { value: new THREE.Color(deep) },
        uSky: { value: new THREE.Color("#cfe6f5") },
        uSunDir: { value: new THREE.Vector3(0.3, 0.8, 0.2).normalize() },
        uLight: { value: 1 },
        uFoam: { value: foam },
        uOpacity: { value: opacity },
        uRipples: { value: Array.from({ length: MAX_RIPPLES }, () => new THREE.Vector4(0, 0, -99, 0)) },
      },
    ]),
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })

// the steam's puffs: one instanced mesh of camera-facing quads, each its own fade
// (camera-facing quads like sprites: each instance's centre and size from its matrix)
const STEAM_VERT = /* glsl */ `
  attribute float alpha;
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_vertex>
  void main() {
    vec3 centre = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
    float size = length(instanceMatrix[0].xyz);
    vec4 mvPosition = modelViewMatrix * vec4(centre, 1.0);
    mvPosition.xy += position.xy * size;
    gl_Position = projectionMatrix * mvPosition;
    vAlpha = alpha;
    vUv = uv;
    #include <fog_vertex>
  }
`
const STEAM_FRAG = /* glsl */ `
  uniform sampler2D map;
  varying float vAlpha;
  varying vec2 vUv;
  #include <fog_pars_fragment>
  void main() {
    vec4 c = texture2D(map, vUv);
    gl_FragColor = vec4(c.rgb, c.a * vAlpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`

// a soft round puff for the steam
let puffTex = null
const puff = () => {
  if (puffTex) return puffTex
  const c = document.createElement("canvas")
  c.width = c.height = 64
  const g = c.getContext("2d")
  const r = g.createRadialGradient(32, 32, 2, 32, 32, 30)
  r.addColorStop(0, "rgba(255,255,255,0.55)")
  r.addColorStop(1, "rgba(255,255,255,0)")
  g.fillStyle = r
  g.fillRect(0, 0, 64, 64)
  puffTex = new THREE.CanvasTexture(c)
  return puffTex
}

export const createWater = (scene, { pools = [], tubs = [], quality = "medium" } = {}) => {
  const group = new THREE.Group()
  group.name = "leisureWater"
  scene.add(group)
  const surfaces = []
  for (const s of pools) {
    // (the pool's outline, a hair above the painted floor)
    const shape = new THREE.Shape(s.poly.map(([x, z]) => new THREE.Vector2(x, -z)))
    const geo = new THREE.ShapeGeometry(shape)
    geo.rotateX(-Math.PI / 2)
    geo.translate(0, 0.03, 0)
    const m = new THREE.Mesh(geo, makeMaterial({ shallow: "#5fd3ea", deep: "#1b8db8" }))
    m.renderOrder = 2
    m.userData.spot = s.id
    group.add(m)
    surfaces.push({ spot: s, mesh: m, ripples: [], at: 0 })
  }
  // the steam: soft puffs rising and fading over each tub (fewer on Low), all of them one
  // instanced draw (it was a sprite and a material each: 7 draws a tub)
  const puffs = []
  for (const s of tubs) {
    const geo = new THREE.CircleGeometry(Math.max(0.6, s.R - 0.24), 28)
    geo.rotateX(-Math.PI / 2)
    geo.translate(s.x, (s.water || 0.51) + 0.012, s.z)
    const m = new THREE.Mesh(geo, makeMaterial({ shallow: "#79e0ee", deep: "#2aa7c7", foam: 1, opacity: 0.88 }))
    m.renderOrder = 2
    group.add(m)
    surfaces.push({ spot: s, mesh: m, ripples: [], at: 0 })
    const n = quality === "low" ? 3 : 7
    for (let i = 0; i < n; i++) puffs.push({ tub: s, phase: i / n, ang: (i * 2.4) % (Math.PI * 2) })
  }
  const steamGeo = new THREE.PlaneGeometry(1, 1)
  steamGeo.setAttribute("alpha", new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, puffs.length)), 1))
  const steamMat = new THREE.ShaderMaterial({
    uniforms: { map: { value: puffs.length ? puff() : null }, ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog) },
    vertexShader: STEAM_VERT,
    fragmentShader: STEAM_FRAG,
    transparent: true,
    depthWrite: false,
    fog: true,
  })
  const steam = new THREE.InstancedMesh(steamGeo, steamMat, Math.max(1, puffs.length))
  steam.renderOrder = 3
  steam.frustumCulled = false
  steam.visible = puffs.length > 0
  group.add(steam)
  // splashes: drops thrown up and falling back (one instanced mesh)
  const DROPS = 48
  const dropGeo = new THREE.SphereGeometry(0.035, 5, 4)
  const dropMat = new THREE.MeshBasicMaterial({ color: 0xeaf8ff, transparent: true, opacity: 0.85 })
  const drops = new THREE.InstancedMesh(dropGeo, dropMat, DROPS)
  drops.count = 0
  drops.frustumCulled = false
  group.add(drops)
  const live = []
  const tmp = new THREE.Object3D()
  let time = 0
  const surfaceAt = (x, z) => surfaces.find((s) => (s.spot.poly ? inside(x, z, s.spot.poly) : Math.hypot(x - s.spot.x, z - s.spot.z) < s.spot.R)) || null

  const api = {
    group,
    // a ring on the water at (x, z): k ~0.3 a stroke, 1 a cannonball
    ripple(x, z, k = 0.3) {
      const s = surfaceAt(x, z)
      if (!s) return
      const u = s.mesh.material.uniforms.uRipples.value
      const v = u[s.at % MAX_RIPPLES]
      s.at++
      v.set(x, z, time, k)
    },
    splash(x, z, size = 1) {
      api.ripple(x, z, Math.min(1.2, 0.5 + size * 0.6))
      const n = Math.round(14 + size * 26)
      for (let i = 0; i < n && live.length < DROPS; i++) {
        const a = Math.random() * Math.PI * 2
        const sp = (0.6 + Math.random() * 1.6) * (0.6 + size * 0.5)
        live.push({ x, y: 0.05, z, vx: Math.cos(a) * sp * 0.6, vy: (2.2 + Math.random() * 2.6) * (0.55 + size * 0.45), vz: Math.sin(a) * sp * 0.6, s: 0.6 + Math.random() * 0.9 })
      }
    },
    step(dt, { camera = null, sunDir = null, light = 1, sky = null } = {}) {
      time += dt
      for (const s of surfaces) {
        const u = s.mesh.material.uniforms
        u.uTime.value = time
        u.uLight.value = light
        if (sunDir) u.uSunDir.value.set(sunDir.x, sunDir.y, sunDir.z).normalize()
        if (sky !== null && sky !== undefined) u.uSky.value.set(sky)
      }
      // the steam: rising, drifting, fading (thicker in the cool of the evening)
      if (puffs.length) {
        const alpha = steamGeo.attributes.alpha.array
        puffs.forEach((d, i) => {
          const k = (time * 0.18 + d.phase) % 1
          const tub = d.tub
          const r = (tub.R - 0.5) * (0.3 + 0.6 * ((d.phase * 7.3) % 1))
          tmp.position.set(tub.x + Math.sin(d.ang + time * 0.05) * r, (tub.water || 0.51) + 0.1 + k * 1.3, tub.z + Math.cos(d.ang + time * 0.05) * r)
          tmp.scale.setScalar(0.5 + k * 1.1)
          tmp.rotation.set(0, 0, 0)
          tmp.updateMatrix()
          steam.setMatrixAt(i, tmp.matrix)
          alpha[i] = Math.sin(k * Math.PI) * 0.32 * (1.25 - 0.5 * light)
        })
        steam.instanceMatrix.needsUpdate = true
        steamGeo.attributes.alpha.needsUpdate = true
      }
      // the drops
      let n = 0
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i]
        p.vy -= 9.8 * dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.z += p.vz * dt
        if (p.y < 0.02) {
          live.splice(i, 1)
          continue
        }
      }
      for (const p of live) {
        tmp.position.set(p.x, p.y, p.z)
        tmp.scale.setScalar(p.s)
        tmp.updateMatrix()
        drops.setMatrixAt(n++, tmp.matrix)
      }
      drops.count = n
      if (n) drops.instanceMatrix.needsUpdate = true
      void camera
    },
    // the water's level where you are (null: not on the water)
    levelAt(x, z) {
      const s = surfaceAt(x, z)
      return s ? (s.spot.poly ? 0.03 : (s.spot.water || 0.51) + 0.012) : null
    },
    get time() {
      return time
    },
    dispose() {
      group.removeFromParent()
      for (const s of surfaces) {
        s.mesh.geometry.dispose()
        s.mesh.material.dispose()
      }
      steamGeo.dispose()
      steamMat.dispose()
      dropGeo.dispose()
      dropMat.dispose()
      drops.dispose()
    },
  }
  return api
}

const inside = (x, z, p) => {
  let c = false
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) if (p[i][1] > z !== p[j][1] > z && x < ((p[j][0] - p[i][0]) * (z - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0]) c = !c
  return c
}
