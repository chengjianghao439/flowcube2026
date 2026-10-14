const { commitFulfillment } = require('../fulfillment/fulfillment.refresh')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { syncStockFromContainers, lockStockDimension, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { MOVE_TYPE, writeInventoryLog } = require('../../engine/inventoryEngine')
const { appendInboundEvent, assertPurchaseOrdersOpen } = require('./inbound-tasks.helpers')
const { assertTaskCanPutaway } = require('./inbound-tasks.status')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { settlePurchaseOnAudit } = require('./inbound-tasks.settle')
const { reduceExpectedBindings } = require('../../utils/expectedStock')
const { assertInScope } = require('../../utils/warehouseScope')
const { buildPutawayContributions, movingAverageCost } = require('./inbound-tasks.cost')

async function tryFinishTask(conn, taskId) {
  // 调用方持有任务行锁；阶段用当前读，不能沿用等待任务锁前的 RR 快照。
  // 收货开放时不能因当前实收已全上架而结算。
  const [[taskMeta]] = await conn.query('SELECT status, closed_reason FROM inbound_tasks WHERE id = ? FOR UPDATE', [taskId])
  if (Number(taskMeta?.status) !== 3) return
  const finishRule = assertStatusAction('inboundTask', 'finish', taskMeta.status)
  // 待上架(4) 容器只要还有一个未处理，任务就不能完结
  const [[{ n }]] = await conn.query(
    `SELECT COUNT(*) AS n FROM inventory_containers
     WHERE inbound_task_id = ? AND deleted_at IS NULL AND status = ?`,
    [taskId, CONTAINER_STATUS.PENDING_PUTAWAY],
  )
  if (Number(n) > 0) return

  // 本次短装结束（closeReceiving 写入 closed_reason='short_close'）：本批不再继续收，
  // 原采购未收承诺保留供后续任务，不能将它当作明确取消剩余采购。
  // 不能再要求「收满」才允许完结，否则任务永久卡在待上架——PDA 上没有任何可上架的容器，
  // audit_status 永远停在 0，应付账款永不生成，连带 purchase.closeRemaining 也被堵死
  // （它要求关联收货订单 audit_status=1），用户在前端完全无路可走（审计 P0-3）。
  // 结算侧按 putaway_qty 全量重算，金额天然等于实收，无需额外处理。
  const shortClosed = taskMeta?.closed_reason === 'short_close'

  const [itemRows] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
  if (!itemRows.length) return
  const allReceived = shortClosed || itemRows.every(r => Number(r.received_qty) >= Number(r.ordered_qty))
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

async function putaway(taskId, { containerId, locationId, deviatedFromSuggestion, suggestedLocationCode }, operator, { requestKey, pdaWarehouseId, scopeWarehouseIds = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, {
      table: 'inbound_tasks',
      id: taskId,
      columns: 'id, status, lock_version, warehouse_id',
      entityName: '入库任务',
    })
    // 设备级跨仓拦截：req.pda 由 pdaSessionRequired 中间件填充，PDA 必须先扫码绑定设备。
    // 设备绑定了仓库时，这里挡住「A 仓的机器上架B 仓单据」；设备未绑仓库则不限仓，
    // 此时仍有下面的用户级 scope 断言兜底。
    if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(taskRow.warehouse_id)) {
      throw new AppError('当前设备绑定仓库与该收货订单所属仓库不一致，无法上架', 403)
    }
    // 用户级仓库权限：设备会话尚未接入前端时（req.pda 恒为 null），这才是实际生效的那道闸门
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')
    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      action: 'inbound.putaway',
      userId: operator?.userId ?? null,
      resourceType: 'inbound_task',
      resourceId: taskId,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    assertTaskCanPutaway(taskRow)
    await assertPurchaseOrdersOpen(conn, taskId, '上架')

    // 先确定该容器所属的「商品+仓库」维度并取维度锁，再做单容器加锁读——顺序不能反。
    // 上架的最后一步要汇总整个维度刷新 inventory_stock 缓存；若先锁住自己这只容器
    // 再去请求汇总范围锁，两个上架员同时扫同一商品的不同箱就会成环死锁；
    // 而不给汇总加锁则会丢失更新、库存凭空蒸发（详见 containerEngine.lockStockDimension）。
    // product_id / warehouse_id 是容器的不可变字段，这里无锁预读安全，
    // 真正的状态与归属校验仍由下面的加锁读负责。
    const [[cRef]] = await conn.query(
      'SELECT product_id, warehouse_id, inbound_task_id FROM inventory_containers WHERE id = ? AND deleted_at IS NULL',
      [containerId],
    )
    if (!cRef) throw new AppError('库存条码不存在', 404)
    if (Number(cRef.inbound_task_id) !== Number(taskId)) throw new AppError('库存条码不属于该入库任务',400)
    // This path also updates avg_cost: take the product X lock before any
    // policy S/stock/container locks, avoiding concurrent S-to-X upgrades.
    await conn.query('SELECT id FROM product_items WHERE id=? FOR UPDATE',[cRef.product_id])
    await lockStockDimension(conn, cRef.product_id, cRef.warehouse_id)

    const [[c]] = await conn.query(
      `SELECT c.*, t.task_no, t.purchase_order_id
       FROM inventory_containers c
       INNER JOIN inbound_tasks t ON t.id = c.inbound_task_id
       WHERE c.id = ? AND c.deleted_at IS NULL FOR UPDATE`,
      [containerId],
    )
    if (!c) throw new AppError('库存条码不存在', 404)
    if (Number(c.inbound_task_id) !== Number(taskId)) throw new AppError('库存条码不属于该入库任务', 400)
    if (Number(c.status) !== CONTAINER_STATUS.PENDING_PUTAWAY) {
      throw new AppError('库存条码须为待上架状态', 400)
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
    if (Number(loc.warehouse_id) !== Number(c.warehouse_id)) throw new AppError('库位与库存条码不在同一仓库', 400)

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

    // 原箱来源贡献同时决定上架明细、预计绑定兑现、入库单价与移动加权成本。
    // 任务锁串行化本单明细；商品X锁已经在维度/容器锁之前取得，跨仓均价仍串行。
    const [itemRows] = await conn.query(
      `SELECT iti.*, poi.unit_price
       FROM inbound_task_items iti
       JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
       WHERE iti.task_id = ? ORDER BY iti.id`,
      [taskId],
    )
    const contribution = buildPutawayContributions(c, itemRows)
    const purchasePrice = contribution.purchasePrice
    if (purchasePrice != null) {
      const [[prod]] = await conn.query(
        'SELECT avg_cost, cost_price FROM product_items WHERE id = ? FOR UPDATE',
        [c.product_id],
      )
      if (prod) {
        const [[{ globalQty }]] = await conn.query(
          `SELECT COALESCE(SUM(remaining_qty), 0) AS globalQty
           FROM inventory_containers
           WHERE product_id = ? AND status = 1 AND deleted_at IS NULL
           FOR UPDATE`,
          [c.product_id],
        )
        // Keep the original positive-inbound moving-average policy. Source products
        // retain six-decimal amount precision until the four-decimal final average.
        const newAvg = movingAverageCost({ globalQty, oldAverage: prod.avg_cost ?? prod.cost_price ?? 0, contribution })
        await conn.query('UPDATE product_items SET avg_cost = ? WHERE id = ?', [newAvg, c.product_id])
      }
    }

    await writeInventoryLog(conn, {
      moveType: MOVE_TYPE.PURCHASE_IN,
      type: 1,
      productId: c.product_id,
      warehouseId: c.warehouse_id,
      supplierId: null,
      quantity: qty,
      beforeQty, afterQty,
      unitPrice: purchasePrice,
      refType: 'inbound_task',
      refId: taskId,
      refNo: c.task_no,
      containerId,
      sourceType: SOURCE_TYPE.INBOUND_TASK,
      sourceRefId: taskId,
      remark: `入库上架 ${c.task_no} 容器#${c.barcode}`,
      operatorId: operator?.userId || null,
      operatorName: operator?.realName || null,
    })

    if (contribution.allocations.length) {
      const clauses = contribution.allocations.map(() => 'WHEN ? THEN ?').join(' ')
      await conn.query(`UPDATE inbound_task_items SET putaway_qty = putaway_qty + CASE id ${clauses} END
        WHERE task_id = ? AND id IN (?)`,
      [...contribution.allocations.flatMap(part => [part.itemId, part.qty]), taskId, contribution.allocations.map(part => part.itemId)])
    }
    for (const part of contribution.allocations) {
      const row = itemRows.find(item => Number(item.id) === part.itemId)
      if (row.purchase_item_id != null) {
        await reduceExpectedBindings(conn, { purchaseItemId: row.purchase_item_id }, part.qty)
      }
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
    await commitFulfillment(conn, 'inbound', taskId)
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
