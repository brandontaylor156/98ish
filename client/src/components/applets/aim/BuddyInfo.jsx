import React, { useEffect, useState } from "react"
import { keyOf, useAim } from "./AimContext"

const duration = (since) => {
  const minutes = Math.max(0, Math.round((Date.now() - new Date(since)) / 60_000))
  const hours = Math.floor(minutes / 60)
  return hours ? `${hours} hour${hours === 1 ? "" : "s"}, ${minutes % 60} minutes` : `${minutes} minutes`
}

// Buddy Info: online time, idle, warning level, away message and profile
const BuddyInfo = ({ buddy }) => {
  const aim = useAim()
  const [info, setInfo] = useState(null)
  const [error, setError] = useState(null)
  const presence = aim.presence[keyOf(buddy)]

  const load = async () => {
    setError(null)
    const result = await aim.getInfo(buddy)
    if (result.ok) setInfo(result.info)
    else setError(result.error)
  }

  // Reload when they sign on/off or change status
  useEffect(() => {
    load()
  }, [buddy, presence?.online, presence?.away, presence?.idleSince])

  if (error) return <div className="aimInfo aimSystem--error">{error}</div>
  if (!info) return <div className="aimInfo">Loading...</div>

  return (
    <div className="aimInfo">
      <div className="aimInfoName">{info.screenName}</div>
      <table className="aimInfoTable">
        <tbody>
          <tr>
            <th>Status</th>
            <td>{info.online ? (info.away ? "Away" : "Online") : "Offline"}</td>
          </tr>
          {info.online && (
            <tr>
              <th>Online time</th>
              <td>{duration(info.signOnAt)}</td>
            </tr>
          )}
          {info.online && info.idleSince && (
            <tr>
              <th>Idle</th>
              <td>{duration(info.idleSince)}</td>
            </tr>
          )}
          {info.online && (
            <tr>
              <th>Warning level</th>
              <td>{info.warning}%</td>
            </tr>
          )}
          {info.memberSince && (
            <tr>
              <th>Member since</th>
              <td>{new Date(info.memberSince).toLocaleDateString()}</td>
            </tr>
          )}
        </tbody>
      </table>

      {info.awayMessage && (
        <fieldset className="aimInfoBox">
          <legend>Away Message</legend>
          {info.awayMessage}
        </fieldset>
      )}
      <fieldset className="aimInfoBox">
        <legend>Profile</legend>
        {info.profile || <i>This person hasn't written a profile yet.</i>}
      </fieldset>

      <div className="aimInfoButtons">
        <button type="button" onClick={() => aim.openIm(info.screenName)}>
          Send IM
        </button>
        <button type="button" onClick={load}>
          Refresh
        </button>
      </div>
    </div>
  )
}

export default BuddyInfo
