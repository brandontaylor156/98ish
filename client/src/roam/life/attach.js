// Roam life: everything that rides along with a world (the town or an interior): emotes and doing
// things together (social.js), eating and drinking (eat.js), and in the town the doors, the stores
// and the things you put down (town.js). The page (Pickleball.jsx) attaches it to each world it
// shows and detaches it when the world goes.
//
//   const life = attachLife({ world, host, friends: () => Set, onSocial, onEvent, inTown })
//   life.social.emote("wave"); life.eat.hold("coffee"); life.town?.put("grill"); life.detach()

import { createSocial } from "./social.js"
import { createEat } from "./eat.js"
import { createTownLife } from "./town.js"

export const attachLife = ({ world, host, friends = () => new Set(), onSocial = () => {}, onEvent = () => {}, inTown = true }) => {
  const social = createSocial({ world, rules: host.together, friends, onState: onSocial })
  const eat = createEat({ items: host.heldItems || {}, onDone: (id) => onEvent({ type: "finished", item: id }) })
  const offs = [world.use(social.plugin), world.use(eat.plugin)]
  world.setSocial?.(social)
  const town = inTown && world.buildingAt ? createTownLife({ world, host, social, onEvent }) : null
  return {
    social,
    eat,
    town,
    detach() {
      for (const off of offs) off()
      town?.dispose()
    },
  }
}
