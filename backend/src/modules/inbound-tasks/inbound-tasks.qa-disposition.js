const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { CONTAINER_STATUS, lockStockDimension } = require('../../engine/containerEngine')
const { lockStatusRow } = require('../../utils/statusTransition')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { appendInboundEvent } = require('./inbound-tasks.helpers')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')
const { generateDailyCode } = require('../../utils/codeGenerator')

const REJECTED = CONTAINER_STATUS.REJECTED   // 6 质检不合格
const VOID = CONTAINER_STATUS.VOID           // 3 作废

const DISPOSITION_TYPE_NAME = { 1: '退供应商', 2: '报废' }
const DISPOSITION_STATUS_NAME = { 1: '待扫出', 2: '已完成' }   // Phase3：1=待PDA物理扫出确认 2=已完成

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
  status: r.status != null ? Number(r.status) : 2,
  statusName: DISPOSITION_STATUS_NAME[r.status != null ? Number(r.status) : 2] || '未知',
  scannedCount: r.scanned_count != null ? Number(r.scanned_count) : null,
  pendingCount: r.pending_count != null ? Number(r.pending_count) : null,
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
      `SELECT c.id, c.product_id, c.warehouse_id, c.remaining_qty, c.inbound_task_item_id, c.unit, c.barcode,
              p.code AS product_code, p.name AS product_name
       FROM inventory_containers c
       LEFT JOIN product_items p ON p.id = c.product_id
       WHERE c.inbound_task_id = ? AND c.status = ? AND c.deleted_at IS NULL${contFilter}
         AND NOT EXISTS (SELECT 1 FROM inbound_qa_disposition_containers dc WHERE dc.container_id = c.id)
       ORDER BY c.product_id ASC, c.id ASC FOR UPDATE`,
      contParams,
    )
    if (!containers.length) throw new AppError('该收货订单没有待处置的质检拒收品', 400)

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

    // Phase3 严格化：**不立即 void**。容器保持 REJECTED，登记到处置单待扫出清单
    // （下方 INSERT inbound_qa_disposition_containers），等仓库在 PDA 逐个扫码物理确认出场时才
    // void(6→VOID)。处置决策(ERP) 与物理出场(PDA 扫码) 分离，守
    // 「仓库端只执行不决策」；容器已被本处置单认领（uk_dispo_container 唯一约束 + 上面 NOT EXISTS）不会重复处置。
    const containerIds = containers.map(c => c.id)

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
         supplier_id, supplier_name, warehouse_id, warehouse_name, disposition_type, status,
         total_qty, total_amount, container_count, reason, remark, operator_id, operator_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?)`,
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
    // 待扫出容器清单：每个 REJECTED 容器一行（barcode/qty 快照），scanned_at 留空待 PDA 扫出
    for (const c of containers) {
      await conn.query(
        `INSERT INTO inbound_qa_disposition_containers (disposition_id, container_id, product_id, barcode, qty)
         VALUES (?, ?, ?, ?, ?)`,
        [dispositionId, c.id, c.product_id, c.barcode, Number(c.remaining_qty) || 0],
      )
    }

    await appendInboundEvent(
      conn, taskId, 'qa_disposed', '质检拒收处置',
      `拒收品处置：${DISPOSITION_TYPE_NAME[typeN]} ${totalQty} 件（处置单 ${dispositionNo}）待仓库 PDA 扫出确认${reason ? `，原因：${reason}` : ''}`,
      operator || { userId: null, realName: null },
      { dispositionId, dispositionNo, dispositionType: typeN, status: 1, totalQty, totalAmount, containerIds },
    )

    const payload = { id: dispositionId, dispositionNo, dispositionType: typeN, status: 1, totalQty, totalAmount, containerCount: containerIds.length }
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

const SCAN_PROGRESS_SUBQ = `
  (SELECT COUNT(*) FROM inbound_qa_disposition_containers dc WHERE dc.disposition_id = d.id AND dc.scanned_at IS NOT NULL) AS scanned_count,
  (SELECT COUNT(*) FROM inbound_qa_disposition_containers dc WHERE dc.disposition_id = d.id AND dc.scanned_at IS NULL) AS pending_count`

/** 某收货订单的拒收处置历史（供 ERP 收货详情展示，带扫出进度）。 */
async function listByTask(taskId) {
  const [rows] = await pool.query(
    `SELECT d.*,${SCAN_PROGRESS_SUBQ} FROM inbound_qa_dispositions d WHERE d.inbound_task_id = ? AND d.deleted_at IS NULL ORDER BY d.id DESC`,
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

/** PDA 待扫出处置单列表（status=1，接仓库数据权限）。 */
async function listPendingScanOut({ scopeWarehouseIds = null } = {}) {
  const scope = scopeFilter(scopeWarehouseIds, 'd.warehouse_id')
  const [rows] = await pool.query(
    `SELECT d.*,${SCAN_PROGRESS_SUBQ} FROM inbound_qa_dispositions d
     WHERE d.status = 1 AND d.deleted_at IS NULL${scope.sql}
     ORDER BY d.id ASC`,
    scope.params,
  )
  return rows.map(r => fmtDisposition(r, []))
}

/** 单个处置单的待扫出/已扫出容器清单（PDA 作业页 + ERP 进度）。 */
async function getScanDetail(dispositionId, scopeWarehouseIds = null) {
  const [[d]] = await pool.query(
    `SELECT d.*,${SCAN_PROGRESS_SUBQ} FROM inbound_qa_dispositions d WHERE d.id = ? AND d.deleted_at IS NULL`,
    [dispositionId],
  )
  if (!d) throw new AppError('拒收处置单不存在', 404)
  assertInScope(scopeWarehouseIds, d.warehouse_id, '拒收处置单')
  const [containers] = await pool.query(
    `SELECT dc.id, dc.container_id, dc.barcode, dc.qty, dc.scanned_at, dc.product_id,
            p.name AS product_name, p.code AS product_code
     FROM inbound_qa_disposition_containers dc
     LEFT JOIN product_items p ON p.id = dc.product_id
     WHERE dc.disposition_id = ? ORDER BY dc.scanned_at IS NOT NULL, dc.id ASC`,
    [dispositionId],
  )
  return {
    ...fmtDisposition(d, []),
    containers: containers.map(c => ({
      id: c.id, containerId: c.container_id, barcode: c.barcode, qty: Number(c.qty),
      productId: c.product_id, productName: c.product_name, productCode: c.product_code,
      scanned: !!c.scanned_at, scannedAt: c.scanned_at,
    })),
  }
}

/**
 * PDA 拒收处置物理扫出：仓库扫一个 REJECTED 容器码，物理确认出场 → void(6→VOID)。
 * 全部容器扫完 → 处置单 status=2 已完成。守「仓库端只执行不决策」（只扫系统列出的容器，不自选）。
 * 自管事务；requestKey 幂等（断网重扫不重复 void）；加锁顺序：处置单头 → 待扫容器行 → 库存维度 → 容器。
 */
async function scanOut(dispositionId, { barcode, requestKey, operator = null, pdaWarehouseId = null, scopeWarehouseIds = null } = {}) {
  const bc = String(barcode || '').trim()
  if (!bc) throw new AppError('请扫描容器条码', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'inbound.qa.dispose.scan', userId: operator?.userId || null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const d = await lockStatusRow(conn, {
      table: 'inbound_qa_dispositions', id: dispositionId,
      columns: 'id, disposition_no, inbound_task_id, warehouse_id, status',
      entityName: '拒收处置单',
    })
    if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(d.warehouse_id)) {
      throw new AppError('当前设备绑定仓库与处置单仓库不一致，无法扫出', 403)
    }
    assertInScope(scopeWarehouseIds, d.warehouse_id, '拒收处置单')
    if (Number(d.status) !== 1) throw new AppError('该处置单已完成扫出', 409)

    const [[dc]] = await conn.query(
      'SELECT id, container_id, scanned_at FROM inbound_qa_disposition_containers WHERE disposition_id = ? AND barcode = ? FOR UPDATE',
      [dispositionId, bc],
    )
    if (!dc) throw new AppError(`条码 ${bc} 不在本处置单待扫清单中`, 400, 'DISPOSE_SCAN_NOT_IN_LIST')
    if (dc.scanned_at) throw new AppError(`容器 ${bc} 已扫出，请勿重复`, 409, 'DISPOSE_SCAN_DUPLICATE')

    const [[c]] = await conn.query('SELECT id, product_id, warehouse_id, status FROM inventory_containers WHERE id = ? FOR UPDATE', [dc.container_id])
    if (!c || Number(c.status) !== REJECTED) throw new AppError('该容器状态异常，非待处置拒收品', 409)
    await lockStockDimension(conn, c.product_id, c.warehouse_id)
    // 物理出场：6→VOID，脱离库位、remaining 归零（非 ACTIVE 不进缓存，无需 syncStock）
    await conn.query('UPDATE inventory_containers SET status = ?, remaining_qty = 0, location_id = NULL WHERE id = ?', [VOID, c.id])
    await conn.query('UPDATE inbound_qa_disposition_containers SET scanned_at = NOW(), scanned_by = ? WHERE id = ?', [operator?.userId || null, dc.id])

    const [[{ pending }]] = await conn.query(
      'SELECT COUNT(*) AS pending FROM inbound_qa_disposition_containers WHERE disposition_id = ? AND scanned_at IS NULL',
      [dispositionId],
    )
    const done = Number(pending) === 0
    if (done) {
      await conn.query('UPDATE inbound_qa_dispositions SET status = 2 WHERE id = ?', [dispositionId])
      await appendInboundEvent(
        conn, d.inbound_task_id, 'qa_dispose_scanned', '拒收处置扫出完成',
        `处置单 ${d.disposition_no} 全部拒收品已 PDA 扫出确认物理出场`,
        operator || { userId: null, realName: null }, { dispositionId, allDone: true },
      )
    }

    const payload = { dispositionId, containerId: c.id, barcode: bc, pending: Number(pending), done }
    if (requestState.enabled) {
      await completeOperationRequest(conn, requestState, { data: payload, message: `扫出 ${bc}`, resourceType: 'inbound_qa_disposition', resourceId: dispositionId })
    }
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

module.exports = { createDisposition, listByTask, listPendingScanOut, getScanDetail, scanOut }
