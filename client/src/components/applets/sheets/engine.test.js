// Sheets 98's formula engine: node --test client/src/components/applets/sheets/engine.test.js
import test from "node:test"
import assert from "node:assert/strict"
import * as S from "./engine.js"

const calc = (cells) => {
  const v = S.recalc(cells)
  return (a) => {
    const x = v.get(a)
    return S.isError(x) ? x.code : x
  }
}

test("addresses and columns", () => {
  assert.equal(S.colName(0), "A")
  assert.equal(S.colName(25), "Z")
  assert.equal(S.colName(26), "AA")
  assert.equal(S.colName(51), "AZ")
  assert.equal(S.colIndex("AZ"), 51)
  assert.deepEqual(S.parseAddr("$B$12"), { row: 11, col: 1 })
  assert.equal(S.parseAddr("ZZ1"), null)
  assert.equal(S.parseAddr("A0"), null)
  assert.equal(S.addr(0, 27), "AB1")
})

test("literals: numbers, money, percent, booleans, text", () => {
  assert.equal(S.parseLiteral("12"), 12)
  assert.equal(S.parseLiteral("-1,234.5"), -1234.5)
  assert.equal(S.parseLiteral("$4.50"), 4.5)
  assert.equal(S.parseLiteral("15%"), 0.15)
  assert.equal(S.parseLiteral("1e3"), 1000)
  assert.equal(S.parseLiteral("true"), true)
  assert.equal(S.parseLiteral("'12"), "12")
  assert.equal(S.parseLiteral("12 apples"), "12 apples")
  assert.equal(S.parseLiteral("1,23"), "1,23")
  assert.equal(S.parseLiteral(""), null)
  assert.equal(S.suggestedFormat("$4.50"), "currency")
  assert.equal(S.suggestedFormat("15%"), "percent")
  assert.equal(S.suggestedFormat("15"), null)
})

test("parsing and precedence", () => {
  const v = calc({ A1: "=1+2*3", A2: "=(1+2)*3", A3: "=2^3^2", A4: "=-2^2", A5: "=10/4", A6: "=50%*8", A7: '="a"&"b"&1', A8: "=1+2=3", A9: "=1<2", A10: '="abc"="ABC"', A11: "=3>=3", A12: "=2<>2", A13: "= 1 +  1 " })
  assert.equal(v("A1"), 7)
  assert.equal(v("A2"), 9)
  assert.equal(v("A3"), 64, "left to right like spreadsheets")
  assert.equal(v("A4"), 4, "unary minus binds tighter than ^ (as in Excel)")
  assert.equal(v("A5"), 2.5)
  assert.equal(v("A6"), 4)
  assert.equal(v("A7"), "ab1")
  assert.equal(v("A8"), true)
  assert.equal(v("A9"), true)
  assert.equal(v("A10"), true, "text compares without case")
  assert.equal(v("A11"), true)
  assert.equal(v("A12"), false)
  assert.equal(v("A13"), 2)
  for (const bad of ["=1+", "=(1", "=1)", "=SUM(1,", "=A1:", "=1 2", "=@", '="open'])
    assert.equal(calc({ A1: bad })("A1"), "#ERROR!", bad)
})

test("refs, ranges and the functions", () => {
  const v = calc({
    A1: "10", A2: "20", A3: "30", A4: "hello", A5: "",
    B1: "=SUM(A1:A5)", B2: "=AVERAGE(A1:A3)", B3: "=MIN(A1:A3)", B4: "=MAX(A1:A3)", B5: "=COUNT(A1:A5)", B6: "=COUNTA(A1:A5)",
    B7: '=IF(A1>5,"big","small")', B8: "=IF(A1<5,1)", B9: "=ROUND(2.675,2)", B10: "=ROUND(1234.5,-2)", B11: "=ROUND(-2.5)",
    B12: "=SUM(A1,A2,5)", B13: "=a1+$A$2", B14: "=SUM(A3:A1)", B15: "=AVERAGE(A4:A5)", B16: "=SUM(1,TRUE)",
    C1: "=ROUNDUP(1.21,1)", C2: "=ROUNDDOWN(-1.29,1)", C3: "=ABS(-3)", C4: "=MOD(-7,3)", C5: "=POWER(2,10)", C6: "=SQRT(16)",
    C7: "=AND(A1>1,A2>1)", C8: "=OR(FALSE,A1=10)", C9: "=NOT(A1=10)", C10: '=CONCATENATE("x",A1,"y")', C11: "=LEN(A4)", C12: '=UPPER("ab")&LOWER("CD")', C13: '=TRIM("  a   b ")', C14: "=INT(-1.5)",
  })
  assert.equal(v("B1"), 60, "text in a range is skipped")
  assert.equal(v("B2"), 20)
  assert.equal(v("B3"), 10)
  assert.equal(v("B4"), 30)
  assert.equal(v("B5"), 3)
  assert.equal(v("B6"), 4)
  assert.equal(v("B7"), "big")
  assert.equal(v("B8"), false)
  assert.equal(v("B9"), 2.68)
  assert.equal(v("B10"), 1200)
  assert.equal(v("B11"), -3, "half away from zero")
  assert.equal(v("B12"), 35)
  assert.equal(v("B13"), 30, "refs ignore case")
  assert.equal(v("B14"), 60, "backwards ranges")
  assert.equal(v("B15"), "#DIV/0!")
  assert.equal(v("B16"), 2)
  assert.deepEqual(["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12", "C13", "C14"].map(v), [1.3, -1.2, 3, 2, 1024, 4, true, true, false, "x10y", 5, "ABcd", "a b", -2])
})

test("errors: #DIV/0!, #VALUE!, #NAME?, #REF!, #NUM!, and they spread", () => {
  const v = calc({ A1: "=1/0", A2: "=A1+1", A3: '="a"*2', A4: "=FOO(1)", A5: "=nope", A6: "=SQRT(-1)", A7: "=ROUND(1,2,3)", A8: "=SUM(A1:A2)", A9: "=IF(TRUE,1,A1)", A10: "=10^400", A11: "=A2:A3" })
  assert.equal(v("A1"), "#DIV/0!")
  assert.equal(v("A2"), "#DIV/0!")
  assert.equal(v("A3"), "#VALUE!")
  assert.equal(v("A4"), "#NAME?")
  assert.equal(v("A5"), "#NAME?")
  assert.equal(v("A6"), "#NUM!")
  assert.equal(v("A7"), "#VALUE!")
  assert.equal(v("A8"), "#DIV/0!")
  assert.equal(v("A9"), 1, "only the branch taken is worked out")
  assert.equal(v("A10"), "#NUM!")
  assert.equal(v("A11"), "#VALUE!")
})

test("cycles: direct, indirect, through ranges; the rest of the sheet still works", () => {
  const v = calc({ A1: "=A1+1", B1: "=C1", C1: "=D1", D1: "=B1*2", E1: "=B1+1", F1: "=SUM(F2:F3)", F2: "1", F3: "=F1", G1: "5", G2: "=G1*2" })
  assert.equal(v("A1"), "#CYCLE!")
  assert.equal(v("B1"), "#CYCLE!")
  assert.equal(v("C1"), "#CYCLE!")
  assert.equal(v("D1"), "#CYCLE!")
  assert.equal(v("E1"), "#CYCLE!", "depends on a cycle")
  assert.equal(v("F1"), "#CYCLE!")
  assert.equal(v("F3"), "#CYCLE!")
  assert.equal(v("F2"), 1)
  assert.equal(v("G2"), 10)
  // in any order of evaluation
  const order = calc({ Z9: "=B1", B1: "=C1", C1: "=B1", A1: "=2+2" })
  assert.equal(order("Z9"), "#CYCLE!")
  assert.equal(order("A1"), 4)
  // fixing it recalculates
  const fixed = calc({ B1: "=C1", C1: "=D1", D1: "3", E1: "=B1+1" })
  assert.equal(fixed("E1"), 4)
})

test("copying formulas: relative refs move, $ parts stay, off the sheet is #REF!", () => {
  assert.equal(S.shiftFormula("=A1+B2", 1, 1), "=B2+C3")
  assert.equal(S.shiftFormula("=$A$1+A$1+$A1", 2, 3), "=$A$1+D$1+$A3")
  assert.equal(S.shiftFormula("=SUM(A1:A3)*2", 0, 2), "=SUM(C1:C3)*2")
  assert.equal(S.shiftFormula('="A1"&A1', 1, 0), '="A1"&A2', "text isn't touched")
  assert.equal(S.shiftFormula("=A1", -1, 0), "=#REF!")
  assert.equal(S.shiftFormula("hello A1", 1, 1), "hello A1")
  assert.equal(calc({ A1: S.shiftFormula("=A1", -1, 0) })("A1"), "#ERROR!")
  // a block pasted lower down
  const cells = { A1: "1", A2: "2", B1: "=A1*10", B2: "=$A$1+A2" }
  const block = S.copyBlock(cells, S.rangeOf({ row: 0, col: 1 }, { row: 1, col: 1 }))
  const pasted = S.pasteBlock(block, 5, 2)
  assert.deepEqual(pasted, { C6: "=B6*10", C7: "=$A$1+B7" })
})

test("formats", () => {
  assert.equal(S.display(1234.5, "number"), "1,234.50")
  assert.equal(S.display(1234.5, "currency"), "$1,234.50")
  assert.equal(S.display(-3, "currency"), "-$3.00")
  assert.equal(S.display(0.125, "percent"), "12.5%")
  assert.equal(S.display(1234.56, "integer"), "1,235")
  assert.equal(S.display(0.1 + 0.2), "0.3")
  assert.equal(S.display(1 / 3), "0.3333333333")
  assert.equal(S.display(true), "TRUE")
  assert.equal(S.display(S.ERRORS.div0), "#DIV/0!")
  assert.equal(S.display(12345678901234), "12345678901234")
  assert.equal(S.display(1.5e20), "1.5e+20")
  assert.equal(S.display(123456789012.5), "1.23457e+11")
  assert.equal(S.display(null), "")
})

test("CSV: quotes, commas, line breaks, round trip", () => {
  const rows = S.parseCsv('name,note,amount\r\n"Smith, Jo","said ""hi""\nthen left",12.5\nlast,,\n')
  assert.deepEqual(rows, [["name", "note", "amount"], ["Smith, Jo", 'said "hi"\nthen left', "12.5"], ["last", "", ""]])
  assert.deepEqual(S.parseCsv(S.toCsv(rows)), rows)
  assert.deepEqual(S.parseCsv("﻿a,b"), [["a", "b"]], "byte order mark")
  // a sheet -> CSV keeps values (formulas as results) -> back
  const sheet = { cells: { A1: "Item", B1: "Cost", A2: "Pizza, large", B2: "12.5", A3: "Tip", B3: "=B2*20%", A4: "Total", B4: "=SUM(B2:B3)", C4: "=1/3" }, formats: { B4: "currency" } }
  const csv = S.sheetToCsv(sheet)
  assert.equal(csv, 'Item,Cost,\r\n"Pizza, large",12.5,\r\nTip,2.5,\r\nTotal,$15.00,0.3333333333333333\r\n')
  const back = S.csvToSheet(csv)
  assert.equal(back.cells.A2, "Pizza, large")
  assert.equal(calc(back.cells)("B4"), 15)
  // formulas in a CSV stay text
  assert.equal(S.csvToSheet("=1+1,x").cells.A1, "'=1+1")
  assert.equal(calc(S.csvToSheet("=1+1,x").cells)("A1"), "=1+1")
})

test("the .sheet file: round trip, refuses junk, cleans what it reads", () => {
  const sheet = { cells: { A1: "1", B1: "=A1*2" }, formats: { B1: "currency" }, widths: { 1: 120 }, chart: null }
  const back = S.deserialize(S.serialize(sheet))
  assert.deepEqual(back, sheet)
  assert.throws(() => S.deserialize('{"app":"Other"}'))
  assert.throws(() => S.deserialize("not json"))
  const dirty = S.deserialize(JSON.stringify({ app: "Sheets 98", cells: { a1: "x", ZZZ9: "y", B2: 5, C3: "" }, formats: { A1: "weird", B1: "percent" }, widths: { 0: 9999, x: 3 } }))
  assert.deepEqual(dirty, { cells: { A1: "x" }, formats: { B1: "percent" }, widths: { 0: 400 }, chart: null })
})

test("a 200 x 26 sheet recalculates quickly", () => {
  const cells = {}
  for (let r = 0; r < 200; r++) {
    cells[S.addr(r, 0)] = String(r)
    for (let c = 1; c < 26; c++) cells[S.addr(r, c)] = `=${S.addr(r, c - 1)}+1`
  }
  cells.A201 = "=SUM(A1:Z200)"
  const t = performance.now()
  const v = S.recalc(cells)
  assert.ok(performance.now() - t < 500)
  assert.equal(v.get("Z200"), 199 + 25)
})
