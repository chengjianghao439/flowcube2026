'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('../backend/node_modules/exceljs')
const { parseBudgetedRows } = require('../backend/src/modules/import/importBudget')

test('bounded customer parsing accepts optional address and rejects an eighth column', async () => {
  const valid = Buffer.from('code,name,contact,phone,settlement,credit,address\nC1,fixture,,010-12345678,01,0,address\n')
  const rows = await parseBudgetedRows(valid, { entity: 'customers', preserveSettlementLexeme: true })
  assert.equal(rows[1][4], '01')
  assert.equal(rows[1][6], 'address')
  await assert.rejects(parseBudgetedRows(Buffer.from('a,b,c,d,e,f,g,h\n1,2,3,4,5,6,7,8\n'), { entity: 'customers' }), e => e.code === 'IMPORT_BUDGET_EXCEEDED')
})

test('bounded XLSX parsing retains source rows only when profile imports request them', async () => {
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('fixture')
  sheet.addRow(['code', 'name', 'contact', 'phone', 'settlement', 'credit'])
  sheet.getRow(4).values = ['C1', 'fixture', '', '', '01', 0]
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer())
  const preserved = await parseBudgetedRows(buffer, { entity: 'customers', preserveSettlementLexeme: true, preserveRowNumbers: true })
  assert.equal(preserved.length, 4)
  assert.equal(preserved[3][0], 'C1')
  assert.equal(preserved[3][4], '01')
  const compact = await parseBudgetedRows(buffer, { entity: 'customers', preserveSettlementLexeme: true })
  assert.equal(compact.length, 2)
  assert.equal(compact[1][0], 'C1')
})
