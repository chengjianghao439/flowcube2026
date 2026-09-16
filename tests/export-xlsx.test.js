'use strict'
/**
 * 导出 Excel 的单元格格式回归（纯函数 + exceljs，无数据库）。
 *
 * 2026-09-16：生产导出的日期列曾是 exceljs 默认的 `mm-dd-yy`（英文习惯），
 * 而同一份表里用 DATE_FORMAT 生成的字符串列是 `yyyy-mm-dd HH:mm`，两种格式并存；
 * 「创建时间」还因为被 DATE_FORMAT 成字符串而在 Excel 里无法排序/筛选。
 *
 * 现行规则：`fillSheet`（普通导出与多 sheet 导出共用）遇到 Date 值统一指定数字格式——
 * 纯日期 `yyyy-mm-dd`、带时分秒 `yyyy-mm-dd hh:mm`，**保留日期单元格类型**，
 * 从而在 Excel 里可排序可筛选；已是字符串的列原样输出，不二次处理。
 */
const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const ExcelJS = require(path.join(__dirname, '../backend/node_modules/exceljs'))
const { exportXlsx } = require('../backend/src/utils/excelExport')

/** 收集导出流为 Buffer 的假响应对象 */
function fakeRes() {
  const chunks = []
  return {
    chunks,
    setHeader() {},
    end() {},
    on() {}, once() {}, emit() {}, removeListener() {},
    writable: true,
    write(chunk) { chunks.push(Buffer.from(chunk)); return true },
  }
}

async function exportToWorksheet(columns, rows) {
  const res = fakeRes()
  await exportXlsx(res, 'test', 'S', columns, rows)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(Buffer.concat(res.chunks))
  return wb.worksheets[0]
}

const COLUMNS = [
  { header: '销售日期', key: 'd', width: 14 },
  { header: '创建时间', key: 't', width: 20 },
  { header: '已格式化文本', key: 's', width: 20 },
]

test('日期列写成日期单元格，并指定 yyyy-mm-dd / yyyy-mm-dd hh:mm 数字格式', async () => {
  const ws = await exportToWorksheet(COLUMNS, [
    { d: new Date(2026, 8, 16), t: new Date(2026, 8, 16, 19, 55), s: '2026-09-16 19:55' },
  ])
  const row = ws.getRow(2)

  const dateCell = row.getCell(1)
  assert.equal(dateCell.type, 4, '纯日期应是日期类型单元格（type=4），不是文本')
  assert.equal(dateCell.numFmt, 'yyyy-mm-dd', `纯日期格式应为 yyyy-mm-dd，实际 ${dateCell.numFmt}`)

  const timeCell = row.getCell(2)
  assert.equal(timeCell.type, 4, '带时间的日期应是日期类型单元格')
  assert.equal(timeCell.numFmt, 'yyyy-mm-dd hh:mm', `带时间格式应为 yyyy-mm-dd hh:mm，实际 ${timeCell.numFmt}`)

  // 已经是字符串的列原样输出（DATE_FORMAT 生成的那些列不应被二次处理）
  const textCell = row.getCell(3)
  assert.equal(textCell.value, '2026-09-16 19:55')
  assert.equal(textCell.numFmt, undefined, '字符串列不应被赋予日期格式')
})

test('零时刻的日期不为它加时分（避免纯日期列显示成 00:00）', async () => {
  const ws = await exportToWorksheet(COLUMNS, [
    { d: new Date(2026, 0, 1), t: new Date(2026, 0, 1, 0, 0, 0), s: '' },
  ])
  const row = ws.getRow(2)
  assert.equal(row.getCell(1).numFmt, 'yyyy-mm-dd')
  assert.equal(row.getCell(2).numFmt, 'yyyy-mm-dd', '午夜时刻视为纯日期')
})

test('非日期值不被打扰（金额/字符串保持原值与原类型）', async () => {
  const ws = await exportToWorksheet([{ header: '金额', key: 'amt', width: 14 }], [{ amt: 358.43 }])
  const cell = ws.getRow(2).getCell(1)
  assert.equal(cell.value, 358.43)
  assert.equal(cell.numFmt, undefined)
})
