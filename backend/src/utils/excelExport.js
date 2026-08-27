const ExcelJS = require('exceljs')
const { beijingTodayYmd } = require('./backendTime')

/**
 * 日期列格式化为 YYYY-MM-DD。
 * mysql2 把 DATE/DATETIME 列返回成 JS Date 对象，直接 String(d).slice(0,10) 会截出
 * "Wed Jul 01" 这种英文格式；用 toISOString 又会转成 UTC 而整体差一天（连接池是 +08:00）。
 * 所以必须按本地时区逐段取。
 */
function ymd(value) {
  if (!value) return ''
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return String(value).slice(0, 10)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * 通用 xlsx 导出，直接写入 res 流
 * @param {object} res - Express response
 * @param {string} filename - 文件名（不含扩展名）
 * @param {string} sheetName - 工作表名
 * @param {Array<{header:string, key:string, width?:number}>} columns
 * @param {Array<object>} data
 */
async function exportXlsx(res, filename, sheetName, columns, data) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(sheetName)
  fillSheet(ws, columns, data, 1)

  await writeWorkbook(res, wb, filename)
}

/**
 * 单 sheet 渲染（表头 + 斑马纹 + 细边框），多 sheet 导出复用同一份样式。
 * @param {number} startRow - 表头所在行（1 起）；startRow>1 时其上方的行留给汇总块
 */
function fillSheet(ws, columns, data, startRow = 1) {
  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }))

  // 表头样式
  const headerRow = ws.getRow(startRow)
  headerRow.values = columns.map(c => c.header)
  headerRow.eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } } }
  })
  headerRow.height = 24

  data.forEach((row, i) => {
    ws.addRow(row)
    const r = ws.getRow(startRow + 1 + i)
    r.eachCell(cell => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } }
    })
    if (i % 2 === 1) {
      r.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } } }
      )
    }
  })
}

async function writeWorkbook(res, wb, filename) {
  const safeFilename = encodeURIComponent(filename)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}.xlsx`)
  await wb.xlsx.write(res)
  res.end()
}

/**
 * 多 sheet xlsx 导出。payload.sheets = [{ sheetName, columns, rows, summaryRows? }]，
 * summaryRows 为 [[label, value], ...]，渲染为该 sheet 头部一个两列加粗汇总块，
 * 汇总块下方空一行再接标准表格（表头 + 数据）。
 */
async function exportMultiSheetXlsx(res, filename, sheets) {
  const wb = new ExcelJS.Workbook()
  for (const sheet of sheets) {
    const ws = wb.addWorksheet(sheet.sheetName)
    ws.columns = sheet.columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }))
    let startRow = 1
    if (Array.isArray(sheet.summaryRows) && sheet.summaryRows.length) {
      sheet.summaryRows.forEach(([label, value], i) => {
        const r = i + 1
        const labelCell = ws.getCell(`A${r}`)
        labelCell.value = label
        labelCell.font = { bold: true }
        const valueCell = ws.getCell(`B${r}`)
        valueCell.value = value
        valueCell.font = { bold: true }
        ws.getRow(r).height = 20
      })
      // 汇总块末尾空一行，表头从 summaryRows.length + 2 行开始
      startRow = sheet.summaryRows.length + 2
    }
    fillSheet(ws, sheet.columns, sheet.rows || [], startRow)
  }
  await writeWorkbook(res, wb, filename)
}

/**
 * 对账单专用导出：带抬头、合计行与签章栏的正式单据格式，直接发给往来方核对。
 *
 * 与 exportXlsx 的普通「列+行」表格不同——那种适合内部查数，发给客户则需要
 * 单据抬头（谁跟谁、对哪段期间的账）和确认签章位，对方才能签字回传。
 *
 * @param {object} res
 * @param {object} meta   { title, statementNo, partyName, partyLabel, periodStart, periodEnd, remark }
 * @param {Array}  items  [{ orderNo, createdAt, dueDate, totalAmount, paidAmount, balance }]
 */
async function exportStatementXlsx(res, meta, items) {
  const wb = new ExcelJS.Workbook()
  const ws = wb.addWorksheet(meta.title)
  const COLS = ['A', 'B', 'C', 'D', 'E', 'F', 'G']
  ws.columns = [
    { key: 'idx', width: 6 }, { key: 'orderNo', width: 24 }, { key: 'createdAt', width: 14 },
    { key: 'dueDate', width: 14 }, { key: 'totalAmount', width: 16 },
    { key: 'paidAmount', width: 16 }, { key: 'balance', width: 16 },
  ]

  // ── 抬头 ──
  ws.mergeCells('A1:G1')
  const title = ws.getCell('A1')
  title.value = meta.title
  title.font = { bold: true, size: 18 }
  title.alignment = { horizontal: 'center', vertical: 'middle' }
  ws.getRow(1).height = 34

  const infoRows = [
    [`${meta.partyLabel}：${meta.partyName}`, `对账单号：${meta.statementNo}`],
    [
      `对账期间：${ymd(meta.periodStart) || '—'} 至 ${ymd(meta.periodEnd) || '—'}`,
      `打印日期：${beijingTodayYmd()}`,
    ],
  ]
  infoRows.forEach((pair, i) => {
    const r = 2 + i
    ws.mergeCells(`A${r}:D${r}`)
    ws.mergeCells(`E${r}:G${r}`)
    ws.getCell(`A${r}`).value = pair[0]
    ws.getCell(`E${r}`).value = pair[1]
    ws.getRow(r).height = 20
    ;['A', 'E'].forEach(c => { ws.getCell(`${c}${r}`).alignment = { vertical: 'middle' } })
  })

  // ── 表头 ──
  const headerRow = 5
  const headers = ['序号', '单据编号', '单据日期', '到期日', '金额', '已结', '未结余额']
  headers.forEach((h, i) => {
    const cell = ws.getCell(`${COLS[i]}${headerRow}`)
    cell.value = h
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'thin' }, left: { style: 'thin' }, right: { style: 'thin' } }
  })
  ws.getRow(headerRow).height = 24

  // ── 明细 ──
  const money = v => Number(v || 0)
  let total = 0, paid = 0, balance = 0
  items.forEach((it, i) => {
    const r = headerRow + 1 + i
    total += money(it.totalAmount); paid += money(it.paidAmount); balance += money(it.balance)
    const values = [
      i + 1, it.orderNo, ymd(it.createdAt), ymd(it.dueDate),
      money(it.totalAmount), money(it.paidAmount), money(it.balance),
    ]
    values.forEach((v, ci) => {
      const cell = ws.getCell(`${COLS[ci]}${r}`)
      cell.value = v
      cell.border = { top: { style: 'hair' }, bottom: { style: 'hair' }, left: { style: 'thin' }, right: { style: 'thin' } }
      if (ci >= 4) { cell.numFmt = '#,##0.00'; cell.alignment = { horizontal: 'right' } }
      else if (ci === 0) cell.alignment = { horizontal: 'center' }
    })
  })

  // ── 合计 ──
  const totalRow = headerRow + 1 + items.length
  ws.mergeCells(`A${totalRow}:D${totalRow}`)
  ws.getCell(`A${totalRow}`).value = '合计'
  ws.getCell(`A${totalRow}`).alignment = { horizontal: 'center', vertical: 'middle' }
  ;[total, paid, balance].forEach((v, i) => {
    const cell = ws.getCell(`${COLS[4 + i]}${totalRow}`)
    cell.value = v
    cell.numFmt = '#,##0.00'
    cell.alignment = { horizontal: 'right' }
  })
  for (const c of COLS) {
    const cell = ws.getCell(`${c}${totalRow}`)
    cell.font = { bold: true }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0F3F9' } }
    cell.border = { top: { style: 'thin' }, bottom: { style: 'double' }, left: { style: 'thin' }, right: { style: 'thin' } }
  }
  ws.getRow(totalRow).height = 22

  // ── 确认栏 ──
  let r = totalRow + 2
  if (meta.remark) {
    ws.mergeCells(`A${r}:G${r}`)
    ws.getCell(`A${r}`).value = `备注：${meta.remark}`
    r += 1
  }
  ws.mergeCells(`A${r}:G${r}`)
  ws.getCell(`A${r}`).value = '以上金额经双方核对，如无异议请签章确认后回传；如有异议请在收到后 3 个工作日内提出。'
  ws.getCell(`A${r}`).alignment = { vertical: 'middle', wrapText: true }
  ws.getRow(r).height = 22

  const signRow = r + 2
  ws.mergeCells(`A${signRow}:C${signRow}`)
  ws.mergeCells(`E${signRow}:G${signRow}`)
  ws.getCell(`A${signRow}`).value = '制单人：____________________'
  ws.getCell(`E${signRow}`).value = `${meta.partyLabel}签章：____________________`
  ws.getRow(signRow).height = 30

  const safeFilename = encodeURIComponent(`${meta.title}_${meta.partyName}_${meta.statementNo}`)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}.xlsx`)
  await wb.xlsx.write(res)
  res.end()
}

module.exports = { exportXlsx, exportStatementXlsx, exportMultiSheetXlsx, ymd }
