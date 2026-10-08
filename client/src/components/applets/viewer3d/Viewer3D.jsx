import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import MoreOptions from "../../shared/MoreOptions"
import Combo from "../../shared/select/Combo"
import { helpItem } from "../../../utils/help"
import { launch } from "../../../utils/programs"
import { keyOf, useAim } from "../aim/AimContext"
import { MAX_TRIS, PHOTO_SPACES, SEND_BYTES, SEND_TRIS, validateModel } from "./core.js"
import { fileAt, getPet, listModels, readModel, saveModel, setPet } from "./store.js"
import { checkToken, getQuota, getToken, quotaLine, setToken } from "./space.js"
import "./Viewer3D.css"

// 3D Viewer 98 (Snap to 3D): see, make and use 3D models. A model is a .glb on drive C:
// (C:\My 3D). "Make 3D from a Photo..." sends a photo to free Hugging Face Spaces (TRELLIS.2
// first, then the others in space.js when one is out of free time or busy) and gets a model
// back (a shape-only one is colored from the photo, paint.js); "Bring to Life" asks AniGen for a rigged one; "Import" opens
// any .glb/.gltf. Then: Place in My Park (it trots after you), Set as Desktop Toy (a small
// spinning window), Send in Messenger (shrunk to 2 MB), Share a picture of the view.
//   handoff: { open: path } | { toy: path } | { photo: path (an image on the drive) }
// A toy window (handoff.toy) shows just the model, spinning.

const dataUrlToBlob = async (url) => (await fetch(url)).blob()

const Viewer3D = ({ mobile, handoff, dispatch, onClose, onTitle }) => {
  const aim = useAim()
  const toy = !!handoff?.toy
  const canvasRef = useRef(null)
  const viewerRef = useRef(null)
  const [models, setModels] = useState([])
  const [current, setCurrent] = useState(null) // path
  const [info, setInfo] = useState(null)
  const [busy, setBusy] = useState(null) // status text while working
  const [error, setError] = useState(null)
  const [note, setNote] = useState(null)
  const [make, setMake] = useState(null) // { photo: Blob, url, rig } the Make 3D dialog
  const [send, setSend] = useState(false)
  const [tilt, setTilt] = useState(false)
  const [token, setTok] = useState(getToken())
  const [tokenCheck, setTokenCheck] = useState(null) // { busy } | { ok, name } | { ok: false, error }
  const [quota, setQuota] = useState(getQuota())
  const [pet, setPetPath] = useState(getPet())
  const photoInput = useRef(null)
  const modelInput = useRef(null)

  const wanted = useRef(null) // the path last asked for, shown once the renderer is ready
  const refresh = useCallback(async () => setModels(await listModels()), [])

  // the viewer
  useEffect(() => {
    let alive = true
    let v = null
    import("./scene.js").then(({ createViewer }) => {
      if (!alive || !canvasRef.current) return
      v = createViewer(canvasRef.current, { toy })
      viewerRef.current = v
      // a model asked for before the renderer had loaded (a handoff, the newest model)
      if (wanted.current) show(wanted.current)
    })
    return () => {
      alive = false
      v?.dispose()
      viewerRef.current = null
    }
  }, [])

  const show = useCallback(
    async (path) => {
      wanted.current = path
      setError(null)
      const file = await fileAt(path)
      if (!file) return setError("That model isn't on drive C: any more.")
      try {
        const bytes = await readModel(file)
        const ok = validateModel(bytes)
        if (!ok.ok) return setError(ok.error)
        const v = viewerRef.current
        if (v) setInfo({ ...(await v.show(bytes)) })
        setCurrent(path)
        onTitle?.(toy ? `3D Toy - ${file.meta?.title || file.name}` : `${file.meta?.title || file.name.replace(/\.(glb|gltf)$/i, "")} - 3D Viewer 98`)
      } catch (e) {
        setError(e?.message || "That model couldn't be opened.")
      }
    },
    [toy, onTitle]
  )

  useEffect(() => {
    refresh()
  }, [refresh])

  // what the window was opened with
  useEffect(() => {
    if (!handoff?.id) return
    const path = handoff.open || handoff.toy
    if (path) show(path)
    if (handoff.photo) {
      fileAt(handoff.photo).then(async (f) => {
        if (!f) return setError("That photo isn't on drive C: any more.")
        const { readContent } = await import("../../../utils/fs.js")
        const url = await readContent(f)
        if (url) setMake({ photo: await dataUrlToBlob(url), url, rig: false, name: f.name.replace(/\.[^.]+$/, "") })
      })
    }
  }, [handoff?.id])

  // show the newest model when nothing is open yet
  useEffect(() => {
    if (!current && models.length && !handoff?.open && !handoff?.toy) show(models[0].file && pathFor(models[0]))
  }, [models])
  const pathFor = (m) => m.path || ["C:", "My 3D", m.name].join("/")

  // ---- making, importing ----
  const runMake = async ({ photo, rig, name }) => {
    setMake(null)
    setError(null)
    setBusy("Starting...")
    const t0 = Date.now()
    try {
      const space = await import("./space.js")
      const made = rig ? await space.bringToLife(photo, { onStatus: setBusy }) : await space.makeFromPhoto(photo, { onStatus: setBusy })
      let bytes = made.bytes
      // a plain shape (Hunyuan3D, TripoSG): its colors come from the photo
      if (!rig && made.textured === false) {
        setBusy("Coloring it from your photo...")
        const { paintFromPhoto } = await import("./paint.js")
        bytes = await paintFromPhoto(bytes, photo)
      }
      await keep(bytes, { title: name || (rig ? "Creature" : "Model"), source: rig ? "rigged" : "photo" })
      const skipped = made.tried?.length ? ` (${made.tried.map((t) => t.name).join(", ")} couldn't, so ${made.space} did)` : ""
      setNote(`Made in ${Math.round((Date.now() - t0) / 1000)} s by ${made.space}${made.textured === false && !rig ? ", colored from your photo" : ""}${skipped}.`)
    } catch (e) {
      setError(e?.message || "The model couldn't be made.")
    } finally {
      setBusy(null)
      setQuota(getQuota())
    }
  }

  // validate, simplify if needed, save to C:\My 3D, show
  const keep = async (bytes, { title, source }) => {
    const ok = validateModel(bytes)
    if (!ok.ok) throw new Error(ok.error)
    let out = bytes
    let tris = 0
    if (ok.format === "glb") {
      setBusy("Checking the model's size...")
      const { shrinkModel } = await import("./shrink.js")
      const s = await shrinkModel(bytes, { maxTris: MAX_TRIS, onStatus: setBusy })
      out = s.bytes
      tris = s.triangles
    }
    const saved = await saveModel(out, { title, format: ok.format, source, tris })
    if (!saved.ok) throw new Error(saved.error)
    await refresh()
    await show(saved.path)
    return saved
  }

  const onImport = async (e) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setError(null)
    setBusy("Opening the model...")
    try {
      await keep(new Uint8Array(await f.arrayBuffer()), { title: f.name.replace(/\.(glb|gltf)$/i, ""), source: "import" })
    } catch (err) {
      setError(err?.message || "That model couldn't be imported.")
    } finally {
      setBusy(null)
    }
  }

  const onPhoto = async (e, rig) => {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    setMake({ photo: f, url: URL.createObjectURL(f), rig, name: f.name.replace(/\.[^.]+$/, "") })
  }

  // ---- using it ----
  const currentModel = models.find((m) => pathFor(m) === current)
  const placeInPark = () => {
    const next = pet === current ? null : current
    setPet(next)
    setPetPath(next)
    setNote(next ? "It'll trot after you next time you walk My Park in Pickleball 98." : "Taken out of My Park.")
  }
  const desktopToy = () => dispatch?.({ type: "open_window", payload: launch("3D Viewer 98", { name: `3D Toy - ${currentModel?.title || "Model"}`, width: 220, height: 240, handoff: { id: Date.now(), toy: current } }) })
  const sharePicture = async () => {
    const blob = await viewerRef.current?.snapshot()
    if (!blob) return
    const { shareOut } = await import("../../../utils/share.js")
    shareOut({ files: [{ name: `${currentModel?.title || "3D model"}.png`, data: blob, mime: "image/png" }], title: currentModel?.title || "3D model" })
  }
  const remove = async () => {
    const { fs, saveNow } = await import("../../../utils/fs.js")
    const f = await fileAt(current)
    if (!f) return
    fs.deleteItem(f)
    await saveNow({ quiet: true })
    if (pet === current) placeInPark()
    setCurrent(null)
    setInfo(null)
    await refresh()
  }

  const buddies = useMemo(() => {
    const seen = new Set()
    const out = []
    for (const g of aim?.me?.groups || []) for (const b of g.buddies || []) if (!seen.has(keyOf(b)) && keyOf(b) !== "smarterchild") seen.add(keyOf(b)), out.push(b)
    return out
  }, [aim?.me?.groups])

  const sendTo = async (to) => {
    setSend(false)
    setError(null)
    setBusy("Shrinking it to send (up to 2 MB)...")
    try {
      const f = await fileAt(current)
      const bytes = await readModel(f)
      const { shrinkModel } = await import("./shrink.js")
      const s = await shrinkModel(bytes, { maxTris: SEND_TRIS, maxBytes: SEND_BYTES, texture: 1024, onStatus: setBusy })
      if (s.bytes.length > SEND_BYTES) throw new Error("This model is still over 2 MB after shrinking, so it can't be sent.")
      setBusy(`Sending to ${to}...`)
      const r = await aim.sendMedia(to, { kind: "model", blob: new Blob([s.bytes], { type: "model/gltf-binary" }), title: currentModel?.title || "3D model", tris: s.triangles })
      if (r?.ok === false) throw new Error(r.error || "It couldn't be sent.")
      setNote(`Sent to ${to}.`)
    } catch (e) {
      setError(e?.message || "It couldn't be sent.")
    } finally {
      setBusy(null)
    }
  }

  const toggleTilt = async () => {
    const v = viewerRef.current
    if (!v) return
    if (tilt) {
      v.disableTilt()
      setTilt(false)
    } else setTilt(await v.enableTilt())
  }

  if (toy)
    return (
      <div className="v3dRoot v3dToy">
        <canvas ref={canvasRef} className="v3dCanvas" data-touch-surface />
      </div>
    )

  const online = aim?.status === "online"
  const has = !!current
  const menus = [
    {
      label: "File",
      items: [
        { label: "Make 3D from a Photo...", onClick: () => photoInput.current?.click() },
        { label: "Import Model (.glb, .gltf)...", onClick: () => modelInput.current?.click() },
        "-",
        { label: "Share a Picture of the View...", disabled: !has, onClick: sharePicture },
        { label: "Delete Model", disabled: !has, onClick: remove },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    {
      label: "Model",
      items: [
        { label: pet === current && has ? "Take Out of My Park" : "Place in My Park", disabled: !has, onClick: placeInPark },
        { label: "Set as Desktop Toy", disabled: !has, onClick: desktopToy },
        { label: "Send in Messenger...", disabled: !has || !online, onClick: () => setSend(true) },
        "-",
        { label: "Bring a Creature to Life (from a photo)...", onClick: () => document.getElementById("v3d-rig")?.click() },
      ],
    },
    { label: "Help", items: [helpItem({ program: "3D Viewer 98" })] },
  ]

  return (
    <div className={`v3dRoot${mobile ? " is-mobile" : ""}`}>
      <MenuBar menus={menus} />
      <div className="v3dBar">
        <button type="button" className="v3dMake" onClick={() => photoInput.current?.click()} disabled={!!busy} data-v3d-make>
          Make 3D from a Photo...
        </button>
        {models.length > 0 && <Combo value={current || ""} options={models.map((m) => [pathFor(m), m.title])} onChange={show} ariaLabel="Model" name="model" />}
      </div>
      <div className="v3dStage">
        <canvas ref={canvasRef} className="v3dCanvas" data-touch-surface />
        {!has && !busy && (
          <div className="v3dEmpty" data-v3d-empty>
            <p>
              <b>No 3D models yet.</b>
            </p>
            <p>Take or pick a photo of a thing (a mug, a shoe, a toy, your dog) and 3D Viewer turns it into a model you can spin, put in My Park or send to a friend.</p>
            <p>
              Or <button type="button" className="v3dLink" onClick={() => modelInput.current?.click()}>import a .glb file</button>.
            </p>
          </div>
        )}
        {busy && (
          <div className="v3dBusy window" role="status" data-v3d-busy>
            <div className="window-body">
              <p>{busy}</p>
              <div className="v3dBusyBar">
                <div />
              </div>
            </div>
          </div>
        )}
      </div>
      <div className="v3dStatus" data-v3d-status>
        {error ? <span className="v3dError">{error}</span> : note ? <span>{note}</span> : info ? <span>{`${info.triangles.toLocaleString()} triangles${info.rigged ? " · has bones" : ""}${info.animations ? ` · ${info.animations} animation${info.animations === 1 ? "" : "s"}` : ""}${pet === current ? " · in My Park" : ""}`}</span> : <span>&nbsp;</span>}
      </div>
      <MoreOptions id="viewer3d.more" summary={`${has ? "Place in My Park · Desktop toy · Send · Bring to life" : "Bring to life"} · ${token ? "Your Hugging Face token is set" : "Add a free Hugging Face token for more 3D time"}`} className="v3dMore" forceOpen={/free 3D time/i.test(error || "") && !token}>
        <div className="v3dMoreRow">
          <button type="button" disabled={!has} onClick={placeInPark} data-v3d-park>
            {pet === current && has ? "Take Out of My Park" : "Place in My Park"}
          </button>
          <button type="button" disabled={!has} onClick={desktopToy} data-v3d-toy>
            Set as Desktop Toy
          </button>
          <button type="button" disabled={!has || !online} onClick={() => setSend(true)} data-v3d-send>
            Send in Messenger...
          </button>
          <button type="button" disabled={!has} onClick={sharePicture}>
            Share a Picture
          </button>
          {mobile && (
            <button type="button" disabled={!has} onClick={toggleTilt}>
              {tilt ? "Stop Tilting" : "Tilt to Look"}
            </button>
          )}
          <label className="v3dFileBtn">
            Bring a Creature to Life...
            <input id="v3d-rig" type="file" accept="image/*" onChange={(e) => onPhoto(e, true)} hidden />
          </label>
        </div>
        <div className="v3dToken">
          <label htmlFor="v3d-token">Your Hugging Face token (free; gives you your own, bigger daily 3D time)</label>
          <div className="v3dTokenRow">
            <input
              id="v3d-token"
              type="password"
              autoComplete="off"
              placeholder="hf_..."
              value={token}
              onChange={(e) => (setTok(e.target.value), setTokenCheck(null))}
              onBlur={() => (setToken(token), setQuota(getQuota()))}
            />
            <button
              type="button"
              disabled={!token.trim() || tokenCheck?.busy}
              onClick={async () => {
                setToken(token)
                setQuota(getQuota())
                setTokenCheck({ busy: true })
                setTokenCheck(await checkToken(token))
              }}
              data-v3d-token-check
            >
              {tokenCheck?.busy ? "Checking..." : "Check"}
            </button>
            {token && (
              <button type="button" onClick={() => (setTok(""), setToken(""), setTokenCheck(null), setQuota(getQuota()))}>
                Remove
              </button>
            )}
          </div>
          {tokenCheck && !tokenCheck.busy && <small className={tokenCheck.ok ? "v3dOk" : "v3dError"}>{tokenCheck.ok ? `It works: signed in to Hugging Face as ${tokenCheck.name}.` : tokenCheck.error}</small>}
          <small>
            How: at huggingface.co, sign up free, then Settings &gt; Access Tokens &gt; Create new token, type "Read", and paste it here. It's kept on this device for you only, sent only to Hugging Face, and removed if you delete your 98 Messenger account.
          </small>
          <small data-v3d-quota>{quotaLine(quota) || "Free 3D time left today: Hugging Face says how much when it runs low."}</small>
          <small>Free services tried, in order: {PHOTO_SPACES.map((x) => `${x.name}${x.textured ? "" : " (shape, colored from your photo)"}`).join(", ")}.</small>
        </div>
      </MoreOptions>
      <input ref={photoInput} type="file" accept="image/*" onChange={(e) => onPhoto(e, false)} hidden />
      <input ref={modelInput} type="file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" onChange={onImport} hidden data-v3d-import />
      {make && (
        <Dialog title={make.rig ? "Bring to Life" : "Make 3D"} okLabel={make.rig ? "Bring to Life" : "Make 3D"} onOk={() => runMake(make)} onCancel={() => setMake(null)}>
          <div className="v3dMakeBody">
            <img src={make.url} alt="" className="v3dMakePhoto" />
            <p>
              This photo goes to a free service on Hugging Face ({make.rig ? "AniGen" : "TRELLIS.2, or another free one if it's busy or out of time"}), which builds a 3D model {make.rig ? "with bones" : "of the main thing in it"}. It takes {make.rig ? "2 to 4" : "about 1 to 3"} minutes.
            </p>
            <p className="v3dHint">
              Best: one object, plain background, good light. {quotaLine(quota) || "Free time on Hugging Face is limited each day."}
              {token ? "" : " A free token in More options gives you more."}
            </p>
          </div>
        </Dialog>
      )}
      {send && (
        <Dialog title="Send in Messenger" onCancel={() => setSend(false)} okLabel="Cancel" onOk={() => setSend(false)}>
          <div className="v3dSend">
            {buddies.length ? (
              buddies.map((b) => (
                <button key={b} type="button" onClick={() => sendTo(b)} data-send-to={b}>
                  {b}
                </button>
              ))
            ) : (
              <p>Add a buddy in 98 Messenger first.</p>
            )}
          </div>
        </Dialog>
      )}
    </div>
  )
}

export default Viewer3D
