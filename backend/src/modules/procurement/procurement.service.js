const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { generateMasterCode } = require('../../utils/codeGenerator')
const { getProcurementPlan } = require('../inventory/inventory.procurement')
const purchaseService = require('../purchase/purchase.service')
const { normalizePagination } = require('../../utils/pagination')

const PLAN_STATUS = { DRAFT: 1, PARTIAL: 2, DONE: 3, VOID: 4 }
const PLAN_STATUS_NAME = { 1: '草稿', 2: '部分转采购', 3: '已完成', 4: '已作废' }
const ITEM_STATUS = { PENDING: 1, CONVERTED: 2, IGNORED: 3 }
const ITEM_STATUS_NAME = { 1: '待处理', 2: '已转采购', 3: '已忽略' }

function fmtPlan(r) {
  return {
    id: Number(r.id), code: r.code, name: r.name || null,
    horizonDays: Number(r.horizon_days), forecastMethod: r.forecast_method, forecastWindow: Number(r.forecast_window),
    defaultLeadTime: Number(r.default_lead_time),
    status: Number(r.status), statusName: PLAN_STATUS_NAME[Number(r.status)] || '',
    itemCount: Number(r.item_count),
    operatorId: Number(r.operator_id), operatorName: r.operator_name || null,
    remark: r.remark || null, createdAt: r.created_at, updatedAt: r.updated_at,
  }
}

function fmtItem(r) {
  return {
    id: Number(r.id), planId: Number(r.plan_id),
    productId: Number(r.product_id), productCode: r.product_code, productName: r.product_name, unit: r.unit,
    warehouseId: Number(r.warehouse_id), warehouseName: r.warehouse_name,
    supplierId: r.supplier_id != null ? Number(r.supplier_id) : null, supplierName: r.supplier_name || null,
    adu: Number(r.adu), forecastDemand: Number(r.forecast_demand), safetyStock: Number(r.safety_stock),
    available: Number(r.available), inTransit: Number(r.in_transit), leadTimeDays: Number(r.lead_time_days),
    suggestedQty: Number(r.suggested_qty), adjustedQty: Number(r.adjusted_qty),
    expectedArrival: r.expected_arrival, status: Number(r.status), statusName: ITEM_STATUS_NAME[Number(r.status)] || '',
    purchaseOrderId: r.purchase_order_id != null ? Number(r.purchase_order_id) : null,
  }
}

/**
 * 生成采购计划（文档 11 单据化）。复用 MVP 只读计算 getProcurementPlan 得出建议行，整批快照落库为单据。
 * 计算阶段纯只读（不碰库存/在途/占库），落库只写 procurement_plans / _items。X-Request-Key 幂等防连点生成两批。
 */
async function generatePlan({ window = 30, horizon = 30, warehouseId = null, name = null, defaultLeadTime = 7, remark = null, operator, requestKey, scopeWarehouseIds = null }) {
  // 目标仓若指定，须在数据权限内
  if (warehouseId) assertInScope(scopeWarehouseIds, warehouseId, '仓库')
  // 只读计算（在事务外做，避免长事务）
  const { list, params } = await getProcurementPlan({ window, horizon, warehouseId, defaultLeadTime, scopeWarehouseIds })
  if (!list.length) throw new AppError('按当前参数没有需要采购的商品（近期无出库或供给已充足）', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'procurement.plan.generate', userId: operator?.userId ?? null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const code = await generateMasterCode(conn, 'PLAN', 'procurement_plans')
    const [r] = await conn.query(
      `INSERT INTO procurement_plans (code, name, horizon_days, forecast_method, forecast_window, default_lead_time, status, item_count, operator_id, operator_name, remark)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [code, name || null, params.horizon, 'sma', params.window, params.defaultLeadTime, PLAN_STATUS.DRAFT, list.length, operator.userId, operator.realName || null, remark || null],
    )
    const planId = r.insertId
    for (const it of list) {
      await conn.query(
        `INSERT INTO procurement_plan_items
           (plan_id, product_id, warehouse_id, product_code, product_name, unit, warehouse_name, supplier_id, supplier_name,
            adu, forecast_demand, safety_stock, available, in_transit, lead_time_days, suggested_qty, adjusted_qty, expected_arrival, status)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [planId, it.productId, it.warehouseId, it.productCode, it.productName, it.unit, it.warehouseName, it.supplierId, it.supplierName,
          it.adu, it.forecastDemand, it.safetyStock, it.available, it.inTransit, it.leadTimeDays, it.suggestedQty, it.suggestedQty, it.expectedArrival, ITEM_STATUS.PENDING],
      )
    }
    const result = { id: planId, code, itemCount: list.length }
    await completeOperationRequest(conn, requestState, { data: result, message: '采购计划已生成', resourceType: 'procurement_plan', resourceId: planId })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 计划头列表：只列在数据权限内（有≥1行落在 scope 仓库）的计划，分页 + 关键字。 */
async function listPlans({ page = 1, pageSize = 20, keyword = '', status = null, scopeWarehouseIds = null }) {
  const conds = ['pp.deleted_at IS NULL']
  const params = []
  if (keyword) { conds.push('(pp.code LIKE ? OR pp.name LIKE ?)'); params.push(`%${keyword}%`, `%${keyword}%`) }
  if (status != null) { conds.push('pp.status = ?'); params.push(Number(status)) }
  // 数据权限：限定为「至少有一行明细落在 scope 仓库」的计划（计划头本身跨仓，无单一仓库列）
  const scope = scopeFilter(scopeWarehouseIds, 'ppi.warehouse_id')
  if (scope.sql) {
    conds.push(`EXISTS (SELECT 1 FROM procurement_plan_items ppi WHERE ppi.plan_id = pp.id${scope.sql})`)
    params.push(...scope.params)
  }
  const where = conds.join(' AND ')
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })
  const [rows] = await pool.query(
    `SELECT * FROM procurement_plans pp WHERE ${where} ORDER BY pp.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM procurement_plans pp WHERE ${where}`, params)
  return { list: rows.map(fmtPlan), pagination: { page: Number(page), pageSize: ps, total: Number(total) } }
}

async function getPlan(id, scopeWarehouseIds = null) {
  const [[plan]] = await pool.query('SELECT * FROM procurement_plans WHERE id = ? AND deleted_at IS NULL', [id])
  if (!plan) throw new AppError('采购计划不存在', 404)
  // 明细按数据权限过滤（跨仓计划里，限权用户只看自己仓的行）
  const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const [items] = await pool.query(
    `SELECT * FROM procurement_plan_items WHERE plan_id = ?${scope.sql} ORDER BY suggested_qty DESC, id`,
    [id, ...scope.params],
  )
  return { ...fmtPlan(plan), items: items.map(fmtItem) }
}

/** 改一行：调整量 / 补选供应商 / 忽略。仅草稿或部分转采购态可改；已转采购的行不可再改。 */
async function updatePlanItem(planId, itemId, { adjustedQty, supplierId, ignore }, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const plan = await lockStatusRow(conn, { table: 'procurement_plans', id: planId, columns: 'id, status', entityName: '采购计划' })
    assertStatusAction('procurementPlan', 'edit', plan.status)
    const [[item]] = await conn.query('SELECT * FROM procurement_plan_items WHERE id = ? AND plan_id = ? FOR UPDATE', [itemId, planId])
    if (!item) throw new AppError('计划明细不存在', 404)
    assertInScope(scopeWarehouseIds, item.warehouse_id, '计划明细')
    if (Number(item.status) === ITEM_STATUS.CONVERTED) throw new AppError('该行已转采购，不能再修改', 400)

    const sets = []
    const params = []
    if (adjustedQty != null) {
      const q = Number(adjustedQty)
      if (!Number.isFinite(q) || q < 0) throw new AppError('调整数量不能为负', 400)
      sets.push('adjusted_qty = ?'); params.push(q)
    }
    if (supplierId !== undefined) {
      if (supplierId === null) { sets.push('supplier_id = NULL, supplier_name = NULL') }
      else {
        const [[sup]] = await conn.query('SELECT id, name, is_active FROM supply_suppliers WHERE id = ? AND deleted_at IS NULL', [Number(supplierId)])
        if (!sup) throw new AppError('供应商不存在', 404)
        if (!sup.is_active) throw new AppError('该供应商已停用', 400)
        sets.push('supplier_id = ?, supplier_name = ?'); params.push(sup.id, sup.name)
      }
    }
    if (ignore != null) { sets.push('status = ?'); params.push(ignore ? ITEM_STATUS.IGNORED : ITEM_STATUS.PENDING) }
    if (!sets.length) throw new AppError('没有要修改的字段', 400)
    await conn.query(`UPDATE procurement_plan_items SET ${sets.join(', ')} WHERE id = ?`, [...params, itemId])
    await conn.commit()
    return getPlan(planId, scopeWarehouseIds)
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/**
 * 转采购（文档 11 · 5.4）：勾选待处理行，按 (供应商, 仓库) 分组，每组生成一张采购单草稿(status=1，需人工确认)。
 * 绝不自动提交采购单。事务内：锁计划头 → 逐行校验(待处理/在scope/已选供应商) → 建草稿 → CAS 回写行 → 收口计划状态。
 */
async function convert(planId, { itemIds, target = 'purchase', operator, requestKey, scopeWarehouseIds = null }) {
  if (target !== 'purchase') throw new AppError('暂只支持转采购单草稿（请购单待文档02落地）', 400)
  const ids = [...new Set((itemIds || []).map(Number).filter(n => n > 0))]
  if (!ids.length) throw new AppError('请至少勾选一行转采购', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'procurement.plan.convert', userId: operator?.userId ?? null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const plan = await lockStatusRow(conn, { table: 'procurement_plans', id: planId, columns: 'id, status', entityName: '采购计划' })
    assertStatusAction('procurementPlan', 'convert', plan.status)

    const [items] = await conn.query(
      `SELECT * FROM procurement_plan_items WHERE plan_id = ? AND id IN (${ids.map(() => '?').join(',')}) FOR UPDATE`,
      [planId, ...ids],
    )
    if (items.length !== ids.length) throw new AppError('部分明细不存在，请刷新后重试', 400)
    for (const it of items) {
      assertInScope(scopeWarehouseIds, it.warehouse_id, '计划明细')
      if (Number(it.status) !== ITEM_STATUS.PENDING) throw new AppError(`${it.product_name} 不是待处理状态，无法转采购`, 400)
      if (!it.supplier_id) throw new AppError(`${it.product_name} 尚未选择供应商，请先在明细里补选`, 400)
      if (Number(it.adjusted_qty) <= 0) throw new AppError(`${it.product_name} 采购量为 0，请先调整或忽略该行`, 400)
    }

    // 按 (供应商, 仓库) 分组，每组一张采购单草稿
    const groups = new Map()
    for (const it of items) {
      const key = `${it.supplier_id}:${it.warehouse_id}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(it)
    }

    const createdOrders = []
    for (const [key, groupItems] of groups) {
      const [supplierId, warehouseId] = key.split(':').map(Number)
      const first = groupItems[0]
      // 复用采购创建链路：产出草稿(status=1)，单价留 0 由采购员确认时补。requestKey 加组后缀防组间撞幂等键。
      const po = await purchaseService.createWithinTransaction(conn, {
        supplierId, supplierName: first.supplier_name,
        warehouseId, warehouseName: first.warehouse_name,
        remark: `由采购计划 ${plan.id} 转入`,
        items: groupItems.map(it => ({
          productId: Number(it.product_id), productCode: it.product_code, productName: it.product_name,
          unit: it.unit, quantity: Number(it.adjusted_qty), unitPrice: 0,
        })),
        operator,
      })
      for (const it of groupItems) {
        await conn.query('UPDATE procurement_plan_items SET status = ?, purchase_order_id = ? WHERE id = ?', [ITEM_STATUS.CONVERTED, po.id, it.id])
      }
      createdOrders.push({ purchaseOrderId: po.id, orderNo: po.orderNo, supplierId, warehouseId, itemCount: groupItems.length })
    }

    // 收口计划状态：全部（非忽略）行都已转 → 已完成(3)，否则 部分转采购(2)
    const [[{ pending }]] = await conn.query(
      'SELECT COUNT(*) AS pending FROM procurement_plan_items WHERE plan_id = ? AND status = ?',
      [planId, ITEM_STATUS.PENDING],
    )
    const nextStatus = Number(pending) === 0 ? PLAN_STATUS.DONE : PLAN_STATUS.PARTIAL
    await compareAndSetStatus(conn, { table: 'procurement_plans', id: planId, fromStatus: plan.status, toStatus: nextStatus, entityName: '采购计划' })

    const result = { planId, planStatus: nextStatus, createdOrders }
    await completeOperationRequest(conn, requestState, { data: result, message: `已生成 ${createdOrders.length} 张采购单草稿`, resourceType: 'procurement_plan', resourceId: planId })
    await conn.commit()
    return result
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

/** 作废计划（草稿/部分转采购态可作废；已转采购的行不回滚，仅计划头置作废）。 */
async function cancel(planId, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const plan = await lockStatusRow(conn, { table: 'procurement_plans', id: planId, columns: 'id, status', entityName: '采购计划' })
    // 作废仅需计划头级校验；明细跨仓，limited 用户能否作废由是否看得到该计划兜底（此处放行 scope=null 情形）
    if (scopeWarehouseIds) {
      const [[owned]] = await conn.query(
        `SELECT 1 AS ok FROM procurement_plan_items WHERE plan_id = ?${scopeFilter(scopeWarehouseIds, 'warehouse_id').sql} LIMIT 1`,
        [planId, ...scopeFilter(scopeWarehouseIds, 'warehouse_id').params],
      )
      if (!owned) throw new AppError('无权作废该采购计划', 403)
    }
    const rule = assertStatusAction('procurementPlan', 'cancel', plan.status)
    await compareAndSetStatus(conn, { table: 'procurement_plans', id: planId, fromStatus: plan.status, toStatus: rule.to, entityName: '采购计划' })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

module.exports = { generatePlan, listPlans, getPlan, updatePlanItem, convert, cancel }
