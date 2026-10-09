// The walking camera's one setting (My Park's menu and the open world's): Free (it turns only by
// your hand; the default) or Follow behind (it also comes round behind you as you walk away from
// it). Kept on this device for both worlds (walkfeel.js loadCameraMode / saveCameraMode).
import React, { useState } from "react"
import { loadCameraMode, saveCameraMode } from "./walkfeel.js"

const LABEL = { free: "Camera: Free", follow: "Camera: Follow behind" }

export function CameraButton({ world, className = "", data = "camera-mode" }) {
  const [mode, setMode] = useState(() => world?.cameraMode || loadCameraMode())
  const flip = () => {
    const next = mode === "free" ? "follow" : "free"
    setMode(next)
    if (world?.setCameraMode) world.setCameraMode(next)
    else saveCameraMode(next)
  }
  return (
    <button type="button" className={className} onClick={flip} data-camera-mode={mode} data-park={data} title={mode === "free" ? "The camera turns only when you drag the picture (double tap: behind you)" : "The camera also comes round behind you as you walk away from it"}>
      {LABEL[mode]}
    </button>
  )
}
