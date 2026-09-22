'use strict'
// Run actual service functions with a fail-closed SQL double: invalid input must
// return the quantity error before a business write. No application config/DB is loaded.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const qty = require('../backend/src/utils/qtyPrecision')
const AppError = require('../backend/src/utils/AppError')

function service(relative, { allowDecimal = 1, status = 2, allowWrites = false, expectedQty = 10 } = {}) {
  const writes = []
  const conn = {
    beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release() {},
    async query(sql) {
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) { writes.push(sql); if (!allowWrites) throw new Error('unexpected business write'); return [{ affectedRows: 1 }] }
      if (sql.includes('product_items')) return [[{ id: 1, name: '测试商品', allow_decimal_qty: allowDecimal }]]
      if (sql.includes('SUM(expected_qty - received_qty)')) return [[{ remaining: 0 }]]
      if (sql.includes('return_task_items')) return [[{ id: 1, product_id: 1, expected_qty: expectedQty, received_qty: 0, checked_qty: 0 }]]
      if (sql.includes('inventory_check_items')) return [[{ id: 1, product_id: 1, book_qty: 2 }]]
      if (sql.includes('inventory_containers')) return [[1, 2].map(id => ({ id, barcode: `I${id}`, product_id: 1, warehouse_id: 1, status: 1, remaining_qty: 1, initial_qty: 2, container_type: 2 }))]
      if (sql.includes('sale_order_items')) return [[{ id: 1, product_id: 1, warehouse_id: 1, reserved_qty: 2 }]]
      throw new Error(`unexpected read: ${sql}`)
    },
  }
  const fallback = new Proxy({}, { get: () => () => {} })
  const filename = path.resolve(__dirname, '../backend/src', relative)
  const context = {
    module: { exports: {} }, console, Buffer, process: { env: { NODE_ENV: 'test' } },
    require(id) {
      if (id.endsWith('/qtyPrecision')) return qty
      if (id.endsWith('/AppError')) return AppError
      if (id.endsWith('/unitConversion')) return require('../backend/src/utils/unitConversion')
      if (id.endsWith('/db')) return { pool: { ...conn, getConnection: async () => conn } }
      if (id.endsWith('/operationRequest')) return { beginResourceOperationRequest: async () => ({}), beginOperationRequest: async () => ({}) }
      if (id.endsWith('/statusTransition')) return { lockStatusRow: async () => ({ id: 1, status, warehouse_id: 1 }), compareAndSetStatus: async () => { writes.push('status change'); if (!allowWrites) throw new Error('unexpected status write') } }
      if (id.endsWith('/containerEngine')) return { CONTAINER_STATUS: { ACTIVE: 1 }, SOURCE_TYPE: {}, createContainer: async () => ({ containerId: 1, barcode: 'I1' }) }
      if (id.endsWith('/statusRules')) return { assertStatusAction: () => ({}) }
      if (id.startsWith('node:')) return require(id)
      return fallback
    },
  }
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename })
  return { api: context.module.exports, conn, writes }
}

for (const [label, value, code, allowDecimal] of [
  ['超两位', 0.005, 'QTY_DECIMALS_EXCEEDED', 1],
  ['两箱小数合计整数', 0.5, 'QTY_INTEGER_REQUIRED', 0],
]) {
  for (const kind of ['inbound', 'return', 'stockcheck']) {
    test(`${kind} ${label}在业务写入前拒绝`, async () => {
      const files = { inbound: 'modules/inbound-tasks/inbound-tasks.command.js', return: 'modules/return-tasks/return-tasks.service.js', stockcheck: 'modules/stockcheck/stockcheck.service.js' }
      const { api, conn, writes } = service(files[kind], { allowDecimal })
      const result = kind === 'inbound' ? api.receive(1, { productId: 1, packages: [{ qty: value }, { qty: value }] })
        : kind === 'return' ? api.receive(conn, 1, { productId: 1, packages: [{ qty: value }, { qty: value }] })
          : api.saveItemContainerScans(1, 1, [{ barcode: 'I1', countedQty: value }, { barcode: 'I2', countedQty: value }], { userId: 1 })
      await assert.rejects(result, { code })
      assert.deepEqual(writes, [])
    })
  }
}
test('退货质检分别校验合格与不合格量，不允许小数相加绕过整数策略', async () => {
  const { api, conn, writes } = service('modules/return-tasks/return-tasks.service.js', { allowDecimal: 0, status: 3 })
  await assert.rejects(api.check(conn, 1, { productId: 1, passedQty: 0.5, rejectedQty: 0.5 }), { code: 'QTY_INTEGER_REQUIRED' })
  assert.deepEqual(writes, [])
})
test('释放预占拒绝三位数量，避免预计绑定与实际预占不同步', async () => {
  const { api, writes } = service('modules/sale/sale.service.js')
  await assert.rejects(api.releaseStock(1, { userId: 1 }, [{ id: 1, qty: 0.005 }]), { code: 'QTY_DECIMALS_EXCEEDED' })
  assert.deepEqual(writes, [])
})

test('退货首次收货也在状态推进前拒绝三位数量', async () => {
  const { api, conn, writes } = service('modules/return-tasks/return-tasks.service.js', { status: 1 })
  await assert.rejects(api.receive(conn, 1, { productId: 1, packages: [{ qty: 0.005 }] }), { code: 'QTY_DECIMALS_EXCEEDED' })
  assert.deepEqual(writes, [])
})
test('退货合法两箱0.1加0.2完整分配0.3，不误报超收0', async () => {
  const { api, conn } = service('modules/return-tasks/return-tasks.service.js', { expectedQty: 0.3, allowWrites: true })
  const result = await api.receive(conn, 1, { productId: 1, packages: [{ qty: 0.1 }, { qty: 0.2 }] })
  assert.equal(result.containers.length, 2)
  assert.equal(result.status, 3)
})
