// Arena items: clear lines to earn one (you can hold one at a time), press V or the Item
// button to use it. Shield and Sweep help you; Mirror and Darkness hit your target.
export const ITEMS = ["shield", "sweep", "mirror", "darkness"]
export const LINES_PER_ITEM = 4

export const ITEM_INFO = {
  shield: { name: "Shield", about: "Blocks the next garbage sent to you." },
  sweep: { name: "Sweep", about: "Clears the bottom 3 rows of your board." },
  mirror: { name: "Mirror", about: "Swaps your target's left and right for 5 seconds." },
  darkness: { name: "Darkness", about: "Turns off your target's lights for 5 seconds." },
}

export const randomItem = (random = Math.random) => ITEMS[Math.floor(random() * ITEMS.length)]
