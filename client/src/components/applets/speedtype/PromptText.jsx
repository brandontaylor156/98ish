import React, { useEffect, useMemo, useRef } from "react"
import { wordIndexAt, wordRanges } from "./typing"

// The prompt, word by word: what you've typed right is dimmed, the current word is
// highlighted, wrong characters are red until you fix them, and a caret shows where the
// next key goes. The box keeps the current word in view (long prompts, small phones).
const PromptText = ({ prompt, correct, wrong, waiting = false }) => {
  const ranges = useMemo(() => wordRanges(prompt), [prompt])
  const current = wordIndexAt(ranges, correct)
  const boxRef = useRef(null)
  const wordRef = useRef(null)

  useEffect(() => {
    const box = boxRef.current
    const el = wordRef.current
    if (!box || !el) return
    const top = el.offsetTop - box.offsetTop
    const lineH = el.offsetHeight || 20
    if (top < box.scrollTop || top + lineH * 2 > box.scrollTop + box.clientHeight) box.scrollTop = Math.max(0, top - lineH)
  }, [current, prompt])

  const caret = Math.min(prompt.length, correct + wrong)
  return (
    <div className={`stPrompt${waiting ? " is-waiting" : ""}`} ref={boxRef} aria-label="Prompt" data-prompt>
      {ranges.map(([start, end], w) => {
        const chars = []
        for (let i = start; i < end; i++) {
          const cls = i < correct ? "is-done" : i < correct + wrong ? "is-wrong" : ""
          chars.push(
            <span key={i} className={`${cls}${i === caret ? " is-caret" : ""}`}>
              {prompt[i]}
            </span>
          )
        }
        return (
          <span key={start} className={`stWord${w === current ? " is-current" : ""}${w < current ? " is-past" : ""}`} ref={w === current ? wordRef : null}>
            {chars}
          </span>
        )
      })}
      {caret === prompt.length && <span className="is-caret stEndCaret"> </span>}
    </div>
  )
}

export default PromptText
