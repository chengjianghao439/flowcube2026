const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const vm = require('node:vm')
const path = require('node:path')
const { createRequire } = require('node:module')
const filename = path.resolve(__dirname, '../backend/src/engine/containerEngine.js')
const localRequire = createRequire(filename)
const module_ = { exports: {} }
const stubs = { '../utils/logger': { warn() {}, info() {} }, '../utils/codeGenerator': {}, '../utils/expectedStock': {} }
vm.runInNewContext(fs.readFileSync(filename, 'utf8'), { module: module_, require: id => id in stubs ? stubs[id] : localRequire(id) }, { filename })
const engine = module_.exports

function inventory({ bound = 0, reserved = 8 } = {}) {
  let quantity = 10
  return { get quantity() { return quantity }, async query(sql, args) {
    if (sql.includes('sale_order_expected_bindings')) return [[{ qty: bound }]]
    if (sql.includes('SELECT COALESCE(quantity')) return [[{ qty: quantity, quantity, reserved }]]
    if (sql.includes('SELECT quantity FROM inventory_stock')) return [[{ quantity }]]
    if (sql.includes('SELECT remaining_qty')) return [[{ remaining_qty: quantity }]]
    if (sql.includes('SELECT id, barcode')) return [[{ id: 1, barcode: 'I1', remaining_qty: quantity }]]
    if (sql.includes('UPDATE inventory_containers')) { quantity = args[0]; return [{ affectedRows: 1 }] }
    if (sql.includes('SUM(remaining_qty)')) return [[{ total: quantity }]]
    if (sql.includes('INSERT INTO inventory_stock')) return [{ affectedRows: 1 }]
    throw Error(sql)
  } }
}
test('stockcheck loss cannot remove physical sales reservations', async () => {
  const conn = inventory()
  await assert.rejects(engine.adjustContainersForStockcheck(conn, { productId: 1, warehouseId: 2, diffQty: -5 }), e => e.code === 'STOCKCHECK_RESERVED_SHORTAGE')
  assert.equal(conn.quantity, 10)
})
test('expected bindings are not mistaken for physical reservations', async () => {
  const conn = inventory({ bound: 6 })
  await engine.adjustContainersForStockcheck(conn, { productId: 1, warehouseId: 2, diffQty: -5 })
  assert.equal(conn.quantity, 5)
})
test('container deduction rejects nonpositive quantities instead of changing their sign', async () => {
  for (const qty of [-1, 0]) {
    const conn = inventory()
    await assert.rejects(engine.deductFromContainers(conn, { productId: 1, warehouseId: 2, qty }), e => e.statusCode === 400)
    assert.equal(conn.quantity, 10)
  }
})
