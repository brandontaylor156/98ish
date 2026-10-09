// Every game on the online room system (server/arcade/rooms.js). To add one, write its
// rules module next to this file (see the guide at the top of rooms.js) and list it here.

module.exports = [
  require("./checkers"),
  require("./wordduel"),
  require("./lastcard"),
  require("./pickleball"),
  require("./hexlands"),
  require("./monsterduel"),
  require("./speedtype"),
  require("./colormatch"),
  require("./echo"),
  require("./tetherball"),
  require("./imposter"),
  require("./holdem"),
  require("./parkact"),
]
