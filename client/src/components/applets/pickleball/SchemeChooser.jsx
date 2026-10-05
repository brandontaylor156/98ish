import React from "react"

// "How do you want to play?": asked once, the first time you play on a touch screen. Each
// choice has a little 5-second picture that plays over and over: the move pad (always yours:
// nothing moves your player for you) and how that scheme hits. Switch any time in
// Options > Settings.

const Demo = ({ scheme, padSide }) => (
  <div className={`pkDemo pkDemo--${scheme} pkDemo--pad-${padSide}`} aria-hidden="true">
    <div className="pkDemoCourt">
      <i className="pkDemoNet" />
      <i className="pkDemoKitchen" />
      <i className="pkDemoTarget" />
      <i className="pkDemoBall" />
      <i className="pkDemoMe" />
    </div>
    <div className="pkDemoPad">
      <i className="pkDemoKnob" />
    </div>
    {scheme === "swipe" && <i className="pkDemoSwipe" />}
    {scheme === "classic" && <i className="pkDemoHold" />}
    <i className="pkDemoFinger" />
    <i className="pkDemoThumb" />
  </div>
)

export const SchemeChooser = ({ padSide, onPadSide, onPick, onCancel, current }) => (
  <div className="pkCenter pkDim pkChooserLayer">
    <div className="pkPanel2 window pkChooser" role="dialog" aria-label="How do you want to play?">
      <div className="title-bar">
        <div className="title-bar-text">How do you want to play?</div>
        {onCancel && (
          <div className="title-bar-controls">
            <button aria-label="Close" onClick={onCancel} />
          </div>
        )}
      </div>
      <div className="window-body pkChooserBody">
        <p className="pkChooserLead">You always move your player yourself, with the pad. Pick how you hit:</p>
        <div className="pkChooserRow">
          <button type="button" className={`pkChoice${current === "swipe" ? " is-on" : ""}`} data-scheme="swipe" onClick={() => onPick("swipe")}>
            <Demo scheme="swipe" padSide={padSide} />
            <b>Swipe (recommended)</b>
            <small>Swipe up toward where it goes as the ball comes. Quick flick = hard, slow = soft, tap = dink.</small>
          </button>
          <button type="button" className={`pkChoice${current === "classic" ? " is-on" : ""}`} data-scheme="classic" onClick={() => onPick("classic")}>
            <Demo scheme="classic" padSide={padSide} />
            <b>Classic</b>
            <small>Touch their court to aim. Tap = soft, hold = hard. Let go as the ball comes.</small>
          </button>
        </div>
        <div className="pkChooserPad">
          <span>Move pad:</span>
          {[
            ["left", "Left"],
            ["right", "Right"],
          ].map(([v, l]) => (
            <button type="button" key={v} className={padSide === v ? "is-on" : ""} aria-pressed={padSide === v} data-pad={v} onClick={() => onPadSide(v)}>
              {l}
            </button>
          ))}
        </div>
        <p className="pkMuted">Change these any time: Pause &gt; Settings.</p>
      </div>
    </div>
  </div>
)
