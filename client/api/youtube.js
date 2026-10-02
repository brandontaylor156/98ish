// Vercel serverless function: proxies YouTube search so the API key stays on the server.
// Also mounted by vite.config.js during `npm run dev`.

export default async function handler(req, res) {
  const q = new URL(req.url, "http://localhost").searchParams.get("q")
  const key = process.env.YOUTUBE_KEY

  res.setHeader("Content-Type", "application/json")

  if (!key) {
    res.statusCode = 500
    return res.end(JSON.stringify({ error: "YOUTUBE_KEY is not set" }))
  }
  if (!q) {
    res.statusCode = 400
    return res.end(JSON.stringify({ error: "Missing search term" }))
  }

  const params = new URLSearchParams({
    part: "snippet",
    maxResults: "15",
    type: "video",
    q,
    key,
  })
  const response = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`)
  const data = await response.json()

  res.statusCode = response.status
  res.end(JSON.stringify(response.ok ? { items: data.items } : { error: data.error?.message }))
}
