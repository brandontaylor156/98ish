import React, { Suspense, lazy } from "react"
import { useCouple } from "../../../utils/couple"

// The taskbar tray's heart for couples (and anyone with a pair request waiting). Its code
// loads only then, so the taskbar stays small for everyone else.
const TrayHeart = lazy(() => import("./TrayHeart"))

const CoupleTray = () => {
  const { status } = useCouple()
  if (status !== "paired" && status !== "pending-in") return null
  return (
    <Suspense fallback={null}>
      <TrayHeart />
    </Suspense>
  )
}

export default CoupleTray
