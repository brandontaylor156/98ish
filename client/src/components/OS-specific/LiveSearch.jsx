import React from "react"
import { useOpenGesture } from "../../hooks/useMediaQuery"
import { openItem } from "../../utils/openItem"
import { fs } from "../../utils/fs"
import { iconFor } from "../../utils/fileInfo"

// Search results from the Start menu's Find box. Opening one works just like opening it
// in My Computer.
const LiveSearch = ({ results, dispatch, closeMenu }) => {
  const openGesture = useOpenGesture()

  return (
    <div className="window liveSearch" onClick={(e) => e.stopPropagation()}>
      <div className="bg-light overflow-auto" style={{ height: "100%" }}>
        <div className="row row-cols-4 row-cols-sm-6 m-0 align-content-start pt-3">
          {results.map((item, idx) => (
            <div key={idx} className="col p-0 text-center">
              <div
                className="liveSearchItem"
                title={fs.displayPath(item)}
                {...openGesture(() => {
                  openItem(item, dispatch)
                  closeMenu()
                })}
              >
                <img src={iconFor(item)} alt="" draggable="false" />
                <p>{item.name}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default LiveSearch
