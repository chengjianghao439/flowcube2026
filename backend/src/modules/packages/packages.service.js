const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

const { WT_STATUS, isValidTransition } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('../warehouse-tasks/warehouse-task-events.service')
const {
  assertTaskCheckScanClosure,
  assertTaskPackagingClosure,
} = require('../warehouse-tasks/warehouse-tasks.service')

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
    let autoPacked = false
    if (remaining === 0) {
      // 所有箱子打包完毕 → 自动推进到「待出库」(5→6)
      if (taskRow && isValidTransition(Number(taskRow.status), WT_STATUS.SHIPPING)) {
        await assertTaskCheckScanClosure(conn, pkg.warehouse_task_id)
        await assertTaskPackagingClosure(conn, pkg.warehouse_task_id)
        const [r] = await conn.query(
          'UPDATE warehouse_tasks SET status=? WHERE id=? AND status=?',
          [WT_STATUS.SHIPPING, pkg.warehouse_task_id, WT_STATUS.PACKING],
        )
        autoPacked = r.affectedRows > 0
        if (autoPacked) {
          try {
            await recordEvent(conn, {
              taskId:    pkg.warehouse_task_id,
              taskNo:    taskRow.task_no,
              eventType:  WT_EVENT.PACK_DONE,
              fromStatus: WT_STATUS.PACKING,
              toStatus:   WT_STATUS.SHIPPING,
              detail:     { packageId },
            })
          } catch (_) {}
        }
      }
    } else {
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
    return { id: packageId, status: 2, statusName: '已完成', autoPacked }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ─── 按条码查询箱子（含任务信息 + 所有箱的明细）────────────────────────────────
async function getByBarcode(barcode) {
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
    packages:         allPkgs,
  }
}

module.exports = { listByTask, createPackage, addItem, finishPackage, getByBarcode }
