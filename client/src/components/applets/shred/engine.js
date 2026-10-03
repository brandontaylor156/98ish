// Shred 98's engine: the three.js note highway over the stage (venue.js), the song (audio.js),
// your inputs (keyboard, gamepad, touch) and the frame loop. The rules live in game.js; this
// file feeds it inputs stamped with song time and draws what it says. three.js loads with
// this file, on first open.

import * as THREE from "three"
import { createAudio, COUNT_IN_BEATS } from "./audio.js"
import { chartFor, timeChart } from "./chart.js"
import * as G from "./game.js"
import { drawShift, inputShift } from "./timing.js"
import { createVenue } from "./venue.js"
import { dotCanvas, flameCanvas, textureOf } from "./art.js"
import { PAD } from "./pad.js"

export const LANE_COLORS = [0x2bd94f, 0xff3341, 0xffd21f, 0x2a8cff, 0xff8a1a]
const HALF_W = 2.78
const LENGTH = 27
const GEM_Y = 0.1
const SPEEDS = [6.5, 8, 9.5, 11, 12.5]
const DIFF_SPEED = { easy: 0.86, medium: 0.95, hard: 1.05, expert: 1.15 }
const MAX_GEMS = 220
const MAX_STARS = 80
const TAILS = 36
const SPARKS = 900
const RESUME_REWIND = 1.6 // seconds replayed before the spot you paused at


const gemShader = {
  vertexShader: `
    attribute vec2 aInfo; // x: missed, y: glow
    uniform float uFar;
    varying vec3 vN; varying vec3 vWorld; varying vec3 vColor; varying vec2 vInfo;
    void main() {
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vWorld = wp.xyz;
      vN = normalize(mat3(modelMatrix * instanceMatrix) * normal);
      #ifdef USE_INSTANCING_COLOR
        vColor = instanceColor;
      #else
        vColor = vec3(1.0);
      #endif
      vInfo = aInfo;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform float uStar; uniform float uFar; uniform float uWhite;
    varying vec3 vN; varying vec3 vWorld; varying vec3 vColor; varying vec2 vInfo;
    void main() {
      vec3 n = normalize(vN);
      vec3 v = normalize(cameraPosition - vWorld);
      vec3 l = normalize(vec3(0.25, 1.0, 0.7));
      float diff = max(dot(n, l), 0.0);
      float spec = pow(max(dot(reflect(-l, n), v), 0.0), 28.0);
      float rim = pow(1.0 - max(dot(n, v), 0.0), 2.5);
      vec3 base = mix(vColor, vec3(0.35, 0.78, 1.0), uStar * (1.0 - uWhite));
      vec3 c = base * (0.42 + 0.8 * diff) + spec * 0.9 + rim * base * 0.9 + base * vInfo.y * 0.6;
      c = mix(c, vec3(dot(c, vec3(0.3, 0.5, 0.2))) * 0.35, vInfo.x);
      float fade = smoothstep(uFar, uFar + 4.0, vWorld.z);
      gl_FragColor = vec4(c, fade);
    }`,
}

const boardShader = {
  vertexShader: `varying vec3 vPos; void main() { vPos = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float uBeat, uBeatLen, uBpb, uStar, uScroll, uFar, uHalfW, uTime, uFlash;
    uniform vec3 uRail;
    varying vec3 vPos;
    void main() {
      float x = vPos.x;
      float z = vPos.z;
      float d = uScroll - z;
      float ax = abs(x);
      // dark rosewood with a little grain
      float grain = 0.5 + 0.5 * sin(x * 9.0 + sin(d * 0.27 + x * 3.1) * 2.2 + sin(d * 1.3) * 0.3);
      vec3 col = mix(vec3(0.045, 0.034, 0.04), vec3(0.085, 0.062, 0.06), grain);
      // a soft lane glow down each lane's center
      float lc = abs(fract(x + 0.5) - 0.5);
      col += vec3(0.02, 0.02, 0.03) * (1.0 - smoothstep(0.0, 0.5, lc));
      // lane dividers (the strings)
      float dv = 0.5 - lc;
      col += vec3(0.2, 0.2, 0.26) * (1.0 - smoothstep(0.006, 0.022, dv)) * step(ax, 2.55);
      // beat lines: frets across the board, heavier on the bar
      float b = uBeat + (-z) / uBeatLen;
      float fb = fract(b);
      float dist = min(fb, 1.0 - fb) * uBeatLen;
      float bar = step(mod(floor(b + 0.5), uBpb), 0.5);
      float w = mix(0.03, 0.065, bar);
      float line = 1.0 - smoothstep(w * 0.4, w, dist);
      float halfLine = 1.0 - smoothstep(0.008, 0.02, abs(fb - 0.5) * uBeatLen);
      col += vec3(0.62, 0.6, 0.66) * line * mix(0.3, 0.75, bar) + vec3(0.25) * halfLine * 0.18;
      // chrome side rails
      float rail = smoothstep(uHalfW - 0.2, uHalfW - 0.16, ax);
      float shine = 0.55 + 0.45 * smoothstep(uHalfW - 0.16, uHalfW - 0.06, ax) * (1.0 - smoothstep(uHalfW - 0.06, uHalfW, ax));
      vec3 railCol = uRail * shine;
      railCol = mix(railCol, vec3(0.35, 0.85, 1.0) * (1.2 + 0.5 * sin(d * 3.0 - uTime * 14.0)), uStar);
      col = mix(col, railCol, rail);
      // star power floods the board blue
      col += vec3(0.03, 0.14, 0.32) * uStar * (0.75 + 0.25 * sin(d * 1.1 - uTime * 5.0)) * (1.0 - rail);
      col += vec3(1.0) * uFlash * 0.25;
      // darker behind the strikeline, fading out at the far end
      col *= 0.55 + 0.45 * smoothstep(1.4, -0.3, z);
      float fade = smoothstep(uFar, uFar + 7.0, z);
      gl_FragColor = vec4(col, fade);
    }`,
}

const tailShader = {
  vertexShader: `
    uniform float uWobble, uTime;
    varying vec2 vUv; varying float vZ;
    void main() {
      vec3 p = position;
      p.x += sin(p.z * 9.0 + uTime * 32.0) * uWobble * 0.09 * smoothstep(0.0, -0.6, p.z);
      vec4 wp = modelMatrix * vec4(p, 1.0);
      vZ = wp.z;
      vUv = uv;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: `
    uniform vec3 uColor; uniform float uHeld, uDropped, uFar, uStar;
    varying vec2 vUv; varying float vZ;
    void main() {
      float across = abs(vUv.x - 0.5) * 2.0;
      float core = 1.0 - smoothstep(0.0, 0.35, across);
      float body = 1.0 - smoothstep(0.55, 1.0, across);
      vec3 c = mix(uColor, vec3(0.35, 0.8, 1.0), uStar);
      vec3 col = c * body * (0.55 + 0.6 * uHeld) + vec3(1.0) * core * (0.12 + 0.55 * uHeld);
      col = mix(col, vec3(0.16, 0.16, 0.2) * body, uDropped);
      float fade = smoothstep(uFar, uFar + 4.0, vZ);
      gl_FragColor = vec4(col, body * fade * (0.75 + 0.25 * uHeld));
    }`,
}

const starShape = () => {
  const s = new THREE.Shape()
  for (let i = 0; i < 10; i++) {
    const r = i % 2 ? 0.21 : 0.47
    const a = Math.PI / 2 + (i * Math.PI) / 5
    if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r)
    else s.moveTo(Math.cos(a) * r, Math.sin(a) * r)
  }
  s.closePath()
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 })
  g.rotateX(-Math.PI / 2)
  return g
}

export const createEngine = ({ canvas, container, onStatus, onHud, onEvent, onMenu, prefs: initialPrefs, calibration: initialCal }) => {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: (window.devicePixelRatio || 1) < 2, powerPreference: "high-performance", stencil: false })
  renderer.autoClear = false
  const maxPixelRatio = Math.min(window.devicePixelRatio || 1, 2)
  let pixelRatio = maxPixelRatio
  renderer.setPixelRatio(pixelRatio)
  const audio = createAudio()
  const venue = createVenue()
  const disposables = []
  const keep = (x) => (disposables.push(x), x)

  // ---------- the highway ----------
  const hw = new THREE.Scene()
  const cam = new THREE.PerspectiveCamera(46, 1, 0.1, 120)
  const camBase = { pos: new THREE.Vector3(0, 4.5, 5.2), look: new THREE.Vector3(0, 0, -8.5), scale: 1 }
  const hwGroup = new THREE.Group()
  hw.add(hwGroup)

  const boardGeo = keep(new THREE.PlaneGeometry(HALF_W * 2, LENGTH + 1.6, 1, 1))
  boardGeo.rotateX(-Math.PI / 2)
  boardGeo.translate(0, 0, -(LENGTH + 1.6) / 2 + 1.6)
  const boardMat = keep(new THREE.ShaderMaterial({
    ...boardShader,
    uniforms: {
      uBeat: { value: 0 }, uBeatLen: { value: 4 }, uBpb: { value: 4 }, uStar: { value: 0 }, uScroll: { value: 0 }, uFar: { value: -LENGTH }, uHalfW: { value: HALF_W },
      uTime: { value: 0 }, uFlash: { value: 0 }, uRail: { value: new THREE.Color(0xb8bcc8) },
    },
    transparent: true,
    depthWrite: false,
  }))
  const board = new THREE.Mesh(boardGeo, boardMat)
  board.renderOrder = -2
  hwGroup.add(board)

  const strike = new THREE.Mesh(keep(new THREE.BoxGeometry(HALF_W * 2 - 0.3, 0.03, 0.08)), keep(new THREE.MeshBasicMaterial({ color: 0xd8dae6 })))
  strike.position.set(0, 0.02, 0)
  hwGroup.add(strike)

  const dotTex = keep(textureOf(dotCanvas()))
  const flameTex = keep(textureOf(flameCanvas()))

  // the five fret buttons on the strikeline
  const frets = LANE_COLORS.map((color) => {
    const g = new THREE.Group()
    const base = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.36, 0.4, 0.07, 32)), keep(new THREE.MeshBasicMaterial({ color: 0x0c0c12 })))
    const ringMat = keep(new THREE.MeshBasicMaterial({ color }))
    const ring = new THREE.Mesh(keep(new THREE.TorusGeometry(0.36, 0.06, 10, 36)), ringMat)
    ring.rotation.x = -Math.PI / 2
    ring.position.y = 0.05
    const capMat = keep(new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.22) }))
    const cap = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 32)), capMat)
    cap.position.y = 0.06
    const glowMat = keep(new THREE.SpriteMaterial({ map: dotTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
    const glow = new THREE.Sprite(glowMat)
    glow.scale.set(1.6, 1.6, 1)
    glow.position.y = 0.15
    const flameMat = keep(new THREE.MeshBasicMaterial({ map: flameTex, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
    const flame = new THREE.Mesh(keep(new THREE.PlaneGeometry(1, 2)), flameMat)
    flame.position.y = 0.9
    const shockMat = keep(new THREE.MeshBasicMaterial({ color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }))
    const shock = new THREE.Mesh(keep(new THREE.RingGeometry(0.34, 0.42, 36)), shockMat)
    shock.rotation.x = -Math.PI / 2
    shock.position.y = 0.04
    g.add(base, ring, cap, glow, flame, shock)
    hwGroup.add(g)
    return { g, ring, ringMat, cap, capMat, glow, glowMat, flame, flameMat, shock, shockMat, color: new THREE.Color(color), press: 0, fire: 0, shockT: 1, held: false, sustain: false }
  })

  // gems: bodies, white caps, star-shaped star notes; instanced
  const gemMaterial = (white = 0) => keep(new THREE.ShaderMaterial({ ...gemShader, uniforms: { uStar: { value: 0 }, uFar: { value: -LENGTH }, uWhite: { value: white } }, transparent: true }))
  const lathe = keep(new THREE.LatheGeometry([new THREE.Vector2(0, 0), new THREE.Vector2(0.37, 0), new THREE.Vector2(0.41, 0.04), new THREE.Vector2(0.41, 0.1), new THREE.Vector2(0.35, 0.155), new THREE.Vector2(0, 0.155)], 36))
  const capGeo = keep(new THREE.CylinderGeometry(0.15, 0.15, 0.04, 24))
  capGeo.translate(0, 0.17, 0)
  const hopoCapGeo = keep(new THREE.CylinderGeometry(0.29, 0.31, 0.05, 28))
  hopoCapGeo.translate(0, 0.165, 0)
  const instanced = (geo, mat, max) => {
    const m = new THREE.InstancedMesh(geo, mat, max)
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(max * 3), 3)
    m.instanceColor.setUsage(THREE.DynamicDrawUsage)
    geo.setAttribute("aInfo", new THREE.InstancedBufferAttribute(new Float32Array(max * 2), 2))
    m.count = 0
    m.frustumCulled = false
    hwGroup.add(m)
    return m
  }
  const gemsBody = instanced(lathe, gemMaterial(), MAX_GEMS)
  const gemsCap = instanced(capGeo, gemMaterial(1), MAX_GEMS)
  const gemsHopo = instanced(hopoCapGeo, gemMaterial(1), MAX_GEMS)
  const gemsStar = instanced(keep(starShape()), gemMaterial(), MAX_STARS)
  const gemMats = [gemsBody, gemsCap, gemsHopo, gemsStar].map((m) => m.material)

  // sustain tails: a pool of strips
  const tailGeo = keep(new THREE.PlaneGeometry(1, 1, 1, 28))
  tailGeo.rotateX(-Math.PI / 2)
  tailGeo.translate(0, 0, -0.5)
  const tails = Array.from({ length: TAILS }, () => {
    const mat = keep(new THREE.ShaderMaterial({ ...tailShader, uniforms: { uColor: { value: new THREE.Color() }, uHeld: { value: 0 }, uDropped: { value: 0 }, uFar: { value: -LENGTH }, uStar: { value: 0 }, uWobble: { value: 0 }, uTime: { value: 0 } }, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }))
    const mesh = new THREE.Mesh(tailGeo, mat)
    mesh.visible = false
    mesh.renderOrder = -1
    hwGroup.add(mesh)
    return { mesh, mat }
  })

  // sparks
  const sparkPos = new Float32Array(SPARKS * 3)
  const sparkCol = new Float32Array(SPARKS * 3)
  const spark = Array.from({ length: SPARKS }, () => ({ life: 0, vx: 0, vy: 0, vz: 0, r: 1, g: 1, b: 1 }))
  const sparkGeo = keep(new THREE.BufferGeometry())
  sparkGeo.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3))
  sparkGeo.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3))
  const sparks = new THREE.Points(sparkGeo, keep(new THREE.PointsMaterial({ size: 0.13, map: dotTex, vertexColors: true, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })))
  sparks.frustumCulled = false
  hwGroup.add(sparks)
  let sparkNext = 0
  const emit = (x, y, z, color, n, power = 1) => {
    for (let i = 0; i < n; i++) {
      const idx = sparkNext
      const p = spark[idx]
      sparkNext = (sparkNext + 1) % SPARKS
      const a = Math.random() * Math.PI * 2
      const s = (0.8 + Math.random() * 2.2) * power
      p.life = 0.35 + Math.random() * 0.45
      p.vx = Math.cos(a) * s * 0.7
      p.vz = Math.sin(a) * s * 0.35
      p.vy = 2 + Math.random() * 4 * power
      const white = Math.random() < 0.35
      p.r = white ? 1 : color.r
      p.g = white ? 1 : color.g
      p.b = white ? 1 : color.b
      const k = idx * 3
      sparkPos[k] = x + (Math.random() - 0.5) * 0.3
      sparkPos[k + 1] = y
      sparkPos[k + 2] = z + (Math.random() - 0.5) * 0.2
    }
  }

  // star power lightning along the rails
  const boltGeo = keep(new THREE.BufferGeometry())
  const boltPos = new Float32Array(2 * 30 * 3)
  boltGeo.setAttribute("position", new THREE.BufferAttribute(boltPos, 3))
  const bolts = new THREE.LineSegments(boltGeo, keep(new THREE.LineBasicMaterial({ color: 0x9fe4ff, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })))
  bolts.visible = false
  bolts.frustumCulled = false
  hwGroup.add(bolts)
  const zapBolts = () => {
    let k = 0
    for (const side of [-1, 1]) {
      let px = side * (HALF_W - 0.08)
      let pz = 0.5
      for (let i = 0; i < 15; i++) {
        const nz = pz - 1.6 - Math.random() * 0.6
        const nx = side * (HALF_W - 0.08) + (Math.random() - 0.5) * 0.35
        boltPos.set([px, 0.12, pz, nx, 0.12 + Math.random() * 0.1, nz], k)
        k += 6
        px = nx
        pz = nz
      }
    }
    boltGeo.attributes.position.needsUpdate = true
  }

  // ---------- state ----------
  let prefs = initialPrefs
  let cal = initialCal || { audio: 0, video: 0 }
  let status = "idle" // idle | playing | paused | results | failed
  let run = null
  let size = { width: 0, height: 0 }
  let raf = 0
  let disposed = false
  let lastFrame = 0
  let clockTime = 0
  let shake = 0
  let flash = 0
  let starMix = 0
  let hudKey = ""
  let hudTimer = 0
  let crowdTimer = 0
  let autoplay = false
  let whammyKey = false
  let whammyTouch = 0
  let whammyPad = 0
  const pointers = new Map() // touch pointerId -> lane
  const pads = new Map() // gamepad index -> previous buttons
  const perf = { frames: 0, slow: 0, ms: 0 }

  const setStatus = (s) => {
    status = s
    onStatus?.(s)
  }

  const keyMap = () => {
    const map = new Map()
    const k = prefs.keys
    k.frets.forEach((codes, lane) => codes.forEach((c) => map.set(c, { type: "fret", lane })))
    for (const c of k.strum) map.set(c, { type: "strum" })
    for (const c of k.star) map.set(c, { type: "star" })
    for (const c of k.whammy || []) map.set(c, { type: "whammy" })
    for (const c of k.pause) map.set(c, { type: "pause" })
    return map
  }
  let keys = keyMap()

  const laneX = (lane) => (prefs.lefty ? 2 - lane : lane - 2)
  const noteSpeed = () => SPEEDS[Math.max(0, Math.min(4, (prefs.speed || 3) - 1))] * (DIFF_SPEED[run?.difficulty] || 1)

  // song time for judging an input that happened at `perfMs`, and for drawing now
  const judgeTime = (perfMs) => audio.songTimeAt(perfMs) + inputShift(cal)
  const drawTime = (perfMs) => audio.songTimeAt(perfMs) + drawShift(cal)

  // ---------- running a song ----------
  const startRun = (opts) => {
    const { song, difficulty, practice = null } = opts
    const rate = practice?.rate || 1
    const spb = 60 / (song.bpm * rate)
    let notes = timeChart(chartFor(song, difficulty), song.bpm * rate)
    let start = 0
    let end = null
    let section = null
    if (practice?.section) {
      section = practice.section
      start = section.start * spb
      end = section.end * spb
      notes = notes.filter((n) => n.time >= start - 1e-6 && n.time < end - 1e-6).map((n, i) => ({ ...n, i }))
    }
    const songEnd = song.lengthBeats * spb
    const lastEnd = notes.length ? notes.at(-1).end : songEnd
    const finish = section ? Math.max(lastEnd + 0.6, end + 0.25) : Math.max(lastEnd + 1.5, songEnd + 0.3)
    const tap = !!(prefs.easyStrum || opts.touch)
    const game = G.createGame({ notes, difficulty, spb, noFail: !!(prefs.noFail || practice), tap })
    run = { ...opts, rate, spb, notes, game, start, finish, section, song, difficulty, practice, firstVisible: 0, tap, passes: (run?.passes || 0) + 1 }
    const first = notes[0]?.time ?? start
    // a count-in when the first note comes quickly; otherwise straight in
    const lead = section ? Math.min(start, 2 * spb) : first - start < 3 ? COUNT_IN_BEATS * spb : 0
    audio.start(start - lead)
    starMix = 0
    pointers.clear()
    for (const f of frets) {
      f.held = false
      f.sustain = false
    }
    whammyKey = false
    hudKey = ""
  }

  const finishRun = () => {
    const r = G.results(run.game)
    if (run.practice?.loop && run.section) {
      onEvent?.({ type: "loop", results: r })
      startRun({ ...run, passes: run.passes })
      return
    }
    setStatus("results")
    if (!r.failed) audio.sfx("applause")
    onEvent?.({ type: "results", results: r, song: run.song, difficulty: run.difficulty, practice: run.practice })
  }

  const handleEvents = () => {
    const g = run.game
    for (const e of g.events) {
      switch (e.type) {
        case "hit": {
          audio.setLead(true)
          venue.strum()
          for (const lane of e.note.lanes) {
            const f = frets[lane]
            f.fire = 1
            f.shockT = 0
            emit(f.g.position.x, 0.25, 0, f.color, e.note.lanes.length > 1 ? 10 : 14, run.game.star.active ? 1.4 : 1)
          }
          onEvent?.({ type: "judge", judge: e.judge, delta: e.delta, lanes: e.note.lanes, streak: e.streak })
          break
        }
        case "miss":
          audio.setLead(false)
          onEvent?.({ type: "miss", lost: e.lost })
          break
        case "wrong":
          audio.setLead(false)
          audio.clank()
          if (e.lane >= 0) frets[e.lane].shockT = 0.6
          onEvent?.({ type: "wrong", lost: e.lost })
          break
        case "sustainEnd":
          for (const lane of e.note.lanes) frets[lane].sustain = false
          if (!e.full) audio.setLead(false)
          break
        case "multiplier":
          onEvent?.({ type: "multiplier", value: e.value })
          break
        case "streak":
          onEvent?.({ type: "streak", value: e.value })
          break
        case "starPhrase":
          audio.sfx(e.ready ? "starReady" : "phrase")
          onEvent?.({ type: e.ready ? "starReady" : "starPhrase", energy: e.energy })
          break
        case "phraseBroken":
          onEvent?.({ type: "phraseBroken" })
          break
        case "starOn":
          audio.sfx("starOn")
          if (prefs.shake !== false) shake = 1
          flash = 1
          onEvent?.({ type: "starOn" })
          break
        case "starOff":
          onEvent?.({ type: "starOff" })
          break
        case "fail":
          audio.pause()
          audio.sfx("fail")
          setStatus("failed")
          onEvent?.({ type: "failed", results: G.results(g), song: run.song, difficulty: run.difficulty })
          break
        default:
      }
    }
    g.events.length = 0
  }

  // ---------- input ----------
  const playing = () => status === "playing" && run && !autoplay

  const fretDown = (lane, perfMs) => {
    frets[lane].held = true
    frets[lane].press = 1
    if (!playing()) return
    G.fretDown(run.game, lane, judgeTime(perfMs))
    handleEvents()
  }
  const fretUp = (lane, perfMs) => {
    frets[lane].held = false
    if (!playing()) return
    G.fretUp(run.game, lane, judgeTime(perfMs))
    handleEvents()
  }
  const strum = (perfMs) => {
    if (!playing()) return
    G.strum(run.game, judgeTime(perfMs))
    handleEvents()
  }
  const starPower = (perfMs) => {
    if (!playing()) return
    G.activateStar(run.game, judgeTime(perfMs))
    handleEvents()
  }

  const onKeyDown = (e) => {
    const action = keys.get(e.code)
    if (status !== "playing" || !action) return
    e.preventDefault()
    e.stopPropagation()
    if (e.repeat) return
    audio.unlock()
    if (action.type === "fret") fretDown(action.lane, e.timeStamp)
    else if (action.type === "strum") strum(e.timeStamp)
    else if (action.type === "star") starPower(e.timeStamp)
    else if (action.type === "whammy") whammyKey = true
    else if (action.type === "pause") api.pause()
  }
  const onKeyUp = (e) => {
    const action = keys.get(e.code)
    if (!action) return
    if (action.type === "fret") fretUp(action.lane, e.timeStamp)
    else if (action.type === "whammy") whammyKey = false
  }

  // touch (and mouse): the bottom of the screen is five lanes, lined up with the frets
  const laneScreenX = () => {
    const v = new THREE.Vector3()
    return frets.map((f) => {
      v.set(f.g.position.x, 0, 0).project(cam)
      return ((v.x + 1) / 2) * size.width
    })
  }
  const laneAt = (clientX) => {
    const r = canvas.getBoundingClientRect()
    const xs = laneScreenX()
    const x = clientX - r.left
    let best = 0
    xs.forEach((lx, i) => {
      if (Math.abs(lx - x) < Math.abs(xs[best] - x)) best = i
    })
    return best
  }
  const inFretZone = (e) => {
    const zone = container.querySelector('[data-control="frets"]')
    if (zone) return !!e.target.closest?.('[data-control="frets"]')
    if (e.target !== canvas) return false
    const r = canvas.getBoundingClientRect()
    return e.clientY - r.top > r.height * 0.45
  }
  const onPointerDown = (e) => {
    if (status !== "playing" || !inFretZone(e)) return
    e.preventDefault()
    audio.unlock()
    const lane = laneAt(e.clientX)
    pointers.set(e.pointerId, { lane, x: e.clientX, t: e.timeStamp })
    try {
      e.target.setPointerCapture?.(e.pointerId)
    } catch {}
    fretDown(lane, e.timeStamp)
  }
  const onPointerMove = (e) => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    const lane = laneAt(e.clientX)
    // wiggling a held finger sideways is the whammy
    const dt = Math.max(8, e.timeStamp - p.t)
    whammyTouch = Math.min(1, whammyTouch + (Math.abs(e.clientX - p.x) / dt) * 0.6)
    p.x = e.clientX
    p.t = e.timeStamp
    if (lane !== p.lane && !frets[p.lane].sustain) {
      // sliding onto another lane presses it
      const old = p.lane
      p.lane = lane
      if (![...pointers.values()].some((q) => q !== p && q.lane === old)) fretUp(old, e.timeStamp)
      fretDown(lane, e.timeStamp)
    }
  }
  const onPointerUp = (e) => {
    const p = pointers.get(e.pointerId)
    if (!p) return
    pointers.delete(e.pointerId)
    if (![...pointers.values()].some((q) => q.lane === p.lane)) fretUp(p.lane, e.timeStamp)
  }
  const onContextMenu = (e) => e.preventDefault()

  const releaseEverything = (t) => {
    pointers.clear()
    for (const f of frets) {
      f.held = false
      f.sustain = false
    }
    whammyKey = false
    if (run) G.releaseAll(run.game, t)
  }
  const onBlur = (e) => {
    if (container.contains(e.relatedTarget)) return
    if (status === "playing") api.pause()
  }
  const onVisibility = () => {
    if (document.hidden && status === "playing") api.pause()
  }

  // gamepads: polled every frame (frets, strum, star, whammy; menus when not playing)
  const pollPads = () => {
    const list = navigator.getGamepads ? navigator.getGamepads() : []
    const now = performance.now()
    whammyPad = 0
    for (const gp of list) {
      if (!gp || !gp.connected) continue
      const prev = pads.get(gp.index) || []
      const down = gp.buttons.map((b) => b.pressed || b.value > 0.5)
      const pressed = (i) => down[i] && !prev[i]
      const released = (i) => !down[i] && prev[i]
      if (status === "playing") {
        PAD.frets.forEach((b, lane) => {
          if (pressed(b)) fretDown(lane, now)
          if (released(b)) fretUp(lane, now)
        })
        if (pressed(PAD.strumUp) || pressed(PAD.strumDown)) strum(now)
        if (pressed(PAD.star)) starPower(now)
        if (pressed(PAD.pause)) api.pause()
        // whammy: the right stick (or the guitar's whammy axis)
        for (const a of [2, 3, 4]) if (gp.axes[a] !== undefined) whammyPad = Math.max(whammyPad, Math.abs(gp.axes[a]) > 0.25 ? Math.min(1, Math.abs(gp.axes[a])) : 0)
      } else if (onMenu) {
        if (pressed(PAD.strumUp)) onMenu("up")
        if (pressed(PAD.strumDown)) onMenu("down")
        if (pressed(PAD.left)) onMenu("left")
        if (pressed(PAD.right)) onMenu("right")
        if (pressed(PAD.frets[0]) || pressed(PAD.pause)) onMenu("ok")
        if (pressed(PAD.frets[1])) onMenu("back")
      }
      pads.set(gp.index, down)
    }
  }

  container.addEventListener("keydown", onKeyDown)
  container.addEventListener("keyup", onKeyUp)
  container.addEventListener("pointerdown", onPointerDown, true)
  container.addEventListener("pointermove", onPointerMove, true)
  container.addEventListener("pointerup", onPointerUp, true)
  container.addEventListener("pointercancel", onPointerUp, true)
  container.addEventListener("contextmenu", onContextMenu)
  container.addEventListener("focusout", onBlur)
  document.addEventListener("visibilitychange", onVisibility)

  // ---------- sizing ----------
  const fitCamera = () => {
    const aspect = size.width / size.height
    cam.aspect = aspect
    cam.fov = aspect < 1 ? 50 : 44
    // the highway takes ~44% of a wide window and nearly all of a tall one
    const want = aspect < 0.8 ? 0.97 : aspect < 1.2 ? 0.72 : Math.max(0.36, Math.min(0.5, 0.75 / aspect))
    let s = 1
    const v = new THREE.Vector3()
    for (let i = 0; i < 3; i++) {
      cam.position.copy(camBase.pos).multiplyScalar(s)
      cam.lookAt(camBase.look.clone().multiplyScalar(s))
      cam.updateProjectionMatrix()
      cam.updateMatrixWorld()
      v.set(HALF_W, 0, 0).project(cam)
      const width = v.x // half the highway in NDC (0..1 of half the screen)
      s *= width / want
    }
    camBase.scale = s
    // then aim so the strikeline sits a little above the bottom edge
    const target = aspect < 0.8 ? -0.7 : -0.76
    let lookY = 0
    for (let i = 0; i < 8; i++) {
      cam.position.copy(camBase.pos).multiplyScalar(s)
      cam.lookAt(camBase.look.clone().multiplyScalar(s).add(new THREE.Vector3(0, lookY, 0)))
      cam.updateMatrixWorld()
      v.set(0, 0, 0).project(cam)
      lookY += (v.y - target) * s * 1.6
    }
    camBase.lookY = lookY
  }
  const resize = () => {
    const width = container.clientWidth
    const height = container.clientHeight
    size = { width, height }
    if (!width || !height) {
      if (status === "playing") api.pause() // minimized
      return
    }
    renderer.setSize(width, height, false)
    fitCamera()
    venue.resize(width, height)
    start()
  }
  const resizeObserver = new ResizeObserver(resize)
  resizeObserver.observe(container)

  let frameTimes = []
  let qualityClock = 0
  const adaptQuality = (dtMs) => {
    frameTimes.push(dtMs)
    qualityClock += dtMs
    if (qualityClock < 2500) return
    const avg = frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length
    frameTimes = []
    qualityClock = 0
    let next = pixelRatio
    if (avg > 20 && pixelRatio > 0.75) next = Math.max(0.75, pixelRatio - 0.25)
    else if (avg < 15 && pixelRatio < maxPixelRatio) next = Math.min(maxPixelRatio, pixelRatio + 0.25)
    if (next !== pixelRatio) {
      pixelRatio = next
      renderer.setPixelRatio(pixelRatio)
      renderer.setSize(size.width, size.height, false)
    }
  }

  // ---------- drawing ----------
  const m4 = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const sv = new THREE.Vector3()
  const pv = new THREE.Vector3()
  const white = new THREE.Color(1, 1, 1)

  const drawNotes = (visT) => {
    const g = run.game
    const speed = noteSpeed()
    const horizon = visT + LENGTH / speed
    let nBody = 0
    let nCap = 0
    let nHopo = 0
    let nStar = 0
    let nTail = 0
    const info = (mesh) => mesh.geometry.attributes.aInfo.array
    const put = (mesh, i, x, z, color, scaleY, missed, glow) => {
      m4.compose(pv.set(x, GEM_Y, z), q, sv.set(1, scaleY, 1))
      mesh.setMatrixAt(i, m4)
      mesh.instanceColor.setXYZ(i, color.r, color.g, color.b)
      const a = info(mesh)
      a[i * 2] = missed
      a[i * 2 + 1] = glow
    }
    while (run.firstVisible < g.notes.length && g.notes[run.firstVisible].end < visT - 1.5) run.firstVisible++
    for (let i = run.firstVisible; i < g.notes.length; i++) {
      const n = g.notes[i]
      if (n.time > horizon) break
      const z = -(n.time - visT) * speed
      // the tail
      if (n.sustainTime > 0 && nTail < TAILS && n.result !== "miss") {
        const held = n.result === "hit" && g.sustains.some((s) => s.note === n)
        const dropped = n.result === "hit" && !held
        const zEnd = -(n.end - visT) * speed
        const zStart = held ? 0 : z
        if (zEnd < zStart - 0.05 && !(dropped && zStart > 2)) {
          for (const lane of n.lanes) {
            if (nTail >= TAILS) break
            const t = tails[nTail++]
            t.mesh.visible = true
            t.mesh.position.set(laneX(lane), 0.03, Math.min(zStart, 1.4))
            t.mesh.scale.set(held ? 0.3 : 0.22, 1, Math.max(0.01, Math.min(zStart, 1.4) - zEnd))
            t.mat.uniforms.uColor.value.copy(frets[lane].color)
            t.mat.uniforms.uHeld.value = held ? 1 : 0
            t.mat.uniforms.uDropped.value = dropped ? 1 : 0
            t.mat.uniforms.uStar.value = starMix
            t.mat.uniforms.uWobble.value = held ? 0.3 + 1.6 * whammyLevel() : 0
            t.mat.uniforms.uTime.value = clockTime
            if (held) frets[lane].sustain = true
          }
        }
      }
      if (n.result === "hit") continue
      if (z > 2.2) continue
      const missed = n.result === "miss" ? 1 : 0
      for (const lane of n.lanes) {
        const x = laneX(lane)
        const color = frets[lane].color
        if (n.star && nStar < MAX_STARS) {
          put(gemsStar, nStar++, x, z, color, 1, missed, 0.25)
          if (nCap < MAX_GEMS) put(gemsCap, nCap++, x, z, white, 1, missed, 0.4)
        } else if (nBody < MAX_GEMS) {
          put(gemsBody, nBody++, x, z, color, n.hopo ? 0.72 : 1, missed, 0)
          if (n.hopo) {
            if (nHopo < MAX_GEMS) put(gemsHopo, nHopo++, x, z - 0.0, white, 1, missed, 0.6)
          } else if (nCap < MAX_GEMS) put(gemsCap, nCap++, x, z, white, 1, missed, 0.2)
        }
      }
    }
    for (const [mesh, count] of [[gemsBody, nBody], [gemsCap, nCap], [gemsHopo, nHopo], [gemsStar, nStar]]) {
      mesh.count = count
      mesh.instanceMatrix.needsUpdate = true
      mesh.instanceColor.needsUpdate = true
      mesh.geometry.attributes.aInfo.needsUpdate = true
    }
    for (let i = nTail; i < TAILS; i++) tails[i].mesh.visible = false
  }

  const hideNotes = () => {
    for (const m of [gemsBody, gemsCap, gemsHopo, gemsStar]) m.count = 0
    for (const t of tails) t.mesh.visible = false
  }

  const whammyLevel = () => Math.max(whammyKey ? 0.6 + 0.4 * Math.abs(Math.sin(clockTime * 9)) : 0, whammyTouch, whammyPad)

  const drawFrets = (dt) => {
    frets.forEach((f, lane) => {
      f.g.position.x = laneX(lane)
      f.press = f.held ? 1 : Math.max(0, f.press - dt * 10)
      f.fire = Math.max(0, f.fire - dt * 4.2)
      f.shockT = Math.min(1, f.shockT + dt * 3.5)
      const lit = Math.max(f.press * 0.8, f.fire, f.sustain ? 1 : 0)
      f.capMat.color.copy(f.color).multiplyScalar(0.22 + 0.9 * lit)
      f.cap.position.y = 0.06 - 0.025 * f.press
      f.ring.scale.setScalar(1 + 0.08 * f.fire)
      f.ringMat.color.copy(f.color).lerp(white, f.fire * 0.4)
      f.glowMat.opacity = Math.min(1, f.fire * 0.9 + (f.sustain ? 0.55 : 0) + f.press * 0.15)
      // the flame shoots up on a hit, and flickers on a held sustain
      const flick = f.sustain ? 0.45 + 0.15 * Math.sin(clockTime * 40 + lane) : 0
      const fire = Math.max(f.fire, flick)
      f.flameMat.opacity = Math.min(1, fire * 1.1)
      f.flame.scale.set(0.8 + 0.3 * fire, 0.4 + 0.9 * fire, 1)
      f.flame.position.y = 0.2 + 0.45 * f.flame.scale.y
      f.flame.quaternion.copy(cam.quaternion)
      f.shock.scale.setScalar(1 + f.shockT * 1.6)
      f.shockMat.opacity = (1 - f.shockT) * 0.8
      if (f.sustain && Math.random() < dt * 40) emit(f.g.position.x, 0.25, 0, f.color, 2, 0.6)
    })
  }

  const drawSparks = (dt) => {
    for (let i = 0; i < SPARKS; i++) {
      const p = spark[i]
      const k = i * 3
      if (p.life <= 0) {
        sparkPos[k + 1] = -50
        continue
      }
      p.life -= dt
      p.vy -= 14 * dt
      sparkPos[k] += p.vx * dt
      sparkPos[k + 1] += p.vy * dt
      sparkPos[k + 2] += p.vz * dt
      const fade = Math.max(0, Math.min(1, p.life * 2.5))
      sparkCol[k] = p.r * fade
      sparkCol[k + 1] = p.g * fade
      sparkCol[k + 2] = p.b * fade
    }
    sparkGeo.attributes.position.needsUpdate = true
    sparkGeo.attributes.color.needsUpdate = true
  }

  const sendHud = (visT, force) => {
    const g = run.game
    const h = G.hud(g)
    const progress = Math.max(0, Math.min(1, (visT - run.start) / Math.max(1, run.finish - run.start)))
    const key = `${h.score}|${h.streak}|${h.multiplier}|${h.meter.toFixed(3)}|${h.energy.toFixed(3)}|${h.starActive}|${Math.round(progress * 200)}`
    if (!force && key === hudKey) return
    hudKey = key
    onHud?.({ ...h, progress, counts: { ...g.counts }, hit: g.hit, total: g.notes.length })
  }

  const frame = (now) => {
    raf = 0
    if (disposed || !size.width || !size.height) return
    const dt = lastFrame ? Math.min(0.1, (now - lastFrame) / 1000) : 1 / 60
    if (lastFrame && now - lastFrame > 40) perf.slow++
    lastFrame = now
    clockTime += dt
    const t0 = performance.now()
    pollPads()
    audio.sampleClock(performance.now())

    let visT = 0
    let beat = clockTime * 2
    let energy = 0.35
    if (run && (status === "playing" || status === "paused" || status === "results" || status === "failed")) {
      const g = run.game
      visT = drawTime(now)
      if (status === "playing") {
        const jt = judgeTime(performance.now())
        if (autoplay) G.autoplay(g, jt)
        G.setWhammy(g, whammyLevel() > 0.15)
        G.tick(g, jt)
        handleEvents()
        if (status === "playing" && visT >= run.finish && G.isDone(g)) finishRun()
      }
      audio.setWhammy(run.game.sustains.length ? whammyLevel() : 0)
      whammyTouch = Math.max(0, whammyTouch - dt * 3)
      starMix += ((g.star.active ? 1 : 0) - starMix) * Math.min(1, dt * 6)
      beat = visT / run.spb
      energy = g.star.active ? 1 : Math.min(1, g.meter.value * 0.85 + Math.min(g.streak, 40) / 40 * 0.25)
      hwGroup.visible = true
      const speed = noteSpeed()
      boardMat.uniforms.uBeat.value = beat
      boardMat.uniforms.uBeatLen.value = speed * run.spb
      boardMat.uniforms.uBpb.value = run.song.bpb || 4
      boardMat.uniforms.uScroll.value = visT * speed
      drawNotes(visT)
      hudTimer += dt
      if (hudTimer > 0.05 || status !== "playing") {
        hudTimer = 0
        sendHud(visT)
      }
      crowdTimer += dt
      if (crowdTimer > 0.5) {
        crowdTimer = 0
        // the crowd cheers while you play and on the results screen; it's quiet when
        // paused (including minimized), after a fail and in the menus
        audio.setCrowd(status === "playing" ? energy : status === "results" ? 0.2 : 0)
      }
    } else {
      hwGroup.visible = false
      audio.setCrowd(0)
      hideNotes()
    }
    boardMat.uniforms.uStar.value = starMix
    boardMat.uniforms.uTime.value = clockTime
    boardMat.uniforms.uFlash.value = flash
    for (const m of gemMats) m.uniforms.uStar.value = starMix
    bolts.visible = starMix > 0.3
    if (bolts.visible && Math.random() < 0.5) zapBolts()
    bolts.material.opacity = starMix * (0.5 + Math.random() * 0.5)
    drawFrets(dt)
    drawSparks(dt)
    flash = Math.max(0, flash - dt * 2.5)

    // camera, with the star power shake
    shake = Math.max(0, shake - dt * 1.6)
    const amp = shake * shake * 0.16 * camBase.scale
    cam.position.copy(camBase.pos).multiplyScalar(camBase.scale)
    cam.position.x += (Math.random() - 0.5) * amp
    cam.position.y += (Math.random() - 0.5) * amp
    const look = camBase.look.clone().multiplyScalar(camBase.scale)
    look.y += camBase.lookY || 0
    cam.lookAt(look)

    venue.update(dt, { time: clockTime, beat, energy, star: run?.game.star.active && status === "playing", playing: status === "playing" })
    venue.camera.position.x += (Math.random() - 0.5) * amp * 0.5

    renderer.clear()
    renderer.render(venue.scene, venue.camera)
    renderer.clearDepth()
    renderer.render(hw, cam)
    venue.camera.position.x = 0

    perf.frames++
    perf.ms += performance.now() - t0
    adaptQuality(dt * 1000)
    start()
  }

  function start() {
    if (!raf && !disposed && size.width && size.height) raf = requestAnimationFrame(frame)
  }

  const onContextLost = (e) => {
    e.preventDefault()
    if (status === "playing") api.pause()
  }
  const onContextRestored = () => start()
  canvas.addEventListener("webglcontextlost", onContextLost)
  canvas.addEventListener("webglcontextrestored", onContextRestored)

  // ---------- public API ----------
  const api = {
    audio,
    get status() {
      return status
    },
    get run() {
      return run
    },
    // { song, difficulty, practice: { rate, section, loop } | null, touch }
    play(opts) {
      audio.unlock()
      audio.stopPreview()
      audio.load(opts.song, opts.practice?.rate || 1)
      venue.setPalette(opts.song.palette)
      run = null
      startRun(opts)
      setStatus("playing")
      container.focus({ preventScroll: true })
      start()
    },
    restart() {
      if (!run) return
      api.play({ song: run.song, difficulty: run.difficulty, practice: run.practice, touch: run.touch })
    },
    pause() {
      if (status !== "playing" || !run) return
      const t = judgeTime(performance.now())
      run.pausedAt = audio.pause()
      releaseEverything(t)
      handleEvents()
      setStatus("paused")
    },
    resume() {
      if (status !== "paused" || !run) return
      audio.unlock()
      const back = Math.max(run.start - (run.section ? 0 : COUNT_IN_BEATS * run.spb), run.pausedAt - RESUME_REWIND)
      audio.start(back)
      setStatus("playing")
      container.focus({ preventScroll: true })
      start()
    },
    // back to the menus
    quit() {
      audio.stop()
      run = null
      autoplay = false
      setStatus("idle")
    },
    // the on-screen star power button
    activateStar() {
      starPower(performance.now())
    },
    preview(song) {
      venue.setPalette(song.palette)
      if (status === "idle") audio.preview(song)
    },
    stopPreview() {
      audio.stopPreview()
    },
    setTheme(palette) {
      venue.setPalette(palette)
    },
    sfx(kind) {
      audio.sfx(kind)
    },
    setPrefs(next) {
      prefs = next
      keys = keyMap()
    },
    setCalibration(next) {
      cal = next
    },
    setVolume(master) {
      audio.setVolume(master, prefs.music ?? 0.9, prefs.sfx !== false)
    },
    // where the five lanes are on screen (px from the stage's left), for touch hints
    lanePositions() {
      return size.width ? laneScreenX() : []
    },
    unlock() {
      audio.unlock()
    },
    dispose() {
      disposed = true
      if (raf) cancelAnimationFrame(raf)
      raf = 0
      resizeObserver.disconnect()
      container.removeEventListener("keydown", onKeyDown)
      container.removeEventListener("keyup", onKeyUp)
      container.removeEventListener("pointerdown", onPointerDown, true)
      container.removeEventListener("pointermove", onPointerMove, true)
      container.removeEventListener("pointerup", onPointerUp, true)
      container.removeEventListener("pointercancel", onPointerUp, true)
      container.removeEventListener("contextmenu", onContextMenu)
      container.removeEventListener("focusout", onBlur)
      document.removeEventListener("visibilitychange", onVisibility)
      canvas.removeEventListener("webglcontextlost", onContextLost)
      canvas.removeEventListener("webglcontextrestored", onContextRestored)
      audio.dispose()
      venue.dispose()
      for (const d of disposables) d.dispose?.()
      for (const m of [gemsBody, gemsCap, gemsHopo, gemsStar]) m.dispose()
      renderer.dispose()
      renderer.forceContextLoss()
      if (window.__shred?.api === api) delete window.__shred
    },
  }

  venue.setPalette({ a: 0xff7a1a, b: 0xffc23a, sky: 0x2a1408 })
  audio.setVolume(1, prefs.music ?? 0.9, prefs.sfx !== false)

  // test hooks (dev server only)
  if (import.meta.env.DEV) {
    window.__shred = {
      api,
      perf,
      renderer,
      get game() {
        return run?.game || null
      },
      get run() {
        return run
      },
      get status() {
        return status
      },
      autoplay(on = true) {
        autoplay = on
      },
      // play the rest of the song perfectly, instantly, and go to the results
      finish() {
        if (!run || status !== "playing") return
        const g = run.game
        G.autoplay(g, (g.notes.at(-1)?.end ?? 0) + 1)
        handleEvents()
        if (status === "playing") {
          audio.stop()
          finishRun()
        }
      },
      // jump the song (and the game) ahead to `seconds`, missing whatever's skipped
      seek(seconds) {
        if (!run || status !== "playing") return
        audio.start(seconds)
      },
      lanes: () => api.lanePositions(),
      judgeTime: () => judgeTime(performance.now()),
      drawTime: () => drawTime(performance.now()),
      // the performance.now() moment a song time will be heard (for timing bots)
      perfAt: (songTime) => audio.perfAtContext(songTime + audio.anchor - inputShift(cal)),
      setEnergy(x) {
        if (run) run.game.star.energy = x
      },
    }
  }

  return api
}
