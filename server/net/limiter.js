// Sliding-window counter keyed by anything: hit(key) records one and says whether the key
// is now over the limit; over(key) checks without recording. Old keys are swept now and then.

const limiter = (limit, windowMs) => {
  const hits = new Map()
  let sweptAt = Date.now()
  const recent = (key) => (hits.get(key) || []).filter((t) => Date.now() - t < windowMs)
  const sweep = () => {
    if (Date.now() - sweptAt < windowMs) return
    sweptAt = Date.now()
    for (const key of hits.keys()) {
      const list = recent(key)
      if (list.length) hits.set(key, list)
      else hits.delete(key)
    }
  }
  const over = (key) => recent(key).length >= limit
  const hit = (key) => {
    sweep()
    const list = recent(key)
    list.push(Date.now())
    hits.set(key, list)
    return list.length > limit
  }
  return Object.assign(hit, { over })
}

module.exports = { limiter }
