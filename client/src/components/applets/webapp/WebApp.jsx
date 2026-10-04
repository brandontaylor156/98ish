import React, { useEffect, useState } from "react"
import "./WebApp.css"

// One of Brandon's other web apps, running live inside a 98ish window: a slim toolbar
// (Home, Open in New Window) over the site itself.
const WebApp = ({ project, mobile }) => {
  const [key, setKey] = useState(0) // bump to reload
  const [loading, setLoading] = useState(true)
  const [slow, setSlow] = useState(false)

  useEffect(() => {
    setLoading(true)
    setSlow(false)
    // a site that refuses to be shown in a frame never finishes: offer a new window
    const t = setTimeout(() => setSlow(true), 12000)
    return () => clearTimeout(t)
  }, [key])

  const openOutside = () => window.open(project.url, "_blank", "noopener")

  return (
    <div className="waRoot">
      <div className="waBar">
        {/* a cross-site page can't be told to reload or go back, so this loads it fresh */}
        <button type="button" onClick={() => setKey((k) => k + 1)} title="Back to the start page">
          <span aria-hidden="true">&#8962;</span> Home
        </button>
        <span className="waAddress" title={project.url}>
          {project.url.replace(/^https?:\/\//, "")}
        </span>
        <button type="button" onClick={openOutside} title="Open in a new browser window">
          <span aria-hidden="true">&#8599;</span> {mobile ? "Open" : "New Window"}
        </button>
      </div>
      {project.signIn && <div className="waNote">If signing in doesn't stick in here, use {mobile ? "Open" : "New Window"} above: some browsers block sign-in inside another site.</div>}
      <div className="waFrameBox">
        <iframe
          key={key}
          className="waFrame"
          src={project.url}
          title={project.name}
          allow="clipboard-write; fullscreen"
          referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setLoading(false)}
        />
        {loading && (
          <div className="waLoading">
            <span className="appLoadingGlass motion-ok" aria-hidden="true" />
            <p>Connecting to {project.name}...</p>
            {slow && (
              <button type="button" onClick={openOutside}>
                Open in a new window
              </button>
            )}
          </div>
        )}
      </div>
      <div className="status-bar waStatus">
        <p className="status-bar-field">{loading ? "Opening page..." : "Done"}</p>
        <p className="status-bar-field waZone">Internet zone</p>
      </div>
    </div>
  )
}

export default WebApp
