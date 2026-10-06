// My Park: the pieces of a court (three.js), shared by Riverside and the real venues: a
// pickleball court (surface, kitchen, lines, net, posts), a tennis court (with pickleball
// lines painted on, if the venue has them) and a basketball court. Geometry is made once per
// kit and shared; venue.js mergeStatic merges the copies afterwards (a few draw calls for a
// whole venue).

import * as THREE from "three"
import { HALF_L, HALF_W, KITCHEN, LINE_W, NET_POST_X, netHeightAt } from "../physics.js"

const quad = (positions, x0, z0, x1, z1, y) => {
  positions.push(x0, y, z0, x1, y, z1, x1, y, z0, x0, y, z0, x0, y, z1, x1, y, z1)
}
const canvasTexture = (w, h, draw) => {
  const c = document.createElement("canvas")
  c.width = w
  c.height = h
  draw(c.getContext("2d"), w, h)
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}
// (layer heights: surface 0, kitchen 0.008, lines 0.014, painted-on lines 0.016, art 0.018;
// each layer's material also has a polygon offset)
const linesGeometry = (segs, y = 0.014) => {
  const lp = []
  for (const [x0, z0, x1, z1] of segs) quad(lp, x0, z0, x1, z1, y)
  const g = new THREE.BufferGeometry()
  g.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3))
  g.computeVertexNormals()
  return g
}
// a net across local x at z = 0 (posts at +-postX), top following heightAt
const netGeometries = (postX, heightAt) => {
  const SEG = 24
  const netPos = []
  const netUv = []
  const tapePos = []
  const netIdx = []
  for (let i = 0; i <= SEG; i++) {
    const x = -postX + (2 * postX * i) / SEG
    const top = heightAt(x)
    netPos.push(x, 0.07, 0, x, top - 0.045, 0)
    netUv.push(x / 0.045, 0.07 / 0.045, x / 0.045, (top - 0.045) / 0.045)
    tapePos.push(x, top - 0.05, 0, x, top + 0.004, 0)
    if (i < SEG) {
      const a = i * 2
      netIdx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3)
    }
  }
  const net = new THREE.BufferGeometry()
  net.setAttribute("position", new THREE.Float32BufferAttribute(netPos, 3))
  net.setAttribute("uv", new THREE.Float32BufferAttribute(netUv, 2))
  net.setIndex(netIdx)
  const tape = new THREE.BufferGeometry()
  tape.setAttribute("position", new THREE.Float32BufferAttribute(tapePos, 3))
  tape.setIndex(netIdx)
  return { net, tape }
}

const T = { L: 23.77, W: 10.97, S: 8.23, SVC: 6.4, POST: 6.4, NET_C: 0.914, NET_S: 1.07 }

export const createCourtKit = ({ keep, std, colors = {}, runoff = null }) => {
  const C = { court: 0x2f62ad, kitchen: 0x3b75c4, surround: 0x3c8a5a, lines: 0xf4f7fb, tennis: null, tennisSurround: null, pbLines: 0xd8e0ea, ...colors }
  const grain = keep(
    canvasTexture(256, 256, (ctx, w, h) => {
      ctx.fillStyle = "#ffffff"
      ctx.fillRect(0, 0, w, h)
      let s = 5
      const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647)
      for (let i = 0; i < 3000; i++) {
        const v = rnd() * 0.08 - 0.04
        ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`
        ctx.fillRect(rnd() * w, rnd() * h, 2, 2)
      }
    })
  )
  grain.wrapS = grain.wrapT = THREE.RepeatWrapping
  grain.repeat.set(3, 6)
  const off = (n) => ({ polygonOffset: true, polygonOffsetFactor: -n, polygonOffsetUnits: -2 * n })
  const mats = {
    court: std(C.court, { map: grain, roughness: 0.8 }),
    kitchen: std(C.kitchen, { map: grain, roughness: 0.8, ...off(1) }),
    runoff: std(C.surround, { roughness: 0.9 }),
    line: std(C.lines, { roughness: 0.7, ...off(2) }),
    pbLine: std(C.pbLines, { roughness: 0.7, ...off(3) }),
    post: std(0x2b2f36, { roughness: 0.5, metalness: 0.3 }),
    tennis: std(C.tennis ?? C.court, { map: grain, roughness: 0.8 }),
    tennisRunoff: std(C.tennisSurround ?? C.surround, { roughness: 0.9 }),
    asphalt: std(0x4b4f55, { roughness: 0.95 }),
    bbLine: std(0xf2f2f2, { roughness: 0.8 }),
    hoop: std(0xd8dde2, { roughness: 0.4, metalness: 0.4 }),
    rim: std(0xe0662a, { roughness: 0.5 }),
  }
  const netTex = keep(
    canvasTexture(32, 32, (ctx, w) => {
      ctx.clearRect(0, 0, w, w)
      ctx.strokeStyle = "rgba(20,24,30,0.85)"
      ctx.lineWidth = 3
      ctx.strokeRect(0, 0, w, w)
    })
  )
  netTex.wrapS = netTex.wrapT = THREE.RepeatWrapping
  mats.net = keep(new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }))
  mats.tape = keep(new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide }))

  // ---- pickleball (a court's own frame: the net along x, the length along z) ----
  const ro = runoff || { hx: HALF_L + 3.2, hz: HALF_W + 2.0 }
  const pb = {
    court: keep(new THREE.PlaneGeometry(2 * HALF_W, 2 * HALF_L).rotateX(-Math.PI / 2)),
    kitchen: keep(new THREE.PlaneGeometry(2 * HALF_W, 2 * KITCHEN).rotateX(-Math.PI / 2).translate(0, 0.008, 0)),
    runoff: keep(new THREE.PlaneGeometry(2 * ro.hz, 2 * ro.hx).rotateX(-Math.PI / 2).translate(0, -0.002, 0)),
    lines: keep(
      linesGeometry([
        [-HALF_W, -HALF_L, HALF_W, -HALF_L + LINE_W],
        [-HALF_W, HALF_L - LINE_W, HALF_W, HALF_L],
        [-HALF_W, -HALF_L, -HALF_W + LINE_W, HALF_L],
        [HALF_W - LINE_W, -HALF_L, HALF_W, HALF_L],
        [-HALF_W, -KITCHEN, HALF_W, -KITCHEN + LINE_W],
        [-HALF_W, KITCHEN - LINE_W, HALF_W, KITCHEN],
        [-LINE_W / 2, KITCHEN, LINE_W / 2, HALF_L],
        [-LINE_W / 2, -HALF_L, LINE_W / 2, -KITCHEN],
      ])
    ),
    post: keep(new THREE.CylinderGeometry(0.04, 0.045, 0.98, 8).translate(0, 0.49, 0)),
  }
  const pbNet = netGeometries(NET_POST_X, netHeightAt)
  pb.net = keep(pbNet.net)
  pb.tape = keep(pbNet.tape)
  // pickleball lines painted on a tennis court (in the pickleball court's own frame), a bit lighter
  pb.overlay = keep(
    linesGeometry(
      [
        [-HALF_W, -HALF_L, HALF_W, -HALF_L + LINE_W],
        [-HALF_W, HALF_L - LINE_W, HALF_W, HALF_L],
        [-HALF_W, -HALF_L, -HALF_W + LINE_W, HALF_L],
        [HALF_W - LINE_W, -HALF_L, HALF_W, HALF_L],
        [-HALF_W, -KITCHEN, HALF_W, -KITCHEN + LINE_W],
        [-HALF_W, KITCHEN - LINE_W, HALF_W, KITCHEN],
        [-LINE_W / 2, KITCHEN, LINE_W / 2, HALF_L],
        [-LINE_W / 2, -HALF_L, LINE_W / 2, -KITCHEN],
      ],
      0.016
    )
  )

  // ---- tennis ----
  const tw = 0.05
  const tn = {
    court: keep(new THREE.PlaneGeometry(T.W, T.L).rotateX(-Math.PI / 2)),
    runoff: keep(new THREE.PlaneGeometry(T.W + 7.3, T.L + 12.8).rotateX(-Math.PI / 2).translate(0, -0.002, 0)),
    lines: keep(
      linesGeometry([
        [-T.W / 2, -T.L / 2, T.W / 2, -T.L / 2 + tw],
        [-T.W / 2, T.L / 2 - tw, T.W / 2, T.L / 2],
        [-T.W / 2, -T.L / 2, -T.W / 2 + tw, T.L / 2],
        [T.W / 2 - tw, -T.L / 2, T.W / 2, T.L / 2],
        [-T.S / 2, -T.L / 2, -T.S / 2 + tw, T.L / 2],
        [T.S / 2 - tw, -T.L / 2, T.S / 2, T.L / 2],
        [-T.S / 2, -T.SVC, T.S / 2, -T.SVC + tw],
        [-T.S / 2, T.SVC - tw, T.S / 2, T.SVC],
        [-tw / 2, -T.SVC, tw / 2, T.SVC],
        [-tw / 2, -T.L / 2, tw / 2, -T.L / 2 + 0.1],
        [-tw / 2, T.L / 2 - 0.1, tw / 2, T.L / 2],
      ])
    ),
    post: keep(new THREE.CylinderGeometry(0.045, 0.05, T.NET_S, 8).translate(0, T.NET_S / 2, 0)),
  }
  const tNet = netGeometries(T.POST, (x) => T.NET_C + ((T.NET_S - T.NET_C) * (x / T.POST)) ** 2)
  tn.net = keep(tNet.net)
  tn.tape = keep(tNet.tape)

  // ---- basketball ----
  const BB = { L: 28, W: 15 }
  const bw = 0.05
  const bbSegs = [
    [-BB.W / 2, -BB.L / 2, BB.W / 2, -BB.L / 2 + bw],
    [-BB.W / 2, BB.L / 2 - bw, BB.W / 2, BB.L / 2],
    [-BB.W / 2, -BB.L / 2, -BB.W / 2 + bw, BB.L / 2],
    [BB.W / 2 - bw, -BB.L / 2, BB.W / 2, BB.L / 2],
    [-BB.W / 2, -bw / 2, BB.W / 2, bw / 2],
  ]
  for (const s of [-1, 1]) {
    // the key
    const z0 = s * BB.L / 2
    const z1 = s * (BB.L / 2 - 5.8)
    bbSegs.push([-2.45, Math.min(z0, z1), -2.45 + bw, Math.max(z0, z1)], [2.45 - bw, Math.min(z0, z1), 2.45, Math.max(z0, z1)], [-2.45, z1 - bw / 2, 2.45, z1 + bw / 2])
  }
  const bb = {
    court: keep(new THREE.PlaneGeometry(BB.W + 2, BB.L + 2).rotateX(-Math.PI / 2)),
    lines: keep(linesGeometry(bbSegs)),
    pole: keep(new THREE.CylinderGeometry(0.07, 0.08, 3.05, 6).translate(0, 1.52, 0)),
    board: keep(new THREE.BoxGeometry(1.8, 1.05, 0.05)),
    rim: keep(new THREE.TorusGeometry(0.23, 0.015, 4, 12).rotateX(Math.PI / 2)),
  }

  // center-court art (our own simple drawings, white on the court): "bear" (a walking bear
  // silhouette), "paddle" (crossed paddles), "ball"
  const arts = new Map()
  const artMat = (kind) => {
    if (!arts.has(kind)) {
      const tex = keep(
        canvasTexture(256, 128, (ctx, w, h) => {
          ctx.clearRect(0, 0, w, h)
          ctx.fillStyle = "#ffffff"
          if (kind === "bear") {
            const e = (x, y, rx, ry, r = 0) => {
              ctx.beginPath()
              ctx.ellipse(x, y, rx, ry, r, 0, Math.PI * 2)
              ctx.fill()
            }
            e(128, 66, 78, 30) // body
            e(56, 50, 26, 20, -0.25) // shoulders/head base
            e(30, 52, 20, 15) // head
            e(14, 56, 10, 7) // snout
            e(36, 36, 6, 6) // ear
            for (const [x, k] of [[66, 0], [96, 1], [168, 0], [196, 1]]) {
              ctx.fillRect(x - 10 + k * 3, 80, 20, 40)
              e(x + k * 3, 120, 13, 6)
            }
            e(204, 54, 10, 8) // tail end of the back
          } else if (kind === "paddle") {
            ctx.save()
            for (const r of [-0.5, 0.5]) {
              ctx.setTransform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), w / 2, h / 2)
              ctx.beginPath()
              ctx.ellipse(0, -18, 22, 30, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.fillRect(-5, 8, 10, 40)
            }
            ctx.restore()
          } else {
            ctx.beginPath()
            ctx.arc(w / 2, h / 2, h * 0.4, 0, Math.PI * 2)
            ctx.fill()
          }
        })
      )
      arts.set(kind, keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, color: 0xf6f6f2, ...off(4) })))
    }
    return arts.get(kind)
  }
  const artGeo = keep(new THREE.PlaneGeometry(2.6, 1.3).rotateX(-Math.PI / 2))
  const alleyGeo = keep(new THREE.PlaneGeometry(1.37, T.L).rotateX(-Math.PI / 2).translate(0, 0.008, 0))
  // a court painted its own colors (feature courts, red clay): materials made once per paint
  const painted = new Map()
  const paintMats = (paint) => {
    if (!paint) return null
    const key = JSON.stringify(paint)
    if (!painted.has(key)) {
      const num = (v, d) => (typeof v === "string" && v[0] === "#" ? parseInt(v.slice(1), 16) : d)
      painted.set(key, {
        court: std(num(paint.court, C.court), { map: grain, roughness: paint.clay ? 1 : 0.8 }),
        kitchen: std(num(paint.kitchen, num(paint.court, C.kitchen)), { map: grain, roughness: 0.8, ...off(1) }),
        tennis: std(num(paint.court, C.tennis ?? C.court), { map: grain, roughness: paint.clay ? 1 : 0.8 }),
        surround: paint.surround ? std(num(paint.surround, C.surround), { roughness: paint.clay ? 1 : 0.9 }) : null,
        alley: paint.alley ? std(num(paint.alley, C.court), { map: grain, roughness: 0.8, ...off(1) }) : null,
        line: paint.lines ? std(num(paint.lines, C.lines), { roughness: 0.7, ...off(2) }) : null,
        art: paint.art ? artMat(paint.art) : null,
      })
    }
    return painted.get(key)
  }
  const mesh = (g, geo, mat, order = 0) => {
    const m = new THREE.Mesh(geo, mat)
    m.renderOrder = order
    g.add(m)
    return m
  }
  const groupAt = (x, z, rot) => {
    const g = new THREE.Group()
    g.position.set(x, 0, z)
    g.rotation.y = rot
    g.updateMatrixWorld(true)
    return g
  }
  return {
    mats,
    // a pickleball court in its own group (the match's figures and ball go in it: the court's frame)
    paintMats,
    pickleball(x, z, rot, { runoff: withRunoff = true, paint = null } = {}) {
      const g = groupAt(x, z, rot)
      const pm = paintMats(paint)
      if (withRunoff) mesh(g, pb.runoff, mats.runoff)
      mesh(g, pb.court, pm?.court || mats.court)
      mesh(g, pb.kitchen, pm?.kitchen || mats.kitchen)
      mesh(g, pb.lines, pm?.line || mats.line)
      // the art in each kitchen, facing its baseline
      if (pm?.art)
        for (const s of [-1, 1]) {
          const a = mesh(g, artGeo, pm.art, 1)
          a.position.set(0, 0.018, s * KITCHEN * 0.5)
          a.rotation.y = s > 0 ? 0 : Math.PI
        }
      mesh(g, pb.net, mats.net, 2)
      mesh(g, pb.tape, mats.tape)
      for (const s of [-1, 1]) mesh(g, pb.post, mats.post).position.x = s * NET_POST_X
      return g
    },
    // a tennis court (length along local z); pb: pickleball courts painted on (1, 2 or 4)
    tennis(x, z, rot, { pb: n = 0, layout = null, runoff: withRunoff = true, paint = null } = {}) {
      const g = groupAt(x, z, rot)
      const pm = paintMats(paint)
      if (withRunoff) mesh(g, tn.runoff, mats.tennisRunoff)
      mesh(g, tn.court, pm?.tennis || mats.tennis)
      // doubles alleys in their own color
      if (pm?.alley) for (const s of [-1, 1]) mesh(g, alleyGeo, pm.alley).position.x = s * (T.S / 2 + 1.37 / 2)
      mesh(g, tn.lines, pm?.line || mats.line)
      mesh(g, tn.net, mats.net, 2)
      mesh(g, tn.tape, mats.tape)
      for (const s of [-1, 1]) mesh(g, tn.post, mats.post).position.x = s * T.POST
      // pickleball lines: one centered (same direction), or two / four across the tennis court
      // (layout "pair": two side by side, same direction; "ends": two end to end)
      const spots = n === 1 ? [[0, 0, 0]] : n === 2 && layout === "pair" ? [[-T.W / 4 - 0.2, 0, 0], [T.W / 4 + 0.2, 0, 0]] : n === 2 && layout === "ends" ? [[0, -T.L / 4 - 0.6, 0], [0, T.L / 4 + 0.6, 0]] : n === 2 ? [[0, -T.L / 4, Math.PI / 2], [0, T.L / 4, Math.PI / 2]] : n >= 4 ? [[-T.W / 4 - 0.4, -T.L / 4, 0], [T.W / 4 + 0.4, -T.L / 4, 0], [-T.W / 4 - 0.4, T.L / 4, 0], [T.W / 4 + 0.4, T.L / 4, 0]] : []
      for (const [ox, oz, r] of spots) {
        const m = mesh(g, pb.overlay, mats.pbLine)
        m.position.set(ox, 0, oz)
        m.rotation.y = r
        if (n >= 4 || layout === "pair") m.scale.set(0.9, 1, layout === "pair" ? 1 : 0.82)
      }
      return g
    },
    basketball(x, z, rot) {
      const g = groupAt(x, z, rot)
      mesh(g, bb.court, mats.asphalt)
      mesh(g, bb.lines, mats.bbLine)
      for (const s of [-1, 1]) {
        const p = mesh(g, bb.pole, mats.hoop)
        p.position.set(0, 0, s * (BB.L / 2 + 0.6))
        const b = mesh(g, bb.board, mats.hoop)
        b.position.set(0, 3.3, s * (BB.L / 2 - 1.2))
        const r = mesh(g, bb.rim, mats.rim)
        r.position.set(0, 3.05, s * (BB.L / 2 - 1.6))
      }
      return g
    },
  }
}
