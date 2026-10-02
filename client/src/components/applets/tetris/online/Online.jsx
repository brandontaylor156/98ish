import { useEffect, useRef, useState } from "react"
import { useNet } from "../../network/NetContext"
import Lobby from "./Lobby"
import Room from "./Room"
import Match from "./Match"

// Tetris Online: the lobby (Quick Match, rooms, rankings), a room waiting for players, and
// matches. The server (server/net/tetris.js) runs rooms and matches; this keeps its latest
// view of your room, the opponents' boards it streams, and a feed of KOs and items.
const useOnline = () => {
  const net = useNet()
  const { socket, request } = net
  const [room, setRoom] = useState(null)
  const [boards, setBoards] = useState({}) // pid -> { b, h, l }
  const [feed, setFeed] = useState([]) // [{ id, text }]
  const [ranks, setRanks] = useState({}) // mode -> { stars, rank, into, need, gained }
  const [error, setError] = useState(null)
  const offset = useRef(0) // server clock - our clock
  const roomKey = useRef(null)
  const roomRef = useRef(null)
  roomRef.current = room

  const say = (text) => setFeed((list) => [...list.slice(-30), { id: `${Date.now()}${Math.random()}`, text }])

  useEffect(() => {
    if (!socket) return
    const handlers = {
      "tetris:room": (view) => {
        offset.current = view.now - Date.now()
        const key = `${view.id}:${view.round}`
        if (key !== roomKey.current) {
          roomKey.current = key
          setBoards({})
          setFeed([])
        }
        setRoom(view)
      },
      "tetris:boards": ({ roomId, boards: changed }) => {
        if (roomId === roomRef.current?.id) setBoards((all) => ({ ...all, ...changed }))
      },
      "tetris:ko": ({ roomId, byName, victimName, by, victim }) => {
        if (roomId !== roomRef.current?.id) return
        const you = roomRef.current.you
        const name = (id, n) => (id === you ? "You" : n)
        say(by ? `${name(by, byName)} K.O.'d ${victim === you ? "you" : victimName}!` : `${name(victim, victimName)} topped out.`)
      },
      "tetris:item": ({ roomId, item, by, byName, target, targetName }) => {
        if (roomId !== roomRef.current?.id) return
        const you = roomRef.current.you
        const who = by === you ? "You" : byName
        const word = { shield: "a Shield", sweep: "a Sweep", mirror: "Mirror", darkness: "Darkness" }[item]
        say(target ? `${who} used ${word} on ${target === you ? "you" : targetName}!` : `${who} used ${word}.`)
      },
      "tetris:rank": (r) => setRanks((all) => ({ ...all, [r.mode]: r })),
      // let into a friend's room (an accepted invitation): join it
      "tetris:invited": ({ roomId }) => {
        request("tetris:join", { roomId }).then((r) => !r.ok && setError(r.error))
      },
    }
    for (const [event, fn] of Object.entries(handlers)) socket.on(event, fn)
    request("tetris:hello")
    return () => {
      for (const [event, fn] of Object.entries(handlers)) socket.off(event, fn)
    }
  }, [socket])

  const act = async (event, payload) => {
    setError(null)
    const result = await request(event, payload)
    if (!result.ok) setError(result.error)
    return result
  }

  const leave = async () => {
    const id = roomRef.current?.id
    setRoom(null)
    roomKey.current = null
    if (id) await request("tetris:leave", { roomId: id })
  }

  return { net, room, boards, feed, ranks, error, setError, offset, act, leave, request, socket }
}

const Online = ({ onExit, fitWindow, mobile }) => {
  const online = useOnline()
  const { room, net } = online
  const inMatch = room && room.phase !== "waiting"

  // Closing the window (or going back to the menu) leaves the room
  const leaveRef = useRef(online.leave)
  leaveRef.current = online.leave
  useEffect(() => () => leaveRef.current(), [])

  // Matches need room for the opponents' boards: widen the window while one is on
  const widened = useRef(false)
  useEffect(() => {
    if (!fitWindow) return
    if (inMatch && !widened.current) {
      widened.current = true
      fitWindow(room.mode === "battle" ? 840 : 900, 620)
    } else if (!inMatch && widened.current) {
      widened.current = false
      fitWindow(600, 600)
    }
  }, [inMatch])

  const exit = async () => {
    await online.leave()
    if (widened.current) fitWindow?.(600, 600)
    onExit()
  }

  if (!net || net.status === "offline") {
    return (
      <div className="tetrisOnline tetrisOnline--message">
        <p>Tetris Online needs the network, and it isn't answering right now. Check your connection and try again in a moment.</p>
        <button type="button" onClick={onExit}>Back</button>
      </div>
    )
  }

  if (!room) return <Lobby online={online} onExit={exit} />
  if (room.phase === "waiting") return <Room online={online} onExit={exit} />
  return <Match key={`${room.id}:${room.round}`} online={online} mobile={mobile} onExit={exit} />
}

export default Online
