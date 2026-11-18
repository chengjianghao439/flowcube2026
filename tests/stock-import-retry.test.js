'use strict'

const assert = require('node:assert/strict')
const crypto = require('node:crypto')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')
const AppError = require('../backend/src/utils/AppError')

const importDir = path.resolve(__dirname, '../backend/src/modules/import')
const options = { fileBuffer: Buffer.from('fixture stock A and B'), originalName: 'opening.csv', operator: { userId: 11 }, scopeWarehouseIds: [1], requestKey: 'fixture-key' }
const batchRows = [['code', 'warehouse', 'qty'], ['A', 1, 10], ['B', 1, 7]]

function fixture({ inputRows = batchRows, failSecondConnection = true, rejectFirstMovement = false } = {}) {
  const stock = new Map([['A', 0], ['B', 0]])
  const runs = new Map(), rows = new Map(), movements = []
  let batches = 0, failNext = false, movementAttempts = 0
  const batchKey = (userId, requestKey) => JSON.stringify([userId, requestKey])
  const rowKey = (batchId, index) => JSON.stringify([batchId, index])
  async function query(sql, values = []) {
    const normalized = sql.replace(/\s+/g, ' ').trim()
    if (normalized.startsWith('INSERT INTO inventory_import_batches')) return [{ insertId: ++batches }]
    if (normalized.startsWith('SELECT batch_id')) return [runs.has(batchKey(...values)) ? [runs.get(batchKey(...values))] : []]
    if (normalized.startsWith('INSERT INTO inventory_stock_import_runs')) {
      const [userId, requestKey, batchId, hash, warehouses, rowTotal] = values
      runs.set(batchKey(userId, requestKey), { batch_id: batchId, body_sha256: hash, warehouse_ids: JSON.parse(warehouses), total_rows: rowTotal })
      return [{ affectedRows: 1 }]
    }
    if (normalized.startsWith('SELECT row_index, applied')) return [[...rows.values()].filter(r => r.batch_id === values[0])]
    if (normalized.startsWith('SELECT id, name, unit FROM product_items')) return [stock.has(values[0]) ? [{ id: values[0], name: values[0], unit: '件' }] : []]
    if (normalized.startsWith('SET TRANSACTION ISOLATION LEVEL')) return [[]]
    if (normalized.startsWith('SELECT 1 FROM inventory_stock_import_rows')) {
      const [batchId, productId, warehouseId, index] = values
      return [[...rows.values()].filter(row => row.batch_id === batchId && row.productId === productId && row.warehouseId === warehouseId && row.row_index > index && row.applied)]
    }
    if (normalized.startsWith('SELECT id FROM inventory_warehouses')) return [[{ id: 1 }]]
    if (normalized.startsWith('SELECT applied FROM inventory_stock_import_rows')) {
      const row = rows.get(rowKey(...values))
      return [row ? [row] : []]
    }
    if (normalized.startsWith('INSERT INTO inventory_stock_import_rows')) {
      const [batchId, index, message] = values
      const key = rowKey(batchId, index)
      if (message?.length > 500) throw Error('fixture error summary exceeds VARCHAR capacity')
      if (!rows.has(key)) rows.set(key, { batch_id: batchId, row_index: index, applied: 0, error_message: message || null })
      else if (message && !rows.get(key).applied) rows.get(key).error_message = message
      return [{ affectedRows: 1 }]
    }
    if (normalized.startsWith('UPDATE inventory_stock_import_rows')) {
      const [batchId, index] = values.length === 2 ? values : values.slice(2)
      const row = rows.get(rowKey(batchId, index))
      if (values.length === 4) [row.productId, row.warehouseId] = values
      row.applied = 1
      row.error_message = null
      return [{ affectedRows: 1 }]
    }
    if (normalized.startsWith('UPDATE inventory_import_batches')) return [{ affectedRows: 1 }]
    assert.fail(normalized)
  }
  const pool = {
    query,
    async getConnection() {
      if (failNext) { failNext = false; throw Error('fixture second row connection unavailable') }
      return {
        query,
        async beginTransaction() {},
        async rollback() {},
        async commit() {
          if (!this.movement) return
          stock.set(this.movement.code, this.movement.after)
          movements.push(this.movement)
        },
        release() {},
      }
    },
  }
  const mocks = {
    'node:crypto': crypto,
    '../../config/db': { pool },
    '../../utils/AppError': AppError,
    './importBudget': { parseBudgetedRows: async () => inputRows },
    '../../utils/qtyPrecision': { assertQtyPrecision: async () => {} },
    '../../engine/inventoryEngine': { MOVE_TYPE: { STOCKCHECK: 'fixture' }, writeInventoryLog: async () => {} },
    '../../engine/containerEngine': {
      SOURCE_TYPE: { IMPORT: 'fixture' },
      async getStockProjection(_connection, params) { return { quantity: stock.get(params.productId) } },
      async adjustContainerStock(connection, params) {
        if (++movementAttempts === 1 && rejectFirstMovement) throw Error('first movement transient failure')
        const before = stock.get(params.productId)
        const after = before + params.qty
        connection.movement = { code: params.productId, after, batch: params.sourceRefId }
        if (failSecondConnection && movements.length === 0) failNext = true
        return { before, after, createdContainerId: 1, primaryDeductContainerId: 1 }
      },
    },
  }

  function load(name) {
    const file = path.join(importDir, name)
    const module = { exports: {} }
    vm.runInNewContext(fs.readFileSync(file, 'utf8'), {
      module, Buffer, require: id => id === './stockImportBatches' ? load('stockImportBatches.js') : mocks[id] ?? {},
    }, { filename: file })
    return module.exports
  }
  return { service: load('import.service.js'), stock, movements, batches: () => batches }
}

test('同一文件同键续传只执行未完成行，已提交的行不会覆盖期间的正常出库', async () => {
  const { service, stock, movements, batches } = fixture()
  await assert.rejects(service.importStock(options), /second row connection unavailable/)
  assert.equal(stock.get('A'), 10)
  assert.equal(stock.get('B'), 0)
  stock.set('A', 8)
  const retry = await service.importStock(options)
  assert.equal(retry.data.batchId, 1)
  assert.equal(retry.data.success, 2)
  assert.equal(stock.get('A'), 8)
  assert.equal(stock.get('B'), 7)
  assert.equal(movements.length, 2)
  assert.equal(batches(), 1)
})

test('部分成功后可查询进度；同键换文件或权限缩小时拒绝恢复及回放', async () => {
  const { service, stock, movements } = fixture()
  await assert.rejects(service.importStock(options), /second row connection unavailable/)
  const status = await service.getStockImportStatus(options)
  assert.equal(status.success, 1)
  assert.equal(status.totalRows, 2)
  assert.equal(status.batchId, 1)
  await assert.rejects(service.importStock({ ...options, fileBuffer: Buffer.from('other') }), { code: 'STOCK_IMPORT_CONTENT_CHANGED' })
  await assert.rejects(service.getStockImportStatus({ ...options, scopeWarehouseIds: [] }), { code: 'WAREHOUSE_SCOPE_DENIED' })
  await assert.rejects(service.importStock({ ...options, scopeWarehouseIds: [] }), { code: 'WAREHOUSE_SCOPE_DENIED' })
  assert.equal(stock.get('B'), 0)
  assert.equal(movements.length, 1)
})


test('补跑较早的同商品同仓行时，保留较晚行已经提交的库存目标', async () => {
  const { service, stock, movements } = fixture({
    inputRows: [batchRows[0], ['A', 1, 10], ['A', 1, 15]],
    failSecondConnection: false,
    rejectFirstMovement: true,
  })
  const first = await service.importStock(options)
  assert.equal(first.data.success, 1)
  assert.equal(stock.get('A'), 15)
  const retry = await service.importStock(options)
  assert.equal(retry.data.success, 2)
  assert.equal(stock.get('A'), 15)
  assert.equal(movements.length, 1)
})

test('超长编码的可读失败摘要有界，后续合法行仍正常入库', async () => {
  const { service, stock } = fixture({
    inputRows: [batchRows[0], ['x'.repeat(1800), 1, 10], batchRows[2]],
    failSecondConnection: false,
  })
  const result = await service.importStock(options)
  assert.equal(result.data.success, 1)
  assert.equal(stock.get('B'), 7)
  assert.equal(result.data.errors.length, 1)
  assert.match(result.data.errors[0], /第2行/)
  assert(result.data.errors[0].length <= 500)
})
