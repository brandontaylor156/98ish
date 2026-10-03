// The stage behind the highway: a club stage with a light rig, an LED wall, amp stacks, a
// drum riser, the band as backlit silhouettes and a crowd that bounces with how well you
// play. Drawn with its own camera, under the highway.

import * as THREE from "three"
import { crowdCanvas, dotCanvas, drummerCanvases, grilleCanvas, guitaristCanvases, kickHeadCanvas, textureOf } from "./art.js"

const STAGE_Y = 1
const FIG_W = 2.4
const FIG_H = 4.8

const beamMaterial = (color) =>
  new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(color) }, uIntensity: { value: 1 } },
    vertexShader: `
      varying vec3 vN; varying vec3 vView; varying float vAlong;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vN = normalize(mat3(modelMatrix) * normal);
        vView = normalize(cameraPosition - wp.xyz);
        vAlong = uv.y;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 uColor; uniform float uIntensity;
      varying vec3 vN; varying vec3 vView; varying float vAlong;
      void main() {
        float facing = pow(abs(dot(normalize(vN), normalize(vView))), 1.6);
        float a = facing * pow(vAlong, 1.3) * 0.42 * uIntensity;
        gl_FragColor = vec4(uColor, a);
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  })

const screenMaterial = () =>
  new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uBeat: { value: 0 },
      uA: { value: new THREE.Color(0xff7a1a) },
      uB: { value: new THREE.Color(0xffc23a) },
      uEnergy: { value: 0.5 },
      uStar: { value: 0 },
    },
    vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
    fragmentShader: `
      uniform float uTime, uBeat, uEnergy, uStar; uniform vec3 uA, uB;
      varying vec2 vUv;
      float hash(float n) { return fract(sin(n) * 43758.5453); }
      void main() {
        vec2 grid = vec2(84.0, 36.0);
        vec2 cell = floor(vUv * grid);
        vec2 f = fract(vUv * grid) - 0.5;
        float led = smoothstep(0.5, 0.2, length(f));
        // an equalizer that kicks on the beat
        float col = cell.x;
        float pulse = pow(1.0 - fract(uBeat), 2.0);
        float h = 0.18 + 0.55 * hash(col * 1.7 + floor(uBeat * 2.0)) * (0.4 + 0.6 * uEnergy) + 0.25 * pulse * uEnergy;
        float bar = step(cell.y / grid.y, h);
        float x = vUv.x - 0.5;
        float wave = smoothstep(0.06, 0.0, abs(vUv.y - 0.5 - 0.22 * sin(x * 9.0 + uTime * 2.0) * (0.3 + uEnergy)));
        vec3 c = mix(uA, uB, cell.y / grid.y) * bar * 0.9 + uB * wave * 0.8;
        vec3 starC = mix(vec3(0.2, 0.6, 1.0), vec3(1.0), wave + bar * 0.4) * (0.6 + 0.4 * pulse);
        c = mix(c, starC, uStar);
        c *= 0.25 + 0.75 * led;
        c += vec3(0.02, 0.02, 0.035);
        gl_FragColor = vec4(c, 1.0);
      }`,
  })

// A crowd of instanced billboards: each person bounces on the beat, and more of them put
// their hands up (or lighters, during star power) the better you play
const crowdMaterial = (tex) =>
  new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: tex },
      uBeat: { value: 0 },
      uEnergy: { value: 0.5 },
      uStar: { value: 0 },
      uRim: { value: new THREE.Color(0xff7a1a) },
      uTime: { value: 0 },
    },
    vertexShader: `
      attribute vec4 aInfo; // x, y, z, random
      uniform float uBeat, uEnergy, uStar, uTime;
      varying vec2 vUv; varying float vVariant; varying float vShade;
      void main() {
        float r = aInfo.w;
        float hands = step(r, uEnergy * 0.9);
        float variant = hands * (uStar > 0.5 ? (r < 0.4 ? 3.0 : 2.0) : (r < uEnergy * 0.45 ? 2.0 : 1.0));
        vVariant = variant;
        float phase = fract(uBeat + r * 0.15);
        float jump = uEnergy * uEnergy * 0.22 * pow(sin(phase * 3.14159), 2.0) + 0.03 * sin(uTime * (1.0 + r) + r * 20.0);
        vec3 base = aInfo.xyz + vec3(0.0, jump, 0.0);
        float size = 1.35 + r * 0.3;
        vec4 mv = modelViewMatrix * vec4(base, 1.0);
        mv.xy += position.xy * size;
        vUv = uv;
        vShade = 0.6 + 0.4 * r;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap; uniform vec3 uRim;
      varying vec2 vUv; varying float vVariant; varying float vShade;
      void main() {
        vec4 t = texture2D(uMap, vec2((vUv.x + vVariant) / 4.0, vUv.y));
        if (t.a < 0.4) discard;
        vec3 c = t.rgb + uRim * 0.05 * vShade * smoothstep(0.3, 1.0, vUv.y);
        gl_FragColor = vec4(c, 1.0);
      }`,
    transparent: false,
  })

const figurePlane = (canvas, pivot = [0, 0]) => {
  const tex = textureOf(canvas)
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, alphaTest: 0.35, color: 0xff8844, depthWrite: true, side: THREE.DoubleSide })
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(FIG_W, FIG_H), mat)
  // the plane's center sits at FIG_H/2 above the feet; pivots are in canvas pixels
  const px = ((pivot[0] / 512) - 0.5) * FIG_W
  const py = (1 - pivot[1] / 1024) * FIG_H
  mesh.position.set(-px, FIG_H / 2 - py, 0)
  const group = new THREE.Group()
  group.position.set(px, py, 0)
  group.add(mesh)
  return { group, mat, tex }
}

const buildMusician = (style) => {
  const c = guitaristCanvases(style)
  const root = new THREE.Group()
  const body = figurePlane(c.body)
  const guitar = figurePlane(c.guitar, [300, 500])
  const head = figurePlane(c.head, [256, 222])
  const forearm = figurePlane(c.forearm, [376, 404])
  guitar.group.position.z = 0.01
  forearm.group.position.z = 0.02
  head.group.position.z = 0.005
  root.add(body.group, guitar.group, head.group, forearm.group)
  return { root, parts: { body, guitar, head, forearm }, mats: [body.mat, guitar.mat, head.mat, forearm.mat], texs: [body.tex, guitar.tex, head.tex, forearm.tex] }
}

export const createVenue = () => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x07060c)
  scene.fog = new THREE.Fog(0x07060c, 18, 40)
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100)
  const disposables = []
  const keep = (...things) => {
    disposables.push(...things)
    return things[0]
  }

  scene.add(new THREE.HemisphereLight(0x3a3550, 0x0a0a10, 1.2))
  const keyA = new THREE.PointLight(0xff7a1a, 30, 22, 1.6)
  keyA.position.set(-5, 8, 4)
  const keyB = new THREE.PointLight(0xffc23a, 30, 22, 1.6)
  keyB.position.set(5, 8, 4)
  scene.add(keyA, keyB)

  const dark = keep(new THREE.MeshLambertMaterial({ color: 0x15141c }))
  const darker = keep(new THREE.MeshLambertMaterial({ color: 0x0c0b11 }))
  const metal = keep(new THREE.MeshLambertMaterial({ color: 0x3b3a44 }))

  // the room: back wall, stage, floor in front
  const wall = new THREE.Mesh(keep(new THREE.PlaneGeometry(60, 24)), darker)
  wall.position.set(0, 8, -7)
  const stage = new THREE.Mesh(keep(new THREE.BoxGeometry(26, STAGE_Y, 10)), dark)
  stage.position.set(0, STAGE_Y / 2, -2.5)
  const lip = new THREE.Mesh(keep(new THREE.BoxGeometry(26, 0.08, 0.1)), keep(new THREE.MeshBasicMaterial({ color: 0x2a2833 })))
  lip.position.set(0, STAGE_Y, 2.5)
  const floor = new THREE.Mesh(keep(new THREE.PlaneGeometry(60, 30)), darker)
  floor.rotation.x = -Math.PI / 2
  floor.position.set(0, -0.6, 10)
  scene.add(wall, stage, lip, floor)

  // the LED wall
  const screenMat = keep(screenMaterial())
  const screen = new THREE.Mesh(keep(new THREE.PlaneGeometry(15, 5.6)), screenMat)
  screen.position.set(0, 6.6, -6.9)
  scene.add(screen)

  // truss and lamps
  const truss = new THREE.Mesh(keep(new THREE.BoxGeometry(24, 0.35, 0.35)), metal)
  truss.position.set(0, 10.4, 0.5)
  const truss2 = truss.clone()
  truss2.position.z = -4.5
  scene.add(truss, truss2)
  const dotTex = keep(textureOf(dotCanvas()))
  const beamGeo = keep(new THREE.CylinderGeometry(0.12, 2.3, 11, 24, 1, true))
  beamGeo.translate(0, -5.5, 0)
  const canGeo = keep(new THREE.CylinderGeometry(0.22, 0.3, 0.5, 10))
  const poolGeo = keep(new THREE.PlaneGeometry(3.4, 3.4))
  const beamDir = new THREE.Vector3()
  const beams = []
  const LAMPS = 8
  for (let i = 0; i < LAMPS; i++) {
    const x = -9.5 + (19 * i) / (LAMPS - 1)
    const z = i % 2 ? 0.5 : -4.5
    const pivot = new THREE.Group()
    pivot.position.set(x, 10.1, z)
    const can = new THREE.Mesh(canGeo, metal)
    pivot.add(can)
    const mat = keep(beamMaterial(0xffffff))
    const beam = new THREE.Mesh(beamGeo, mat)
    pivot.add(beam)
    const lens = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: dotTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })))
    lens.scale.set(1.1, 1.1, 1)
    lens.position.y = -0.3
    pivot.add(lens)
    scene.add(pivot)
    // the pool of light where the beam lands on the stage
    const pool = new THREE.Mesh(poolGeo, keep(new THREE.MeshBasicMaterial({ map: dotTex, color: 0xffffff, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.5 })))
    pool.rotation.x = -Math.PI / 2
    scene.add(pool)
    beams.push({ pivot, mat, lens, pool, i, side: x < 0 ? -1 : 1 })
  }
  // haze where the beams cross
  const haze = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: dotTex, color: 0x332244, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.6 })))
  haze.scale.set(30, 12, 1)
  haze.position.set(0, 5, -3)
  scene.add(haze)

  // amp stacks
  const grille = keep(textureOf(grilleCanvas()))
  const grilleMat = keep(new THREE.MeshLambertMaterial({ map: grille }))
  const ampMats = [dark, dark, dark, dark, grilleMat, dark]
  for (const x of [-8.6, 8.6]) {
    for (const [y, h] of [[STAGE_Y + 1.1, 2.2], [STAGE_Y + 3.3, 2.2]]) {
      const cab = new THREE.Mesh(keep(new THREE.BoxGeometry(2.4, h, 1.2)), ampMats)
      cab.position.set(x, y, -3.4)
      scene.add(cab)
    }
    const head = new THREE.Mesh(keep(new THREE.BoxGeometry(2.4, 0.7, 1)), metal)
    head.position.set(x, STAGE_Y + 4.75, -3.4)
    const lamp = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: dotTex, color: 0xff3020, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })))
    lamp.scale.set(0.35, 0.35, 1)
    lamp.position.set(x + 0.9, STAGE_Y + 4.75, -2.85)
    scene.add(head, lamp)
  }

  // drum riser and kit
  const riser = new THREE.Mesh(keep(new THREE.BoxGeometry(6, 0.7, 3.2)), dark)
  riser.position.set(0, STAGE_Y + 0.35, -4.6)
  scene.add(riser)
  const kitTop = STAGE_Y + 0.7
  const shell = keep(new THREE.MeshLambertMaterial({ color: 0x5a1220 }))
  const chrome = keep(new THREE.MeshLambertMaterial({ color: 0x9a9aa8 }))
  const brass = keep(new THREE.MeshLambertMaterial({ color: 0xb08a2a, emissive: 0x2a1c00 }))
  const kickHead = keep(textureOf(kickHeadCanvas()))
  const kick = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.75, 0.75, 0.6, 28)), [shell, keep(new THREE.MeshLambertMaterial({ map: kickHead, emissive: 0x111111 })), shell])
  kick.rotation.x = Math.PI / 2
  kick.position.set(0, kitTop + 0.75, -4.1)
  scene.add(kick)
  const drum = (r, h, x, y, z, tilt = 0.3) => {
    const d = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r, h, 20)), [shell, chrome, chrome])
    d.position.set(x, y, z)
    d.rotation.x = tilt
    scene.add(d)
  }
  drum(0.32, 0.3, -0.45, kitTop + 1.75, -4.3)
  drum(0.36, 0.32, 0.45, kitTop + 1.75, -4.3)
  drum(0.45, 0.5, 1.3, kitTop + 0.8, -3.9, 0.1)
  drum(0.35, 0.18, -1.15, kitTop + 1.0, -3.9, 0.2)
  const cymbals = []
  for (const [x, y, r] of [[-1.6, kitTop + 2.3, 0.6], [1.7, kitTop + 2.4, 0.7], [-1.2, kitTop + 1.45, 0.34]]) {
    const c = new THREE.Mesh(keep(new THREE.CylinderGeometry(r, r * 0.95, 0.03, 24)), brass)
    c.position.set(x, y, -3.9)
    c.rotation.x = 0.45
    c.rotation.z = x < 0 ? 0.15 : -0.15
    scene.add(c)
    cymbals.push(c)
  }

  // the band
  const guitarist = buildMusician({ hair: "long" })
  guitarist.root.position.set(3.4, STAGE_Y, 0.4)
  const bassist = buildMusician({ hair: "spiky", bass: true, bassist: true })
  bassist.root.position.set(-4.3, STAGE_Y, -0.4)
  bassist.root.scale.set(-0.95, 0.95, 1)
  const drumC = drummerCanvases()
  const drummer = new THREE.Group()
  const dBody = figurePlane(drumC.body)
  const dArmL = figurePlane(drumC.armL, [176, 360])
  const dArmR = figurePlane(drumC.armR, [336, 360])
  dArmL.group.position.z = dArmR.group.position.z = 0.01
  drummer.add(dBody.group, dArmL.group, dArmR.group)
  drummer.position.set(0, kitTop - 1.2, -5.2)
  drummer.scale.setScalar(0.92)
  scene.add(guitarist.root, bassist.root, drummer)
  const figMats = [...guitarist.mats, ...bassist.mats, dBody.mat, dArmL.mat, dArmR.mat]
  disposables.push(...figMats, ...guitarist.texs, ...bassist.texs, dBody.tex, dArmL.tex, dArmR.tex)
  // halos behind the players
  const halos = []
  for (const [x, y, z, s] of [[3.4, STAGE_Y + 2.6, 0.1, 6], [-4.3, STAGE_Y + 2.5, -0.7, 5], [0, kitTop + 2, -5.5, 5]]) {
    const h = new THREE.Sprite(keep(new THREE.SpriteMaterial({ map: dotTex, color: 0xff7a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.45 })))
    h.scale.set(s, s * 1.3, 1)
    h.position.set(x, y, z)
    scene.add(h)
    halos.push(h)
  }

  // footlights washing the front of the stage, so the crowd stands out against them
  const footGlow = new THREE.Mesh(keep(new THREE.PlaneGeometry(34, 2.6)), keep(new THREE.MeshBasicMaterial({ map: dotTex, color: 0xff7a1a, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0.55 })))
  footGlow.position.set(0, STAGE_Y + 0.25, 2.65)
  scene.add(footGlow)

  // the crowd
  const crowdTex = keep(textureOf(crowdCanvas()))
  const crowdMat = keep(crowdMaterial(crowdTex))
  const people = []
  let seed = 11
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
  for (let row = 0; row < 4; row++) {
    const z = 4.2 + row * 1.5
    const n = 16 + row * 3
    for (let i = 0; i < n; i++) {
      const x = -14 - row * 2 + ((28 + row * 4) * (i + 0.5 + (rnd() - 0.5) * 0.6)) / n
      people.push([x, 0.15 + rnd() * 0.25 - row * 0.05, z + (rnd() - 0.5) * 0.6, rnd()])
    }
  }
  people.sort((a, b) => a[2] - b[2]) // back rows first
  const crowdGeo = keep(new THREE.InstancedBufferGeometry())
  const quad = new THREE.PlaneGeometry(1, 1)
  quad.translate(0, 0.5, 0)
  crowdGeo.index = quad.index
  crowdGeo.attributes.position = quad.attributes.position
  crowdGeo.attributes.uv = quad.attributes.uv
  crowdGeo.setAttribute("aInfo", new THREE.InstancedBufferAttribute(new Float32Array(people.flat()), 4))
  crowdGeo.instanceCount = people.length
  const crowd = new THREE.Mesh(crowdGeo, crowdMat)
  crowd.frustumCulled = false
  scene.add(crowd)

  // ---------- animation ----------
  const palette = { a: new THREE.Color(0xff7a1a), b: new THREE.Color(0xffc23a), sky: new THREE.Color(0x07060c) }
  const starBlue = new THREE.Color(0x48b8ff)
  const ICE = new THREE.Color(0xbfe6ff)
  const tmp = new THREE.Color()
  let strum = 0
  let drumHit = 0
  let lastBeat = 0
  let starMix = 0
  let pose = 0

  const setPalette = (p) => {
    palette.a.set(p.a)
    palette.b.set(p.b)
    palette.sky.set(p.sky)
    scene.background.copy(palette.sky).multiplyScalar(0.45)
    scene.fog.color.copy(scene.background)
    screenMat.uniforms.uA.value.copy(palette.a)
    screenMat.uniforms.uB.value.copy(palette.b)
  }

  // the frame: s = { time, beat, energy 0..1, star, playing }
  const update = (dt, s) => {
    const beatPhase = ((s.beat % 1) + 1) % 1
    const kick = Math.pow(1 - beatPhase, 3)
    starMix += ((s.star ? 1 : 0) - starMix) * Math.min(1, dt * 5)
    pose += ((s.star ? 1 : 0) - pose) * Math.min(1, dt * 4)
    if (Math.floor(s.beat) !== Math.floor(lastBeat) && s.playing) drumHit = 1
    lastBeat = s.beat
    drumHit = Math.max(0, drumHit - dt * 6)
    strum = Math.max(0, strum - dt * 7)

    // lights
    beams.forEach((b) => {
      const sweep = s.playing ? Math.sin(s.time * (0.5 + b.i * 0.07) + b.i * 1.7) : Math.sin(s.time * 0.25 + b.i)
      b.pivot.rotation.z = b.side * 0.25 + sweep * 0.32
      b.pivot.rotation.x = 0.28 + Math.cos(s.time * 0.4 + b.i) * 0.12
      tmp.copy(b.i % 2 ? palette.a : palette.b).lerp(starBlue, starMix)
      b.mat.uniforms.uColor.value.copy(tmp)
      const flash = s.playing ? 0.55 + 0.6 * kick * (0.4 + s.energy) : 0.45
      b.mat.uniforms.uIntensity.value = flash * (s.star ? 1.25 : 1)
      b.lens.material.color.copy(tmp)
      beamDir.set(0, -1, 0).applyEuler(b.pivot.rotation)
      const t = (b.pivot.position.y - STAGE_Y - 0.02) / Math.max(0.2, -beamDir.y)
      const px = b.pivot.position.x + beamDir.x * t
      const pz = b.pivot.position.z + beamDir.z * t
      const onStage = pz < 2.4 && pz > -7
      b.pool.visible = onStage
      b.pool.position.set(px, onStage ? STAGE_Y + 0.02 : -0.58, pz)
      b.pool.material.color.copy(tmp).multiplyScalar(0.45 * flash)
    })
    keyA.color.copy(palette.a).lerp(starBlue, starMix)
    keyB.color.copy(palette.b).lerp(starBlue, starMix)
    keyA.intensity = keyB.intensity = 18 + 22 * kick * (s.playing ? 1 : 0.3)
    haze.material.color.copy(palette.a).lerp(starBlue, starMix).multiplyScalar(0.18 + 0.1 * kick)
    for (const h of halos) h.material.color.copy(palette.b).lerp(starBlue, starMix)
    for (const m of figMats) m.color.copy(palette.b).lerp(ICE, starMix)
    footGlow.material.color.copy(palette.a).lerp(starBlue, starMix).multiplyScalar(0.6 + 0.4 * kick * (s.playing ? 1 : 0.4))
    screenMat.uniforms.uTime.value = s.time
    screenMat.uniforms.uBeat.value = s.beat
    screenMat.uniforms.uEnergy.value = s.playing ? s.energy : 0.25
    screenMat.uniforms.uStar.value = starMix
    cymbals.forEach((c, i) => (c.rotation.z = (i % 2 ? -0.15 : 0.15) + Math.sin(s.time * 20) * 0.04 * drumHit))

    // the band: bob on the beat, headbang when the crowd's into it, strum when you hit
    const groove = s.playing ? 1 : 0.35
    const bob = Math.pow(Math.sin(beatPhase * Math.PI), 2) * 0.06 * groove
    for (const [m, k] of [[guitarist, 1], [bassist, 0.8]]) {
      m.root.position.y = STAGE_Y - bob * k
      m.parts.head.group.rotation.z = (m === guitarist ? -1 : 1) * (0.05 + 0.12 * kick * Math.min(1, s.energy * 1.4) * groove) + pose * 0.18
      m.parts.body.group.rotation.z = pose * (m === guitarist ? 0.08 : 0.05)
    }
    guitarist.parts.guitar.group.rotation.z = pose * 0.35
    guitarist.parts.forearm.group.rotation.z = -0.35 * strum + pose * 0.3
    bassist.parts.forearm.group.rotation.z = -0.25 * kick * groove
    dArmL.group.rotation.z = beatPhase < 0.5 ? 0.35 * drumHit : 0
    dArmR.group.rotation.z = beatPhase >= 0.5 ? -0.35 * drumHit : -0.2 * kick * groove
    drummer.position.y = kitTop - 1.2 - bob * 0.5

    // crowd
    crowdMat.uniforms.uBeat.value = s.beat
    crowdMat.uniforms.uEnergy.value = s.playing ? s.energy : 0.3
    crowdMat.uniforms.uStar.value = s.star ? 1 : 0
    crowdMat.uniforms.uTime.value = s.time
    crowdMat.uniforms.uRim.value.copy(palette.a).lerp(starBlue, starMix)
  }

  // Frame the stage for the window's shape: landscape sees the whole stage behind the
  // highway; a tall phone screen sees the band above it
  const resize = (w, h) => {
    const aspect = w / h
    camera.aspect = aspect
    if (aspect >= 1) {
      camera.fov = 42
      camera.position.set(0, 2.9, 15.5)
      camera.lookAt(0, 3.9, -2)
    } else {
      // keep the stage's width in view; the band sits in the top third
      const hFov = 2 * Math.atan(Math.tan((42 * Math.PI) / 360) * 1.25)
      camera.fov = Math.min(95, (2 * Math.atan(Math.tan(hFov / 2) / aspect) * 180) / Math.PI)
      camera.position.set(0, 3.4, 15.5)
      const lift = Math.tan(((camera.fov / 2) * Math.PI) / 180) * 17.5 * 0.42
      camera.lookAt(0, 3.4 - lift, -2)
    }
    camera.updateProjectionMatrix()
  }

  return {
    scene,
    camera,
    update,
    resize,
    setPalette,
    strum: () => (strum = 1),
    dispose() {
      quad.dispose()
      for (const d of disposables) d.dispose?.()
    },
  }
}
