// Real Sky (docs/venue-realism.md): the dome and the weather you see.
// - the sky: atmosphere.js's physical scattering, worked out on the CPU into a small texture
//   when the sun moves half a degree or the haze changes (a few ms, off the frame), sampled
//   here; blended to the look's own colors when it's overcast or night (sky.js realLook)
// - the sun's disk and glow, the moon's disk with its phase
// - clouds: a cloud deck drawn in the dome's shader from noise, its coverage the day's cloud
//   cover, drifting with the real wind; High lights each cloud from the sun's side (a second
//   noise sample toward the sun: soft self-shadowing), Medium draws a flatter layer, Low none
// - rain or snow: streaks in a box that wraps round the camera, falling on the GPU (no
//   per-frame JavaScript), slanted by the wind; outdoors only
import * as THREE from "three"
import { EL_MIN, SKY_H, SKY_W, V_POW, horizonRowV, renderSky } from "./atmosphere.js"

const noise = `
float rsHash(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float rsNoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(rsHash(i), rsHash(i + vec2(1.0, 0.0)), u.x), mix(rsHash(i + vec2(0.0, 1.0)), rsHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float rsFbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < OCTAVES; i++) { v += a * rsNoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return v / (1.0 - pow(0.5, float(OCTAVES)));
}
// (the sun-side sample for High's shading: the big shapes are enough)
float rsFbm3(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 3; i++) { v += a * rsNoise(p); p = p * 2.03 + vec2(17.1, 9.3); a *= 0.5; }
  return v / 0.875;
}
`

export const createRealSky = ({ radius = 300, quality = "medium", phone = false } = {}) => {
  // (phones draw the flatter layer even on High: the sky fills most of a portrait screen)
  const clouds = quality === "low" ? 0 : quality === "high" && !phone ? 2 : 1
  const w = phone ? 48 : SKY_W
  const h = phone ? 24 : SKY_H
  const tex = new THREE.DataTexture(new Uint8Array(w * h * 4).fill(255), w, h, THREE.RGBAFormat)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.magFilter = THREE.LinearFilter
  tex.minFilter = THREE.LinearFilter
  tex.wrapS = THREE.RepeatWrapping
  tex.wrapT = THREE.ClampToEdgeWrapping
  tex.needsUpdate = true
  const uniforms = {
    skyTex: { value: tex },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    sunColor: { value: new THREE.Color(1, 0.97, 0.9) },
    sunVis: { value: 1 },
    moonDir: { value: new THREE.Vector3(0, -1, 0) },
    moonLit: { value: 0.5 },
    lookTop: { value: new THREE.Color(0x3f8fe0) },
    lookHorizon: { value: new THREE.Color(0xd8ecfb) },
    lookK: { value: 0 }, // 0: the physical sky; 1: the look's colors (overcast, night)
    cover: { value: 0 },
    rain: { value: 0 },
    dayK: { value: 1 },
    cloudOff: { value: new THREE.Vector2(0, 0) },
  }
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms,
    defines: { CLOUDS: clouds, OCTAVES: clouds === 2 ? 4 : 3 },
    vertexShader: "varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }",
    fragmentShader: `
uniform sampler2D skyTex;
uniform vec3 sunDir; uniform vec3 sunColor; uniform float sunVis;
uniform vec3 moonDir; uniform float moonLit;
uniform vec3 lookTop; uniform vec3 lookHorizon; uniform float lookK;
uniform float cover; uniform float rain; uniform float dayK; uniform vec2 cloudOff;
varying vec3 vDir;
${noise}
void main() {
  vec3 d = normalize(vDir);
  float el = degrees(asin(clamp(d.y, -1.0, 1.0)));
  float v = pow(clamp((el - (${EL_MIN.toFixed(1)})) / (90.0 - (${EL_MIN.toFixed(1)})), 0.0, 1.0), ${(1 / V_POW).toFixed(4)});
  float u = fract(atan(d.x, -d.z) / 6.2831853);
  vec3 sky = texture2D(skyTex, vec2(u, max(v, ${horizonRowV(h).toFixed(5)}))).rgb;
  vec3 look = mix(lookHorizon, lookTop, pow(clamp(d.y, 0.0, 1.0), 0.5));
  sky = mix(sky, look, lookK);
  // the sun: a disk and its glow (hidden by cloud and overcast)
  float cs = dot(d, normalize(sunDir));
  float disk = smoothstep(0.99986, 0.99994, cs) * sunVis;
  float glow = pow(max(cs, 0.0), 420.0) * 0.55 * sunVis + pow(max(cs, 0.0), 40.0) * 0.08 * sunVis;
  // the moon: a disk lit by its phase
  float cm = dot(d, normalize(moonDir));
  float mdisk = smoothstep(0.99990, 0.99995, cm) * (1.0 - dayK) * step(0.0, moonDir.y) * (0.35 + 0.65 * moonLit);
  float dens = 0.0;
#if CLOUDS > 0
  if (d.y > 0.0 && cover > 0.01) {
    vec2 p = d.xz / (d.y + 0.08) * 0.85 + cloudOff;
    float n = rsFbm(p);
    dens = smoothstep(1.0 - cover - 0.06, 1.0 - cover + 0.32, n) * smoothstep(0.0, 0.16, d.y);
  #if CLOUDS > 1
    float n2 = rsFbm3(p + normalize(sunDir.xz + 1e-4) * 0.09);
    float shade = clamp(0.62 + (n - n2) * 3.2, 0.18, 1.0);
  #else
    float shade = 0.72;
  #endif
    vec3 lit = sunColor * (0.55 + 0.45 * dayK) * dayK + vec3(0.05, 0.06, 0.09) * (1.0 - dayK);
    vec3 dark = mix(lookHorizon * 0.62, vec3(0.32, 0.35, 0.39) * dayK + vec3(0.02, 0.025, 0.04), rain);
    vec3 cloud = mix(dark, lit, shade * (1.0 - 0.6 * rain));
    sky = mix(sky, cloud, dens * 0.96);
  }
#endif
  float clear = (1.0 - dens) * (1.0 - smoothstep(0.75, 0.98, cover));
  sky += sunColor * glow * clear;
  sky = mix(sky, vec3(1.0, 0.98, 0.92), disk * clear);
  sky = mix(sky, vec3(0.92, 0.93, 0.98), mdisk * (1.0 - dens));
  gl_FragColor = vec4(sky, 1.0);
  #include <colorspace_fragment>
}`,
  })
  material.name = "realSky"

  // the scattering texture: redone when the sun moves half a degree or the haze changes
  let lastSun = null
  let lastHaze = -1
  let pending = 0
  const refresh = (sun, haze) => {
    const moved = !lastSun || lastSun.x * sun.x + lastSun.y * sun.y + lastSun.z * sun.z < 0.99996
    if (!moved && Math.abs(haze - lastHaze) < 0.15) return
    lastSun = { ...sun }
    lastHaze = haze
    clearTimeout(pending)
    // off the frame: a few ms on a laptop, more on a phone
    pending = setTimeout(() => {
      const out = renderSky([sun.x, sun.y, sun.z], { haze, w, h })
      tex.image.data.set(out.data)
      tex.needsUpdate = true
    }, 0)
  }

  // the look (sky.js realLook) -> the dome
  const t0 = performance.now()
  let wind = { x: 0, z: 0 }
  const setLook = (d) => {
    const s = d.sunSky || d.sun.dir
    uniforms.sunDir.value.set(s.x, s.y, s.z)
    uniforms.sunColor.value.setHex(d.sun.color).lerp(new THREE.Color(1, 0.97, 0.9), 0.4)
    const dayK = Math.max(0, Math.min(1, ((d.sunEl ?? 45) + 3) / 9))
    uniforms.dayK.value = dayK
    uniforms.sunVis.value = (d.sunEl ?? 45) > -1 ? 1 : 0
    if (d.moon) uniforms.moonDir.value.set(d.moon.dir.x, d.moon.dir.y, d.moon.dir.z)
    uniforms.moonLit.value = d.moon?.lit ?? 0.5
    uniforms.lookTop.value.setHex(d.sky[0])
    uniforms.lookHorizon.value.setHex(d.sky[1])
    const wx = d.weather || {}
    uniforms.cover.value = wx.cover ?? 0
    uniforms.rain.value = Math.max(wx.rain ?? 0, wx.snow ?? 0)
    // night and overcast: the look's colors (they already carry the grey and the moonlit navy)
    uniforms.lookK.value = Math.max(1 - dayK, Math.min(1, (wx.cover ?? 0) * 0.9 + (wx.rain ?? 0) * 0.4) * 0.92)
    // the wind blows FROM windDir: clouds drift the other way (x east, z south)
    const a = ((wx.windDir ?? 270) * Math.PI) / 180
    const ms = wx.wind ?? 2
    wind = { x: -Math.sin(a) * ms, z: Math.cos(a) * ms }
    refresh(s.y > -0.25 ? s : { x: s.x, y: -0.25, z: s.z }, d.haze ?? 1)
  }
  // drift the clouds (call per frame; cheap)
  const tick = () => {
    const t = (performance.now() - t0) / 1000
    uniforms.cloudOff.value.set((wind.x * t) / 900, (wind.z * t) / 900)
  }
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, 32, 16), material)
  mesh.renderOrder = -1
  mesh.frustumCulled = false
  mesh.onBeforeRender = tick
  return {
    mesh,
    material,
    uniforms,
    setLook,
    dispose() {
      clearTimeout(pending)
      tex.dispose()
      material.dispose()
      mesh.geometry.dispose()
    },
  }
}

// rain (or snow): streaks in a box round the camera, falling on the GPU
export const createPrecip = ({ quality = "medium", phone = false } = {}) => {
  const n = Math.round((quality === "high" ? 2600 : 1400) * (phone ? 0.55 : 1))
  const base = new Float32Array(n * 2 * 3)
  const end = new Float32Array(n * 2)
  let s = 7
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
  for (let i = 0; i < n; i++) {
    const x = rnd()
    const y = rnd()
    const z = rnd()
    base.set([x, y, z, x, y, z], i * 6)
    end[i * 2 + 1] = 1
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute("position", new THREE.BufferAttribute(base, 3))
  geo.setAttribute("aEnd", new THREE.BufferAttribute(end, 1))
  const uniforms = {
    time: { value: 0 },
    amount: { value: 0 },
    speed: { value: 9 },
    tail: { value: 0.045 },
    wind: { value: new THREE.Vector2(0, 0) },
    box: { value: new THREE.Vector3(36, 22, 36) },
    color: { value: new THREE.Color(0xc8d4e2) },
    alpha: { value: 0.38 },
  }
  const material = new THREE.ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    fog: false,
    vertexShader: `
uniform float time; uniform float amount; uniform float speed; uniform float tail; uniform vec2 wind; uniform vec3 box;
attribute float aEnd;
varying float vA;
void main() {
  vec3 b = position;
  vec3 vel = vec3(wind.x, -speed, wind.y);
  vec3 p = (fract(b + vel * time / box) - 0.5) * box;
  vec3 wp = cameraPosition + p + vec3(0.0, box.y * 0.2, 0.0);
  wp -= vel * tail * aEnd;
  float keep = step(fract(b.x * 91.7 + b.z * 53.3), amount);
  vA = keep * (1.0 - smoothstep(0.32, 0.5, length(p.xz) / box.x)) * (1.0 - smoothstep(0.3, 0.5, abs(p.y) / box.y));
  gl_Position = keep > 0.5 ? projectionMatrix * viewMatrix * vec4(wp, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
}`,
    fragmentShader: `
uniform vec3 color; uniform float alpha;
varying float vA;
void main() {
  gl_FragColor = vec4(color, vA * alpha);
  #include <colorspace_fragment>
}`,
  })
  const lines = new THREE.LineSegments(geo, material)
  lines.frustumCulled = false
  lines.renderOrder = 3
  lines.visible = false
  const t0 = performance.now()
  lines.onBeforeRender = () => (uniforms.time.value = (performance.now() - t0) / 1000)
  // the weather (weather.js) -> how much falls, rain or snow, and the wind's slant
  const setWeather = (wx = {}) => {
    const snow = (wx.snow ?? 0) > (wx.rain ?? 0)
    const amt = snow ? wx.snow : wx.rain || 0
    uniforms.amount.value = Math.min(1, amt)
    lines.visible = amt > 0.02
    uniforms.speed.value = snow ? 1.3 : 8.5 + amt * 2.5
    uniforms.tail.value = snow ? 0.02 : 0.05
    uniforms.color.value.setHex(snow ? 0xf4f7fb : 0xbfcad8)
    uniforms.alpha.value = snow ? 0.85 : 0.32 + amt * 0.18
    const a = ((wx.windDir ?? 270) * Math.PI) / 180
    const ms = Math.min(14, wx.wind ?? 0) * (snow ? 0.6 : 0.35)
    uniforms.wind.value.set(-Math.sin(a) * ms, Math.cos(a) * ms)
  }
  return {
    mesh: lines,
    setWeather,
    dispose() {
      geo.dispose()
      material.dispose()
    },
  }
}
