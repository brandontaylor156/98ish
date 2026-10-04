// The guided tour's stops (their order is TOUR_STEPS in utils/welcome.js).
// Each stop says what it points at and what needs to be open for it:
//   title, text(mobile)      the balloon's words (tap language on phones)
//   target(ctx)              the elements to light up (none: a card in the middle)
//   start                    the Start menu open (true), or opened down a path of submenus
//   program                  a program the tour opens for this stop and closes afterwards
//   demo                     something it acts out ("drag": nudges the window by its title bar)
//   merge                    light up one box around all the targets (icons), not one each
//   place                    "right": the balloon goes beside it if there's room
// ctx: { mobile, all(selector), win(programName) -> that window's element or null }

const visible = (els) => els.filter((el) => el && el.getClientRects().length)

export const STEPS = {
  hello: {
    title: "Let's look around!",
    text: (m) =>
      `This quick tour points out the main things on 98ish, one at a time. It takes about a minute. ${m ? "Tap Next to keep going, and the × in the corner" : "Click Next (or press Enter) to keep going, and press Esc"} to leave whenever you like.`,
  },
  start: {
    title: "The Start button",
    text: (m) => `Everything begins here. ${m ? "Tap" : "Click"} Start for all your programs, your settings, help, and Shut Down when you're done for the day.`,
    target: (ctx) => ctx.all(".taskbarLeft > div"),
  },
  startMenu: {
    title: "The Start menu",
    text: (m) =>
      `Type in the box at the top to find any file or program. Settings changes the look, and Help has Help Topics (answers to everything) and brings back the Welcome screen. ${m ? "Tap anywhere outside the menu to close it." : ""}`.trim(),
    start: true,
    target: (ctx) => ctx.all(".startMenu"),
  },
  programs: {
    title: "Programs",
    text: (m) =>
      m
        ? "Programs keeps everything in folders: Games (lots you can play online), Community, Us (for couples), Accessories, Internet and more. Tap a folder to look inside, and the top row to go back."
        : "Programs keeps everything in folders: Games (lots you can play online), Community, Us (for couples), Accessories, Internet and more. Point at a folder and it opens to the side.",
    start: ["Programs", "Games"],
    target: (ctx) => ctx.all(".startMenu, .startMenu .smSub"),
  },
  icons: {
    title: "Your desktop",
    text: (m) =>
      m
        ? "Tap an icon to open it. Press and hold one to drag it somewhere else. Press and hold an empty spot for a menu that makes new folders and notes."
        : "Double-click an icon to open it, or drag it anywhere. Drag a box around a few icons to move them together. Right-click anything (the desktop too) for more options.",
    merge: true,
    target: (ctx) => (ctx.mobile ? ctx.all(".mobileIcon").slice(0, 6) : ctx.all(".desktopIconInner").slice(0, 8)),
  },
  window: {
    title: "Windows",
    text: (m) =>
      m
        ? "Every program opens in its own window. On a phone it fills the screen. Here's Tetris!"
        : "Every program opens in its own window, and you can have lots open at once. Here's Tetris! Drag a window's edges or corner to resize it.",
    program: "Tetris",
    place: "right",
    target: (ctx) => (ctx.mobile ? [ctx.win("Tetris")?.querySelector(".title-bar")] : [ctx.win("Tetris")]),
  },
  titleBar: {
    title: "The title bar",
    text: (m) =>
      m
        ? "The buttons up here tuck a window away (_) or close it (X). Its button on the taskbar brings it back."
        : "Drag a window by its title bar to move it, like this. Message boxes and popups move the same way. The buttons on the right minimize, maximize and close it.",
    program: "Tetris",
    demo: "drag",
    target: (ctx) => [ctx.win("Tetris")?.querySelector(".title-bar")],
  },
  playOnline: {
    title: "Play Online",
    text: () =>
      "Games for two or more have this globe button. Quick Match finds someone to play right now, or Create Room gives you a short code to send a friend so you end up in the same game.",
    program: "Tetris",
    target: (ctx) => {
      const win = ctx.win("Tetris")
      return [win?.querySelector(".olPlayButton") || win]
    },
  },
  taskbar: {
    title: "The taskbar",
    text: (m) =>
      m
        ? "Every open window gets a button down here, like Tetris now. Tap one to jump back to it."
        : "Every open window gets a button down here, like Tetris now. Click one to jump to it, and again to tuck it away. Right-click the taskbar to line up all your windows.",
    program: "Tetris",
    target: (ctx) => ctx.all(".taskbarRight"),
  },
  tray: {
    title: "The tray",
    text: (m) =>
      m
        ? "The speaker sets the volume for every sound, or mutes it. Tap the clock to change the time zone. A little envelope shows up here when you have mail."
        : "The speaker sets the volume for every sound, or mutes it. The little computer shows whether you're connected for online play. Double-click the clock to change the time zone, and watch for an envelope when you have mail.",
    target: (ctx) => ctx.all(".tray"),
  },
  messenger: {
    title: "98 Messenger",
    text: () =>
      "This is how you find your friends. Make up a screen name, add buddies, chat and send game invites. Tick \"Sign me on automatically\" and it remembers you next time.",
    program: "98 Messenger",
    place: "right",
    target: (ctx) => (ctx.mobile ? [ctx.win("98 Messenger")?.querySelector(".title-bar")] : [ctx.win("98 Messenger")]),
  },
  display: {
    title: "Make it yours",
    text: (m) =>
      `Display Properties changes the wallpaper (even to your own photo), the colors and the screen saver. For a whole new look at once, try Start > Settings > Desktop Themes.${m ? "" : " Right-click the desktop and choose Properties to get here."}`,
    program: "Display Properties",
    place: "right",
    target: (ctx) => (ctx.mobile ? [ctx.win("Display Properties")?.querySelector(".title-bar")] : [ctx.win("Display Properties")]),
  },
  finish: {
    title: "That's the tour!",
    text: (m) =>
      `You're all set. The Welcome screen has more about playing with friends, couples' apps and how to get involved. Bring it back any time from Start > Help.${m ? "" : " Have fun!"}`,
  },
}

export const targetsFor = (step, ctx) => (step.target ? visible(step.target(ctx) || []) : [])
