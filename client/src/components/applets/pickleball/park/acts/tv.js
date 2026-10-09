// My Park > Watch TV (pure): what's on. The owner: "Ability to watch tv at the lobby/gym/
// wherever gym." Only things that are yours or your friends' to show, never a broadcast:
//   live      a friend's game, live (Live Broadcast: bc:list), this venue's first
//   videos    the videos on your drive C: (Media Player's library: your highlight reels too)
//   together  YouTube with your partner or a buddy, in sync (Watch Together, its own window,
//             through YouTube's own player)

export const CHANNELS = ["live", "videos", "together"]

export const channelsFor = ({ pal = null, signedOn = false } = {}) => [
  { id: "live", label: "📡 Live" },
  { id: "videos", label: "🎞 My videos" },
  { id: "together", label: pal ? `💞 With ${pal.name}` : "▶ YouTube", disabled: !signedOn },
]

const mmss = (s) => {
  const t = Math.max(0, Math.round(Number(s) || 0))
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, "0")}`
}

// what the TV's menu says and lists for a channel
export const listFor = (channel, { live = [], videos = [], venue = null, venueName = (id) => id, pal = null, signedOn = false } = {}) => {
  if (channel === "live") {
    const list = live
      .filter((b) => b && b.id)
      .slice()
      .sort((a, b) => (b.venue === venue) - (a.venue === venue))
      .map((b) => ({ id: b.id, live: true, name: `${b.host || "A friend"}'s game`, sub: [b.venue === venue ? "Here" : b.venue ? venueName(b.venue) : null, b.courtName, b.title].filter(Boolean).join(" · ") }))
    return { msg: list.length ? "Live now:" : "Nobody's live right now. When a friend goes live (Real Games > Go Live), their game shows up here.", list }
  }
  if (channel === "videos") {
    const list = videos.filter((v) => v && v.file).map((v) => ({ id: v.key || v.name, name: v.title || v.name || "Video", sub: v.duration ? mmss(v.duration) : "Video", video: v }))
    return { msg: list.length ? "On drive C:" : "No videos on drive C: yet. Videos you add to My Videos (Media Player > Add Videos), your highlight reels too, play on this TV.", list }
  }
  if (channel === "together") {
    if (!signedOn) return { msg: "Watch Together needs 98 Messenger: sign on first, then pick a YouTube video to watch in sync.", list: [] }
    return { msg: pal ? `Watch Together opens: pick a YouTube video and ${pal.name} gets a Join button. Watch it here together.` : "Watch Together opens: pick a YouTube video, then invite a buddy to watch with you.", list: [] }
  }
  return { msg: "", list: [] }
}

// where to watch from: a free seat in front of the TV that faces it (within reach), else
// standing on the spot. seats: [{ id, x, z, y, yaw }]
export const seatFor = (tv, spot, seats = [], taken = () => false, { reach = 3.5, maxTurn = 1.0 } = {}) => {
  let best = null
  for (const s of seats) {
    // (a seat on your floor: a stool's or a chair's seat height, not one upstairs)
    if (taken(s.id) || Math.abs((s.y || 0) - (spot.y || 0)) > 1.5) continue
    const d = Math.hypot(s.x - spot.x, s.z - spot.z)
    if (d > reach) continue
    // (in front of the screen, and the seat turned toward it)
    const toS = Math.atan2(s.x - tv.x, s.z - tv.z)
    const front = Math.abs(Math.atan2(Math.sin(toS - tv.a), Math.cos(toS - tv.a)))
    const look = Math.atan2(tv.x - s.x, tv.z - s.z)
    const turn = Math.abs(Math.atan2(Math.sin(look - s.yaw), Math.cos(look - s.yaw)))
    if (front > 1.1 || turn > maxTurn) continue
    if (!best || d < best.d) best = { seat: s, d }
  }
  return best ? best.seat : null
}
