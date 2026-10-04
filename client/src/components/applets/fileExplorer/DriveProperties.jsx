import React from "react"
import Dialog from "../../shared/Dialog"
import { useDriveUsage } from "../../../hooks/useFs"
import { formatBytes } from "../../../utils/fileInfo"
import { imageMapper } from "../../../utils/imageMapper"
import { storageInfo } from "../../../utils/fs"
import { statusText, useDriveSync } from "../../../utils/driveSync"

// Local Disk (C:) Properties, as in Windows 98: used and free space with the tilted pie,
// plus where this browser keeps the drive and how sync is doing.

const commas = (n) => Math.round(n).toLocaleString("en-US")

// a tilted pie: the used part blue, the free part magenta, with a darker rim below
export const DrivePie = ({ used, free }) => {
  const total = used + free
  const share = total > 0 ? Math.min(1, Math.max(0, used / total)) : 0
  const [cx, cy, rx, ry, depth] = [60, 26, 56, 22, 10]
  // the used wedge runs clockwise from the right-hand side (like Win98's, from 3 o'clock)
  const angle = share * Math.PI * 2
  const end = [cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]
  const wedge =
    share >= 0.999
      ? null
      : share <= 0.001
        ? null
        : `M${cx},${cy} L${cx + rx},${cy} A${rx},${ry} 0 ${angle > Math.PI ? 1 : 0} 1 ${end[0].toFixed(2)},${end[1].toFixed(2)} Z`
  // the rim: the front half of the ellipse, colored by what's in front
  const rim = (from, to, color) => {
    const a = Math.max(0, from)
    const b = Math.min(Math.PI, to)
    if (b <= a) return null
    const p = (t) => [cx + rx * Math.cos(t), cy + ry * Math.sin(t)]
    const [x1, y1] = p(a)
    const [x2, y2] = p(b)
    return <path d={`M${x1},${y1} A${rx},${ry} 0 0 1 ${x2},${y2} L${x2},${y2 + depth} A${rx},${ry} 0 0 0 ${x1},${y1 + depth} Z`} fill={color} stroke="#000" strokeWidth="0.6" />
  }
  const top = share >= 0.999 ? "#0000ff" : "#ff00ff"
  return (
    <svg className="fxPie" viewBox="0 0 120 62" width="120" height="62" role="img" aria-label={`${Math.round(share * 100)}% used`}>
      {rim(0, Math.PI, "#800080")}
      {rim(0, angle, "#000080")}
      <ellipse cx={cx} cy={cy} rx={rx} ry={ry} fill={top} stroke="#000" strokeWidth="0.6" />
      {wedge && <path d={wedge} fill="#0000ff" stroke="#000" strokeWidth="0.6" />}
    </svg>
  )
}

const DriveProperties = ({ item, onClose }) => {
  const usage = useDriveUsage()
  const sync = useDriveSync()
  const info = storageInfo()
  const used = usage?.used ?? 0
  const free = usage?.free ?? 0
  const where = {
    idb: "This browser's storage (IndexedDB)",
    local: "This browser's small storage (5 MB)",
    unavailable: "Not saved (storage unavailable)",
    memory: "Not saved",
  }[info.mode]
  return (
    <Dialog title={`${item.name === "C:" ? "Local Disk (C:)" : item.name} Properties`} onOk={onClose}>
      <div className="fxDrive">
        <div className="fxProps">
          <img src={"/assets/" + imageMapper.drive} alt="" />
          <b>Local Disk (C:)</b>
        </div>
        <table className="fxPropsTable">
          <tbody>
            <tr>
              <th>Type:</th>
              <td>Local Disk</td>
            </tr>
            <tr>
              <th>Kept in:</th>
              <td>{where}</td>
            </tr>
            {info.mode === "idb" && (
              <tr>
                <th>Kept safe:</th>
                <td>{info.persisted ? "Yes (the browser won't clear it to make room)" : "Not guaranteed (the browser may clear it if the device runs out of space)"}</td>
              </tr>
            )}
          </tbody>
        </table>
        <table className="fxPropsTable fxSpace">
          <tbody>
            <tr>
              <th>
                <span className="fxSwatch is-used" aria-hidden="true" />
                Used space:
              </th>
              <td>{usage ? `${commas(used)} bytes` : "..."}</td>
              <td>{usage ? formatBytes(used) : ""}</td>
            </tr>
            <tr>
              <th>
                <span className="fxSwatch is-free" aria-hidden="true" />
                Free space:
              </th>
              <td>{usage?.free != null ? `${commas(free)} bytes` : "Unknown"}</td>
              <td>{usage?.free != null ? formatBytes(free) : ""}</td>
            </tr>
            <tr className="fxCapacity">
              <th>Capacity:</th>
              <td>{usage?.capacity ? `${commas(usage.capacity)} bytes` : "Unknown"}</td>
              <td>{usage?.capacity ? formatBytes(usage.capacity) : ""}</td>
            </tr>
          </tbody>
        </table>
        <div className="fxPieRow">
          <DrivePie used={used} free={usage?.free ?? 0} />
          <span>Drive C</span>
        </div>
        <table className="fxPropsTable">
          <tbody>
            <tr>
              <th>Sync:</th>
              <td>
                {statusText(sync)}
                {sync.quota ? ` Online: ${formatBytes(sync.usage || 0)} of ${formatBytes(sync.quota)}.` : ""}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </Dialog>
  )
}

export default DriveProperties
