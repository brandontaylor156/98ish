// Settings and statistics in localStorage (each read falls back when storage is unavailable)
export const load = (key, fallback) => {
  try {
    const saved = JSON.parse(localStorage.getItem(key))
    return saved && typeof saved === "object" && typeof fallback === "object" ? { ...fallback, ...saved } : saved ?? fallback
  } catch {
    return fallback
  }
}

export const save = (key, value) => {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // storage unavailable: it lasts for this visit
  }
}
