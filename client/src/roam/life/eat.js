// Roam life: something to eat or drink in your hand (from the Bag, a free sample, the office's
// coffee machine, the fridge) and finishing it a sip or a bite at a time. A plug-in for any roam
// world (world.use): it offers the action ("Sip (5 left)") and puts the thing in your figure's hand
// (My Park's held items: park/leisure/held.js through the host's figure.hold).
//
//   const eat = createEat({ items })   items: My Park's leisure ITEMS ({ id: { name, kind, sips } })
//   world.use(eat.plugin); eat.hold("coffee"); eat.drop()

export const createEat = ({ items = {}, onDone = () => {} } = {}) => {
  let held = null // { id, left }
  let sipT = 0
  let changed = true
  const hold = (id) => {
    const it = items[id]
    if (!it) return false
    held = { id, left: it.sips || 5 }
    changed = true
    return true
  }
  const drop = () => {
    held = null
    changed = true
  }
  const plugin = {
    action() {
      if (!held || sipT > 0) return null
      const it = items[held.id]
      const verb = it?.kind === "food" ? "Bite" : "Sip"
      return {
        label: `${verb} (${held.left} left)`,
        run: () => {
          sipT = 1.6
          held.left--
          changed = true
          if (held.left <= 0) {
            const was = held.id
            setTimeout(() => {
              if (held && held.left <= 0) {
                held = null
                changed = true
                onDone(was)
              }
            }, 1500)
          }
        },
      }
    },
    step(dt) {
      if (sipT > 0) {
        sipT -= dt
        if (sipT <= 0) changed = true
      }
    },
    figure(key, fig) {
      if (key !== "me" || !changed) return
      changed = false
      fig.hold?.(held ? held.id : null)
      fig.setMood?.(held ? (sipT > 0 ? "sip" : "carry") : null, 0, true)
    },
  }
  return {
    plugin,
    hold,
    drop,
    get held() {
      return held
    },
  }
}
