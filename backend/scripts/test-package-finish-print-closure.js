#!/usr/bin/env node
require('dotenv').config()

const { pool } = require('../src/config/db')
const AppError = require('../src/utils/AppError')
const printJobs = require('../src/modules/print-jobs/print-jobs.service')
const { normalizeJobType } = require('../src/modules/print-jobs/print-dispatch')
const { WT_STATUS } = require('../src/constants/warehouseTaskStatus')
const { finishPackage } = require('../src/modules/packages/packages.service')

const runId = `${Date.now()}_${Math.floor(Math.random() * 10000)}`
const prefix = `__pkg_finish_${runId}`
const taskPrefix = `PF${Date.now().toString(36).slice(-8)}`
const warehouseId = 870000 + Math.floor(Math.random() * 10000)
const createdTaskIds = []
const createdProductIds = []
const createdPrinterIds = []
const createdClientIds = []

const originalAssertQueueReady = printJobs.assertQueueReady
const originalEnqueuePackageLabelJob = printJobs.enqueuePackageLabelJob

async function createProduct(codeSuffix) {
  const code = `${prefix}_${codeSuffix}`
  const [result] = await pool.query(
    `INSERT INTO product_items (code, name, unit, is_active)
     VALUES (?, ?, '件', 1)`,
    [code, `打包打印闭环测试商品 ${codeSuffix}`],
  )
  const product = {
    id: Number(result.insertId),
    code,
    name: `打包打印闭环测试商品 ${codeSuffix}`,
    unit: '件',
  }
  createdProductIds.push(product.id)
  return product
}

async function createPackingTask(product) {
  const taskNo = `${taskPrefix}_${createdTaskIds.length + 1}`
  const [taskResult] = await pool.query(
    `INSERT INTO warehouse_tasks
       (task_no, sale_order_id, sale_order_no, customer_id, customer_name, warehouse_id, warehouse_name, status, priority)
     VALUES (?, 0, ?, 0, '打包打印闭环测试客户', ?, '打包打印闭环测试仓', ?, 2)`,
    [taskNo, taskNo, warehouseId, WT_STATUS.PACKING],
  )
  const taskId = Number(taskResult.insertId)
  createdTaskIds.push(taskId)
  await pool.query(
    `INSERT INTO warehouse_task_items
       (task_id, product_id, product_code, product_name, unit, required_qty, picked_qty, checked_qty)
     VALUES (?, ?, ?, ?, ?, 1, 1, 1)`,
    [taskId, product.id, product.code, product.name, product.unit],
  )
  return taskId
}

async function createPackageWithItem() {
  const product = await createProduct(`p_${createdTaskIds.length + 1}`)
  const taskId = await createPackingTask(product)
  const [pkgResult] = await pool.query(
    'INSERT INTO packages (barcode, warehouse_task_id, remark) VALUES (?, ?, ?)',
    ['TMP', taskId, 'package finish print closure regression'],
  )
  const packageId = Number(pkgResult.insertId)
  await pool.query('UPDATE packages SET barcode=? WHERE id=?', [`L${String(packageId).padStart(6, '0')}`, packageId])
  await pool.query(
    `INSERT INTO package_items (package_id, product_id, product_code, product_name, unit, qty)
     VALUES (?, ?, ?, ?, ?, 1)`,
    [packageId, product.id, product.code, product.name, product.unit],
  )
  return { taskId, packageId }
}

async function createOnlinePackagePrinter() {
  const clientId = `${prefix}_client`
  const printerCode = `${prefix}_printer`
  createdClientIds.push(clientId)
  await pool.query(
    `INSERT INTO print_clients (client_id, hostname, ip_address, last_seen, status)
     VALUES (?, 'package-finish-test', '127.0.0.1', NOW(), 1)`,
    [clientId],
  )
  const [printerResult] = await pool.query(
    `INSERT INTO printers
       (name, code, type, label_raw_format, warehouse_id, description, status, source, client_id)
     VALUES (?, ?, 1, 'zpl', ?, 'package finish print closure regression', 1, 'local_desktop', ?)`,
    [`打包打印闭环测试打印机 ${runId}`, printerCode, warehouseId, clientId],
  )
  const printerId = Number(printerResult.insertId)
  createdPrinterIds.push(printerId)
  await pool.query(
    `INSERT INTO printer_bindings (warehouse_id, print_type, printer_id, printer_code)
     VALUES (?, 'package_label', ?, ?)`,
    [warehouseId, printerId, printerCode],
  )
  return printerId
}

async function packageStatus(packageId) {
  const [[row]] = await pool.query('SELECT status FROM packages WHERE id=?', [packageId])
  return Number(row.status)
}

async function packagePrintJobs(packageId) {
  const [rows] = await pool.query(
    `SELECT id, status, job_type, job_unique_key, ref_type, ref_id
     FROM print_jobs
     WHERE ref_type='package' AND ref_id=?
     ORDER BY id ASC`,
    [packageId],
  )
  return rows
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

async function testBindingMissingRollsBack() {
  const { packageId } = await createPackageWithItem()
  printJobs.assertQueueReady = async () => {
    throw new AppError('未找到可用打印机，请先在打印机管理中绑定对应用途', 409, 'PRINT_BINDING_MISSING')
  }
  try {
    await finishPackage(packageId, { createdBy: null })
    throw new Error('finish should fail when package_label binding is missing')
  } catch (error) {
    assert(error?.code === 'PRINT_BINDING_MISSING', `expected PRINT_BINDING_MISSING, got ${error?.code || error?.message}`)
  } finally {
    printJobs.assertQueueReady = originalAssertQueueReady
  }
  assert(await packageStatus(packageId) === 1, 'PRINT_BINDING_MISSING must keep package in packing status')
  assert((await packagePrintJobs(packageId)).length === 0, 'PRINT_BINDING_MISSING must not create print job')
}

async function testEnqueueFailureRollsBack() {
  const { packageId } = await createPackageWithItem()
  printJobs.assertQueueReady = async () => ({ printerId: 1, printerCode: 'mock', printerName: 'mock', clientId: 'mock' })
  printJobs.enqueuePackageLabelJob = async () => null
  try {
    await finishPackage(packageId, { createdBy: null })
    throw new Error('finish should fail when package label job is not queued')
  } catch (error) {
    assert(error?.code === 'PACKAGE_LABEL_JOB_NOT_QUEUED', `expected PACKAGE_LABEL_JOB_NOT_QUEUED, got ${error?.code || error?.message}`)
  } finally {
    printJobs.assertQueueReady = originalAssertQueueReady
    printJobs.enqueuePackageLabelJob = originalEnqueuePackageLabelJob
  }
  assert(await packageStatus(packageId) === 1, 'print enqueue failure must roll back package status')
  assert((await packagePrintJobs(packageId)).length === 0, 'print enqueue failure must not leave print job')
}

async function testFinishCreatesTraceablePrintJobOnce() {
  await createOnlinePackagePrinter()
  const { packageId } = await createPackageWithItem()
  const first = await finishPackage(packageId, { createdBy: null })
  await pool.query('UPDATE printers SET status=0 WHERE id=?', [createdPrinterIds[createdPrinterIds.length - 1]])
  const second = await finishPackage(packageId, { createdBy: null })
  const jobs = await packagePrintJobs(packageId)

  assert(await packageStatus(packageId) === 2, 'successful finish must mark package finished')
  assert(first.printQueued === true, 'successful finish must report printQueued')
  assert(Number(first.printJobId) > 0, 'successful finish must return printJobId')
  assert(Number(second.printJobId) === Number(first.printJobId), 'second finish must reuse package label print job even if printer becomes unavailable')
  assert(jobs.length === 1, `finish retry must not duplicate package label job, got ${jobs.length}`)
  assert(jobs[0].job_type === 'package_label', `package label job_type should be package_label, got ${jobs[0].job_type}`)
  assert(jobs[0].job_unique_key === `package_label:package:${packageId}`, 'package finish must use stable package print idempotency key')
}

async function cleanup() {
  printJobs.assertQueueReady = originalAssertQueueReady
  printJobs.enqueuePackageLabelJob = originalEnqueuePackageLabelJob
  if (createdTaskIds.length) {
    await pool.query(
      `DELETE pj FROM print_jobs pj
       INNER JOIN packages p ON p.id = pj.ref_id AND pj.ref_type = 'package'
       WHERE p.warehouse_task_id IN (${createdTaskIds.map(() => '?').join(',')})`,
      createdTaskIds,
    )
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
  await pool.query('DELETE FROM printer_bindings WHERE warehouse_id=? AND print_type=?', [warehouseId, 'package_label'])
  if (createdPrinterIds.length) {
    await pool.query(`DELETE FROM printers WHERE id IN (${createdPrinterIds.map(() => '?').join(',')})`, createdPrinterIds)
  }
  if (createdClientIds.length) {
    await pool.query(`DELETE FROM print_clients WHERE client_id IN (${createdClientIds.map(() => '?').join(',')})`, createdClientIds)
  }
  if (createdProductIds.length) {
    await pool.query(`DELETE FROM product_items WHERE id IN (${createdProductIds.map(() => '?').join(',')})`, createdProductIds)
  }
}

async function main() {
  try {
    assert(normalizeJobType('package_label', 'zpl') === 'package_label', 'package_label must not normalize to rack_label')
    console.log('ok package_label dispatch type is independent')
    await testBindingMissingRollsBack()
    console.log('ok PRINT_BINDING_MISSING blocks without state advance')
    await testEnqueueFailureRollsBack()
    console.log('ok package label enqueue failure rolls back package finish')
    await testFinishCreatesTraceablePrintJobOnce()
    console.log('ok finish advances package and creates exactly one traceable package label job')
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
