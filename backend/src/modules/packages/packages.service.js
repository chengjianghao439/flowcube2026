const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const printJobs = require('../print-jobs/print-jobs.service')

const { WT_STATUS, isValidTransition } = require('../../constants/warehouseTaskStatus')
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

// ─── 向箱子添加商品 ───────────────────────────────────────────────────────────
async function addItem(packageId, { productCode, qty }) {
  const [[pkg]] = await pool.query(
    `SELECT p.id, p.status, p.warehouse_task_id, wt.status AS task_status
     FROM packages p
     JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.id=?`,
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)
  if (Number(pkg.task_status) !== WT_STATUS.PACKING) {
    throw new AppError('任务不在待打包状态，禁止装箱', 400)
  }
  if (pkg.status === 2) throw new AppError('该箱已完成，无法继续添加商品', 400)
  if (!qty || qty <= 0) throw new AppError('数量必须大于 0', 400)

  // 查找商品信息
  const [[product]] = await pool.query(
    'SELECT id, code, name, unit FROM product_items WHERE code=? AND deleted_at IS NULL',
    [productCode],
  )
  if (!product) throw new AppError(`商品 ${productCode} 不存在`, 404)

  // 若箱中已有该商品，累加数量
  const [[existing]] = await pool.query(
    'SELECT id, qty FROM package_items WHERE package_id=? AND product_id=?',
    [packageId, product.id],
  )

  if (existing) {
    const newQty = Number(existing.qty) + Number(qty)
    await pool.query('UPDATE package_items SET qty=? WHERE id=?', [newQty, existing.id])
    return {
      itemId:      existing.id,
      productId:   product.id,
      productCode: product.code,
      productName: product.name,
      unit:        product.unit,
      qty:         newQty,
    }
  }

  const [ins] = await pool.query(
    `INSERT INTO package_items
       (package_id, product_id, product_code, product_name, unit, qty)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [packageId, product.id, product.code, product.name, product.unit, qty],
  )
  return {
    itemId:      ins.insertId,
    productId:   product.id,
    productCode: product.code,
    productName: product.name,
    unit:        product.unit,
    qty:         Number(qty),
  }
}

// ─── 完成箱子 ─────────────────────────────────────────────────────────────────
async function finishPackage(packageId) {
  const [[pkg]] = await pool.query(
    'SELECT id, status, warehouse_task_id FROM packages WHERE id=?',
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)
  if (pkg.status === 2) throw new AppError('该箱已标记为完成', 400)

  const [[{ cnt }]] = await pool.query(
    'SELECT COUNT(*) AS cnt FROM package_items WHERE package_id=?',
    [packageId],
  )
  if (cnt === 0) throw new AppError('箱子内没有商品，无法完成打包', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[taskRow]] = await conn.query(
      'SELECT id, status, task_no FROM warehouse_tasks WHERE id=? FOR UPDATE',
      [pkg.warehouse_task_id],
    )
    if (!taskRow || Number(taskRow.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止完成装箱', 400)
    }

    await conn.query('UPDATE packages SET status=2 WHERE id=?', [packageId])

    // 检查该任务是否还有未完成的箱子
    const [[{ remaining }]] = await conn.query(
      'SELECT COUNT(*) AS remaining FROM packages WHERE warehouse_task_id=? AND status=1',
      [pkg.warehouse_task_id],
    )
    if (remaining > 0) {
      // 仍有未完成箱子，记录进度
      try {
        const [[taskRow]] = await conn.query('SELECT task_no FROM warehouse_tasks WHERE id=?', [pkg.warehouse_task_id])
        await recordEvent(conn, {
          taskId:    pkg.warehouse_task_id,
          taskNo:    taskRow?.task_no ?? '',
          eventType: WT_EVENT.PACK_PROGRESS,
          detail:    { packageId, remaining },
        })
      } catch (_) {}
    }

    await conn.commit()
    return {
      id: packageId,
      warehouseTaskId: Number(pkg.warehouse_task_id),
      status: 2,
      statusName: '已完成',
      allPackagesDone: Number(remaining) === 0,
    }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

async function finishPackageWithPrint(packageId, { createdBy, requestKey } = {}) {
  const [[pkg]] = await pool.query(
    `SELECT p.id, p.barcode, p.status, p.warehouse_task_id, wt.warehouse_id
     FROM packages p
     INNER JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.id = ?`,
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)

  await printJobs.assertQueueReady({
    warehouseId: Number(pkg.warehouse_id),
    jobType: 'package_label',
    contentType: 'zpl',
  })

  const result = Number(pkg.status) === 2
    ? {
        id: Number(pkg.id),
        warehouseTaskId: Number(pkg.warehouse_task_id),
        status: 2,
        statusName: '已完成',
        allPackagesDone: false,
      }
    : await finishPackage(packageId)

  const job = await printJobs.enqueuePackageLabelJob({
    packageId,
    createdBy: createdBy ?? null,
    jobUniqueKey: requestKey ? `package_label:${requestKey}` : null,
  })
  if (!job) {
    throw new AppError('箱贴未进入打印链，请先检查打印机绑定、用途配置和桌面客户端在线状态', 409)
  }

  return {
    ...result,
    printQueued: true,
    printJobId: Number(job.id),
    printJobStatus: Number(job.status),
  }
}

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
    taskStatus:       pkg.task_status,
    taskStatusName:   pkg.task_status === 6 ? '待出库' : pkg.task_status === 7 ? '已出库' : pkg.task_status === 5 ? '待打包' : null,
    printSummary,
    packages:         allPkgs,
  }
}

module.exports = { listByTask, createPackage, addItem, finishPackage, finishPackageWithPrint, getByBarcode }
