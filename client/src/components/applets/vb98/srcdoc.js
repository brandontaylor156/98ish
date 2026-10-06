// The page a Visual Basic 98 program runs in (the iframe's srcdoc). The iframe gets
// sandbox="allow-scripts" (no allow-same-origin: an opaque origin with no access to 98ish's
// storage, cookies or DOM), and this page's CSP allows no network at all (no fetch, no
// WebSocket, no images or fonts from anywhere), only its own inline script and styles.
import runtimeSrc from "./vbruntime.js?raw"
import bootSrc from "./sandboxBoot.js?raw"

export const SANDBOX_ATTR = "allow-scripts"
export const CSP = "default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; media-src data: blob:; font-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'"

const CSS = `
*{box-sizing:border-box}
html,body{margin:0;padding:0;background:transparent;overflow:hidden;-webkit-text-size-adjust:100%}
body{font:11px Tahoma,"MS Sans Serif",Verdana,Arial,sans-serif;color:#000;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;-webkit-tap-highlight-color:transparent}
#form{position:relative;overflow:hidden;transform:scale(var(--scale,1));transform-origin:0 0}
.ctl{position:absolute;overflow:hidden}
.ctl.off{opacity:.55;pointer-events:none}
.label{white-space:pre-wrap;line-height:1.25;padding:1px}
.button{font:inherit;font-size:inherit;color:inherit;border:0;border-radius:0;padding:0 6px;background:#c0c0c0;box-shadow:inset -1px -1px #0a0a0a,inset 1px 1px #fff,inset -2px -2px grey,inset 2px 2px #dfdfdf;cursor:pointer;touch-action:manipulation}
.button:active{box-shadow:inset -1px -1px #fff,inset 1px 1px #0a0a0a,inset -2px -2px #dfdfdf,inset 2px 2px grey;padding-top:2px;padding-left:8px}
.button:focus-visible{outline:1px dotted #000;outline-offset:-4px}
.textbox{box-shadow:inset -1px -1px #fff,inset 1px 1px grey,inset -2px -2px #dfdfdf,inset 2px 2px #0a0a0a;padding:2px}
.textbox input,.textbox textarea{width:100%;height:100%;border:0;outline:0;padding:1px 3px;font:inherit;background:#fff;resize:none;-webkit-user-select:text;user-select:text;border-radius:0}
.check{display:flex;align-items:center;gap:5px;cursor:pointer}
.check .box{flex:none;width:13px;height:13px;background:#fff;box-shadow:inset -1px -1px #fff,inset 1px 1px grey,inset -2px -2px #dfdfdf,inset 2px 2px #0a0a0a;position:relative}
.check.radio .box{border-radius:50%}
.check .box.on::after{content:"";position:absolute;left:3px;top:1px;width:4px;height:7px;border:solid #000;border-width:0 2px 2px 0;transform:rotate(40deg)}
.check.radio .box.on::after{left:4px;top:4px;width:5px;height:5px;border:0;border-radius:50%;background:#000;transform:none}
.list{background:#fff;box-shadow:inset -1px -1px #fff,inset 1px 1px grey,inset -2px -2px #dfdfdf,inset 2px 2px #0a0a0a;padding:2px;overflow-y:auto}
.row{padding:1px 3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;min-height:16px}
.row.sel{background:#000080;color:#fff}
.combo{background:#fff;box-shadow:inset -1px -1px #fff,inset 1px 1px grey,inset -2px -2px #dfdfdf,inset 2px 2px #0a0a0a;display:flex;align-items:center;overflow:visible;cursor:pointer}
.combo .cap{flex:1;padding:0 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.combo .arrow{flex:none;width:16px;height:calc(100% - 4px);margin-right:2px;background:#c0c0c0;box-shadow:inset -1px -1px #0a0a0a,inset 1px 1px #fff,inset -2px -2px grey,inset 2px 2px #dfdfdf;position:relative}
.combo .arrow::after{content:"";position:absolute;left:4px;top:calc(50% - 2px);border:4px solid transparent;border-top:4px solid #000;border-bottom:0}
.combo .drop{position:absolute;left:0;right:0;top:100%;z-index:50;background:#fff;border:1px solid #000;max-height:160px;overflow-y:auto}
.combo .drop[hidden]{display:none}
.picture,.sprite{display:flex;align-items:center;justify-content:center}
.picture img,.sprite img{width:100%;height:100%;object-fit:contain;pointer-events:none}
.emoji{line-height:1;pointer-events:none}
.shape{cursor:default}
.veil{position:fixed;inset:0;z-index:100;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.08)}
.dlg{min-width:200px;max-width:min(320px,94vw);background:#c0c0c0;box-shadow:inset -1px -1px #0a0a0a,inset 1px 1px #dfdfdf,inset -2px -2px grey,inset 2px 2px #fff;padding:3px}
.dlgbar{background:linear-gradient(90deg,#000080,#1084d0);color:#fff;font-weight:bold;padding:3px 5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dlgbody{padding:12px 10px 6px;display:flex;flex-direction:column;gap:8px}
.dlgtext{white-space:pre-wrap;word-break:break-word;font-size:12px}
.dlgtext.err{color:#800000}
.dlgbody input{font:inherit;font-size:16px;padding:3px;border:0;box-shadow:inset -1px -1px #fff,inset 1px 1px grey,inset -2px -2px #dfdfdf,inset 2px 2px #0a0a0a;-webkit-user-select:text;user-select:text;border-radius:0}
.dlgbtns{display:flex;justify-content:center;gap:8px;padding:6px 0 4px}
.dlgbtns .button{position:static;min-width:72px;height:26px}
`

export const buildSrcdoc = () =>
  `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${CSS}</style></head><body><div id="form"></div><script type="module">\n${runtimeSrc}\n;\n${bootSrc}\n</script></body></html>`
