const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const printJobs = require('../print-jobs/print-jobs.service')

const { WT_STATUS, WT_STATUS_NAME, isValidTransition } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('../warehouse-tasks/warehouse-task-events.service')
const {
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
} = require('../warehouse-tasks/warehouse-tasks.service')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')

// ─── 查询任务下所有箱子（含明细）────────────────────────────────────────────
async function listByTask(taskId) {
  const [pkgs] = await pool.query(
    `SELECT p.id, p.barcode, p.status, p.remark, p.created_at
     FROM packages p
     WHERE p.warehouse_task_id = ?
     ORDER BY p.created_at ASC`,
    [taskId],
  )
  if (!pkgs.length) return []

  const ids = pkgs.map(p => p.id)
  const [items] = await pool.query(
    `SELECT pi.package_id, pi.id, pi.product_id, pi.product_code,
            pi.product_name, pi.unit, pi.qty
     FROM package_items pi
     WHERE pi.package_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  )

  const itemMap = {}
  items.forEach(i => {
    if (!itemMap[i.package_id]) itemMap[i.package_id] = []
    itemMap[i.package_id].push({
      id: i.id,
      productId:   i.product_id,
      productCode: i.product_code,
      productName: i.product_name,
      unit:        i.unit,
      qty:         Number(i.qty),
    })
  })

  return pkgs.map(p => ({
    id:        p.id,
    barcode:   p.barcode,
    status:    p.status,
    statusName: p.status === 2 ? '已完成' : '打包中',
    remark:    p.remark  || null,
    createdAt: p.created_at,
    items:     itemMap[p.id] || [],
  }))
}

// ─── 创建新物流条码（L + 6位 ID）───────────────────────────────────────────────
async function createPackage(taskId, remark = null) {
  const [[task]] = await pool.query(
    'SELECT id, status FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL',
    [taskId],
  )
  if (!task) throw new AppError('任务不存在', 404)
  if (Number(task.status) !== WT_STATUS.PACKING) {
    throw new AppError('仅「待打包」任务可创建装箱', 400)
  }

  const [result] = await pool.query(
    'INSERT INTO packages (barcode, warehouse_task_id, remark) VALUES (?, ?, ?)',
    ['TMP', taskId, remark],
  )
  const newId  = result.insertId
  const barcode = `L${String(newId).padStart(6, '0')}`
  await pool.query('UPDATE packages SET barcode=? WHERE id=?', [barcode, newId])

  return { id: newId, barcode, warehouseTaskId: taskId, status: 1, items: [] }
}

const QTY_SCALE = 10000

function toQtyUnits(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * QTY_SCALE)
}

function fromQtyUnits(units) {
  return Number((Number(units) / QTY_SCALE).toFixed(4))
}

function throwOverpacked({ taskId, product, requestedUnits, packedUnits, limitUnits, requiredUnits, checkedUnits }) {
  const remainingUnits = Math.max(0, limitUnits - packedUnits)
  throw new AppError(
    `${product.name} 超出可装箱数量，最多还能装 ${fromQtyUnits(remainingUnits)} ${product.unit}`,
    409,
    'PACKAGE_ITEM_OVERPACKED',
    {
      taskId: Number(taskId),
      productId: Number(product.id),
      productCode: product.code,
      requestedQty: fromQtyUnits(requestedUnits),
      packedQty: fromQtyUnits(packedUnits),
      packableQty: fromQtyUnits(limitUnits),
      remainingQty: fromQtyUnits(remainingUnits),
      requiredQty: fromQtyUnits(requiredUnits),
      checkedQty: fromQtyUnits(checkedUnits),
    },
  )
}

// ─── 向箱子添加商品 ───────────────────────────────────────────────────────────
async function addItem(packageId, { productCode, qty }) {
  const qtyUnits = toQtyUnits(qty)
  if (!Number.isFinite(qtyUnits) || qtyUnits <= 0) throw new AppError('数量必须大于 0', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[pkg]] = await conn.query(
      'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
      [packageId],
    )
    if (!pkg) throw new AppError('箱子不存在', 404)
    if (Number(pkg.status) === 2) throw new AppError('该箱已完成，无法继续添加商品', 400)

    const [[task]] = await conn.query(
      'SELECT id, status FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [pkg.warehouse_task_id],
    )
    if (!task) throw new AppError('任务不存在', 404)
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止装箱', 400)
    }

    // 查找商品信息
    const [[product]] = await conn.query(
      'SELECT id, code, name, unit FROM product_items WHERE code=? AND deleted_at IS NULL',
      [productCode],
    )
    if (!product) throw new AppError(`商品 ${productCode} 不存在`, 404)

    // 用任务明细行作为同任务同商品的并发闸门；无论装入哪个箱子，同商品装箱都必须串行校验。
    const [taskItems] = await conn.query(
      `SELECT id, required_qty, checked_qty
       FROM warehouse_task_items
       WHERE task_id=? AND product_id=?
       FOR UPDATE`,
      [pkg.warehouse_task_id, product.id],
    )
    if (!taskItems.length) throw new AppError(`商品 ${product.code} 不属于当前任务，禁止装箱`, 400)

    const requiredUnits = taskItems.reduce((sum, item) => sum + toQtyUnits(item.required_qty), 0)
    const checkedUnits = taskItems.reduce((sum, item) => sum + toQtyUnits(item.checked_qty ?? 0), 0)
    const limitUnits = Math.min(requiredUnits, checkedUnits)

    const [packedRows] = await conn.query(
      `SELECT pi.id, pi.qty
       FROM package_items pi
       INNER JOIN packages p ON p.id = pi.package_id
       WHERE p.warehouse_task_id=? AND pi.product_id=?
       FOR UPDATE`,
      [pkg.warehouse_task_id, product.id],
    )
    const packedUnits = packedRows.reduce((sum, row) => sum + toQtyUnits(row.qty), 0)
    if (packedUnits + qtyUnits > limitUnits) {
      throwOverpacked({
        taskId: pkg.warehouse_task_id,
        product,
        requestedUnits: qtyUnits,
        packedUnits,
        limitUnits,
        requiredUnits,
        checkedUnits,
      })
    }

    // 若箱中已有该商品，累加数量。目标箱已被锁定，避免同箱重复扫码并发写覆盖。
    const [[existing]] = await conn.query(
      'SELECT id, qty FROM package_items WHERE package_id=? AND product_id=? FOR UPDATE',
      [packageId, product.id],
    )

    let result
    if (existing) {
      const newQtyUnits = toQtyUnits(existing.qty) + qtyUnits
      const newQty = fromQtyUnits(newQtyUnits)
      await conn.query('UPDATE package_items SET qty=? WHERE id=?', [newQty, existing.id])
      result = {
        itemId:      existing.id,
        productId:   product.id,
        productCode: product.code,
        productName: product.name,
        unit:        product.unit,
        qty:         newQty,
      }
    } else {
      const [ins] = await conn.query(
        `INSERT INTO package_items
           (package_id, product_id, product_code, product_name, unit, qty)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [packageId, product.id, product.code, product.name, product.unit, fromQtyUnits(qtyUnits)],
      )
      result = {
        itemId:      ins.insertId,
        productId:   product.id,
        productCode: product.code,
        productName: product.name,
        unit:        product.unit,
        qty:         fromQtyUnits(qtyUnits),
      }
    }

    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

function packageLabelJobKey(packageId) {
  return `package_label:package:${Number(packageId)}`
}

async function findActivePackageLabelJob(exec, packageId) {
  const [[job]] = await exec.query(
    `SELECT id, status
     FROM print_jobs
     WHERE job_unique_key=? AND status IN (0, 1, 2)
     ORDER BY id DESC LIMIT 1`,
    [packageLabelJobKey(packageId)],
  )
  return job || null
}

async function buildFinishedPackagePrintResult(exec, packageId, warehouseTaskId, job) {
  const [[{ remaining }]] = await exec.query(
    'SELECT COUNT(*) AS remaining FROM packages WHERE warehouse_task_id=? AND status=1',
    [warehouseTaskId],
  )
  return {
    id: Number(packageId),
    warehouseTaskId: Number(warehouseTaskId),
    status: 2,
    statusName: '已完成',
    allPackagesDone: Number(remaining) === 0,
    printQueued: true,
    printJobId: Number(job.id),
    printJobStatus: Number(job.status),
  }
}

// ─── 完成箱子并保持打印链原子性 ────────────────────────────────────────────────
async function markPackageFinishedWithinTransaction(conn, packageId) {
  const [[pkg]] = await conn.query(
    'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)
  const alreadyFinished = Number(pkg.status) === 2

  const [[taskRow]] = await conn.query(
    'SELECT id, status, task_no FROM warehouse_tasks WHERE id=? FOR UPDATE',
    [pkg.warehouse_task_id],
  )
  if (!taskRow || Number(taskRow.status) !== WT_STATUS.PACKING) {
    throw new AppError('任务不在待打包状态，禁止完成装箱', 400)
  }

  if (!alreadyFinished) {
    const [[{ cnt }]] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM package_items WHERE package_id=?',
      [packageId],
    )
    if (cnt === 0) throw new AppError('箱子内没有商品，无法完成打包', 400)

    await conn.query('UPDATE packages SET status=2 WHERE id=?', [packageId])
  }

  const [[{ remaining }]] = await conn.query(
    'SELECT COUNT(*) AS remaining FROM packages WHERE warehouse_task_id=? AND status=1',
    [pkg.warehouse_task_id],
  )
  if (!alreadyFinished && remaining > 0) {
    try {
      await recordEvent(conn, {
        taskId: pkg.warehouse_task_id,
        taskNo: taskRow.task_no ?? '',
        eventType: WT_EVENT.PACK_PROGRESS,
        detail: { packageId, remaining },
      })
    } catch (_) {}
  }

  return {
    id: packageId,
    warehouseTaskId: Number(pkg.warehouse_task_id),
    status: 2,
    statusName: '已完成',
    allPackagesDone: Number(remaining) === 0,
  }
}

async function finishPackage(packageId, { createdBy } = {}) {
  const [[pkg]] = await pool.query(
    `SELECT p.id, p.barcode, p.status, p.warehouse_task_id, wt.warehouse_id
     FROM packages p
     INNER JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.id = ?`,
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)

  if (Number(pkg.status) === 2) {
    const existingJob = await findActivePackageLabelJob(pool, packageId)
    if (existingJob) {
      return buildFinishedPackagePrintResult(pool, packageId, pkg.warehouse_task_id, existingJob)
    }
  }

  await printJobs.assertQueueReady({
    warehouseId: Number(pkg.warehouse_id),
    jobType: 'package_label',
    contentType: 'zpl',
  })

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const result = await markPackageFinishedWithinTransaction(conn, packageId)

    const job = await printJobs.enqueuePackageLabelJob({
      conn,
      packageId,
      createdBy: createdBy ?? null,
      jobUniqueKey: packageLabelJobKey(packageId),
    })
    if (!job) {
      throw new AppError(
        '箱贴未进入打印链，请先检查打印机绑定、用途配置和桌面客户端在线状态',
        409,
        'PACKAGE_LABEL_JOB_NOT_QUEUED',
      )
    }

    await conn.commit()
    return buildFinishedPackagePrintResult(pool, packageId, result.warehouseTaskId, job)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

const finishPackageWithPrint = finishPackage

// ─── 按条码查询箱子（含任务信息 + 所有箱的明细）────────────────────────────────
async function getByBarcode(barcode) {
  const inboundThresholds = await getInboundClosureThresholds()
  const [[pkg]] = await pool.query(
    `SELECT p.id, p.barcode, p.status, p.warehouse_task_id,
            wt.task_no, wt.customer_name, wt.warehouse_name,
            wt.status AS task_status
     FROM packages p
     JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.barcode = ?`,
    [barcode],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)

  // 返回该任务下所有箱子的明细（方便一次展示全订单）
  const allPkgs = await listByTask(pkg.warehouse_task_id)
  const [printRows] = await pool.query(
    `SELECT
        j.status,
        j.updated_at,
        j.error_message,
        pr.code AS printer_code,
        pr.name AS printer_name
     FROM packages p
     LEFT JOIN (
       SELECT j1.*
       FROM print_jobs j1
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'package'
         GROUP BY ref_id
       ) latest ON latest.max_id = j1.id
     ) j ON j.ref_id = p.id AND j.ref_type = 'package'
     LEFT JOIN printers pr ON pr.id = j.printer_id
     WHERE p.warehouse_task_id = ?`,
    [pkg.warehouse_task_id],
  )
  const printSummary = {
    totalPackages: allPkgs.length,
    successCount: 0,
    failedCount: 0,
    timeoutCount: 0,
    processingCount: 0,
    recentError: null,
    recentPrinter: null,
  }
  for (const row of printRows) {
    const status = Number(row.status)
    if (status === 2) printSummary.successCount += 1
    else if (status === 3) printSummary.failedCount += 1
    else if ((status === 0 || status === 1) && row.updated_at && (Date.now() - new Date(row.updated_at).getTime()) >= Number(inboundThresholds.printTimeoutMinutes) * 60 * 1000) printSummary.timeoutCount += 1
    else if (status === 0 || status === 1) printSummary.processingCount += 1
    if (!printSummary.recentError && row.error_message) printSummary.recentError = row.error_message
    if (!printSummary.recentPrinter && (row.printer_code || row.printer_name)) printSummary.recentPrinter = row.printer_code || row.printer_name
  }

  return {
    packageId:        pkg.id,
    barcode:          pkg.barcode,
    packageStatus:    pkg.status,
    packageStatusName: pkg.status === 2 ? '已完成' : '打包中',
    warehouseTaskId:  pkg.warehouse_task_id,
    taskNo:           pkg.task_no,
    customerName:     pkg.customer_name,
    warehouseName:    pkg.warehouse_name,
    warehouseTaskStatus:     pkg.task_status,
    warehouseTaskStatusName: WT_STATUS_NAME[Number(pkg.task_status)] ?? null,
    taskStatus:       pkg.task_status,
    taskStatusName:   WT_STATUS_NAME[Number(pkg.task_status)] ?? null,
    printSummary,
    packages:         allPkgs,
  }
}

module.exports = { listByTask, createPackage, addItem, finishPackage, finishPackageWithPrint, getByBarcode }
