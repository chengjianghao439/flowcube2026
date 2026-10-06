// Separate process with a V8 heap cap; parent kills it at the wall-clock deadline.
const ExcelJS = require('exceljs')
const { Readable } = require('node:stream')
const { inflateRawSync } = require('node:zlib')
const crc32 = require('jszip/lib/crc32')
const { SaxesParser } = require('saxes')
const fastCsv = require('fast-csv')
function exceed() { const e = new Error('budget'); e.code = 'IMPORT_BUDGET_EXCEEDED'; throw e }
function columnNumber(letters) { let result = 0; for (const c of letters.toUpperCase()) result = result * 26 + c.charCodeAt(0) - 64; return result }
function preflightXml(xml, worksheet, shape, limits) {
  const parser = new SaxesParser()
  let cells = 0, rows = 0, text = 0, depth = 0
  parser.on('opentag', tag => {
    const name = tag.name.split(':').at(-1)
    if (worksheet && name === 'dimension') {
      for (const part of String(tag.attributes.ref || '').split(':')) {
        const m = /^([A-Z]+)(\d+)$/i.exec(part)
        if (!m || columnNumber(m[1]) > shape.columns || Number(m[2]) > limits.rows) exceed()
      }
    }
    if (worksheet && name === 'row' && (++rows > limits.rows || Number(tag.attributes.r) > limits.rows)) exceed()
    if (worksheet && name === 'c') {
      const m = /^([A-Z]+)(\d+)$/i.exec(String(tag.attributes.r || ''))
      if (++cells > limits.rows * shape.columns || !m || columnNumber(m[1]) > shape.columns || Number(m[2]) > limits.rows) exceed()
    }
    if (name === 't') { depth++; text = 0 }
  })
  parser.on('text', value => { if (depth && (text += value.length) > limits.stringChars) exceed() })
  parser.on('closetag', tag => { if (tag.name.split(':').at(-1) === 't') depth-- })
  parser.write(xml).close()
}
function normalized(value) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return value
  if (typeof value === 'object') {
    if (typeof value.text === 'string') return value.text
    if (Array.isArray(value.richText)) return value.richText.map(p => p.text).join('')
    if (value.result !== undefined) return value.result
    return ''
  }
  return value
}
// Streaming preflight bounds CSV records before ExcelJS materializes the worksheet.
async function preflightCsv(buffer, shape, limits) {
  await new Promise((resolve, reject) => {
    let rows = 0, cells = 0, strings = 0
    const parser = fastCsv.parse()
    const input = Readable.from(buffer.toString('utf8'))
    parser.on('data', row => {
      try {
        if (++rows > limits.rows || row.length > shape.columns) exceed()
        cells += row.length
        if (cells > limits.rows * shape.columns) exceed()
        for (const value of row) {
          strings += Buffer.byteLength(value)
          if (value.length > limits.stringChars || strings > limits.stringBytes) exceed()
        }
      } catch (e) { parser.destroy(e); input.destroy() }
    })
    parser.once('error', reject); parser.once('end', resolve)
    input.pipe(parser)
  })
}
async function parse({ buffer, entries, shape, limits, preserveSettlementLexeme, preserveRowNumbers }) {
  let expanded = 0, sheetEntries = 0
  if (entries) {
    for (const entry of entries) {
      const packed = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressed)
      const raw = entry.method === 0 ? packed : inflateRawSync(packed, { maxOutputLength: Math.min(limits.entryBytes, entry.expanded + 1) })
      if (raw.length !== entry.expanded || (crc32(raw) >>> 0) !== entry.crc) throw new Error('invalid ZIP metadata')
      expanded += raw.length
      if (expanded > limits.expandedBytes) exceed()
      const worksheet = /^xl\/worksheets\/[^/]+\.xml$/i.test(entry.name)
      if (worksheet && ++sheetEntries > shape.sheets) exceed()
      if (worksheet || entry.name === 'xl/sharedStrings.xml') preflightXml(raw.toString('utf8'), worksheet, shape, limits)
    }
  }
  const workbook = new ExcelJS.Workbook()
  if (entries) await workbook.xlsx.load(buffer)
  else {
    await preflightCsv(buffer, shape, limits)
    // Keep ExcelJS's original numeric/date/error coercion; customer/supplier fields
    // alone preserve raw lexemes for the strict settlement-type validator.
    await workbook.csv.read(Readable.from(buffer.toString('utf8')), preserveSettlementLexeme ? { map: value => value } : undefined)
  }
  if (workbook.worksheets.length > shape.sheets) exceed()
  let cells = 0, stringBytes = 0
  for (const sheet of workbook.worksheets) {
    if (sheet.rowCount > limits.rows || sheet.columnCount > shape.columns) exceed()
    sheet.eachRow({ includeEmpty: false }, row => {
      if (row.number > limits.rows || row.cellCount > shape.columns) exceed()
      row.eachCell({ includeEmpty: false }, cell => {
        if (++cells > limits.rows * shape.columns * shape.sheets) exceed()
        const value = normalized(cell.value)
        if (typeof value === 'string') {
          stringBytes += Buffer.byteLength(value)
          if (value.length > limits.stringChars || stringBytes > limits.stringBytes) exceed()
        }
      })
    })
  }
  const sheet = workbook.worksheets[0], rows = []
  if (sheet) sheet.eachRow({ includeEmpty: false }, row => {
    const out = []
    for (let c = 1; c <= sheet.columnCount; c++) {
      const value = row.getCell(c).value
      out.push(preserveSettlementLexeme && c === 5 && value && typeof value === 'object' && value.error ? String(value.error) : normalized(value))
    }
    if (preserveRowNumbers) rows[row.number - 1] = out
    else rows.push(out)
  })
  return rows
}
process.once('message', async data => {
  try { process.send({ rows: await parse(data) }, () => { process.disconnect() }) }
  catch (e) { process.send({ error: e.code === 'IMPORT_BUDGET_EXCEEDED' || e.code === 'ERR_BUFFER_TOO_LARGE' ? 'IMPORT_BUDGET_EXCEEDED' : 'IMPORT_FILE_INVALID' }, () => { process.disconnect() }) }
})
