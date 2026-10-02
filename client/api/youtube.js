// Vercel serverless function for YouTube '98: proxies the YouTube Data API so the key stays
// on the server, trims responses to what the app shows, and caches them.
// Also mounted by vite.config.js during `npm run dev`.
//
//   ?action=popular[&pageToken=]        Most Popular chart                 (1 quota unit)
//   ?action=search&q=...[&pageToken=]   search + details for the results   (101 units)
//   ?action=video&id=...                one video, its channel, more from it (4 units)
//   ?action=comments&id=...[&pageToken=] top comments                      (1 unit)
//   ?q=...                              (old form) same as action=search
//
// The key has 10,000 units a day, so searches are the scarce thing: every response is
// cached in this instance's memory and on Vercel's CDN (s-maxage) so repeats are free.

const API = "https://www.googleapis.com/youtube/v3"
const MEMORY_TTL_MS = 30 * 60_000
const memory = new Map() // url -> { at, status, body }

const CDN_SECONDS = { popular: 3600, search: 6 * 3600, video: 3600, comments: 1800 }

const isoSeconds = (iso = "") => {
  const m = iso.match(/P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/) || []
  return ((+m[1] || 0) * 24 + (+m[2] || 0)) * 3600 + (+m[3] || 0) * 60 + (+m[4] || 0)
}

// The few fields the app shows, from a videos.list item
const toVideo = (item) => ({
  id: item.id,
  title: item.snippet.title,
  description: item.snippet.description,
  channelId: item.snippet.channelId,
  channelTitle: item.snippet.channelTitle,
  publishedAt: item.snippet.publishedAt,
  thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
  duration: isoSeconds(item.contentDetails?.duration),
  live: item.snippet.liveBroadcastContent === "live",
  views: item.statistics?.viewCount != null ? Number(item.statistics.viewCount) : null,
  likes: item.statistics?.likeCount != null ? Number(item.statistics.likeCount) : null,
  comments: item.statistics?.commentCount != null ? Number(item.statistics.commentCount) : null,
})

class ApiError extends Error {
  constructor(status, reason, message) {
    super(message)
    this.status = status
    this.reason = reason
  }
}

const call = async (path, params, key) => {
  const response = await fetch(`${API}/${path}?${new URLSearchParams({ ...params, key })}`)
  const data = await response.json()
  if (!response.ok) {
    const reason = data.error?.errors?.[0]?.reason || "error"
    throw new ApiError(response.status, reason, data.error?.message || "YouTube request failed")
  }
  return data
}

const videosById = async (ids, key) => {
  if (!ids.length) return []
  const data = await call("videos", { part: "snippet,contentDetails,statistics", id: ids.join(","), maxResults: "50" }, key)
  const byId = new Map(data.items.map((item) => [item.id, toVideo(item)]))
  return ids.map((id) => byId.get(id)).filter(Boolean) // keep search order, drop removed videos
}

const actions = {
  async popular({ pageToken }, key) {
    const data = await call(
      "videos",
      { part: "snippet,contentDetails,statistics", chart: "mostPopular", regionCode: "US", maxResults: "24", ...(pageToken && { pageToken }) },
      key
    )
    return { videos: data.items.map(toVideo), nextPageToken: data.nextPageToken || null, prevPageToken: data.prevPageToken || null }
  },

  async search({ q, pageToken }, key) {
    if (!q?.trim()) throw new ApiError(400, "badRequest", "Missing search term")
    const data = await call(
      "search",
      { part: "id", type: "video", q: q.trim().slice(0, 200), maxResults: "20", safeSearch: "moderate", ...(pageToken && { pageToken }) },
      key
    )
    const videos = await videosById(data.items.map((item) => item.id.videoId).filter(Boolean), key)
    return {
      videos,
      total: data.pageInfo?.totalResults ?? videos.length,
      nextPageToken: data.nextPageToken || null,
      prevPageToken: data.prevPageToken || null,
    }
  },

  async video({ id }, key) {
    if (!/^[\w-]{11}$/.test(id || "")) throw new ApiError(400, "badRequest", "Invalid video id")
    const [video] = await videosById([id], key)
    if (!video) throw new ApiError(404, "videoNotFound", "This video is no longer available.")

    const channelData = await call("channels", { part: "snippet,statistics,contentDetails", id: video.channelId }, key)
    const channelItem = channelData.items[0]
    const channel = channelItem && {
      id: channelItem.id,
      title: channelItem.snippet.title,
      thumbnail: channelItem.snippet.thumbnails?.default?.url,
      subscribers: channelItem.statistics.hiddenSubscriberCount ? null : Number(channelItem.statistics.subscriberCount),
      videoCount: Number(channelItem.statistics.videoCount),
      joined: channelItem.snippet.publishedAt,
    }

    // "More From" this channel: its latest uploads (cheap playlist reads, not a search)
    let more = []
    const uploads = channelItem?.contentDetails?.relatedPlaylists?.uploads
    if (uploads) {
      try {
        const list = await call("playlistItems", { part: "contentDetails", playlistId: uploads, maxResults: "11" }, key)
        const ids = list.items.map((item) => item.contentDetails.videoId).filter((v) => v !== id).slice(0, 10)
        more = await videosById(ids, key)
      } catch {
        more = [] // some channels hide their uploads list
      }
    }
    return { video, channel, more }
  },

  async comments({ id, pageToken }, key) {
    if (!/^[\w-]{11}$/.test(id || "")) throw new ApiError(400, "badRequest", "Invalid video id")
    try {
      const data = await call(
        "commentThreads",
        { part: "snippet", videoId: id, order: "relevance", maxResults: "20", textFormat: "plainText", ...(pageToken && { pageToken }) },
        key
      )
      return {
        comments: data.items.map((thread) => {
          const c = thread.snippet.topLevelComment.snippet
          return {
            id: thread.id,
            author: c.authorDisplayName,
            avatar: c.authorProfileImageUrl,
            text: c.textOriginal,
            likes: c.likeCount,
            publishedAt: c.publishedAt,
            replies: thread.snippet.totalReplyCount,
          }
        }),
        nextPageToken: data.nextPageToken || null,
      }
    } catch (error) {
      if (error.reason === "commentsDisabled") return { comments: [], disabled: true, nextPageToken: null }
      throw error
    }
  },
}

export default async function handler(req, res) {
  const params = Object.fromEntries(new URL(req.url, "http://localhost").searchParams)
  const action = params.action || (params.q ? "search" : null)
  const key = process.env.YOUTUBE_KEY

  res.setHeader("Content-Type", "application/json")
  const send = (status, body, cdnSeconds = 0) => {
    res.statusCode = status
    // Successful answers are cached by Vercel's CDN; errors (like an exhausted quota) aren't
    res.setHeader(
      "Cache-Control",
      status === 200 && cdnSeconds ? `public, s-maxage=${cdnSeconds}, stale-while-revalidate=86400` : "no-store"
    )
    res.end(JSON.stringify(body))
  }

  if (!key) return send(500, { error: "YOUTUBE_KEY is not set", reason: "config" })
  if (!actions[action]) return send(400, { error: "Unknown action", reason: "badRequest" })

  const cacheKey = req.url
  const hit = memory.get(cacheKey)
  if (hit && Date.now() - hit.at < MEMORY_TTL_MS) return send(200, hit.body, CDN_SECONDS[action])

  try {
    const body = await actions[action](params, key)
    memory.set(cacheKey, { at: Date.now(), body })
    if (memory.size > 500) memory.delete(memory.keys().next().value)
    send(200, body, CDN_SECONDS[action])
  } catch (error) {
    const status = error instanceof ApiError ? error.status : 502
    const reason = error instanceof ApiError ? error.reason : "network"
    send(status, { error: error.message || "YouTube request failed", reason })
  }
}
