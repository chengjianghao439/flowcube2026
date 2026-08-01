/**
 * 会计凭证导出（文档 10 · Phase 1）。复用 exceljs。
 * 可扩展模板层：format='generic' 通用记账凭证（清晰、通用可读，可再另存导入）；
 *   format='kingdee' 金蝶 KIS 风格列。用友/其它格式后续在此追加，不写死一家（设计 §11）。
 * 只导出未冲销(status<>3)的凭证；红字冲销凭证(is_reversal=1, status=1)会被正常导出。
 */
const ExcelJS = require('exceljs')
const { pool } = require('../../config/db')

function dateStr(v) {
  if (!v) return ''
  if (v instanceof Date) {
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`
  }
  return String(v).slice(0, 10)
}

async function fetchRows(period) {
  const where = ['v.status <> 3']
  const params = []
  if (period) { where.push('v.period = ?'); params.push(String(period)) }
  const [rows] = await pool.query(
    `SELECT v.voucher_no, v.voucher_date, v.summary AS v_summary, v.source_no,
            e.line_no, e.account_code, e.account_name, e.direction, e.amount,
            e.summary AS e_summary, e.aux_name
       FROM acct_vouchers v
       JOIN acct_voucher_entries e ON e.voucher_id = v.id
      WHERE ${where.join(' AND ')}
      ORDER BY v.voucher_date ASC, v.id ASC, e.line_no ASC`,
    params,
  )
  return rows
}

function styleHeader(row) {
  row.font = { bold: true }
  row.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFF3F8' } } })
}

function buildGeneric(wb, rows) {
  const ws = wb.addWorksheet('记账凭证')
  ws.columns = [
    { header: '日期', key: 'date', width: 12 },
    { header: '凭证号', key: 'no', width: 16 },
    { header: '摘要', key: 'exp', width: 28 },
    { header: '科目编码', key: 'code', width: 12 },
    { header: '科目名称', key: 'name', width: 16 },
    { header: '借方金额', key: 'debit', width: 14 },
    { header: '贷方金额', key: 'credit', width: 14 },
    { header: '往来单位', key: 'aux', width: 18 },
  ]
  styleHeader(ws.getRow(1))
  for (const r of rows) {
    const row = ws.addRow({
      date: dateStr(r.voucher_date),
      no: r.voucher_no,
      exp: r.e_summary || r.v_summary || '',
      code: r.account_code,
      name: r.account_name,
      debit: r.direction === 1 ? Number(r.amount) : null,
      credit: r.direction === 2 ? Number(r.amount) : null,
      aux: r.aux_name || '',
    })
    row.getCell('debit').numFmt = '#,##0.00'
    row.getCell('credit').numFmt = '#,##0.00'
  }
}

function buildKingdee(wb, rows) {
  const ws = wb.addWorksheet('凭证')
  // 金蝶 KIS 凭证导入常用列（不同版本略有差异，作为可编辑起点模板）
  ws.columns = [
    { header: '日期', key: 'date', width: 12 },
    { header: '凭证字', key: 'group', width: 8 },
    { header: '凭证号', key: 'num', width: 12 },
    { header: '分录号', key: 'entry', width: 8 },
    { header: '摘要', key: 'exp', width: 28 },
    { header: '科目代码', key: 'code', width: 12 },
    { header: '币别', key: 'cy', width: 8 },
    { header: '汇率', key: 'rate', width: 8 },
    { header: '方向', key: 'dc', width: 6 },
    { header: '金额', key: 'amount', width: 14 },
    { header: '往来单位', key: 'aux', width: 18 },
  ]
  styleHeader(ws.getRow(1))
  let curNo = null
  let entryId = 0
  for (const r of rows) {
    if (r.voucher_no !== curNo) { curNo = r.voucher_no; entryId = 0 }
    entryId += 1
    const num = (r.voucher_no || '').split('-').pop() || ''
    const row = ws.addRow({
      date: dateStr(r.voucher_date),
      group: '记',
      num,
      entry: entryId,
      exp: r.e_summary || r.v_summary || '',
      code: r.account_code,
      cy: 'RMB',
      rate: 1,
      dc: r.direction === 1 ? '借' : '贷',
      amount: Number(r.amount),
      aux: r.aux_name || '',
    })
    row.getCell('amount').numFmt = '#,##0.00'
  }
}

async function exportVouchers({ period, format = 'generic' }) {
  const rows = await fetchRows(period)
  const wb = new ExcelJS.Workbook()
  wb.creator = 'FlowCube'
  if (format === 'kingdee') buildKingdee(wb, rows)
  else buildGeneric(wb, rows)
  const buffer = await wb.xlsx.writeBuffer()
  const fname = `凭证导出_${period || '全部'}_${format === 'kingdee' ? '金蝶KIS' : '通用'}.xlsx`
  return { buffer, filename: fname, rowCount: rows.length }
}

module.exports = { exportVouchers }
