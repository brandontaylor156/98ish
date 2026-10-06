import React, { useEffect, useRef, useState } from "react"
import MenuBar from "../../shared/MenuBar"
import Dialog from "../../shared/Dialog"
import { helpItem } from "../../../utils/help"
import { fs, readContent, writeAndSave, FILE_TYPE } from "../../../utils/fs"
import { CDN, diskOptions } from "./catalog"
import { loadV86 } from "./engines"
import "./LanParty.css"

// Virtual PC 98: a real x86 PC emulated by v86, booting FreeDOS from a floppy (bundled), or a
// disk image you insert (kept in this window only: never uploaded, not copied to drive C:).
// Save State compresses the whole machine (gzip) to C:\Games\Saves\VIRTUALPC.V86.

const STATE_FOLDER = ["Games", "Saves"]
const STATE_NAME = "VIRTUALPC.V86"
const MAX_STATE_BYTES = 24 * 1024 * 1024

const gzip = async (buf) => new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new CompressionStream("gzip"))).arrayBuffer())
const gunzip = async (bytes) => await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"))).arrayBuffer()
const toB64Url = async (bytes) =>
  new Promise((resolve) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result))
    r.readAsDataURL(new Blob([bytes], { type: "application/octet-stream" }))
  })
const fromB64Url = async (url) => new Uint8Array(await (await fetch(url)).arrayBuffer())

const VirtualPC = ({ handoff, onClose }) => {
  const screen = useRef(null)
  const emu = useRef(null)
  const keyInput = useRef(null)
  const [disk, setDisk] = useState(null) // { name, buffer } | null (FreeDOS)
  const [status, setStatus] = useState("Starting the PC...")
  const [error, setError] = useState("")
  const [boots, setBoots] = useState(0)

  useEffect(() => {
    let dead = false
    setStatus("Starting the PC...")
    loadV86()
      .then((V86) => {
        if (dead) return
        const e = new V86({
          wasm_path: `${CDN.v86}v86.wasm`,
          memory_size: 32 * 1024 * 1024,
          vga_memory_size: 2 * 1024 * 1024,
          screen_container: screen.current,
          bios: { url: `${CDN.v86Bios}seabios.bin` },
          vga_bios: { url: `${CDN.v86Bios}vgabios.bin` },
          ...diskOptions(disk),
          autostart: true,
          disable_speaker: false,
        })
        emu.current = e
        e.add_listener("emulator-ready", () => !dead && setStatus(""))
      })
      .catch((err) => !dead && (setStatus(""), setError(err.message)))
    return () => {
      dead = true
      const e = emu.current
      emu.current = null
      try {
        e?.destroy?.()
      } catch {}
      if (screen.current) screen.current.querySelectorAll("canvas").forEach((c) => c.getContext("2d")?.clearRect(0, 0, c.width, c.height))
    }
  }, [disk, boots])

  // a disk image handed over from My Computer (only file-system images it knows)
  useEffect(() => {
    if (!handoff?.id || !handoff.image) return
    readContent(handoff.image)
      .then(fromB64Url)
      .then((bytes) => setDisk({ name: handoff.image.name, buffer: bytes.buffer }))
      .catch(() => setError("That disk image couldn't be read."))
  }, [handoff?.id])

  const insert = () => {
    const input = document.createElement("input")
    input.type = "file"
    input.accept = ".img,.ima,.iso,.vfd,.flp"
    input.onchange = async () => {
      const f = input.files?.[0]
      if (!f) return
      if (f.size > 512 * 1024 * 1024) return setError("That disk image is too big (up to 512 MB).")
      setDisk({ name: f.name, buffer: await f.arrayBuffer() })
    }
    input.click()
  }

  const saveState = async () => {
    const e = emu.current
    if (!e) return
    setStatus("Saving the machine...")
    try {
      const packed = await gzip(await e.save_state())
      if (packed.byteLength > MAX_STATE_BYTES) throw new Error("This machine's state is too big to keep on drive C:.")
      let dir = fs.root
      for (const part of STATE_FOLDER) {
        let next = dir.getItem(part)
        if (!next || !next.isDirectory) next = fs.createDirectoryIn(dir, part)
        dir = next
      }
      let file = dir.getItem(STATE_NAME)
      const created = !file
      if (!file) file = fs.createFileIn(dir, STATE_NAME, FILE_TYPE.dossave, "")
      if (!(await writeAndSave(file, await toB64Url(packed), { created }))) throw new Error("Drive C: is full, so the machine couldn't be saved.")
      setStatus("")
    } catch (err) {
      setStatus("")
      setError(err.message || "The machine couldn't be saved.")
    }
  }
  const loadState = async () => {
    const e = emu.current
    const file = fs.root.getItem(STATE_FOLDER[0])?.getItem(STATE_FOLDER[1])?.getItem(STATE_NAME)
    if (!e || !file) return setError("There's no saved machine yet. Use Save State first.")
    setStatus("Restoring the machine...")
    try {
      await e.restore_state(await gunzip(await fromB64Url(await readContent(file))))
      setStatus("")
    } catch {
      setStatus("")
      setError("The saved machine couldn't be restored (it may be from a different disk).")
    }
  }

  const menus = [
    {
      label: "Machine",
      items: [
        { label: "Insert Disk Image...", onClick: insert },
        { label: "Boot FreeDOS", onClick: () => (setDisk(null), setBoots((b) => b + 1)) },
        { label: "Restart", onClick: () => setBoots((b) => b + 1) },
        "-",
        { label: "Save State", onClick: saveState },
        { label: "Load State", onClick: loadState },
        "-",
        { label: "Send Ctrl+Alt+Del", onClick: () => emu.current?.keyboard_send_scancodes?.([0x1d, 0x38, 0x53, 0xd3, 0xb8, 0x9d]) },
        "-",
        { label: "Exit", onClick: onClose },
      ],
    },
    { label: "Help", items: [helpItem({ program: "Virtual PC 98" })] },
  ]

  return (
    <div className="vpRoot">
      <MenuBar menus={menus} />
      <div className="vpStage">
        <div className="vpBar">
          <b>{disk ? disk.name : "FreeDOS (floppy A:)"}</b>
          <button type="button" onClick={() => keyInput.current?.focus()} data-vp-keyboard>
            Keyboard
          </button>
          <button type="button" onClick={saveState}>
            Save State
          </button>
        </div>
        <div className="vpScreenWrap" onPointerDown={() => keyInput.current?.focus({ preventScroll: true })}>
          <div className="vpScreen" ref={screen} data-vp-screen>
            <div />
            <canvas />
          </div>
          {status && <div className="lpStatus">{status}</div>}
          {/* the phone's keyboard types into the PC (v86 reads the page's key events) */}
          <input ref={keyInput} className="vpKeyInput" aria-label="Type into the PC" autoCapitalize="off" autoCorrect="off" spellCheck={false} data-native-keyboard onInput={(ev) => (ev.target.value = "")} />
        </div>
      </div>
      {error && (
        <Dialog title="Virtual PC 98" onOk={() => setError("")} onCancel={() => setError("")}>
          <p>{error}</p>
        </Dialog>
      )}
    </div>
  )
}

export default VirtualPC
