// Printing: a report or record as plain HTML (escaped) in 98ish's print copy (utils/print.js),
// so the desktop around it never prints.
import { printDocument } from "../../../utils/print"

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c])

const STYLE = `
.awPrint { font: 12px "Courier New", monospace; color: #000; }
h1 { font: bold 18px Arial, sans-serif; margin: 0 0 2px; }
.sub { font: 11px Arial, sans-serif; margin-bottom: 12px; border-bottom: 2px solid #000; padding-bottom: 6px; }
table { border-collapse: collapse; width: 100%; }
th { text-align: left; border-bottom: 1px solid #000; font: bold 11px Arial, sans-serif; padding: 3px 6px; }
td { padding: 3px 6px; border-bottom: 1px dotted #999; vertical-align: top; }
tr:nth-child(even) td { background: #eef3ff; }
tfoot td { font-weight: bold; border-top: 2px solid #000; background: none !important; }
.foot { margin-top: 14px; font: 10px Arial, sans-serif; color: #444; }
`

// a table as printable HTML
export const tableHtml = (columns, rows, totals = null) =>
  `<table><thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join("")}</tr></thead><tbody>${rows
    .map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`)
    .join("")}</tbody>${totals ? `<tfoot><tr>${totals.map((t) => `<td>${esc(t)}</td>`).join("")}</tr></tfoot>` : ""}</table>`

// (the 98ish print copy rather than a pop-up window: a Home Screen iPhone app can't open one)
export const printPage = ({ title, subtitle, body }) =>
  printDocument({
    title,
    html: `<div class="awPrint"><h1>${esc(title)}</h1><div class="sub">${esc(subtitle)}</div>${body}<div class="foot">Printed from Appward 98 (an unofficial retro tribute) on ${esc(new Date().toLocaleString())}</div></div>`,
    css: STYLE,
    page: "margin: 0.5in",
  })

// a CSV download (Report Builder's Export)
export const downloadText = (name, text, type = "text/csv") => {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement("a")
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const toCsv = (columns, rows) => [columns, ...rows].map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\r\n")
