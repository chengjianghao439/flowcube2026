const test = require('node:test')
const assert = require('node:assert/strict')

const { SETTLEMENT_TYPE, buildDueDateSql } = require('../backend/src/constants/settlementType')
const { beijingTodayYmd } = require('../backend/src/utils/backendTime')

test('monthly due date uses the Beijing settlement date independent of the database session timezone', () => {
  const due = buildDueDateSql(SETTLEMENT_TYPE.MONTHLY, 30, '2020-01-01')
  assert.equal(due.expr, 'DATE_ADD(DATE(?), INTERVAL ? DAY)')
  assert.deepEqual(due.params, [beijingTodayYmd(), 30])
})

test('cash due date still uses the source document creation date', () => {
  const createdAt = '2026-09-01'
  const due = buildDueDateSql(SETTLEMENT_TYPE.CASH, 0, createdAt)
  assert.equal(due.expr, 'DATE_ADD(DATE(?), INTERVAL ? DAY)')
  assert.deepEqual(due.params, [createdAt, 0])
})
