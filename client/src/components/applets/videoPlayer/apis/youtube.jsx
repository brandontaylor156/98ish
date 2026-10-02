// Searches go through /api/youtube (client/api/youtube.js) so the API key stays server-side.
export const searchVideos = async (term) => {
    const response = await fetch(`/api/youtube?q=${encodeURIComponent(term)}`)
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || "YouTube search failed")
    return data.items
}
