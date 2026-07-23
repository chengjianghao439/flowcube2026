/**
 * 拣货缺货上报（warehouse_task_shortages）
 *
 * 原则：仓库侧只上报事实（"这个商品现场拣不出 N 件"），不做业务决策；
 * 决策由 ERP 端完成——「按实拣改单」（内部复用销售改单的减量路径）或
 * 「驳回」（线下补货后让现场继续拣）。任务存在未处理上报时，拣货完成
 * （readyToShip）被拦截，防止带着缺口进入后续流程。
 */
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { lockStatusRow } = require('../../utils/statusTransition')
const { WT_STATUS } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { logSideEffectFailure } = require('./warehouse-tasks.helpers')

const SHORTAGE_STATUS = Object.freeze({ OPEN: 1, RESOLVED: 2, DISMISSED: 3 })
const SHORTAGE_STATUS_NAME = Object.freeze({ 1: '待处理', 2: '已改单处理', 3: '已驳回' })

function fmtShortage(r) {
  return {
    id: Number(r.id),
    taskId: Number(r.task_id),
    taskNo: r.task_no,
    saleOrderId: r.sale_order_id != null ? Number(r.sale_order_id) : null,
    productId: Number(r.product_id),
    productName: r.product_name,
    missingQty: Number(r.missing_qty),
    reason: r.reason,
    status: Number(r.status),
    statusName: SHORTAGE_STATUS_NAME[Number(r.status)] || null,
    reportedBy: r.reported_by,
    reportedByName: r.reported_by_name,
    resolvedBy: r.resolved_by,
    resolvedByName: r.resolved_by_name,
    resolvedAt: r.resolved_at,
    createdAt: r.created_at,
  }
}

/** PDA 上报缺货：仅登记事实并挂起任务推进，不改任何数量 */
async function reportShortage(taskId, { productId, missingQty, reason = null }, operator) {
  const pid = Number(productId)
  const qty = Number(missingQty)
  if (!Number.isFinite(pid) || pid <= 0) throw new AppError('商品无效', 400)
  if (!Number.isFinite(qty) || qty <= 0) throw new AppError('缺口数量必须大于 0', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks', id: taskId,
      columns: 'id, task_no, status, sale_order_id, cancel_requested_at',
      entityName: '仓库任务',
    })
    if (taskRow.cancel_requested_at) throw new AppError('该任务正在取消收尾中，无需上报缺货', 409)
    if (Number(taskRow.status) !== WT_STATUS.PICKING) {
      throw new AppError('只有拣货中的任务可以上报缺货', 400)
    }

    const [[item]] = await conn.query(
      'SELECT id, product_name, required_qty, picked_qty FROM warehouse_task_items WHERE task_id=? AND product_id=?',
      [taskId, pid],
    )
    if (!item) throw new AppError('该商品不在本任务明细中', 404)
    const unpicked = Number(item.required_qty) - Number(item.picked_qty)
    if (qty > unpicked) {
      throw new AppError(`缺口数量不能超过未拣数量（需 ${item.required_qty}，已拣 ${item.picked_qty}，未拣 ${unpicked}）`, 400)
    }

    const [[dup]] = await conn.query(
      'SELECT id FROM warehouse_task_shortages WHERE task_id=? AND product_id=? AND status=? LIMIT 1',
      [taskId, pid, SHORTAGE_STATUS.OPEN],
    )
    if (dup) throw new AppError('该商品已有未处理的缺货上报，请等待 ERP 端处理', 409)

    const [r] = await conn.query(
      `INSERT INTO warehouse_task_shortages
         (task_id, task_no, sale_order_id, product_id, product_name, missing_qty, reason, status, reported_by, reported_by_name)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [taskId, taskRow.task_no, taskRow.sale_order_id || null, pid, item.product_name, qty,
        reason ? String(reason).slice(0, 200) : null, SHORTAGE_STATUS.OPEN,
        operator?.userId ?? null, operator?.realName ?? null],
    )
    await conn.query('UPDATE warehouse_tasks SET shortage_reported_at = NOW() WHERE id=?', [taskId])
    try {
      await recordEvent(conn, {
        taskId, taskNo: taskRow.task_no,
        eventType: WT_EVENT.SHORTAGE_REPORTED,
        operatorId: operator?.userId ?? null, operatorName: operator?.realName ?? null,
        detail: { shortageId: r.insertId, productId: pid, productName: item.product_name, missingQty: qty, reason },
      })
    } catch (eventErr) {
      logSideEffectFailure('仓库任务事件写入失败：缺货上报事件', eventErr, { taskId, shortageId: r.insertId })
    }
    await conn.commit()
    return { shortageId: r.insertId, productName: item.product_name, missingQty: qty }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function listByTask(taskId) {
  const [rows] = await pool.query(
    'SELECT * FROM warehouse_task_shortages WHERE task_id=? ORDER BY id DESC',
    [taskId],
  )
  return rows.map(fmtShortage)
}

/** 待处理缺货上报清单（ERP 端处理入口列表） */
async function listPending({ page = 1, pageSize = 20 } = {}) {
  const offset = (page - 1) * pageSize
  const [rows] = await pool.query(
    `SELECT s.*, so.order_no AS sale_order_no
     FROM warehouse_task_shortages s
     LEFT JOIN sale_orders so ON so.id = s.sale_order_id
     WHERE s.status = ?
     ORDER BY s.id ASC LIMIT ? OFFSET ?`,
    [SHORTAGE_STATUS.OPEN, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    'SELECT COUNT(*) AS total FROM warehouse_task_shortages WHERE status=?',
    [SHORTAGE_STATUS.OPEN],
  )
  return {
    list: rows.map(r => ({ ...fmtShortage(r), saleOrderNo: r.sale_order_no || null })),
    pagination: { page, pageSize, total },
  }
}

/** 任务无剩余未处理上报时清空挂起标记（同一事务内调用） */
async function clearFlagIfNoOpen(conn, taskId) {
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM warehouse_task_shortages WHERE task_id=? AND status=?',
    [taskId, SHORTAGE_STATUS.OPEN],
  )
  if (Number(n) === 0) {
    await conn.query('UPDATE warehouse_tasks SET shortage_reported_at = NULL WHERE id=?', [taskId])
  }
  return Number(n)
}

/**
 * ERP 端处理缺货上报：
 *  - action='adjustToPicked'：按实拣改单——把销售单里该商品数量减去缺口量，
 *    内部复用 sale.requestAdjustment 的减量路径（缺口 ≤ 未拣量，全部被未拣层
 *    吸收，改单立即生效、无需 PDA 物理确认），随后标记上报已处理。
 *  - action='dismiss'：驳回——线下已补货，现场继续拣，仅关闭上报。
 */
async function resolveShortage(shortageId, { action }, operator) {
  if (!['adjustToPicked', 'dismiss'].includes(action)) throw new AppError('处理动作无效', 400)

  const [[shortage]] = await pool.query('SELECT * FROM warehouse_task_shortages WHERE id=?', [shortageId])
  if (!shortage) throw new AppError('缺货上报不存在', 404)
  if (Number(shortage.status) !== SHORTAGE_STATUS.OPEN) throw new AppError('该上报已处理', 409)

  if (action === 'adjustToPicked') {
    if (!shortage.sale_order_id) throw new AppError('该任务无关联销售单（采购退货任务请直接驳回并线下处理）', 400)
    // 拼装"新明细"：原行全部保留，把上报商品的数量合计减去缺口量（从最后一行往前扣），
    // 然后走标准改单流程（含幂等键，重复点击安全）。
    const [itemRows] = await pool.query(
      'SELECT * FROM sale_order_items WHERE order_id=? ORDER BY id',
      [shortage.sale_order_id],
    )
    if (!itemRows.length) throw new AppError('销售单无明细', 400)
    let toReduce = Number(shortage.missing_qty)
    const items = itemRows.map(r => ({
      productId: Number(r.product_id),
      productCode: r.product_code,
      productName: r.product_name,
      unit: r.unit,
      articleNumber: r.article_number || null,
      spec: r.spec || null,
      color: r.color || null,
      quantity: Number(r.quantity),
      unitPrice: Number(r.unit_price),
      remark: r.remark || null,
    }))
    for (let i = items.length - 1; i >= 0 && toReduce > 0; i--) {
      if (items[i].productId !== Number(shortage.product_id)) continue
      const cut = Math.min(items[i].quantity, toReduce)
      items[i].quantity -= cut
      toReduce -= cut
    }
    if (toReduce > 0) throw new AppError('销售单明细数量不足以扣减缺口，请人工核对改单', 409)
    const finalItems = items.filter(i => i.quantity > 0)
    if (!finalItems.length) throw new AppError('扣减缺口后销售单将无任何明细，请改用取消订单处理', 409)

    const saleSvc = require('../sale/sale.service')
    await saleSvc.requestAdjustment(Number(shortage.sale_order_id), {
      items: finalItems,
      operator,
      requestKey: `shortage-adjust-${shortageId}`,
    })
  }

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [upd] = await conn.query(
      `UPDATE warehouse_task_shortages
       SET status=?, resolved_by=?, resolved_by_name=?, resolved_at=NOW()
       WHERE id=? AND status=?`,
      [action === 'adjustToPicked' ? SHORTAGE_STATUS.RESOLVED : SHORTAGE_STATUS.DISMISSED,
        operator?.userId ?? null, operator?.realName ?? null, shortageId, SHORTAGE_STATUS.OPEN],
    )
    if (upd.affectedRows !== 1) throw new AppError('该上报已被并发处理，请刷新', 409)
    await clearFlagIfNoOpen(conn, Number(shortage.task_id))
    try {
      await recordEvent(conn, {
        taskId: Number(shortage.task_id), taskNo: shortage.task_no,
        eventType: WT_EVENT.SHORTAGE_RESOLVED,
        operatorId: operator?.userId ?? null, operatorName: operator?.realName ?? null,
        detail: { shortageId: Number(shortageId), action, productId: Number(shortage.product_id), missingQty: Number(shortage.missing_qty) },
      })
    } catch (eventErr) {
      logSideEffectFailure('仓库任务事件写入失败：缺货处理事件', eventErr, { shortageId })
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return { shortageId: Number(shortageId), action }
}

/** 任务取消时批量驳回未处理上报（在取消事务内调用），避免留下永远无人处理的挂起项 */
async function dismissOpenShortagesForTask(conn, taskId) {
  const [r] = await conn.query(
    `UPDATE warehouse_task_shortages
     SET status=?, resolved_by_name='系统（任务取消自动关闭）', resolved_at=NOW()
     WHERE task_id=? AND status=?`,
    [SHORTAGE_STATUS.DISMISSED, taskId, SHORTAGE_STATUS.OPEN],
  )
  if (r.affectedRows > 0) {
    await conn.query('UPDATE warehouse_tasks SET shortage_reported_at = NULL WHERE id=?', [taskId])
  }
  return r.affectedRows
}

/** readyToShip 拦截：存在未处理上报时禁止拣货完成（同一事务内调用） */
async function assertNoOpenShortage(conn, taskId) {
  const [[{ n }]] = await conn.query(
    'SELECT COUNT(*) AS n FROM warehouse_task_shortages WHERE task_id=? AND status=?',
    [taskId, SHORTAGE_STATUS.OPEN],
  )
  if (Number(n) > 0) {
    throw new AppError('该任务存在未处理的缺货上报，请等待 ERP 端处理（按实拣改单或驳回）后再完成拣货', 409)
  }
}

module.exports = {
  SHORTAGE_STATUS,
  reportShortage,
  listByTask,
  listPending,
  resolveShortage,
  dismissOpenShortagesForTask,
  assertNoOpenShortage,
}
