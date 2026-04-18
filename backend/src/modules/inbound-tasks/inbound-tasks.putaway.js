const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { syncStockFromContainers, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { appendInboundEvent } = require('./inbound-tasks.helpers')
const { assertTaskCanPutaway } = require('./inbound-tasks.status')

async function syncPurchaseOrderStatus(conn, purchaseOrderId) {
  if (!Number.isFinite(purchaseOrderId) || purchaseOrderId <= 0) return

  const [rows] = await conn.query(
    `SELECT
        poi.id,
        poi.quantity,
        COALESCE(SUM(
          CASE
            WHEN it.id IS NULL OR it.deleted_at IS NOT NULL OR it.status = 5 THEN 0
            ELSE iti.putaway_qty
          END
        ), 0) AS putaway_qty
      FROM purchase_order_items poi
      LEFT JOIN inbound_task_items iti
        ON iti.purchase_item_id = poi.id
      LEFT JOIN inbound_tasks it
        ON it.id = iti.task_id
      WHERE poi.order_id = ?
      GROUP BY poi.id, poi.quantity`,
    [purchaseOrderId],
  )

  const completed = rows.length > 0 && rows.every(row => Number(row.putaway_qty) >= Number(row.quantity))
  if (!completed) return

  await conn.query('UPDATE purchase_orders SET status = 3 WHERE id = ? AND status = 2', [purchaseOrderId])
  const [[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id = ?', [purchaseOrderId])
  if (!po) return

  await conn.query(
    `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date)
     VALUES (1,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
    [po.id, po.order_no, po.supplier_name, Number(po.total_amount), Number(po.total_amount)],
  )
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

  const [res] = await conn.query('UPDATE inbound_tasks SET status = 4 WHERE id = ? AND status = 3', [taskId])
  if (res.affectedRows > 0) {
    await appendInboundEvent(
      conn,
      taskId,
      'putaway_completed',
      '上架完成',
      '收货订单已全部上架，等待审核',
      null,
      null,
    )
  }

  const [poRows] = await conn.query(
    `SELECT DISTINCT purchase_order_id
     FROM inbound_task_items
     WHERE task_id = ? AND purchase_order_id IS NOT NULL`,
    [taskId],
  )

  for (const row of poRows) {
    await syncPurchaseOrderStatus(conn, Number(row.purchase_order_id))
  }
}

async function putaway(taskId, { containerId, locationId }, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[taskRow]] = await conn.query(
      'SELECT id, status, lock_version FROM inbound_tasks WHERE id = ? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!taskRow) throw new AppError('入库任务不存在', 404)
    assertTaskCanPutaway(taskRow)

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

    const [[storedBefore]] = await conn.query(
      `SELECT COUNT(*) AS n
       FROM inventory_containers
       WHERE inbound_task_id = ? AND deleted_at IS NULL AND status = ?`,
      [taskId, CONTAINER_STATUS.ACTIVE],
    )
    if (Number(storedBefore?.n || 0) === 0) {
      await appendInboundEvent(
        conn,
        taskId,
        'putaway_started',
        '开始上架',
        `开始执行收货订单 ${c.task_no} 的扫码上架`,
        operator,
        null,
      )
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

    await appendInboundEvent(
      conn,
      taskId,
      'putaway_recorded',
      '完成上架',
      `库存条码 ${c.barcode} 已上架到货架 ${loc.code}`,
      operator,
      {
        containerId,
        barcode: c.barcode,
        locationId,
        locationCode: loc.code,
      },
    )

    await conn.commit()
    return { barcode: c.barcode, locationCode: loc.code }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  putaway,
  tryFinishTask,
  syncPurchaseOrderStatus,
}
