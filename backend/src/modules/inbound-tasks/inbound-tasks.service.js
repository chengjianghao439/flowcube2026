const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { createContainer, syncStockFromContainers } = require('../../engine/containerEngine')
const { findOrCreateByRackLevel } = require('../locations/locations.service')
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
  operatorId:      r.operator_id       || null,
  operatorName:    r.operator_name     || null,
  remark:          r.remark            || null,
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

// ── 创建（由采购确认时调用）────────────────────────────────────────────────

async function createForPurchaseOrder({ purchaseOrderId, purchaseOrderNo, supplierName, warehouseId, warehouseName, items, conn: extConn }) {
  const useConn = extConn || pool
  const taskNo = await genTaskNo(useConn)
  const [r] = await useConn.query(
    `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status)
     VALUES (?,?,?,?,?,?,1)`,
    [taskNo, purchaseOrderId, purchaseOrderNo, supplierName, warehouseId, warehouseName],
  )
  const taskId = r.insertId
  for (const item of items) {
    await useConn.query(
      `INSERT INTO inbound_task_items (task_id, product_id, product_code, product_name, unit, ordered_qty)
       VALUES (?,?,?,?,?,?)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.quantity],
    )
  }
  return { taskId, taskNo }
}

// ── 收货 ─────────────────────────────────────────────────────────────────────

async function receive(taskId, { items }) {
  const task = await findById(taskId)
  if (task.status >= 4) throw new AppError('任务已完成或已取消', 400)
  if (task.status === 3) throw new AppError('任务已全部收货，请执行上架', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 状态推进到收货中
    if (task.status === 1) {
      await conn.query('UPDATE inbound_tasks SET status = 2 WHERE id = ?', [taskId])
    }

    for (const { itemId, qty } of items) {
      const taskItem = task.items.find(i => i.id === itemId)
      if (!taskItem) throw new AppError(`明细 ${itemId} 不属于该任务`, 400)

      const remaining = taskItem.orderedQty - taskItem.receivedQty
      if (qty > remaining) throw new AppError(`${taskItem.productName} 收货数量 ${qty} 超出剩余 ${remaining}`, 400)

      await conn.query(
        'UPDATE inbound_task_items SET received_qty = received_qty + ? WHERE id = ?',
        [qty, itemId],
      )
    }

    // 检查是否全部收货 → 待上架
    const [updatedItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
    const allReceived = updatedItems.every(i => Number(i.received_qty) >= Number(i.ordered_qty))
    if (allReceived) {
      await conn.query('UPDATE inbound_tasks SET status = 3 WHERE id = ?', [taskId])
    }

    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ── 上架（创建容器 + 绑定库位）──────────────────────────────────────────────

async function putaway(taskId, { items, operator }) {
  const task = await findById(taskId)
  if (task.status < 2 || task.status >= 4) throw new AppError('任务状态不允许上架', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    for (const { itemId, qty, locationId, rackCode, level, position } of items) {
      const taskItem = task.items.find(i => i.id === itemId)
      if (!taskItem) throw new AppError(`明细 ${itemId} 不属于该任务`, 400)

      const maxPutaway = taskItem.receivedQty - taskItem.putawayQty
      if (qty > maxPutaway) throw new AppError(`${taskItem.productName} 上架数量 ${qty} 超出可上架 ${maxPutaway}`, 400)

      // 解析库位 ID：优先用 locationId，其次用 rackCode+level+position 自动生成
      let resolvedLocationId = locationId || null
      if (!resolvedLocationId && rackCode && level && position) {
        resolvedLocationId = await findOrCreateByRackLevel(conn, {
          warehouseId: task.warehouseId,
          rackCode,
          level,
          position,
        })
      }

      // 创建容器（绑定库位）
      const { barcode } = await createContainer(conn, {
        productId:     taskItem.productId,
        warehouseId:   task.warehouseId,
        locationId:    resolvedLocationId,
        initialQty:    qty,
        unit:          taskItem.unit,
        sourceRefType: 'inbound_task',
        sourceRefId:   taskId,
        sourceRefNo:   task.taskNo,
        remark:        `入库上架 ${task.taskNo}`,
      })

      // 同步 inventory_stock 缓存
      const afterQty = await syncStockFromContainers(conn, taskItem.productId, task.warehouseId)
      const beforeQty = afterQty - qty

      // 写入库存变动日志
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id, supplier_id,
            quantity, before_qty, after_qty, unit_price,
            ref_type, ref_id, ref_no,
            remark, operator_id, operator_name)
         VALUES (?,1,?,?,NULL,?,?,?,NULL,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.PURCHASE_IN,
          taskItem.productId, task.warehouseId,
          qty, beforeQty, afterQty,
          'inbound_task', taskId, task.taskNo,
          `入库上架 ${task.taskNo} 容器#${barcode}`,
          operator?.userId || null, operator?.realName || null,
        ],
      )

      await conn.query(
        'UPDATE inbound_task_items SET putaway_qty = putaway_qty + ? WHERE id = ?',
        [qty, itemId],
      )
    }

    // 检查是否全部上架 → 已完成
    const [updatedItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
    const allPutaway = updatedItems.every(i => Number(i.putaway_qty) >= Number(i.received_qty) && Number(i.received_qty) >= Number(i.ordered_qty))
    if (allPutaway) {
      await conn.query('UPDATE inbound_tasks SET status = 4 WHERE id = ?', [taskId])

      // 同步采购订单为已收货
      if (task.purchaseOrderId) {
        await conn.query('UPDATE purchase_orders SET status = 3 WHERE id = ? AND status = 2', [task.purchaseOrderId])
        // 生成应付账款
        const [[po]] = await conn.query('SELECT * FROM purchase_orders WHERE id = ?', [task.purchaseOrderId])
        if (po) {
          await conn.query(
            `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date)
             VALUES (1,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
            [po.id, po.order_no, po.supplier_name, Number(po.total_amount), Number(po.total_amount)],
          )
        }
      }
    }

    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ── 取消 ─────────────────────────────────────────────────────────────────────

async function cancel(taskId) {
  const task = await findById(taskId)
  if (task.status >= 3) throw new AppError('待上架/已完成/已取消的任务不能取消', 400)
  await pool.query('UPDATE inbound_tasks SET status = 5 WHERE id = ?', [taskId])
}

module.exports = { findAll, findById, createForPurchaseOrder, receive, putaway, cancel }
