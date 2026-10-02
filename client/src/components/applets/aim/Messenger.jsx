import React from "react"
import { useAim } from "./AimContext"
import BuddyList from "./BuddyList"
import SignOn from "./SignOn"

// The "98 Messenger" window: Sign On until you're online, then your Buddy List
const Messenger = () => {
  const { status } = useAim()
  return <div className="aimRoot">{status === "online" ? <BuddyList /> : <SignOn />}</div>
}

export default Messenger
