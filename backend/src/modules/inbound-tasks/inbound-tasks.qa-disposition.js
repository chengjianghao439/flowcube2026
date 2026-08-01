const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { CONTAINER_STATUS, lockStockDimension } = require('../../engine/containerEngine')
const { assertNoSerialManaged } = require('../../engine/serialEngine')
const { lockStatusRow } = require('../../utils/statusTransition')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { appendInboundEvent } = require('./inbound-tasks.helpers')
const { assertInScope } = require('../../utils/warehouseScope')
const { generateDailyCode } = require('../../utils/codeGenerator')

const REJECTED = CONTAINER_STATUS.REJECTED   // 6 质检不合格
const VOID = CONTAINER_STATUS.VOID           // 3 作废

const DISPOSITION_TYPE_NAME = { 1: '退供应商', 2: '报废' }

const round4 = n => Math.round((Number(n) || 0) * 10000) / 10000
const round2 = n => Math.round((Number(n) || 0) * 100) / 100

const fmtDisposition = (r, items = []) => ({
  id: r.id,
  dispositionNo: r.disposition_no,
  inboundTaskId: r.inbound_task_id,
  inboundTaskNo: r.inbound_task_no,
  purchaseOrderId: r.purchase_order_id || null,
  purchaseOrderNo: r.purchase_order_no || null,
  supplierId: r.supplier_id || null,
  supplierName: r.supplier_name || null,
  warehouseId: r.warehouse_id,
  warehouseName: r.warehouse_name || null,
  dispositionType: r.disposition_type,
  dispositionTypeName: DISPOSITION_TYPE_NAME[r.disposition_type] || '未知',
  totalQty: Number(r.total_qty),
  totalAmount: Number(r.total_amount),
  containerCount: r.container_count,
  reason: r.reason || null,
  remark: r.remark || null,
  operatorId: r.operator_id || null,
  operatorName: r.operator_name || null,
  createdAt: r.created_at,
  items,
})

const fmtDispositionItem = it => ({
  id: it.id,
  inboundTaskItemId: it.inbound_task_item_id || null,
  productId: it.product_id,
  productCode: it.product_code,
  productName: it.product_name,
  unit: it.unit,
  quantity: Number(it.quantity),
  unitPrice: Number(it.unit_price),
  amount: Number(it.amount),
  containerCount: it.container_count,
})

/**
 * 来料质检拒收处置（文档 07 · Phase 2）。退供应商 / 报废，二者都只消费本收货订单的
 * REJECTED(6) 容器（6→VOID）。ERP 侧后台管理决策（决定拒收品去向），非 PDA 现场作业。
 *
 * 会计口径（务必理解，见迁移 184 注释）：拒收量在收货时就被隔离在 inventory_stock 与应付之外
 * （Phase 1 §5.4：rejected_qty 永不进 putaway_qty→SUM(putaway×单价) 结算天然不含它；REJECTED
 * status≠1 不计入库存缓存）。故处置这批「从未入账、从未计库存」的货 **零 GL、零缓存影响、不出凭证**。
 * total_amount 仅参考货值（拒收量×采购单价），非入账金额；voucher-engine 不认识本表。
 *
 * 自管事务（与 receive/putaway/voidReceipt 同款）。加锁顺序与 voidReceipt/putaway 一致：
 * 先按 (product_id, warehouse_id) 升序取维度锁，再 FOR UPDATE 容器，避免同维度 ABBA 死锁。
 */
async function createDisposition(taskId, {
  dispositionType,
  productIds = null,   // 指定处置哪些商品的拒收品；null/空=全部未处置 REJECTED
  reason = null,
  remark = null,
  requestKey,
  operator = null,
  scopeWarehouseIds = null,
} = {}) {
  const typeN = Number(dispositionType)
  if (typeN !== 1 && typeN !== 2) throw new AppError('请选择处置方式（退供应商/报废）', 400)
  const filterProductIds = Array.isArray(productIds) && productIds.length
    ? [...new Set(productIds.map(Number).filter(n => Number.isFinite(n) && n > 0))]
    : null

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'inbound.qa.dispose', userId: operator?.userId || null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const taskRow = await lockStatusRow(conn, {
      table: 'inbound_tasks', id: taskId,
      columns: 'id, task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name',
      entityName: '收货订单',
    })
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')

    // 维度锁（先）：本任务未处置 REJECTED 容器涉及的 (product_id, warehouse_id)，升序
    const dimParams = [taskId, REJECTED]
    let dimFilter = ''
    if (filterProductIds) { dimFilter = ` AND product_id IN (${filterProductIds.map(() => '?').join(',')})`; dimParams.push(...filterProductIds) }
    const [dimRows] = await conn.query(
      `SELECT DISTINCT product_id, warehouse_id FROM inventory_containers
       WHERE inbound_task_id = ? AND status = ? AND deleted_at IS NULL${dimFilter}
       ORDER BY product_id ASC, warehouse_id ASC`,
      dimParams,
    )
    if (!dimRows.length) throw new AppError('该收货订单没有待处置的质检拒收品', 400)
    for (const d of dimRows) await lockStockDimension(conn, d.product_id, d.warehouse_id)

    // 容器锁（后）：FOR UPDATE 选中的 REJECTED 容器
    const contParams = [taskId, REJECTED]
    let contFilter = ''
    if (filterProductIds) { contFilter = ` AND c.product_id IN (${filterProductIds.map(() => '?').join(',')})`; contParams.push(...filterProductIds) }
    const [containers] = await conn.query(
      `SELECT c.id, c.product_id, c.warehouse_id, c.remaining_qty, c.inbound_task_item_id, c.unit,
              p.code AS product_code, p.name AS product_name
       FROM inventory_containers c
       LEFT JOIN product_items p ON p.id = c.product_id
       WHERE c.inbound_task_id = ? AND c.status = ? AND c.deleted_at IS NULL${contFilter}
       ORDER BY c.product_id ASC, c.id ASC FOR UPDATE`,
      contParams,
    )
    if (!containers.length) throw new AppError('该收货订单没有待处置的质检拒收品', 400)

    // 序列号管控商品：REJECTED void 会归零 remaining，但序列号回冲 Phase 1 未实现，
    // 与 voidReceipt 一样先挡住，避免"容器归零但序列号仍在库"的不一致（文档 07 · Phase 2 风险项）。
    await assertNoSerialManaged(conn, [...new Set(containers.map(c => c.product_id))], '质检拒收处置')

    // 采购单价快照（参考货值用，非入账）：收货明细行 purchase_item_id → purchase_order_items.unit_price
    const itemIds = [...new Set(containers.map(c => c.inbound_task_item_id).filter(Boolean))]
    const priceByItem = new Map()
    if (itemIds.length) {
      const [priceRows] = await conn.query(
        `SELECT iti.id AS item_id, COALESCE(poi.unit_price, 0) AS unit_price
         FROM inbound_task_items iti
         LEFT JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
         WHERE iti.id IN (${itemIds.map(() => '?').join(',')})`,
        itemIds,
      )
      for (const r of priceRows) priceByItem.set(Number(r.item_id), Number(r.unit_price) || 0)
    }

    // 供应商ID：表头只有 supplier_name，供应商ID自采购单带出（退供应商索赔用）
    let supplierId = null
    if (taskRow.purchase_order_id) {
      const [[po]] = await conn.query('SELECT supplier_id FROM purchase_orders WHERE id = ?', [taskRow.purchase_order_id])
      supplierId = po?.supplier_id || null
    }

    // 按商品聚合处置量
    const byProduct = new Map()
    let totalQty = 0
    for (const c of containers) {
      const pid = Number(c.product_id)
      const qty = Number(c.remaining_qty) || 0
      const price = priceByItem.get(Number(c.inbound_task_item_id)) || 0
      let g = byProduct.get(pid)
      if (!g) {
        g = { productId: pid, productCode: c.product_code, productName: c.product_name, unit: c.unit, itemId: c.inbound_task_item_id || null, qty: 0, unitPrice: price, containerCount: 0 }
        byProduct.set(pid, g)
      }
      g.qty = round4(g.qty + qty)
      g.containerCount += 1
      if (!g.unitPrice && price) g.unitPrice = price
      totalQty = round4(totalQty + qty)
    }

    // 消费 REJECTED 容器：6→VOID，remaining 归零、脱离库位。非 ACTIVE 不进 inventory_stock，
    // 无需 syncStockFromContainers（与 void.js 非 ACTIVE 分支一致，缓存不受影响）。
    const containerIds = containers.map(c => c.id)
    await conn.query(
      `UPDATE inventory_containers SET status = ?, remaining_qty = 0, location_id = NULL WHERE id IN (${containerIds.map(() => '?').join(',')})`,
      [VOID, ...containerIds],
    )

    const dispositionNo = await generateDailyCode(conn, 'QAD', 'inbound_qa_dispositions', 'disposition_no')
    let totalAmount = 0
    const lines = []
    for (const g of byProduct.values()) {
      const amount = round2(g.qty * (g.unitPrice || 0))
      totalAmount = round2(totalAmount + amount)
      lines.push([g.itemId, g.productId, g.productCode, g.productName, g.unit, g.qty, g.unitPrice || 0, amount, g.containerCount])
    }

    const [ins] = await conn.query(
      `INSERT INTO inbound_qa_dispositions
        (disposition_no, inbound_task_id, inbound_task_no, purchase_order_id, purchase_order_no,
         supplier_id, supplier_name, warehouse_id, warehouse_name, disposition_type,
         total_qty, total_amount, container_count, reason, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        dispositionNo, taskId, taskRow.task_no, taskRow.purchase_order_id || null, taskRow.purchase_order_no || null,
        supplierId, taskRow.supplier_name || null, taskRow.warehouse_id, taskRow.warehouse_name || null, typeN,
        totalQty, totalAmount, containerIds.length, reason || null, remark || null,
        operator?.userId || null, operator?.realName || null,
      ],
    )
    const dispositionId = ins.insertId
    for (const line of lines) {
      await conn.query(
        `INSERT INTO inbound_qa_disposition_items
          (disposition_id, inbound_task_item_id, product_id, product_code, product_name, unit, quantity, unit_price, amount, container_count)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [dispositionId, ...line],
      )
    }

    await appendInboundEvent(
      conn, taskId, 'qa_disposed', '质检拒收处置',
      `拒收品处置：${DISPOSITION_TYPE_NAME[typeN]} ${totalQty} 件（处置单 ${dispositionNo}）${reason ? `，原因：${reason}` : ''}`,
      operator || { userId: null, realName: null },
      { dispositionId, dispositionNo, dispositionType: typeN, totalQty, totalAmount, containerIds },
    )

    const payload = { id: dispositionId, dispositionNo, dispositionType: typeN, totalQty, totalAmount, containerCount: containerIds.length }
    if (requestState.enabled) {
      await completeOperationRequest(conn, requestState, {
        data: payload, message: `拒收处置 ${DISPOSITION_TYPE_NAME[typeN]} ${totalQty} 件`,
        resourceType: 'inbound_qa_disposition', resourceId: dispositionId,
      })
    }
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 某收货订单的拒收处置历史（供 ERP 收货详情展示）。 */
async function listByTask(taskId) {
  const [rows] = await pool.query(
    'SELECT * FROM inbound_qa_dispositions WHERE inbound_task_id = ? AND deleted_at IS NULL ORDER BY id DESC',
    [taskId],
  )
  if (!rows.length) return []
  const ids = rows.map(r => r.id)
  const [items] = await pool.query(
    `SELECT * FROM inbound_qa_disposition_items WHERE disposition_id IN (${ids.map(() => '?').join(',')}) ORDER BY id ASC`,
    ids,
  )
  const itemsByDispo = new Map()
  for (const it of items) {
    if (!itemsByDispo.has(it.disposition_id)) itemsByDispo.set(it.disposition_id, [])
    itemsByDispo.get(it.disposition_id).push(fmtDispositionItem(it))
  }
  return rows.map(r => fmtDisposition(r, itemsByDispo.get(r.id) || []))
}

module.exports = { createDisposition, listByTask }
