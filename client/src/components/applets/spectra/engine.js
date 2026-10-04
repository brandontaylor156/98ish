// SPECTRA's engine: three.js scene, shaders, input, the frame loop and cleanup. Game rules
// live in logic.js; this file only turns that state into light and sound.
//
// Space: the camera sits near the tube's axis looking down -z. The ship always rides the
// bottom of the tube at z = PLAYER_Z; the world (tube, gates, shards) rolls around the
// axis instead, so turning spins the universe around you. Something at game position
// (s, theta) is drawn at angle theta, depth PLAYER_Z - (s - distance), inside the rolled
// group. The tube's winding is only a vertex-shader bend, so it never affects collisions.

import * as THREE from "three"
import {
  TAU,
  PLAYER_HALF,
  createGame,
  step,
  angleDelta,
  angleDist,
  difficulty,
  gapCenterAt,
  finalScore,
  zoneName,
} from "./logic"
import { createAudio } from "./audio"
import { reducedMotion } from "../../../utils/settings"
import { createFrameClock, substeps } from "../../../utils/frameClock.js"
import { createResolution } from "../../../utils/dynamicResolution.js"
import { releaseGpu } from "../../../utils/webglLoss.js"

const R = 6 // tube radius
const SHIP_R = R - 0.9 // the ship rides this far from the axis
const PLAYER_Z = -5
const VIEW = 230 // how far ahead is drawn
const SLAB_IN = R - 1.6 // gate slabs span this radius range (the ship's radius is inside it)
const SLAB_OUT = R + 0.2
const SLAB_DEPTH = 0.35
const MAX_SHARDS = 420
const MAX_PARTICLES = 900
const TRAIL_POINTS = 28
const DRAG_TURN = TAU * 0.75 // a full-width drag turns this far
const MAX_STEP = 1 / 30 // the longest single logic step (logic.step clamps at 50 ms)

// Cosine palettes (Inigo Quilez): color(t) = a + b * cos(2pi (c t + d)), one per zone
const LOOKS = [
  { a: [0.5, 0.5, 0.5], b: [0.5, 0.5, 0.5], c: [1, 1, 1], d: [0.0, 0.33, 0.67], pattern: [0.6, 1, 0.6, 1], fog: [0.02, 0.0, 0.08], bend: 0.0009 },
  { a: [0.45, 0.25, 0.65], b: [0.45, 0.35, 0.35], c: [1, 1, 1], d: [0.65, 0.85, 0.05], pattern: [1, 0.4, 0.9, 0.6], fog: [0.06, 0.0, 0.12], bend: 0.0011 },
  { a: [0.65, 0.35, 0.2], b: [0.45, 0.35, 0.25], c: [1, 0.8, 0.5], d: [0.0, 0.15, 0.25], pattern: [0.4, 0.6, 1, 1], fog: [0.1, 0.02, 0.0], bend: 0.0012 },
  { a: [0.2, 0.55, 0.5], b: [0.3, 0.45, 0.4], c: [1, 1, 1], d: [0.3, 0.2, 0.2], pattern: [0.8, 1, 0.5, 0.4], fog: [0.0, 0.06, 0.06], bend: 0.0014 },
  { a: [0.5, 0.5, 0.5], b: [0.6, 0.6, 0.6], c: [2, 1, 0], d: [0.5, 0.2, 0.25], pattern: [1, 1, 1, 1], fog: [0.05, 0.02, 0.08], bend: 0.0016 },
  { a: [0.25, 0.15, 0.35], b: [0.5, 0.35, 0.5], c: [1, 1, 1], d: [0.8, 0.5, 0.2], pattern: [0.5, 0.8, 1, 0.8], fog: [0.0, 0.0, 0.0], bend: 0.0017 },
]
const lookFor = (zone) => LOOKS[zone % LOOKS.length]
// the same looks as vectors, made once (no per-frame allocation while fading between them)
const LOOK_VECTORS = new Map()
const vectorsFor = (target) => {
  if (!LOOK_VECTORS.has(target)) {
    LOOK_VECTORS.set(target, {
      a: new THREE.Vector3().fromArray(target.a),
      b: new THREE.Vector3().fromArray(target.b),
      c: new THREE.Vector3().fromArray(target.c),
      d: new THREE.Vector3().fromArray(target.d),
      pattern: new THREE.Vector4().fromArray(target.pattern),
      fog: new THREE.Vector3().fromArray(target.fog),
    })
  }
  return LOOK_VECTORS.get(target)
}

// CPU copy of the shaders' palette, for gates, shards, particles and the ship. `look`
// holds THREE.Vector3s (the live, fading palette).
const palette = (look, t, out) => {
  for (let i = 0; i < 3; i++) {
    out[i] = look.a.getComponent(i) + look.b.getComponent(i) * Math.cos(TAU * (look.c.getComponent(i) * t + look.d.getComponent(i)))
  }
  return out
}

// ---------- shaders ----------

const BEND = /* glsl */ `
uniform vec2 uBend;
vec3 bendWorld(vec3 p) {
  float d = max(0.0, -p.z - 3.0);
  p.xy += uBend * d * d;
  return p;
}
`

const FOG = /* glsl */ `
uniform vec3 uFog;
vec3 applyFog(vec3 col, float depth) {
  return mix(col, uFog, smoothstep(${(VIEW * 0.3).toFixed(1)}, ${VIEW.toFixed(1)}, depth));
}
`

const PALETTE = /* glsl */ `
uniform vec3 uPA, uPB, uPC, uPD;
vec3 pal(float t) { return uPA + uPB * cos(6.2831853 * (uPC * t + uPD)); }
`

const TUBE_VERT = /* glsl */ `
${BEND}
uniform float uTravel;
varying vec2 vXY;
varying float vS;
varying float vDepth;
void main() {
  vXY = position.xy;
  vS = uTravel + (${PLAYER_Z.toFixed(1)} - position.z);
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDepth = -world.z;
  world.xyz = bendWorld(world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

// Every angular term uses whole-number multiples of the angle, so the pattern has no seam
const TUBE_FRAG = /* glsl */ `
${PALETTE}
${FOG}
uniform float uTime, uBeat, uIntensity, uOverdrive, uFlash;
uniform vec4 uPattern; // stripes, lanes+diamonds, swirl, rings
varying vec2 vXY;
varying float vS;
varying float vDepth;
void main() {
  float A = atan(vXY.y, vXY.x);
  float s = vS;
  float t = uTime;
  float flow = sin(3.0 * A + s * 0.06 - t * 0.8)
             + sin(5.0 * A - s * 0.045 + t * 0.5)
             + sin(s * 0.11 + 2.0 * sin(2.0 * A + t * 0.3));
  float hue = flow * 0.12 + s * 0.0025 + t * 0.03;
  vec3 col = pal(hue);

  float swirl = 0.5 + 0.5 * sin(flow * 3.0 + t * 1.3);
  float stripes = 0.5 + 0.5 * sin(s * 0.35 + 6.0 * A + t * 2.0);
  float bright = 0.32 + 0.3 * mix(1.0, swirl, uPattern.z) + 0.22 * stripes * uPattern.x;
  col *= bright;

  float rings = pow(0.5 + 0.5 * sin(s * 0.9), 28.0) * uPattern.w;
  float lanes = pow(0.5 + 0.5 * cos(24.0 * A), 48.0) * uPattern.y;
  float dg = abs(sin(8.0 * A + s * 0.25)) * abs(sin(8.0 * A - s * 0.25));
  float diamonds = (1.0 - smoothstep(0.0, 0.06, dg)) * uPattern.y * 0.6;
  col += (rings + lanes + diamonds) * pal(hue + 0.5) * (0.75 + uBeat * 0.7 + uOverdrive * 0.6);

  col *= 1.0 + uIntensity * 0.5 + uOverdrive * 0.7 + uBeat * 0.15;
  col = applyFog(col, vDepth);
  col = mix(col, vec3(1.0), uFlash);
  gl_FragColor = vec4(col, 1.0);
}
`

const GATE_VERT = /* glsl */ `
${BEND}
attribute float aEdge;   // distance from the slab's nearest end (a gap edge), world units
attribute float aRadial; // 0 = inner edge (toward the axis), 1 = outer
attribute float aFace;   // 0 front/back, 1 inner face, 2 end cap
varying float vEdge;
varying float vRadial;
varying float vFace;
varying float vDepth;
void main() {
  vEdge = aEdge;
  vRadial = aRadial;
  vFace = aFace;
  vec4 world = modelMatrix * vec4(position, 1.0);
  vDepth = -world.z;
  world.xyz = bendWorld(world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const GATE_FRAG = /* glsl */ `
${FOG}
uniform vec3 uColor;
uniform float uFlash, uBeat, uTime;
varying float vEdge;
varying float vRadial;
varying float vFace;
varying float vDepth;
void main() {
  // bright neon at the gap edges and along the inner rim; a darker glassy body
  float gapEdge = 1.0 - smoothstep(0.0, 0.45, vEdge);
  float rim = 1.0 - smoothstep(0.0, 0.12, vRadial);
  float scan = 0.5 + 0.5 * sin(vRadial * 18.0 - uTime * 6.0);
  vec3 body = uColor * (0.28 + 0.18 * scan + 0.25 * uBeat);
  vec3 col = body + (uColor * 1.4 + 0.35) * max(gapEdge, rim * 0.8);
  if (vFace > 1.5) col = uColor * 1.6 + 0.4; // the gap's walls glow fully
  col = mix(col, vec3(1.0), uFlash);
  col = applyFog(col, vDepth);
  gl_FragColor = vec4(col, 1.0);
}
`

const SHARD_VERT = /* glsl */ `
${BEND}
varying vec3 vColor;
varying float vShade;
varying float vDepth;
void main() {
  #ifdef USE_INSTANCING_COLOR
    vColor = instanceColor;
  #else
    vColor = vec3(1.0);
  #endif
  vShade = 0.65 + 0.35 * abs(normal.y) + 0.2 * abs(normal.x);
  vec4 world = modelMatrix * instanceMatrix * vec4(position, 1.0);
  vDepth = -world.z;
  world.xyz = bendWorld(world.xyz);
  gl_Position = projectionMatrix * viewMatrix * world;
}
`

const SHARD_FRAG = /* glsl */ `
${FOG}
uniform float uBeat;
varying vec3 vColor;
varying float vShade;
varying float vDepth;
void main() {
  vec3 col = vColor * vShade * (1.2 + uBeat * 0.6) + 0.25;
  gl_FragColor = vec4(applyFog(col, vDepth), 1.0);
}
`

const POINTS_VERT = /* glsl */ `
${BEND}
uniform float uPixelRatio;
attribute vec3 aColor;
attribute float aSize;
attribute float aAlpha;
varying vec3 vColor;
varying float vAlpha;
void main() {
  vColor = aColor;
  vAlpha = aAlpha;
  vec4 world = modelMatrix * vec4(position, 1.0);
  world.xyz = bendWorld(world.xyz);
  vec4 mv = viewMatrix * world;
  gl_PointSize = aSize * uPixelRatio * (220.0 / max(1.0, -mv.z));
  gl_Position = projectionMatrix * mv;
}
`

const POINTS_FRAG = /* glsl */ `
varying vec3 vColor;
varying float vAlpha;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = length(c);
  float a = smoothstep(0.5, 0.0, d) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`

const GLOW_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = pow(max(0.0, 1.0 - d), 2.2) * uStrength;
  gl_FragColor = vec4(uColor * a, a);
}
`

const GLOW_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const TRAIL_VERT = /* glsl */ `
attribute float aAlpha;
varying float vAlpha;
void main() {
  vAlpha = aAlpha;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`

const TRAIL_FRAG = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor * vAlpha, vAlpha);
}
`

// ---------- geometry ----------

// A gate: solid neon slabs everywhere except its gaps. Built from the same gap list the
// collision check uses, so what you see is exactly what you can hit.
const solidArcs = (gaps) => {
  const holes = gaps
    .map((g) => {
      const start = (((g.center - g.half) % TAU) + TAU) % TAU
      return [start, start + g.half * 2]
    })
    .sort((a, b) => a[0] - b[0])
  const arcs = []
  for (let i = 0; i < holes.length; i++) {
    const from = holes[i][1]
    const to = i + 1 < holes.length ? holes[i + 1][0] : holes[0][0] + TAU
    if (to - from > 1e-4) arcs.push([from, to])
  }
  return arcs
}

const buildGateGeometry = (gaps) => {
  const positions = []
  const edges = []
  const radials = []
  const faces = []
  const indices = []
  const vertex = (angle, r, z, edge, radial, face) => {
    positions.push(Math.cos(angle) * r, Math.sin(angle) * r, z)
    edges.push(edge)
    radials.push(radial)
    faces.push(face)
    return positions.length / 3 - 1
  }
  const quad = (a, b, c, d) => indices.push(a, b, c, a, c, d)

  for (const [a0, a1] of solidArcs(gaps)) {
    const n = Math.max(2, Math.ceil((a1 - a0) / (TAU / 96)))
    const edgeAt = (a) => Math.min(a - a0, a1 - a) * SHIP_R
    let prev = null
    for (let i = 0; i <= n; i++) {
      const a = a0 + ((a1 - a0) * i) / n
      const e = edgeAt(a)
      const ring = {
        fi: vertex(a, SLAB_IN, SLAB_DEPTH, e, 0, 0),
        fo: vertex(a, SLAB_OUT, SLAB_DEPTH, e, 1, 0),
        bi: vertex(a, SLAB_IN, -SLAB_DEPTH, e, 0, 0),
        bo: vertex(a, SLAB_OUT, -SLAB_DEPTH, e, 1, 0),
        ii: vertex(a, SLAB_IN, SLAB_DEPTH, e, 0, 1),
        ib: vertex(a, SLAB_IN, -SLAB_DEPTH, e, 0, 1),
      }
      if (prev) {
        quad(prev.fi, prev.fo, ring.fo, ring.fi) // front face (toward the camera)
        quad(prev.bo, prev.bi, ring.bi, ring.bo) // back face
        quad(prev.ib, prev.ii, ring.ii, ring.ib) // inner face (toward the axis)
      }
      prev = ring
    }
    // end caps: the walls of the gaps
    for (const a of [a0, a1]) {
      const c = [
        vertex(a, SLAB_IN, SLAB_DEPTH, 0, 0, 2),
        vertex(a, SLAB_OUT, SLAB_DEPTH, 0, 1, 2),
        vertex(a, SLAB_OUT, -SLAB_DEPTH, 0, 1, 2),
        vertex(a, SLAB_IN, -SLAB_DEPTH, 0, 0, 2),
      ]
      quad(c[0], c[1], c[2], c[3])
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  geometry.setAttribute("aEdge", new THREE.Float32BufferAttribute(edges, 1))
  geometry.setAttribute("aRadial", new THREE.Float32BufferAttribute(radials, 1))
  geometry.setAttribute("aFace", new THREE.Float32BufferAttribute(faces, 1))
  geometry.setIndex(indices)
  geometry.computeBoundingSphere()
  return geometry
}

// A sleek delta-wing ship, nose toward -z, top toward the tube's axis (+y)
const buildShipGeometry = () => {
  const p = {
    nose: [0, 0.05, -1.35],
    left: [-0.58, 0, 0.45],
    right: [0.58, 0, 0.45],
    top: [0, 0.34, 0.2],
    tail: [0, 0.08, 0.6],
    belly: [0, -0.12, 0.15],
  }
  const tris = [
    ["nose", "left", "top"],
    ["nose", "top", "right"],
    ["left", "tail", "top"],
    ["top", "tail", "right"],
    ["nose", "belly", "left"],
    ["nose", "right", "belly"],
    ["left", "belly", "tail"],
    ["tail", "belly", "right"],
  ]
  const positions = []
  const colors = []
  const shade = { nose: 1, left: 0.55, right: 0.55, top: 1, tail: 0.75, belly: 0.35 }
  for (const tri of tris) {
    for (const k of tri) {
      positions.push(...p[k])
      colors.push(shade[k], shade[k], shade[k])
    }
  }
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3))
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3))
  return g
}

// ---------- engine ----------

export const createEngine = ({ canvas, container, onHud, onStatus, onEvent, best = 0, muted = false }) => {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: "high-performance",
    alpha: false,
    stencil: false,
  })
  // (with anti-aliasing on, a phone's 3x screen is drawn at 1.5: sharper than 2 without it, and cheaper)
  const dpr = window.devicePixelRatio || 1
  const maxPixelRatio = Math.min(dpr, dpr >= 2 ? 1.5 : 2)
  let pixelRatio = maxPixelRatio
  renderer.setPixelRatio(pixelRatio)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(72, 1, 0.1, 400)
  const CAMERA_HOME = new THREE.Vector3(0, -1.5, 3)
  camera.position.copy(CAMERA_HOME)
  camera.lookAt(0, -2, -40)
  const cameraBase = camera.quaternion.clone()

  const world = new THREE.Group() // everything that rolls with the tube
  scene.add(world)

  // shared uniforms (objects reference the same values)
  const shared = {
    uBend: { value: new THREE.Vector2() },
    uFog: { value: new THREE.Vector3() },
    uBeat: { value: 0 },
    uTime: { value: 0 },
  }
  const look = { a: new THREE.Vector3(), b: new THREE.Vector3(), c: new THREE.Vector3(), d: new THREE.Vector3(), pattern: new THREE.Vector4(), fog: new THREE.Vector3(), bend: 0.0009 }
  const setLookInstant = (target) => {
    look.a.fromArray(target.a)
    look.b.fromArray(target.b)
    look.c.fromArray(target.c)
    look.d.fromArray(target.d)
    look.pattern.fromArray(target.pattern)
    look.fog.fromArray(target.fog)
    look.bend = target.bend
  }
  setLookInstant(LOOKS[0])
  let lookTarget = LOOKS[0]

  // tube
  const tubeGeometry = new THREE.CylinderGeometry(R, R, VIEW + 30, 72, 160, true)
  tubeGeometry.rotateX(Math.PI / 2)
  tubeGeometry.translate(0, 0, -(VIEW + 30) / 2 + 5)
  const tubeMaterial = new THREE.ShaderMaterial({
    vertexShader: TUBE_VERT,
    fragmentShader: TUBE_FRAG,
    side: THREE.BackSide,
    uniforms: {
      ...shared,
      uTravel: { value: 0 },
      uIntensity: { value: 0 },
      uOverdrive: { value: 0 },
      uFlash: { value: 0 },
      uPattern: { value: look.pattern },
      uPA: { value: look.a },
      uPB: { value: look.b },
      uPC: { value: look.c },
      uPD: { value: look.d },
    },
  })
  const tube = new THREE.Mesh(tubeGeometry, tubeMaterial)
  tube.frustumCulled = false
  world.add(tube)

  // gates: one mesh per live gate, created when it appears and disposed when it's passed
  const gateMaterialBase = new THREE.ShaderMaterial({
    vertexShader: GATE_VERT,
    fragmentShader: GATE_FRAG,
    side: THREE.DoubleSide,
    uniforms: { ...shared, uColor: { value: new THREE.Vector3(1, 1, 1) }, uFlash: { value: 0 } },
  })
  const gateMeshes = new Map() // gate object -> mesh

  // shards
  const shardMaterial = new THREE.ShaderMaterial({ vertexShader: SHARD_VERT, fragmentShader: SHARD_FRAG, uniforms: { ...shared } })
  const shardMesh = new THREE.InstancedMesh(new THREE.OctahedronGeometry(0.42, 0), shardMaterial, MAX_SHARDS)
  for (let i = 0; i < MAX_SHARDS; i++) shardMesh.setColorAt(i, new THREE.Color(1, 1, 1))
  shardMesh.count = 0
  shardMesh.frustumCulled = false
  world.add(shardMesh)

  // particles (bursts and speed dust), tracked in game space and placed each frame
  const particles = []
  const pPositions = new Float32Array(MAX_PARTICLES * 3)
  const pColors = new Float32Array(MAX_PARTICLES * 3)
  const pSizes = new Float32Array(MAX_PARTICLES)
  const pAlphas = new Float32Array(MAX_PARTICLES)
  const pGeometry = new THREE.BufferGeometry()
  pGeometry.setAttribute("position", new THREE.BufferAttribute(pPositions, 3).setUsage(THREE.DynamicDrawUsage))
  pGeometry.setAttribute("aColor", new THREE.BufferAttribute(pColors, 3).setUsage(THREE.DynamicDrawUsage))
  pGeometry.setAttribute("aSize", new THREE.BufferAttribute(pSizes, 1).setUsage(THREE.DynamicDrawUsage))
  pGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(pAlphas, 1).setUsage(THREE.DynamicDrawUsage))
  const pMaterial = new THREE.ShaderMaterial({
    vertexShader: POINTS_VERT,
    fragmentShader: POINTS_FRAG,
    uniforms: { ...shared, uPixelRatio: { value: pixelRatio } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const points = new THREE.Points(pGeometry, pMaterial)
  points.frustumCulled = false
  world.add(points)

  // ship, its glow and its light trail (not rolled: the ship is always at the bottom)
  const ship = new THREE.Group()
  ship.position.set(0, -SHIP_R, PLAYER_Z)
  scene.add(ship)
  const shipMaterial = new THREE.MeshBasicMaterial({ vertexColors: true, color: new THREE.Color(1, 1, 1) })
  const shipMesh = new THREE.Mesh(buildShipGeometry(), shipMaterial)
  ship.add(shipMesh)
  const glowMaterial = new THREE.ShaderMaterial({
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) }, uStrength: { value: 1 } },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 4.2), glowMaterial)
  glow.position.set(0, 0.1, 0)
  ship.add(glow)

  const trailPositions = new Float32Array(TRAIL_POINTS * 2 * 3)
  const trailAlphas = new Float32Array(TRAIL_POINTS * 2)
  const trailIndex = []
  for (let i = 0; i < TRAIL_POINTS - 1; i++) {
    const a = i * 2
    trailIndex.push(a, a + 1, a + 3, a, a + 3, a + 2)
  }
  const trailGeometry = new THREE.BufferGeometry()
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3).setUsage(THREE.DynamicDrawUsage))
  trailGeometry.setAttribute("aAlpha", new THREE.BufferAttribute(trailAlphas, 1).setUsage(THREE.DynamicDrawUsage))
  trailGeometry.setIndex(trailIndex)
  const trailMaterial = new THREE.ShaderMaterial({
    vertexShader: TRAIL_VERT,
    fragmentShader: TRAIL_FRAG,
    uniforms: { uColor: { value: new THREE.Vector3(1, 1, 1) } },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
  })
  const trail = new THREE.Mesh(trailGeometry, trailMaterial)
  trail.frustumCulled = false
  scene.add(trail)
  const trailHistory = [] // { theta, distance }

  const audio = createAudio()
  audio.setMuted(muted)

  // ---------- state ----------

  let status = "title" // title | playing | paused | crashing | over
  let game = createGame(Math.floor(Math.random() * 1e9))
  let bestScore = best
  let maxMultiplier = 1
  let crashTimer = 0
  let flash = 0
  let shake = 0
  let fov = 72
  let visualTime = 0
  let raf = 0
  const clock = createFrameClock()
  let inFrame = false
  let disposed = false
  let size = { width: 0, height: 0 }
  let hudTimer = 0
  const keys = new Set()
  let dragTurn = 0
  let drag = null // { id, x }
  let overdriveRequested = false

  const setStatus = (next) => {
    status = next
    onStatus?.(next)
  }

  // ---------- particles ----------

  const tmpColor = [0, 0, 0]
  const spawnParticle = (p) => {
    if (particles.length >= MAX_PARTICLES) particles.shift()
    particles.push(p)
  }
  const burst = (s, theta, r, count, color, { speed = 10, life = 0.8, size = 1.4, spread = 1 } = {}) => {
    for (let i = 0; i < count; i++) {
      const dir = Math.random() * TAU
      const v = speed * (0.4 + Math.random() * 0.8)
      spawnParticle({
        s,
        theta,
        r,
        vs: Math.sin(dir) * v * 0.6,
        vt: (Math.cos(dir) * v * 0.08 * spread) / Math.max(1, r * 0.3),
        vr: (Math.random() - 0.5) * v * 0.6,
        life,
        age: 0,
        size: size * (0.6 + Math.random() * 0.8),
        color: [color[0] + 0.3, color[1] + 0.3, color[2] + 0.3],
      })
    }
  }
  const dust = () => {
    palette(look, Math.random(), tmpColor)
    spawnParticle({
      s: game.distance + 40 + Math.random() * (VIEW - 40),
      theta: Math.random() * TAU,
      r: R - 0.3 - Math.random() * 2.4,
      vs: 0,
      vt: 0,
      vr: 0,
      life: 999,
      age: 0,
      size: 0.5 + Math.random() * 0.7,
      dust: true,
      color: [tmpColor[0], tmpColor[1], tmpColor[2]],
    })
  }

  // ---------- events from the game ----------

  const shipColor = [1, 1, 1]
  const handleEvents = () => {
    for (const e of game.events) {
      onEvent?.(e)
      switch (e.type) {
        case "shard":
          palette(look, e.s * 0.004 + 0.5, tmpColor)
          burst(e.s, e.theta, SHIP_R, 14, tmpColor, { speed: 9, life: 0.6, size: 1.2 })
          audio.shard(e.combo)
          break
        case "graze":
          if (!reducedMotion()) shake = Math.min(1, shake + 0.25)
          burst(game.distance, e.theta, SHIP_R, 10, [1, 1, 1], { speed: 14, life: 0.4, size: 0.9 })
          audio.graze()
          break
        case "miss":
          audio.miss()
          break
        case "multiplier":
          audio.multiplier(e.up)
          break
        case "smash":
          shake = Math.min(1, shake + 0.6)
          flash = Math.max(flash, 0.35)
          for (let i = 0; i < 24; i++) {
            palette(look, i / 24, tmpColor)
            burst(e.s, (i / 24) * TAU, SHIP_R, 3, tmpColor, { speed: 16, life: 0.9, size: 1.6 })
          }
          audio.smash()
          break
        case "overdrive":
          flash = Math.max(flash, 0.5)
          audio.overdrive()
          break
        case "zone":
          lookTarget = lookFor(e.zone)
          flash = Math.max(flash, 0.6)
          audio.setZone(e.zone)
          break
        case "crash":
          shake = 1
          flash = 1
          crashTimer = 1.1
          ship.visible = false
          trail.visible = false
          for (let i = 0; i < 6; i++) {
            palette(look, i / 6, tmpColor)
            burst(game.distance, e.theta, SHIP_R, 30, tmpColor, { speed: 20, life: 1.4, size: 2.2, spread: 3 })
          }
          audio.crash()
          audio.stop()
          setStatus("crashing")
          break
        default:
      }
    }
  }

  // ---------- title-screen autopilot (the same keyboard bot the fairness tests use) ----------

  const autopilot = () => {
    const gate = game.gates.find((g) => !g.done && g.s > game.distance)
    const shard = game.shards.find((s) => !s.taken && !s.missed && s.s > game.distance)
    let aim = game.theta
    if (gate) {
      aim = gate.gaps.reduce((a, b) => (angleDist(game.theta, a.center) < angleDist(game.theta, b.center) ? a : b)).center
      if (shard && shard.s < gate.s) {
        // only chase a shard if the gate after it stays easy
        const detour = angleDist(shard.theta, aim)
        if (detour < 0.6) aim = shard.theta
      }
    }
    return { steer: Math.max(-1, Math.min(1, angleDelta(game.theta, aim) * 6)) }
  }

  // ---------- input ----------

  const steerFromKeys = () => {
    let s = 0
    if (keys.has("ArrowLeft") || keys.has("KeyA")) s -= 1
    if (keys.has("ArrowRight") || keys.has("KeyD")) s += 1
    return s
  }

  const onKeyDown = (e) => {
    if (e.target.closest?.(".tcEdit")) return // customizing the on-screen controls
    const code = e.code
    audio.unlock()
    // a focused overlay button (Play, Resume) handles its own Space/Enter
    if ((code === "Space" || code === "Enter") && e.target.closest?.("button")) return
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Space"].includes(code)) e.preventDefault()
    if (code === "KeyM") return api.setMuted(!muted)
    if (code === "KeyP" || code === "Escape") {
      if (status === "playing") api.pause()
      else if (status === "paused") api.resume()
      return
    }
    if ((code === "Space" || code === "Enter") && (status === "title" || status === "over")) {
      if (status === "over" && performance.now() - overAt < 450) return // don't restart by accident
      return api.startGame()
    }
    if (status === "paused" && (code === "Space" || code === "Enter")) return api.resume()
    if (code === "Space" || code === "ShiftLeft" || code === "ShiftRight" || code === "ArrowUp" || code === "KeyW") overdriveRequested = true
    keys.add(code)
  }
  const onKeyUp = (e) => keys.delete(e.code)

  const onPointerDown = (e) => {
    if (e.target.closest("button, a, input")) return // overlay buttons
    audio.unlock()
    if (status !== "playing") return
    drag = { id: e.pointerId, x: e.clientX }
    container.setPointerCapture?.(e.pointerId)
  }
  const onPointerMove = (e) => {
    if (!drag || drag.id !== e.pointerId) return
    const dx = e.clientX - drag.x
    drag.x = e.clientX
    dragTurn += (dx / Math.max(200, size.width)) * DRAG_TURN
  }
  const onPointerUp = (e) => {
    if (drag && drag.id === e.pointerId) drag = null
  }

  const onBlur = (e) => {
    if (container.contains(e.relatedTarget)) return
    keys.clear()
    drag = null
    if (status === "playing") api.pause()
  }
  const onVisibility = () => {
    if (document.hidden && status === "playing") api.pause()
    if (!document.hidden) restartClock()
  }

  container.addEventListener("keydown", onKeyDown)
  container.addEventListener("keyup", onKeyUp)
  container.addEventListener("pointerdown", onPointerDown)
  container.addEventListener("pointermove", onPointerMove)
  container.addEventListener("pointerup", onPointerUp)
  container.addEventListener("pointercancel", onPointerUp)
  container.addEventListener("focusout", onBlur)
  document.addEventListener("visibilitychange", onVisibility)

  // ---------- sizing & adaptive quality ----------

  const resize = () => {
    const width = container.clientWidth
    const height = container.clientHeight
    size = { width, height }
    if (!width || !height) {
      if (status === "playing") api.pause() // minimized
      return
    }
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    // keep the tube's sides in view on tall, narrow screens
    camera.fov = width < height ? 84 : 72
    fov = camera.fov
    camera.updateProjectionMatrix()
    restartClock()
    start()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)

  // dynamic resolution (utils/dynamicResolution.js): down a step while frames run slow (to
  // 1.0 at the lowest), back up when there's time to spare
  const resolution = createResolution({ max: maxPixelRatio, min: Math.min(1, maxPixelRatio) })
  const adaptQuality = (dtMs, workMs) => {
    if (!resolution.frame(dtMs, workMs)) return
    pixelRatio = resolution.ratio
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(size.width, size.height, false)
    pMaterial.uniforms.uPixelRatio.value = pixelRatio
  }

  // ---------- per-frame scene update ----------

  const tmpMatrix = new THREE.Matrix4()
  const tmpQuat = new THREE.Quaternion()
  const tmpPos = new THREE.Vector3()
  const tmpScale = new THREE.Vector3()
  const zAxis = new THREE.Vector3(0, 0, 1)
  const instanceColor = new THREE.Color()
  const depthOf = (s) => PLAYER_Z - (s - game.distance)

  const updateScene = (dt) => {
    visualTime += dt
    // ease the palette toward the zone's look
    const k = Math.min(1, dt * 0.8)
    const target = vectorsFor(lookTarget)
    look.a.lerp(target.a, k)
    look.b.lerp(target.b, k)
    look.c.lerp(target.c, k)
    look.d.lerp(target.d, k)
    look.pattern.lerp(target.pattern, k)
    look.fog.lerp(target.fog, k)
    look.bend += (lookTarget.bend - look.bend) * k

    const od = game.overdrive > 0 ? 1 : 0
    const beat = audio.beatPulse() ?? Math.exp(-((visualTime * (100 + 40 * difficulty(game.distance))) / 60 % 1) * 7)
    shared.uBeat.value = beat
    shared.uTime.value = visualTime
    shared.uFog.value.copy(look.fog)
    const wobble = od ? 0.0006 * Math.sin(visualTime * 7) : 0
    shared.uBend.value.set(Math.sin(visualTime * 0.13) * look.bend + wobble, Math.cos(visualTime * 0.097) * look.bend * 0.7)

    const intensity = Math.min(1, (game.multiplier - 1) / 7)
    tubeMaterial.uniforms.uTravel.value = game.distance
    tubeMaterial.uniforms.uIntensity.value += (intensity - tubeMaterial.uniforms.uIntensity.value) * Math.min(1, dt * 3)
    tubeMaterial.uniforms.uOverdrive.value += (od - tubeMaterial.uniforms.uOverdrive.value) * Math.min(1, dt * 4)
    tubeMaterial.uniforms.uFlash.value = flash * 0.6
    flash = Math.max(0, flash - dt * 2.2)

    // roll the world so the ship is always at the bottom
    world.rotation.z = -Math.PI / 2 - game.theta

    // gates
    const live = new Set()
    for (const gate of game.gates) {
      const depth = depthOf(gate.s)
      if (depth < -VIEW || depth > 6 || (gate.result === "smash")) continue
      live.add(gate)
      let mesh = gateMeshes.get(gate)
      if (!mesh) {
        const material = gateMaterialBase.clone()
        material.uniforms.uBend = shared.uBend
        material.uniforms.uFog = shared.uFog
        material.uniforms.uBeat = shared.uBeat
        material.uniforms.uTime = shared.uTime
        palette(look, gate.s * 0.0021 + 0.15, tmpColor)
        material.uniforms.uColor.value.set(tmpColor[0], tmpColor[1], tmpColor[2])
        mesh = new THREE.Mesh(buildGateGeometry(gate.gaps), material)
        mesh.frustumCulled = false
        world.add(mesh)
        gateMeshes.set(gate, mesh)
      }
      mesh.position.z = depth
      // rotating gates turn as you approach and land on their final angle when you arrive
      mesh.rotation.z = gate.spin * (gate.s - game.distance)
      const u = mesh.material.uniforms
      u.uFlash.value = gate.result === "graze" ? Math.max(0, 1 - (game.distance - gate.s) / 6) : 0
    }
    for (const [gate, mesh] of gateMeshes) {
      if (live.has(gate)) continue
      world.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
      gateMeshes.delete(gate)
    }

    // shards
    let n = 0
    for (const shard of game.shards) {
      if (shard.taken || shard.missed || n >= MAX_SHARDS) continue
      const depth = depthOf(shard.s)
      if (depth < -VIEW || depth > 4) continue
      const spin = visualTime * 2.4 + shard.s
      tmpPos.set(Math.cos(shard.theta) * SHIP_R, Math.sin(shard.theta) * SHIP_R, depth)
      tmpQuat.setFromAxisAngle(zAxis, shard.theta + spin)
      const pulse = 1 + 0.18 * shared.uBeat.value
      tmpScale.set(pulse, pulse * 1.35, pulse)
      tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
      shardMesh.setMatrixAt(n, tmpMatrix)
      palette(look, shard.s * 0.004 + 0.5, tmpColor)
      instanceColor.setRGB(tmpColor[0], tmpColor[1], tmpColor[2])
      shardMesh.setColorAt(n, instanceColor)
      n++
    }
    shardMesh.count = n
    shardMesh.instanceMatrix.needsUpdate = true
    if (shardMesh.instanceColor) shardMesh.instanceColor.needsUpdate = true

    // particles
    const dustTarget = status === "title" ? 90 : 140
    let dustCount = 0
    for (const p of particles) if (p.dust) dustCount++
    for (let i = dustCount; i < dustTarget; i++) dust()
    let w = 0
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i]
      p.age += dt
      p.s += p.vs * dt
      p.theta += p.vt * dt
      p.r = Math.max(0.5, Math.min(R - 0.1, p.r + p.vr * dt))
      const depth = depthOf(p.s)
      const dead = p.age >= p.life || depth > 3 || depth < -VIEW
      if (dead) continue
      particles[w++] = p
    }
    particles.length = w
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i]
      if (!p) {
        pAlphas[i] = 0
        continue
      }
      const depth = depthOf(p.s)
      pPositions[i * 3] = Math.cos(p.theta) * p.r
      pPositions[i * 3 + 1] = Math.sin(p.theta) * p.r
      pPositions[i * 3 + 2] = depth
      pColors[i * 3] = p.color[0]
      pColors[i * 3 + 1] = p.color[1]
      pColors[i * 3 + 2] = p.color[2]
      pSizes[i] = p.dust ? p.size * (1 + od * 1.5) : p.size * (1 - p.age / p.life * 0.5)
      pAlphas[i] = p.dust ? Math.min(1, (-depth) / 30) * 0.8 : Math.max(0, 1 - p.age / p.life)
    }
    for (const attr of ["position", "aColor", "aSize", "aAlpha"]) pGeometry.attributes[attr].needsUpdate = true

    // ship: palette color, banks into turns, glows harder in overdrive
    palette(look, visualTime * 0.05 + 0.1, shipColor)
    shipMaterial.color.setRGB(0.55 + shipColor[0] * 0.6, 0.55 + shipColor[1] * 0.6, 0.55 + shipColor[2] * 0.6)
    ship.rotation.z = -game.thetaVel * 0.09
    ship.rotation.x = -0.05
    glowMaterial.uniforms.uColor.value.set(shipColor[0], shipColor[1], shipColor[2])
    glowMaterial.uniforms.uStrength.value = 0.55 + od * 0.6 + shared.uBeat.value * 0.25
    glow.rotation.x = -Math.PI / 2

    // trail: where the ship has been, relative to where it is now
    trailHistory.unshift({ theta: game.theta, distance: game.distance })
    if (trailHistory.length > TRAIL_POINTS) trailHistory.length = TRAIL_POINTS
    for (let i = 0; i < TRAIL_POINTS; i++) {
      const h = trailHistory[Math.min(i, trailHistory.length - 1)]
      const angle = -Math.PI / 2 + angleDelta(game.theta, h.theta)
      // a few units long whatever the speed, always in front of the camera
      const z = PLAYER_Z + 0.5 + Math.min(5, (game.distance - h.distance) * 0.3)
      const width = 0.32 * (1 - i / TRAIL_POINTS)
      const cx = Math.cos(angle) * SHIP_R
      const cy = Math.sin(angle) * SHIP_R
      const tx = -Math.sin(angle) * width
      const ty = Math.cos(angle) * width
      trailPositions.set([cx - tx, cy - ty, z, cx + tx, cy + ty, z], i * 6)
      const alpha = (1 - i / TRAIL_POINTS) * (0.6 + od * 0.4)
      trailAlphas[i * 2] = alpha
      trailAlphas[i * 2 + 1] = alpha
    }
    trailGeometry.attributes.position.needsUpdate = true
    trailGeometry.attributes.aAlpha.needsUpdate = true
    trailMaterial.uniforms.uColor.value.set(shipColor[0] * 0.8 + 0.2, shipColor[1] * 0.8 + 0.2, shipColor[2] * 0.8 + 0.2)

    // camera: FOV kick in overdrive, shake on impacts, a little lean into turns
    const baseFov = size.width < size.height ? 84 : 72
    const targetFov = baseFov + od * 22 + Math.min(8, (game.speed - 16) * 0.25)
    fov += (targetFov - fov) * Math.min(1, dt * 3)
    camera.fov = fov
    camera.updateProjectionMatrix()
    shake = Math.max(0, shake - dt * 2.5)
    camera.position.set(
      CAMERA_HOME.x + (Math.random() - 0.5) * shake * 0.6,
      CAMERA_HOME.y + (Math.random() - 0.5) * shake * 0.6,
      CAMERA_HOME.z
    )
    camera.quaternion.copy(cameraBase)
    camera.rotateZ(-game.thetaVel * 0.025)
  }

  // ---------- loop ----------

  let overAt = 0
  const perf = { frames: 0, cpuMs: 0, renderMs: 0 } // dev stats
  const frame = (now) => {
    raf = 0
    if (disposed) return
    const cpuStart = performance.now()
    if (!size.width || !size.height) return // minimized: stop until resized
    inFrame = true
    const dtMs = clock.tick(now)
    let dt = dtMs / 1000
    // logic.step takes at most 50 ms at a time: a slow frame runs as equal shorter steps, so
    // the tube moves at real speed down to 10 fps
    const n = substeps(dt, MAX_STEP)

    if (status === "playing") {
      const steer = steerFromKeys()
      for (let i = 0; i < n && status === "playing"; i++) {
        step(game, dt / n, { steer, turn: i === 0 ? dragTurn : 0, overdrive: i === 0 && overdriveRequested })
        handleEvents()
      }
      dragTurn = 0
      overdriveRequested = false
      maxMultiplier = Math.max(maxMultiplier, game.multiplier)
      audio.setDifficulty(difficulty(game.distance))
      audio.setIntensity((game.multiplier - 1) / 7 + (game.overdrive > 0 ? 0.4 : 0))
    } else if (status === "title") {
      for (let i = 0; i < n; i++) step(game, dt / n, autopilot())
      game.score = 0
      if (game.status !== "playing") game = createGame(Math.floor(Math.random() * 1e9)) // (never happens: the bot is fair)
    } else if (status === "crashing") {
      dt *= 0.25 // slow motion
      crashTimer -= dtMs / 1000
      if (crashTimer <= 0) {
        const score = finalScore(game)
        const isBest = score > bestScore
        if (isBest) bestScore = score
        overAt = performance.now()
        onEvent?.({
          type: "gameover",
          score,
          best: bestScore,
          isBest,
          distance: Math.floor(game.distance),
          shards: game.shardsCollected,
          grazes: game.grazes,
          smashes: game.smashes,
          maxMultiplier,
          zone: zoneName(game.zone),
        })
        setStatus("over")
      }
    } else if (status === "over") {
      dt *= 0.3 // drift slowly behind the score screen
      game.distance += dt * 8
    }

    if (status !== "paused") updateScene(dt)
    const renderStart = performance.now()
    renderer.render(scene, camera)
    perf.frames++
    perf.renderMs += performance.now() - renderStart
    perf.cpuMs += renderStart - cpuStart
    if (!clock.first) adaptQuality(dtMs, performance.now() - cpuStart)

    hudTimer += dtMs
    if (status === "playing" && hudTimer > 80) {
      hudTimer = 0
      onHud?.({
        score: finalScore(game),
        multiplier: game.multiplier,
        combo: game.combo,
        distance: Math.floor(game.distance),
        zone: game.zone,
        zoneName: zoneName(game.zone),
        meter: game.meter,
        overdrive: game.overdrive,
      })
    }

    if (status !== "paused") start()
    inFrame = false
  }

  // The loop runs until paused. Starting it again after a stop starts the clock afresh (the
  // stop wasn't a frame); the call at the end of each frame keeps it (utils/frameClock.js).
  function start() {
    if (!raf && !disposed && size.width && size.height) {
      if (!inFrame) restartClock()
      raf = requestAnimationFrame(frame)
    }
  }
  function restartClock() {
    clock.reset()
    resolution.reset()
  }

  const onContextLost = (e) => {
    e.preventDefault()
    if (status === "playing") api.pause()
    releaseGpu(scene)
  }
  const onContextRestored = () => {
    restartClock()
    start()
  }
  canvas.addEventListener("webglcontextlost", onContextLost)
  canvas.addEventListener("webglcontextrestored", onContextRestored)

  // ---------- public API ----------

  const resetVisuals = () => {
    for (const [, mesh] of gateMeshes) {
      world.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    gateMeshes.clear()
    particles.length = 0
    trailHistory.length = 0
    ship.visible = true
    trail.visible = true
    lookTarget = LOOKS[0]
    flash = 0.4
    shake = 0
  }

  const api = {
    startGame() {
      audio.unlock()
      resetVisuals()
      setLookInstant(LOOKS[0])
      game = createGame(Math.floor(Math.random() * 1e9))
      maxMultiplier = 1
      keys.clear()
      dragTurn = 0
      overdriveRequested = false
      audio.setZone(0)
      audio.start()
      setStatus("playing")
      container.focus({ preventScroll: true })
      start()
    },
    pause() {
      if (status !== "playing") return
      keys.clear()
      drag = null
      audio.pause()
      setStatus("paused")
    },
    resume() {
      if (status !== "paused") return
      audio.unlock()
      audio.resume()
      setStatus("playing")
      container.focus({ preventScroll: true })
      start()
    },
    overdrive() {
      if (status === "playing") overdriveRequested = true
    },
    // on-screen buttons: hold a key down (e.g. "ArrowLeft") or let it go
    hold(code, down) {
      audio.unlock()
      if (down && status === "playing") keys.add(code)
      else keys.delete(code)
    },
    setMuted(value) {
      muted = value
      audio.setMuted(value)
      onEvent?.({ type: "muted", muted: value })
    },
    get status() {
      return status
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      resizeObserver.disconnect()
      container.removeEventListener("keydown", onKeyDown)
      container.removeEventListener("keyup", onKeyUp)
      container.removeEventListener("pointerdown", onPointerDown)
      container.removeEventListener("pointermove", onPointerMove)
      container.removeEventListener("pointerup", onPointerUp)
      container.removeEventListener("pointercancel", onPointerUp)
      container.removeEventListener("focusout", onBlur)
      document.removeEventListener("visibilitychange", onVisibility)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      canvas.removeEventListener("webglcontextrestored", onContextRestored)
      audio.dispose()
      scene.traverse((object) => {
        object.geometry?.dispose()
        if (object.material) [].concat(object.material).forEach((m) => m.dispose())
      })
      gateMaterialBase.dispose()
      shardMesh.dispose()
      renderer.dispose()
      renderer.forceContextLoss() // free the GPU context now, not whenever GC gets to it
    },
  }

  // test hook (dev server only)
  if (import.meta.env?.DEV) window.__spectra = { api, scene, ship, shipMaterial, get game() { return game }, get pixelRatio() { return pixelRatio }, perf, renderer, get audioState() { return audio.state }, get gateMeshes() { return gateMeshes.size }, colorsFinite() {
    const ok = (arr) => Array.from(arr).every(Number.isFinite)
    const gates = [...gateMeshes.values()].every((m) => ok(m.material.uniforms.uColor.value.toArray()))
    return { ship: ok(shipMaterial.color.toArray()), glow: ok(glowMaterial.uniforms.uColor.value.toArray()), trail: ok(trailMaterial.uniforms.uColor.value.toArray()), gates, shards: !shardMesh.instanceColor || ok(shardMesh.instanceColor.array.slice(0, shardMesh.count * 3)), particles: ok(pColors) }
  }, get particles() { return particles.length } }

  return api
}
