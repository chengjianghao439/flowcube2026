const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const printJobs = require('../print-jobs/print-jobs.service')

const { WT_STATUS, WT_STATUS_NAME } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('../warehouse-tasks/warehouse-task-events.service')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { buildPackagePrintSummary } = require('../../utils/printSummary')
const logisticsSvc = require('../logistics/logistics.service')

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
    statusName: p.status === 3 ? '已取消' : p.status === 2 ? '已完成' : '打包中',
    remark:    p.remark  || null,
    createdAt: p.created_at,
    items:     itemMap[p.id] || [],
  }))
}

// ─── 创建新物流条码（L + 6位 ID）───────────────────────────────────────────────
async function createPackage(taskId, remark = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[task]] = await conn.query(
      'SELECT id, status, cancel_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!task) throw new AppError('任务不存在', 404)
    if (task.cancel_requested_at) {
      throw new AppError('该任务正在取消收尾中，禁止继续打包操作', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('仅「待打包」任务可创建装箱', 400)
    }

    const [result] = await conn.query(
      'INSERT INTO packages (barcode, warehouse_task_id, remark) VALUES (?, ?, ?)',
      ['TMP', taskId, remark],
    )
    const newId  = result.insertId
    const barcode = `L${String(newId).padStart(6, '0')}`
    await conn.query('UPDATE packages SET barcode=? WHERE id=?', [barcode, newId])
    await conn.commit()

    return { id: newId, barcode, warehouseTaskId: taskId, status: 1, items: [] }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
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
    if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无法继续添加商品', 400)

    const [[task]] = await conn.query(
      'SELECT id, status, cancel_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [pkg.warehouse_task_id],
    )
    if (!task) throw new AppError('任务不存在', 404)
    if (task.cancel_requested_at) {
      throw new AppError('该任务正在取消收尾中，禁止继续打包操作', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止装箱', 400)
    }

    // 查找商品信息
    const [[product]] = await conn.query(
      'SELECT id, code, name, unit, article_number, spec, color FROM product_items WHERE code=? AND deleted_at IS NULL',
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
       WHERE p.warehouse_task_id=? AND pi.product_id=? AND p.status != 3
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
           (package_id, product_id, product_code, product_name, unit, article_number, spec, color, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [packageId, product.id, product.code, product.name, product.unit, product.article_number || null, product.spec || null, product.color || null, fromQtyUnits(qtyUnits)],
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

// ─── 从箱子移出商品（扫错/多扫纠正）────────────────────────────────────────────
async function removeItem(packageId, { itemId, qty }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[pkg]] = await conn.query(
      'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
      [packageId],
    )
    if (!pkg) throw new AppError('箱子不存在', 404)
    if (Number(pkg.status) !== 1) throw new AppError('该箱已完成或已作废，无法移除商品', 400)

    const [[task]] = await conn.query(
      'SELECT id, status, cancel_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [pkg.warehouse_task_id],
    )
    if (!task) throw new AppError('任务不存在', 404)
    if (task.cancel_requested_at) {
      throw new AppError('该任务正在取消收尾中，禁止继续打包操作', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止移除商品', 400)
    }

    const [[item]] = await conn.query(
      'SELECT id, product_id, product_code, product_name, unit, qty FROM package_items WHERE id=? AND package_id=? FOR UPDATE',
      [itemId, packageId],
    )
    if (!item) throw new AppError('该商品明细不存在', 404)

    const currentUnits = toQtyUnits(item.qty)
    const removeUnits = qty == null ? currentUnits : toQtyUnits(qty)
    if (!Number.isFinite(removeUnits) || removeUnits <= 0) throw new AppError('移除数量必须大于 0', 400)
    if (removeUnits > currentUnits) throw new AppError('移除数量不能超过箱内现有数量', 400)

    let result
    if (removeUnits >= currentUnits) {
      await conn.query('DELETE FROM package_items WHERE id=?', [item.id])
      result = {
        itemId: item.id, productId: item.product_id, productCode: item.product_code,
        productName: item.product_name, unit: item.unit, removed: true, qty: 0,
      }
    } else {
      const newQty = fromQtyUnits(currentUnits - removeUnits)
      await conn.query('UPDATE package_items SET qty=? WHERE id=?', [newQty, item.id])
      result = {
        itemId: item.id, productId: item.product_id, productCode: item.product_code,
        productName: item.product_name, unit: item.unit, removed: false, qty: newQty,
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

// ─── 作废单箱（整箱装错重来，不影响任务下其它箱子）────────────────────────────────
async function voidPackage(packageId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[pkg]] = await conn.query(
      'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
      [packageId],
    )
    if (!pkg) throw new AppError('箱子不存在', 404)
    if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无需重复操作', 400)
    if (Number(pkg.status) === 2) throw new AppError('该箱已完成，无法作废', 400)

    const [[task]] = await conn.query(
      'SELECT id, status, cancel_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [pkg.warehouse_task_id],
    )
    if (!task) throw new AppError('任务不存在', 404)
    if (task.cancel_requested_at) {
      throw new AppError('该任务正在取消收尾中，请通过「取消清理」流程处理该箱子', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止作废箱子', 400)
    }

    await conn.query('UPDATE packages SET status=3 WHERE id=?', [packageId])

    await conn.commit()
    return { id: packageId, warehouseTaskId: Number(pkg.warehouse_task_id), status: 3, statusName: '已取消' }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ─── 作废已完成箱子（改单减量专用）───────────────────────────────────────────
// 与 voidPackage 的区别：voidPackage 只允许作废 status=1（打包中，尚未打印箱贴）的箱子，
// 且要求任务处于 PACKING 状态；本函数专门处理已完成（status=2，已打印箱贴）的箱子，
// 允许任务处于拣货中~待出库任一活跃阶段（改单可能发生在打包完成之后）。
// package_items 与 inventory_containers 无关联（装箱不影响容器库存数字，见
// warehouse-tasks.command.js 里取消逆向归还的同一说明），作废本身不需要任何数量回滚——
// 该商品的 packedUnits 统计口径本就是 `WHERE package.status != 3` 实时 SUM，作废后自动归零，
// 调用方（warehouse-tasks.adjust.js）负责后续把因此腾出的数量纳入分层处理。
async function voidCompletedPackage(conn, packageId, { operator, reason = '改单调整' } = {}) {
  const [[pkg]] = await conn.query(
    'SELECT id, status, warehouse_task_id, barcode FROM packages WHERE id=? FOR UPDATE',
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)
  if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无需重复操作', 400)

  const [[task]] = await conn.query(
    'SELECT id, status FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
    [pkg.warehouse_task_id],
  )
  if (!task) throw new AppError('任务不存在', 404)

  const [items] = await conn.query(
    'SELECT product_id, product_code, product_name, unit, qty FROM package_items WHERE package_id=?',
    [packageId],
  )

  await conn.query('UPDATE packages SET status=3 WHERE id=?', [packageId])

  // 已完成箱子大概率已经进入打印链，参照 warehouse-tasks.command.js 取消流程里的既有处理：
  // 未完成/未确认的打印任务作废，已完成的打印记录保留作审计，不回滚。
  await conn.query(
    `UPDATE print_jobs SET status = 3, error_message = ?
     WHERE ref_type = 'package' AND ref_id = ? AND status IN (0, 1)`,
    [reason, packageId],
  )

  return {
    id: Number(packageId),
    barcode: pkg.barcode,
    warehouseTaskId: Number(pkg.warehouse_task_id),
    status: 3,
    statusName: '已作废',
    items: items.map(i => ({
      productId: Number(i.product_id),
      productCode: i.product_code,
      productName: i.product_name,
      unit: i.unit,
      qty: Number(i.qty),
    })),
    operator: operator ? { userId: operator.userId ?? null, realName: operator.realName ?? null } : null,
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
  const dispatchHint = job?.id
    ? await printJobs.getDispatchHintForJob(job.printerCode, Number(job.id))
    : null
  return {
    id: Number(packageId),
    warehouseTaskId: Number(warehouseTaskId),
    status: 2,
    statusName: '已完成',
    allPackagesDone: Number(remaining) === 0,
    printQueued: true,
    printJobId: Number(job.id),
    printJobStatus: Number(job.status),
    printJob: {
      id: Number(job.id),
      jobType: job.jobType ?? 'package_label',
      status: Number(job.status),
      statusKey: job.statusKey ?? null,
      printStateLabel: job.printStateLabel ?? null,
      printerId: job.printerId ?? null,
      printerCode: job.printerCode ?? null,
      printerName: job.printerName ?? null,
      dispatchHint,
    },
  }
}

// ─── 完成箱子并保持打印链原子性 ────────────────────────────────────────────────
async function markPackageFinishedWithinTransaction(conn, packageId) {
  const [[pkg]] = await conn.query(
    'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)
  if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无法完成打包', 400)
  const alreadyFinished = Number(pkg.status) === 2

  const [[taskRow]] = await conn.query(
    'SELECT id, status, task_no, cancel_requested_at FROM warehouse_tasks WHERE id=? FOR UPDATE',
    [pkg.warehouse_task_id],
  )
  if (!taskRow || Number(taskRow.status) !== WT_STATUS.PACKING) {
    throw new AppError('任务不在待打包状态，禁止完成装箱', 400)
  }
  if (taskRow.cancel_requested_at) {
    throw new AppError('该任务正在取消收尾中，禁止继续打包操作', 409)
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
    } catch (_) {
      // 打包进度事件为 best-effort：记录失败不应阻断打包主流程，故静默忽略
    }
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
    requireClientOnline: false,
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
        '箱贴未进入打印链，请先检查 package_label 打印机绑定和用途配置',
        409,
        'PACKAGE_LABEL_JOB_NOT_QUEUED',
      )
    }

    // 电子面单（文档 06）：销售单已指定承运商时，在同一事务内写一条"待取号"运单记录。
    // 纯 DB INSERT、零 HTTP（真正取号由 scheduler 异步 worker 事务外完成），
    // uk_package 幂等；未指定承运商则返回 null 不建单，对打包主流程零影响。
    await logisticsSvc.createPendingWaybillTx(conn, { packageId, createdBy: createdBy ?? null })

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
        j.id AS job_id,
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
  const printSummary = buildPackagePrintSummary(printRows, allPkgs.length, {
    timeoutMinutes: inboundThresholds.printTimeoutMinutes,
  })

  return {
    packageId:        pkg.id,
    barcode:          pkg.barcode,
    packageStatus:    pkg.status,
    packageStatusName: pkg.status === 3 ? '已取消' : pkg.status === 2 ? '已完成' : '打包中',
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

// ─── 取消任务下所有未取消包裹 ────────────────────────────────────────────────
async function cancelByTaskId(conn, taskId) {
  const [result] = await conn.query(
    `UPDATE packages SET status = 3
     WHERE warehouse_task_id = ? AND status IN (1, 2)`,
    [taskId],
  )
  return result.affectedRows
}

module.exports = {
  listByTask,
  createPackage,
  addItem,
  removeItem,
  voidPackage,
  voidCompletedPackage,
  finishPackage,
  finishPackageWithPrint,
  getByBarcode,
  cancelByTaskId,
}
