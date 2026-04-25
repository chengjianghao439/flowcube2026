#!/usr/bin/env node
require('dotenv').config()

const { pool } = require('../src/config/db')
const { WT_STATUS } = require('../src/constants/warehouseTaskStatus')
const { addItem } = require('../src/modules/packages/packages.service')

const runId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`
const prefix = `__pkg_guard_${runId}`
const taskPrefix = `PG${Date.now().toString(36).slice(-8)}`
const createdTaskIds = []
const createdProductIds = []

async function createProduct(codeSuffix) {
  const code = `${prefix}_${codeSuffix}`
  const [result] = await pool.query(
    `INSERT INTO product_items (code, name, unit, is_active)
     VALUES (?, ?, '件', 1)`,
    [code, `装箱并发测试商品 ${codeSuffix}`],
  )
  const product = {
    id: Number(result.insertId),
    code,
    name: `装箱并发测试商品 ${codeSuffix}`,
    unit: '件',
  }
  createdProductIds.push(product.id)
  return product
}

async function createPackingTask(items) {
  const taskNo = `${taskPrefix}_${createdTaskIds.length + 1}`
  const [taskResult] = await pool.query(
    `INSERT INTO warehouse_tasks
       (task_no, sale_order_id, sale_order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, priority)
     VALUES (?, 0, ?, 0, '装箱并发测试客户', 1, '装箱并发测试仓', ?, 2)`,
    [taskNo, taskNo, WT_STATUS.PACKING],
  )
  const taskId = Number(taskResult.insertId)
  createdTaskIds.push(taskId)

  for (const item of items) {
    await pool.query(
      `INSERT INTO warehouse_task_items
         (task_id, product_id, product_code, product_name, unit, required_qty, picked_qty, checked_qty)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [taskId, item.product.id, item.product.code, item.product.name, item.product.unit, item.requiredQty, item.requiredQty, item.checkedQty],
    )
  }

  return taskId
}

async function createPackage(taskId) {
  const tempBarcode = `PG${Date.now().toString(36).slice(-6)}${String(taskId).slice(-4)}`
  const [result] = await pool.query(
    'INSERT INTO packages (barcode, warehouse_task_id, remark) VALUES (?, ?, ?)',
    [tempBarcode, taskId, 'package add-item guard regression'],
  )
  const id = Number(result.insertId)
  await pool.query('UPDATE packages SET barcode=? WHERE id=?', [`L${String(id).padStart(6, '0')}`, id])
  return id
}

async function getPackedQty(taskId, productId) {
  const [[row]] = await pool.query(
    `SELECT COALESCE(SUM(pi.qty), 0) AS qty
     FROM package_items pi
     INNER JOIN packages p ON p.id = pi.package_id
     WHERE p.warehouse_task_id=? AND pi.product_id=?`,
    [taskId, productId],
  )
  return Number(row.qty)
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function assertOverpacked(error) {
  assert(error?.code === 'PACKAGE_ITEM_OVERPACKED', `expected PACKAGE_ITEM_OVERPACKED, got ${error?.code || error?.message}`)
}

async function testNormalAndDuplicate() {
  const product = await createProduct('normal_dup')
  const taskId = await createPackingTask([{ product, requiredQty: 1, checkedQty: 1 }])
  const packageId = await createPackage(taskId)

  const added = await addItem(packageId, { productCode: product.code, qty: 1 })
  assert(added.qty === 1, 'normal add should add qty=1')

  try {
    await addItem(packageId, { productCode: product.code, qty: 1 })
    throw new Error('duplicate add should fail')
  } catch (error) {
    assertOverpacked(error)
  }

  assert(await getPackedQty(taskId, product.id) === 1, 'duplicate add must not change packed qty')
}

async function testConcurrentDuplicate() {
  const product = await createProduct('concurrent')
  const taskId = await createPackingTask([{ product, requiredQty: 1, checkedQty: 1 }])
  const packageId = await createPackage(taskId)

  const settled = await Promise.allSettled([
    addItem(packageId, { productCode: product.code, qty: 1 }),
    addItem(packageId, { productCode: product.code, qty: 1 }),
  ])
  const successes = settled.filter(r => r.status === 'fulfilled')
  const failures = settled.filter(r => r.status === 'rejected')

  assert(successes.length === 1, `concurrent add should have exactly one success, got ${successes.length}`)
  assert(failures.length === 1, `concurrent add should have exactly one failure, got ${failures.length}`)
  assertOverpacked(failures[0].reason)
  assert(await getPackedQty(taskId, product.id) === 1, 'concurrent add must leave packed qty at 1')
}

async function testCheckedQtyLimit() {
  const product = await createProduct('checked_limit')
  const taskId = await createPackingTask([{ product, requiredQty: 2, checkedQty: 1 }])
  const packageId = await createPackage(taskId)

  try {
    await addItem(packageId, { productCode: product.code, qty: 2 })
    throw new Error('add above checked qty should fail')
  } catch (error) {
    assertOverpacked(error)
  }

  assert(await getPackedQty(taskId, product.id) === 0, 'checked qty guard must reject the whole overpacked write')
}

async function testDifferentProducts() {
  const productA = await createProduct('product_a')
  const productB = await createProduct('product_b')
  const taskId = await createPackingTask([
    { product: productA, requiredQty: 1, checkedQty: 1 },
    { product: productB, requiredQty: 2, checkedQty: 2 },
  ])
  const packageId = await createPackage(taskId)

  await addItem(packageId, { productCode: productA.code, qty: 1 })
  await addItem(packageId, { productCode: productB.code, qty: 2 })

  assert(await getPackedQty(taskId, productA.id) === 1, 'product A packed qty should be 1')
  assert(await getPackedQty(taskId, productB.id) === 2, 'product B packed qty should be 2')
}

async function cleanup() {
  if (createdTaskIds.length) {
    await pool.query(
      `DELETE pi FROM package_items pi
       INNER JOIN packages p ON p.id = pi.package_id
       WHERE p.warehouse_task_id IN (${createdTaskIds.map(() => '?').join(',')})`,
      createdTaskIds,
    )
    await pool.query(`DELETE FROM packages WHERE warehouse_task_id IN (${createdTaskIds.map(() => '?').join(',')})`, createdTaskIds)
    await pool.query(`DELETE FROM warehouse_task_items WHERE task_id IN (${createdTaskIds.map(() => '?').join(',')})`, createdTaskIds)
    await pool.query(`DELETE FROM warehouse_tasks WHERE id IN (${createdTaskIds.map(() => '?').join(',')})`, createdTaskIds)
  }
  if (createdProductIds.length) {
    await pool.query(`DELETE FROM product_items WHERE id IN (${createdProductIds.map(() => '?').join(',')})`, createdProductIds)
  }
}

async function main() {
  try {
    await testNormalAndDuplicate()
    console.log('ok normal add + duplicate overpack guard')
    await testConcurrentDuplicate()
    console.log('ok concurrent duplicate overpack guard')
    await testCheckedQtyLimit()
    console.log('ok checked qty is enforced as packable limit')
    await testDifferentProducts()
    console.log('ok different products remain packable independently')
  } finally {
    await cleanup()
    await pool.end()
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
