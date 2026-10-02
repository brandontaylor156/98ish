// Open Media Player windows, so opening a .MID file from My Computer (or MS-DOS `start`)
// plays it in the player that's already open instead of starting a second one.

const open = [] // [{ index, play(songKey) }], most recently opened last

export const registerPlayer = (player) => {
  open.push(player)
  return () => {
    const i = open.indexOf(player)
    if (i >= 0) open.splice(i, 1)
  }
}

export const latestPlayer = () => open.at(-1) || null
