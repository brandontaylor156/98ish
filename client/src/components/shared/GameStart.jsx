import React from "react"
import MoreOptions from "./MoreOptions"
import PlayOnlineButton from "./online/PlayOnlineButton"
import "./Simple.css"

// A game's title screen, the simple way (docs/simplicity.md): one big Play, Play Online,
// then "More modes »" and "Options »" tucked away (remembered per game and per user).
//   id        the game ("tetris"): remembers its More modes / Options
//   title     the game's logo or heading
//   play      { label, sub, onClick, ...button props } the big button
//   online    { onClick, label, sub } Play Online (PlayOnlineButton), when the game has it
//   modes     [{ key, label, sub, onClick, ...button props }] the other ways to play
//   options   the settings (checkboxes, Customize...), with optionsSummary for the closed line
//   children  anything between the title and Play (the last game's result)
const GameStart = ({ id, title, play, online, modes = [], moreLabel = "More modes", options, optionsSummary, optionsLabel = "Options", className = "", children }) => {
  const { label, sub, onClick, ...playProps } = play || {}
  return (
    <div className={`gameStart ${className}`}>
      {title && <div className="gameStart-title">{title}</div>}
      {children}
      <div className="gameStart-main">
        {play && (
          <button type="button" className="gameStart-play" onClick={onClick} {...playProps}>
            <span className="gameStart-playLabel">{label || "Play"}</span>
            {sub && <span className="gameStart-playSub">{sub}</span>}
          </button>
        )}
        {online && <PlayOnlineButton className={`gameStart-online ${online.className || ""}`} onClick={online.onClick} label={online.label || "Play Online"} sub={online.sub} />}
      </div>
      {modes.length > 0 && (
        <MoreOptions id={`${id}.modes`} label={moreLabel} lessLabel={`Fewer modes`} summary={modes.map((m) => m.label).join(" · ")} className="gameStart-more">
          <div className="gameStart-modes">
            {modes.map(({ key, label: modeLabel, sub: modeSub, onClick: modeClick, ...props }) => (
              <button key={key || modeLabel} type="button" className="gameStart-mode" onClick={modeClick} {...props}>
                <span className="gameStart-modeLabel">{modeLabel}</span>
                {modeSub && <span className="gameStart-modeSub">{modeSub}</span>}
              </button>
            ))}
          </div>
        </MoreOptions>
      )}
      {options && (
        <MoreOptions id={`${id}.options`} label={optionsLabel} lessLabel={`Hide ${optionsLabel.toLowerCase()}`} summary={optionsSummary} className="gameStart-options">
          <div className="gameStart-optionList">{options}</div>
        </MoreOptions>
      )}
    </div>
  )
}

export default GameStart
