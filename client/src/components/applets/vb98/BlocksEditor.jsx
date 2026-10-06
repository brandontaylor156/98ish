import React, { useEffect, useRef } from "react"
import * as Blockly from "blockly/core"
import "blockly/blocks"
import * as En from "blockly/msg/en"
import { TOOLBOX, defineBlocks, generateVB } from "./vbblocks"

// Visual Basic 98's Blocks tab: Blockly (Apache-2.0), loaded only when this tab opens.
// Every change saves the workspace and writes the VB code the blocks make
// (onChange(blocksJson, code)).
Blockly.setLocale(En)

const BlocksEditor = ({ controls, state, onChange }) => {
  const hostRef = useRef(null)
  const wsRef = useRef(null)
  const controlsRef = useRef(controls)
  controlsRef.current = controls

  useEffect(() => {
    defineBlocks(Blockly, () => controlsRef.current)
    const ws = Blockly.inject(hostRef.current, {
      toolbox: TOOLBOX,
      media: "/assets/blockly/",
      sounds: false,
      trashcan: true,
      zoom: { controls: true, wheel: true, startScale: 0.9, maxScale: 2, minScale: 0.4 },
      move: { scrollbars: true, drag: true, wheel: true },
      grid: { spacing: 20, length: 2, colour: "#d0d0d0", snap: true },
      renderer: "zelos",
      theme: Blockly.Themes.Classic,
    })
    wsRef.current = ws
    try {
      if (state) Blockly.serialization.workspaces.load(state, ws)
      else {
        // a first event to start from
        const b = ws.newBlock("vb_event")
        b.initSvg()
        b.render()
        b.moveBy(24, 24)
      }
    } catch {
      ws.clear()
    }
    let timer = null
    const listener = (e) => {
      if (e.isUiEvent) return
      clearTimeout(timer)
      timer = setTimeout(() => {
        const json = Blockly.serialization.workspaces.save(ws)
        onChange(json, generateVB(json))
      }, 250)
    }
    ws.addChangeListener(listener)
    const ro = new ResizeObserver(() => Blockly.svgResize(ws))
    ro.observe(hostRef.current)
    return () => {
      clearTimeout(timer)
      ro.disconnect()
      ws.dispose()
    }
  }, [])

  return <div className="vbBlocks" ref={hostRef} data-vb-blocks data-touch-surface />
}

export default BlocksEditor
