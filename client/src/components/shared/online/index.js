/*
 * Online play for 98ish games: the browser side of the online room system
 * (server: server/arcade/rooms.js, which has the server half of this guide).
 *
 * ============================== ADDING A NEW ONLINE GAME ==============================
 *
 * 1. Server: write server/arcade/games/<id>.js (rules: create / action / view / isOver /
 *    bot) and list it in server/arcade/games/index.js. See server/arcade/games/checkers.js.
 *
 * 2. Program entry (client/src/utils/programs.js): add `online: "<id>"` so invitations and
 *    join links (?join=K7QX) open your game's window:
 *      { name: "Uno 98", app: "uno", type: "uno", icon: "...", group: "Games", single: true, online: "uno" }
 *
 * 3. The game's window:
 *
 *      import PlayOnline, { OnlineResultBar, PlayOnlineButton, useOnlineRoom } from "../../shared/online"
 *      import GameChat from "../../shared/GameChat"
 *
 *      const UnoOnline = ({ onBack }) => {
 *        const online = useOnlineRoom("uno")
 *        const playing = online.phase === "playing" || online.phase === "over"
 *        return (
 *          <div className="unoRoot">
 *            <GameChat game="uno" title="Uno" room={online.chatRoom} />
 *            {playing ? (
 *              <>
 *                <UnoTable view={online.view} seat={online.seat} seats={online.room.seats}
 *                          onPlay={(card) => online.act({ type: "play", card })} />
 *                <OnlineResultBar online={online} />
 *              </>
 *            ) : (
 *              <PlayOnline online={online} title="Uno" icon="/assets/program_icons/uno.svg"
 *                          defaultSettings={{ stacking: false }} computer onBack={onBack}
 *                          renderSettings={(s, set, { disabled }) => (
 *                            <label><input type="checkbox" disabled={disabled} checked={s.stacking}
 *                              onChange={(e) => set({ ...s, stacking: e.target.checked })} /> Stack +2s</label>
 *                          )} />
 *            )}
 *          </div>
 *        )
 *      }
 *
 *    And on the game's title screen / toolbar: <PlayOnlineButton onClick={() => setScreen("online")} />,
 *    plus a "Play Online..." item in its Game menu. Checkers (applets/network/games/
 *    CheckersOnline.jsx) is a complete example.
 *
 * useOnlineRoom(gameId) returns:
 *   connection: net, server ({ state: online | connecting | waking | reconnecting | no-internet
 *               | offline, online, text, retry() }), connected, me ({ id, name, user })
 *   the room:   room (the server's room:state view, or null), phase (null | "lobby" | "playing"
 *               | "over"), seat (your seat number, null when watching), isHost, spectator,
 *               view (your game view from the rules' view()), chatRoom ("match:<id>" for GameChat)
 *   status:     error (last failed request, a sentence), setError, notice (e.g. you were removed),
 *               clearNotice, busy (which request is waiting), serverNow()
 *   actions (all -> Promise<{ ok, error? }>): quickMatch(settings), createRoom(settings),
 *               joinCode(code), joinRoom(roomId), playComputer(settings), leave(), setReady(bool),
 *               setSettings(settings), start(), kick(seat), fillBots(), rematch(), backToLobby(),
 *               act(action) (a move: its error is returned, not put in `error`), invite(to)
 *   real-time:  sendSnap(data) (host, ~20-30/s, may be dropped), sendInput(data) (guests -> host),
 *               sendRelay(data, toSeat?) (reliable), finish({ winners, reason, scores }),
 *               onSnap(fn(data)), onInput(fn(data, fromSeat)), onRelay(fn(data, fromSeat)): each
 *               returns an unsubscribe function (use them in an effect; they don't re-render)
 *
 * Closing the window leaves the room (mid-game, a computer player takes the seat if the game
 * has one). A dropped connection keeps the seat for 30 seconds.
 *
 * Components:
 *   <PlayOnline online title icon blurb defaultSettings renderSettings quickSettings computer onBack extra />
 *     The choices (Quick Match, Create Room, Join with Code, Invite Someone, and Play the
 *     Computer when `computer`), then the lobby while the room's phase is "lobby".
 *     renderSettings(settings, setSettings, { disabled }) draws the game's own settings form
 *     (Create Room, the lobby, and Quick Match too when `quickSettings`).
 *   <OnlineResultBar online text? />   who won, Rematch / Back to Lobby / Leave (phase "over")
 *   <PlayOnlineButton onClick label sub size="big" | "small" />   the globe button for title
 *     screens ("big") and toolbars ("small"); shows how many people are online
 *   <ConnectionPanel server onBack? />   "Waking up the game server..." and friends
 *   <OnlinePeople onInvite(computer) exclude emptyText />   who's online, with Invite buttons
 *
 * Games that predate rooms (Reversi, Chess, Battleship, Hearts, Minesweeper Race) use
 * useNet().openPlayOnline(game) instead: a window listing who's online, to invite.
 */

export { default } from "./PlayOnline"
export { ConnectionPanel, OnlinePeople, OnlineResultBar } from "./PlayOnline"
export { default as PlayOnlineButton, GlobeIcon } from "./PlayOnlineButton"
export { useOnlineRoom, useServerStatus, onlineProgram, setPendingJoin, joinLink } from "./useOnlineRoom"
