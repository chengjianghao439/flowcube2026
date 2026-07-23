const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { syncStockFromContainers, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { appendInboundEvent, assertPurchaseOrdersOpen } = require('./inbound-tasks.helpers')
const { assertTaskCanPutaway } = require('./inbound-tasks.status')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { settlePurchaseOnAudit } = require('./inbound-tasks.settle')

async function tryFinishTask(conn, taskId) {
  const finishRule = assertStatusAction('inboundTask', 'finish', 3)
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

  try {
    await compareAndSetStatus(conn, {
      table: 'inbound_tasks',
      id: taskId,
      fromStatus: finishRule.from,
      toStatus: finishRule.to,
      entityName: '收货订单',
    })
  } catch (error) {
    if (error?.statusCode !== 409) throw error
    return
  }

  await appendInboundEvent(
    conn,
    taskId,
    'putaway_completed',
    '上架完成',
    '收货订单已全部上架',
    null,
    null,
  )

  // 上架完成即结算：不再需要人工审核，直接按实收（上架）量结算应付并推进采购单（见 inbound-tasks.settle.js）。
  const auditRule = assertStatusAction('inboundTaskAudit', 'approve', 0)
  await conn.query(
    `UPDATE inbound_tasks
     SET audit_status = ?, audited_at = NOW(), audited_by = NULL, audited_by_name = '系统自动结算'
     WHERE id = ?`,
    [auditRule.to, taskId],
  )
  await appendInboundEvent(
    conn,
    taskId,
    'audit_approved',
    '自动结算',
    '收货订单上架完成，系统已按实收量自动结算应付',
    null,
    { auditStatus: auditRule.to },
  )
  await settlePurchaseOnAudit(conn, taskId)
}

async function putaway(taskId, { containerId, locationId, deviatedFromSuggestion, suggestedLocationCode }, operator, { requestKey, pdaWarehouseId } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'inbound.putaway',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const taskRow = await lockStatusRow(conn, {
      table: 'inbound_tasks',
      id: taskId,
      columns: 'id, status, lock_version, warehouse_id',
      entityName: '入库任务',
    })
    // PDA 设备绑定了仓库时，强制校验设备所属仓库与任务仓库一致，防止跨仓库误操作
    if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(taskRow.warehouse_id)) {
      throw new AppError('当前设备绑定仓库与该收货订单所属仓库不一致，无法上架', 403)
    }
    assertTaskCanPutaway(taskRow)
    await assertPurchaseOrdersOpen(conn, taskId, '上架')

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

    // 移动加权成本：按该商品在本任务对应采购明细的采购单价，更新全局均价
    //   avg = (在库量×旧均价 + 上架量×采购价) / (在库量 + 上架量)
    // 在库量取全仓 ACTIVE 容器合计（上架后再减本次量）；查不到采购价（异常数据）则跳过。
    // 退货/撤回不反冲均价——只随入库正向移动（业界通行简化），采购价同时快照进本条日志。
    let purchasePrice = null
    const [[priceRow]] = await conn.query(
      `SELECT poi.unit_price
       FROM inbound_task_items iti
       JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
       WHERE iti.task_id = ? AND iti.product_id = ?
       ORDER BY iti.id LIMIT 1`,
      [taskId, c.product_id],
    )
    if (priceRow && Number(priceRow.unit_price) > 0) {
      purchasePrice = Number(priceRow.unit_price)
      const [[{ globalQty }]] = await conn.query(
        `SELECT COALESCE(SUM(remaining_qty), 0) AS globalQty
         FROM inventory_containers
         WHERE product_id = ? AND status = 1 AND deleted_at IS NULL`,
        [c.product_id],
      )
      const prevQty = Math.max(0, Number(globalQty) - qty)
      const [[prod]] = await conn.query(
        'SELECT avg_cost, cost_price FROM product_items WHERE id = ? FOR UPDATE',
        [c.product_id],
      )
      if (prod) {
        const oldAvg = Number(prod.avg_cost ?? prod.cost_price ?? 0) || 0
        const newAvg = prevQty > 0
          ? (prevQty * oldAvg + qty * purchasePrice) / (prevQty + qty)
          : purchasePrice
        await conn.query('UPDATE product_items SET avg_cost = ? WHERE id = ?', [newAvg.toFixed(4), c.product_id])
      }
    }

    await conn.query(
      `INSERT INTO inventory_logs
         (move_type, type, product_id, warehouse_id, supplier_id,
          quantity, before_qty, after_qty, unit_price,
          ref_type, ref_id, ref_no, container_id, log_source_type, log_source_ref_id,
          remark, operator_id, operator_name)
       VALUES (?,1,?,?,NULL,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        MOVE_TYPE.PURCHASE_IN,
        c.product_id, c.warehouse_id,
        qty, beforeQty, afterQty, purchasePrice,
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
      deviatedFromSuggestion
        ? `库存条码 ${c.barcode} 已上架到货架 ${loc.code}（偏离推荐库位${suggestedLocationCode ? ` ${suggestedLocationCode}` : ''}）`
        : `库存条码 ${c.barcode} 已上架到货架 ${loc.code}`,
      operator,
      {
        containerId,
        barcode: c.barcode,
        locationId,
        locationCode: loc.code,
        ...(deviatedFromSuggestion ? { deviatedFromSuggestion: true, suggestedLocationCode: suggestedLocationCode || null } : {}),
      },
    )

    const payload = { barcode: c.barcode, locationCode: loc.code }
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: '上架成功',
      resourceType: 'inbound_task',
      resourceId: taskId,
    })
    await conn.commit()
    return payload
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
}
