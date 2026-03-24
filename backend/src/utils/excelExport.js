const ExcelJS = require('exceljs')

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

  ws.columns = columns.map(c => ({ header: c.header, key: c.key, width: c.width || 18 }))

  // 表头样式
  ws.getRow(1).eachCell(cell => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } }
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4472C4' } }
    cell.alignment = { horizontal: 'center', vertical: 'middle' }
    cell.border = { bottom: { style: 'thin', color: { argb: 'FFAAAAAA' } } }
  })
  ws.getRow(1).height = 24

  data.forEach((row, i) => {
    ws.addRow(row)
    const r = ws.getRow(i + 2)
    r.eachCell(cell => {
      cell.border = { bottom: { style: 'hair', color: { argb: 'FFDDDDDD' } } }
    })
    if (i % 2 === 1) {
      r.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F7FA' } } }
      )
    }
  })

  const safeFilename = encodeURIComponent(filename)
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${safeFilename}.xlsx`)
  await wb.xlsx.write(res)
  res.end()
}

module.exports = { exportXlsx }
