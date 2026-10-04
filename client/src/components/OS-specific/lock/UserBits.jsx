import React, { useSyncExternalStore } from "react"
import { listUsers, pictureFor, subscribeUsers } from "../../../utils/users"

// the device's users, kept current
export const useUsers = () => useSyncExternalStore(subscribeUsers, listUsers)

// a person's picture and name
export const UserBadge = ({ user, small = false }) => (
  <span className={small ? "userBadge is-small" : "userBadge"}>
    <img className="userPicture" src={pictureFor(user)} alt="" draggable={false} />
    <span className="userName">{user?.name}</span>
  </span>
)
