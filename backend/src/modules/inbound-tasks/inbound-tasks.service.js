const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const logger = require('../../utils/logger')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { createContainer, syncStockFromContainers, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')

const TASK_STATUS = { 1: '待收货', 2: '收货中', 3: '待上架', 4: '已完成', 5: '已取消' }

const genTaskNo = conn => generateDailyCode(conn, 'IT', 'inbound_tasks', 'task_no')

const fmt = r => ({
  id:              r.id,
  taskNo:          r.task_no,
  purchaseOrderId: r.purchase_order_id,
  purchaseOrderNo: r.purchase_order_no || null,
  supplierName:    r.supplier_name     || null,
  warehouseId:     r.warehouse_id,
  warehouseName:   r.warehouse_name    || null,
  status:          r.status,
  statusName:      TASK_STATUS[r.status],
  /** 闭环状态机：pending_receive / pending_putaway / done */
  loopStatus:
    r.status === 1 ? 'pending_receive'
      : r.status === 2 ? 'pending_receive'
        : r.status === 3 ? 'pending_putaway'
          : r.status === 4 ? 'done'
            : r.status === 5 ? 'cancelled' : 'unknown',
  operatorId:      r.operator_id       || null,
  operatorName:    r.operator_name     || null,
  remark:          r.remark            || null,
  lockVersion:     Number(r.lock_version) || 0,
  createdAt:       r.created_at,
  updatedAt:       r.updated_at,
})

const fmtItem = r => ({
  id:          r.id,
  taskId:      r.task_id,
  productId:   r.product_id,
  productCode: r.product_code || null,
  productName: r.product_name,
  unit:        r.unit || null,
  orderedQty:  Number(r.ordered_qty),
  receivedQty: Number(r.received_qty),
  putawayQty:  Number(r.putaway_qty),
})

function fmtContainer(r) {
  return {
    id:           r.id,
    barcode:      r.barcode,
    taskId:       r.inbound_task_id,
    productId:    r.product_id,
    productCode:  r.product_code || null,
    productName:  r.product_name || null,
    qty:          Number(r.remaining_qty),
    unit:         r.unit || null,
    status:       r.status === CONTAINER_STATUS.PENDING_PUTAWAY ? 'waiting_putaway' : 'stored',
    locationId:   r.location_id || null,
    locationCode: r.location_code || null,
    createdAt:    r.created_at,
  }
}

// ── 查询 ────────────────────────────────────────────────────────────────────

async function findAll({ page = 1, pageSize = 20, keyword = '', status = null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const conds = ['t.deleted_at IS NULL', '(t.task_no LIKE ? OR t.supplier_name LIKE ? OR t.purchase_order_no LIKE ?)']
  const params = [like, like, like]
  if (status) { conds.push('t.status = ?'); params.push(status) }
  const where = conds.join(' AND ')

  const [rows] = await pool.query(
    `SELECT t.* FROM inbound_tasks t WHERE ${where} ORDER BY t.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM inbound_tasks t WHERE ${where}`,
    params,
  )
  return { list: rows.map(fmt), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [[row]] = await pool.query('SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL', [id])
  if (!row) throw new AppError('入库任务不存在', 404)
  const task = fmt(row)
  const [items] = await pool.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [id])
  task.items = items.map(fmtItem)
  return task
}

/**
 * 按采购单创建入库任务（采购单须已确认 status=2，且不存在未完结任务）
 */
async function createFromPoId(purchaseOrderId) {
  const purchaseSvc = require('../purchase/purchase.service')
  const order = await purchaseSvc.findById(purchaseOrderId)
  if (order.status !== 2) throw new AppError('只有已确认的采购单可创建入库任务', 400)
  if (!order.items.length) throw new AppError('采购单无明细', 400)

  const [[dup]] = await pool.query(
    `SELECT id FROM inbound_tasks
     WHERE purchase_order_id = ? AND deleted_at IS NULL AND status NOT IN (4, 5) LIMIT 1`,
    [purchaseOrderId],
  )
  if (dup) throw new AppError('该采购单已有未完结的入库任务', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskNo = await genTaskNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status)
       VALUES (?,?,?,?,?,?,1)`,
      [taskNo, order.id, order.orderNo, order.supplierName, order.warehouseId, order.warehouseName],
    )
    const taskId = r.insertId
    for (const item of order.items) {
      await conn.query(
        `INSERT INTO inbound_task_items (task_id, product_id, product_code, product_name, unit, ordered_qty)
         VALUES (?,?,?,?,?,?)`,
        [taskId, item.productId, item.productCode, item.productName, item.unit, item.quantity],
      )
    }
    await conn.commit()
    return { taskId, taskNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 将 qty 分摊到任务明细（同 SKU 多行按 id 顺序）
 * @returns {Array<{ itemId: number, add: number }>}
 */
function distributeQtyToLines(taskItems, productId, qty) {
  const lines = taskItems
    .filter(i => i.productId === productId && i.receivedQty < i.orderedQty)
    .sort((a, b) => a.id - b.id)
  let left = +qty
  const updates = []
  for (const line of lines) {
    const cap = line.orderedQty - line.receivedQty
    const add = Math.min(left, cap)
    if (add > 0) {
      updates.push({ itemId: line.id, add })
      left -= add
    }
    if (left <= 0) break
  }
  if (left > 0) throw new AppError('收货数量超过该商品待收数量', 400)
  return updates
}

/**
 * 逐包收货：单次请求只收一包，生成一个待上架容器（status=PENDING_PUTAWAY=4），并尝试排队打印标签
 * body: { productId, qty } — qty 为本包数量，累计 received 不得超过 ordered
 */
async function receive(taskId, { productId, qty }, { userId, tenantId = 0 } = {}) {
  const productIdN = Number(productId)
  const qtyN = Number(qty)
  if (!Number.isFinite(productIdN) || productIdN <= 0) throw new AppError('请选择有效商品', 400)
  if (!Number.isFinite(qtyN) || qtyN <= 0) throw new AppError('数量必须大于 0', 400)

  const conn = await pool.getConnection()
  let result = {
    containerCode: null,
    containerId: null,
    productName: '',
    qty: qtyN,
    printJobId: null,
  }
  try {
    await conn.beginTransaction()

    const [[taskRow]] = await conn.query(
      'SELECT * FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('入库任务不存在', 404)
    if (Number(taskRow.status) >= 4) throw new AppError('任务已完成或已取消', 400)
    if (Number(taskRow.status) === 3) throw new AppError('任务已全部收货，请执行上架', 400)

    if (Number(taskRow.status) === 1) {
      await conn.query('UPDATE inbound_tasks SET status = 2 WHERE id = ?', [taskId])
    }

    const [itemRowsFresh] = await conn.query(
      'SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id',
      [taskId],
    )
    if (!itemRowsFresh.length) throw new AppError('任务无明细', 400)
    const taskItems = itemRowsFresh.map(fmtItem)

    const warehouseId = Number(taskRow.warehouse_id)
    const taskNo = taskRow.task_no

    const updates = distributeQtyToLines(taskItems, productIdN, qtyN)
    for (const u of updates) {
      await conn.query(
        'UPDATE inbound_task_items SET received_qty = received_qty + ? WHERE id = ?',
        [u.add, u.itemId],
      )
      const ti = taskItems.find(x => x.id === u.itemId)
      if (ti) ti.receivedQty += u.add
    }

    const line = taskItems.find(i => i.productId === productIdN)
    const unit = line?.unit || null
    const productName = line?.productName || ''

    const { containerId, barcode } = await createContainer(conn, {
      productId:       productIdN,
      warehouseId,
      initialQty:      qtyN,
      unit,
      locationId:      null,
      inboundTaskId:   taskId,
      containerStatus: CONTAINER_STATUS.PENDING_PUTAWAY,
      sourceType:      SOURCE_TYPE.INBOUND_TASK,
      sourceRefId:     taskId,
      sourceRefType:   'inbound_task',
      sourceRefNo:     taskNo,
      remark:          `收货待上架 ${taskNo}`,
    })

    const [updatedItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
    const allReceived = updatedItems.every(i => Number(i.received_qty) >= Number(i.ordered_qty))
    if (allReceived) {
      await conn.query('UPDATE inbound_tasks SET status = 3 WHERE id = ?', [taskId])
    }

    await conn.query('UPDATE inbound_tasks SET lock_version = lock_version + 1 WHERE id = ?', [taskId])

    await conn.commit()

    result = {
      containerCode: barcode,
      containerId,
      productName,
      qty: qtyN,
      warehouseId,
      printJobId: null,
    }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  try {
    const printJobs = require('../print-jobs/print-jobs.service')
    const job = await printJobs.enqueueContainerLabelJob({
      type: 'container_label',
      tenantId: Number(tenantId) >= 0 ? Number(tenantId) : 0,
      warehouseId: result.warehouseId,
      data: {
        container_code: result.containerCode,
        product_name:   result.productName,
        qty:            result.qty,
      },
      createdBy: userId ?? null,
    })
    if (job?.id) result.printJobId = job.id
  } catch (e) {
    logger.warn(`[inbound receive] 打印队列失败（收货已成功）: ${e.message}`)
  }

  return result
}

/** 待上架容器（status=PENDING_PUTAWAY） */
async function listWaitingContainers(taskId) {
  await findById(taskId)
  const [rows] = await pool.query(
    `SELECT c.*, p.code AS product_code, p.name AS product_name, loc.code AS location_code
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.inbound_task_id = ? AND c.deleted_at IS NULL AND c.status = ?
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     ORDER BY c.id ASC`,
    [taskId, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  return rows.map(fmtContainer)
}

/** 已上架容器（本任务下 ACTIVE 且有库位） */
async function listStoredContainers(taskId) {
  await findById(taskId)
  const [rows] = await pool.query(
    `SELECT c.*, p.code AS product_code, p.name AS product_name, loc.code AS location_code
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
     WHERE c.inbound_task_id = ? AND c.deleted_at IS NULL AND c.status = ? AND c.location_id IS NOT NULL
       AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     ORDER BY c.id ASC`,
    [taskId, CONTAINER_STATUS.ACTIVE],
  )
  return rows.map(fmtContainer)
}

async function listContainers(taskId) {
  const waiting = await listWaitingContainers(taskId)
  const stored = await listStoredContainers(taskId)
  return { waiting, stored }
}

/**
 * 上架：绑定库位、容器变 ACTIVE、sync 库存、写流水、尝试闭环任务
 */
async function putaway(taskId, { containerId, locationId }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[taskRow]] = await conn.query(
      'SELECT id, status, lock_version FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('入库任务不存在', 404)
    const ts = Number(taskRow.status)
    if (ts >= 4) throw new AppError('任务已完成或已取消', 400)
    if (ts === 1) throw new AppError('任务尚未开始收货，无法上架', 400)

    const [[c]] = await conn.query(
      `SELECT c.*, t.task_no, t.purchase_order_id
       FROM inventory_containers c
       INNER JOIN inbound_tasks t ON t.id = c.inbound_task_id
       WHERE c.id = ? AND c.deleted_at IS NULL FOR UPDATE`,
      [containerId],
    )
    if (!c) throw new AppError('容器不存在', 404)
    if (Number(c.inbound_task_id) !== Number(taskId)) throw new AppError('容器不属于该入库任务', 400)
    if (Number(c.status) !== CONTAINER_STATUS.PENDING_PUTAWAY) {
      throw new AppError('容器须为待上架状态（status=4）', 400)
    }

    const [[loc]] = await conn.query(
      `SELECT l.id, l.code, l.warehouse_id, l.status
       FROM warehouse_locations l
       WHERE l.id = ? AND l.deleted_at IS NULL AND l.status = 1 FOR UPDATE`,
      [locationId],
    )
    if (!loc) throw new AppError('库位不存在或已停用', 404)
    if (Number(loc.warehouse_id) !== Number(c.warehouse_id)) throw new AppError('库位与容器不在同一仓库', 400)

    await conn.query(
      `UPDATE inventory_containers
       SET location_id = ?, status = ?,
           is_overdue = 0, putaway_flagged_overdue = 0, putaway_deadline_at = NULL
       WHERE id = ?`,
      [locationId, CONTAINER_STATUS.ACTIVE, containerId],
    )

    const qty = Number(c.remaining_qty)
    const afterQty = await syncStockFromContainers(conn, c.product_id, c.warehouse_id)
    const beforeQty = afterQty - qty

    await conn.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, supplier_id,
          quantity, before_qty, after_qty, unit_price,
          ref_type, ref_id, ref_no, container_id, log_source_type, log_source_ref_id,
          remark, operator_id, operator_name)
       VALUES (?,1,?,?,NULL,?,?,?,NULL,?,?,?,?,?,?,?,?)`,
      [
        MOVE_TYPE.PURCHASE_IN,
        c.product_id, c.warehouse_id,
        qty, beforeQty, afterQty,
        'inbound_task', taskId, c.task_no,
        containerId, SOURCE_TYPE.INBOUND_TASK, taskId,
        `入库上架 ${c.task_no} 容器#${c.barcode}`,
        operator?.userId || null, operator?.realName || null,
      ],
    )

    let putLeft = qty
    const [itemRows] = await conn.query(
      'SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id',
      [taskId],
    )
    for (const row of itemRows) {
      if (Number(row.product_id) !== Number(c.product_id) || putLeft <= 0) continue
      const cap = Number(row.received_qty) - Number(row.putaway_qty)
      if (cap <= 0) continue
      const inc = Math.min(cap, putLeft)
      await conn.query(
        'UPDATE inbound_task_items SET putaway_qty = putaway_qty + ? WHERE id = ?',
        [inc, row.id],
      )
      putLeft -= inc
    }

    await tryFinishTask(conn, taskId)

    await conn.query('UPDATE inbound_tasks SET lock_version = lock_version + 1 WHERE id = ?', [taskId])

    await conn.commit()
    return { barcode: c.barcode, locationCode: loc.code }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function tryFinishTask(conn, taskId) {
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM inventory_containers
     WHERE inbound_task_id = ? AND deleted_at IS NULL AND status = ?`,
    [taskId, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  if (Number(n) > 0) return

  const [itemRows] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
  if (!itemRows.length) return
  const allReceived = itemRows.every(r => Number(r.received_qty) >= Number(r.ordered_qty))
  const allPutaway = itemRows.every(r => Number(r.putaway_qty) >= Number(r.received_qty))
  if (!allReceived || !allPutaway) return

  await conn.query('UPDATE inbound_tasks SET status = 4 WHERE id = ? AND status = 3', [taskId])

  const [[task]] = await conn.query(
    'SELECT purchase_order_id FROM inbound_tasks WHERE id = ?',
    [taskId],
  )
  if (task?.purchase_order_id) {
    await conn.query('UPDATE purchase_orders SET status = 3 WHERE id = ? AND status = 2', [task.purchase_order_id])
    const [[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id = ?', [task.purchase_order_id])
    if (po) {
      await conn.query(
        `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date)
         VALUES (1,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
        [po.id, po.order_no, po.supplier_name, Number(po.total_amount), Number(po.total_amount)],
      )
    }
  }
}

/** 刷新待上架超时标记（按 putaway_deadline_at 或创建超过 24h） */
async function refreshPutawayOverdueMarks() {
  try {
    const [u] = await pool.query(
      `UPDATE inventory_containers
       SET putaway_flagged_overdue = 1, is_overdue = 1
       WHERE status = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         AND (
           (putaway_deadline_at IS NOT NULL AND putaway_deadline_at < NOW())
           OR (putaway_deadline_at IS NULL AND created_at < DATE_SUB(NOW(), INTERVAL 24 HOUR))
         )
         AND (is_overdue = 0 OR is_overdue IS NULL)`,
      [CONTAINER_STATUS.PENDING_PUTAWAY],
    )
    if (u.affectedRows > 0) {
      logger.warn(`[PutawayOverdue] 新标记 ${u.affectedRows} 个待上架超时容器`)
    }
  } catch (e) {
    if (e.code === 'ER_BAD_FIELD_ERROR') { /* 迁移未执行 */ } else throw e
  }
}

/** 全局待上架容器（跨任务），并标记超时 */
async function listAllPendingPutawayContainers() {
  await refreshPutawayOverdueMarks()

  const [rows] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.warehouse_id, c.remaining_qty, c.created_at,
            c.putaway_deadline_at, c.putaway_flagged_overdue, c.is_overdue, c.inbound_task_id,
            t.task_no, t.purchase_order_no, t.warehouse_name
     FROM inventory_containers c
     INNER JOIN inbound_tasks t ON t.id = c.inbound_task_id
     WHERE c.status = ? AND c.deleted_at IS NULL AND (c.is_legacy = 0 OR c.is_legacy IS NULL)
     ORDER BY c.created_at ASC`,
    [CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  return rows.map(r => ({
    id:            r.id,
    barcode:       r.barcode,
    productId:     r.product_id,
    warehouseId:   r.warehouse_id,
    qty:           Number(r.remaining_qty),
    createdAt:     r.created_at,
    putawayDeadlineAt: r.putaway_deadline_at || null,
    isOverdue:     !!Number(r.is_overdue ?? r.putaway_flagged_overdue),
    inboundTaskId: r.inbound_task_id,
    taskNo:        r.task_no,
    purchaseOrderNo: r.purchase_order_no,
    warehouseName: r.warehouse_name,
  }))
}

async function cancel(taskId) {
  const task = await findById(taskId)
  if (task.status !== 1) throw new AppError('仅待收货状态的任务可取消', 400)
  const [[{ n }]] = await pool.query(
    'SELECT COUNT(*) AS n FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL',
    [taskId],
  )
  if (Number(n) > 0) throw new AppError('任务已产生容器，无法取消', 400)
  await pool.query('UPDATE inbound_tasks SET status = 5 WHERE id = ?', [taskId])
}

module.exports = {
  findAll,
  findById,
  createFromPoId,
  receive,
  putaway,
  listContainers,
  listWaitingContainers,
  listStoredContainers,
  refreshPutawayOverdueMarks,
  listAllPendingPutawayContainers,
  cancel,
}
