const { pool } = require('../../config/db')
const { scopeFilter } = require('../../utils/warehouseScope')
const { beijingYmdAddDays, beijingTodayYmd } = require('../../utils/backendTime')
const { getExpectedStock } = require('../../utils/expectedStock')
const { getStockProjections } = require('../../engine/containerEngine')
const { calculateSupply, transferSurplus } = require('../procurement/procurement.planning')
const { round4 } = require('../../utils/unitConversion')

// Every source contributes once: converted plan lines disappear; only unconverted PR
// remainder remains; converted quantities are represented by live draft/expected POs.
async function getCoverage(conn, pairs, { excludePlanItemIds = [], excludeRequisitionId = 0 } = {}) {
  if (!pairs.length) return new Map()
  const tuple = pairs.map(() => '(?,?)').join(',')
  const values = pairs.flatMap(p => [p.productId, p.warehouseId])
  const exclusions = excludePlanItemIds.length ? ` AND i.id NOT IN (${excludePlanItemIds.map(() => '?').join(',')})` : ''
  const [rows] = await conn.query(`SELECT product_id,warehouse_id,kind,SUM(quantity) AS quantity FROM (
    SELECT i.product_id,i.warehouse_id,'plan' AS kind,i.adjusted_qty AS quantity
    FROM procurement_plan_items i JOIN procurement_plans h ON h.id=i.plan_id
    WHERE h.deleted_at IS NULL AND h.status IN (1,2) AND i.status=1
      AND (i.product_id,i.warehouse_id) IN (${tuple})${exclusions}
    UNION ALL
    SELECT i.product_id,h.warehouse_id,'requisition',GREATEST(0,i.quantity-i.converted_qty)
    FROM purchase_requisition_items i JOIN purchase_requisitions h ON h.id=i.requisition_id
    WHERE h.deleted_at IS NULL AND h.status IN (1,2,3) AND h.id<>?
      AND (i.product_id,h.warehouse_id) IN (${tuple})
    UNION ALL
    SELECT i.product_id,h.warehouse_id,'draft',i.quantity
    FROM purchase_order_items i JOIN purchase_orders h ON h.id=i.order_id
    WHERE h.deleted_at IS NULL AND h.status=1 AND (i.product_id,h.warehouse_id) IN (${tuple})
  ) coverage GROUP BY product_id,warehouse_id,kind`, [...values, ...excludePlanItemIds, excludeRequisitionId, ...values, ...values])
  const out = new Map()
  for (const r of rows) {
    const key = `${Number(r.product_id)}:${Number(r.warehouse_id)}`
    const value = out.get(key) || { planCoverage: 0, requisitionCoverage: 0, draftCoverage: 0 }
    value[`${r.kind}Coverage`] = Number(r.quantity)
    out.set(key, value)
  }
  return out
}

/** Shared supply netting for plan and replenishment. SQL/transport batches remain bounded. */
async function getSupplyRows(options = {}, conn = pool) {
  const { keyword = '', warehouseId = null, categoryId = null, scopeWarehouseIds = null, mode = 'plan', includeCovered = true } = options
  const N = Math.min(365, Math.max(1, Number(options.window) || (mode === 'replenishment' ? 90 : 30)))
  const P = Math.min(365, Math.max(1, Number(options.horizon) || 30))
  const defLead = Math.min(365, Math.max(0, Number(options.defaultLeadTime ?? 7)))
  const method = options.forecastMethod === 'wma' ? 'wma' : 'sma'
  const half = Math.max(1, Math.ceil(N / 2))
  const where = ['p.deleted_at IS NULL', 'p.is_active=1', 'w.deleted_at IS NULL', 'w.is_active=1']
  const filterParams = []
  if (keyword) { where.push('(p.code LIKE ? OR p.name LIKE ?)'); filterParams.push(`%${keyword}%`, `%${keyword}%`) }
  if (categoryId) { where.push('p.category_id=?'); filterParams.push(categoryId) }
  // Read all authorized source warehouses so transfer candidates protect their own demand.
  const scope = scopeFilter(scopeWarehouseIds, 'd.warehouse_id')
  const list = []
  for (let offset = 0; ; offset += 500) {
    const [rows] = await conn.query(`SELECT d.product_id,d.warehouse_id,p.code AS product_code,p.name AS product_name,p.unit,p.article_number,p.spec,p.color,w.name AS warehouse_name,
      COALESCE(sold.total_sold,0) AS total_sold,COALESCE(sold.recent_sold,0) AS recent_sold,
      COALESCE(demand.confirmed_demand,0) AS confirmed_demand,COALESCE(demand.draft_demand,0) AS draft_demand,demand.earliest_demand_date,
      COALESCE(sp.safety_stock,df.safety_stock,0) AS safety_stock,
      COALESCE(sp.reorder_point,df.reorder_point,0) AS reorder_point,
      COALESCE(sp.target_stock,df.target_stock,sp.reorder_point,df.reorder_point,0) AS target_stock,
      sup.id AS supplier_id,sup.name AS supplier_name,COALESCE(sup.lead_time_days,0) AS lead_time,
      pol.entry_unit,COALESCE(pol.pack_multiple,0) AS pack_multiple,COALESCE(pol.minimum_order_qty,0) AS minimum_order_qty,
      COALESCE(CASE WHEN pol.entry_unit=p.unit THEN 1 ELSE pu.conversion_rate END,1) AS conversion_rate
    FROM (
      SELECT product_id,warehouse_id FROM inventory_stock
      UNION SELECT product_id,warehouse_id FROM inventory_containers WHERE deleted_at IS NULL AND status=1
      UNION SELECT i.product_id,COALESCE(i.warehouse_id,h.warehouse_id) FROM sale_order_items i JOIN sale_orders h ON h.id=i.order_id WHERE h.deleted_at IS NULL AND h.status IN (1,2,3,6)
      UNION SELECT product_id,warehouse_id FROM product_stock_policies WHERE warehouse_id<>0
      UNION SELECT s.product_id,w.id FROM product_stock_policies s JOIN inventory_warehouses w ON w.deleted_at IS NULL AND w.is_active=1 WHERE s.warehouse_id=0
      UNION SELECT i.product_id,h.warehouse_id FROM warehouse_task_items i JOIN warehouse_tasks h ON h.id=i.task_id WHERE h.task_type='sale_out' AND h.status=7 AND h.shipped_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
    ) d
    JOIN product_items p ON p.id=d.product_id JOIN inventory_warehouses w ON w.id=d.warehouse_id
    LEFT JOIN (SELECT i.product_id,COALESCE(i.warehouse_id,h.warehouse_id) AS warehouse_id,
       SUM(GREATEST(0,i.quantity-i.shipped_qty)) AS confirmed_demand,
       SUM(CASE WHEN h.status=1 THEN GREATEST(0,i.quantity-i.shipped_qty) ELSE 0 END) AS draft_demand,
       MIN(COALESCE(dl.promised_date,dh.promised_date)) AS earliest_demand_date
       FROM sale_order_items i JOIN sale_orders h ON h.id=i.order_id
       LEFT JOIN order_delivery_commitments dl ON dl.document_type='sale' AND dl.document_id=h.id AND dl.item_id=i.id
       LEFT JOIN order_delivery_commitments dh ON dh.document_type='sale' AND dh.document_id=h.id AND dh.item_id=0
       WHERE h.deleted_at IS NULL AND h.status IN (1,2,3,6)
       GROUP BY i.product_id,COALESCE(i.warehouse_id,h.warehouse_id)) demand ON demand.product_id=d.product_id AND demand.warehouse_id=d.warehouse_id
    LEFT JOIN (SELECT i.product_id,h.warehouse_id,SUM(i.picked_qty) AS total_sold,SUM(CASE WHEN h.shipped_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY) THEN i.picked_qty ELSE 0 END) AS recent_sold
       FROM warehouse_task_items i JOIN warehouse_tasks h ON h.id=i.task_id WHERE h.task_type='sale_out' AND h.status=7 AND h.shipped_at>=DATE_SUB(CURDATE(),INTERVAL ? DAY)
       GROUP BY i.product_id,h.warehouse_id) sold ON sold.product_id=d.product_id AND sold.warehouse_id=d.warehouse_id
    LEFT JOIN product_stock_policies sp ON sp.product_id=d.product_id AND sp.warehouse_id=d.warehouse_id
    LEFT JOIN product_stock_policies df ON df.product_id=d.product_id AND df.warehouse_id=0
    LEFT JOIN supply_suppliers sup ON sup.id=p.supplier_id AND sup.deleted_at IS NULL AND sup.is_active=1
    LEFT JOIN supplier_product_purchase_policies pol ON pol.product_id=p.id AND pol.supplier_id=sup.id
    LEFT JOIN product_units pu ON pu.product_id=p.id AND pu.unit_name=pol.entry_unit
    WHERE ${where.join(' AND ')}${scope.sql} ORDER BY d.product_id,d.warehouse_id LIMIT 500 OFFSET ?`, [N, half, N, ...filterParams, ...scope.params, offset])
    if (!rows.length) break
    const pairs = rows.map(r => ({ productId: Number(r.product_id), warehouseId: Number(r.warehouse_id) }))
    const projections = await getStockProjections(conn, pairs)
    const expected = await getExpectedStock(conn, pairs)
    const coverage = await getCoverage(conn, pairs, options)
    const arrivals = new Map()
    for (const item of expected.supplyItems) {
      const key = `${item.productId}:${item.warehouseId}`
      if (!arrivals.has(key)) arrivals.set(key, [])
      arrivals.get(key).push({ quantity: item.quantity, expectedDate: item.expectedDate ? (item.expectedDate instanceof Date ? beijingTodayYmd(item.expectedDate) : String(item.expectedDate).slice(0, 10)) : null })
    }
    for (const r of rows) {
      const key = `${Number(r.product_id)}:${Number(r.warehouse_id)}`
      const stock = projections.get(key)
      const adu = method === 'wma' ? (Number(r.total_sold) + Number(r.recent_sold)) / (N + half) : Number(r.total_sold) / N
      const leadTimeDays = Number(r.lead_time) > 0 ? Number(r.lead_time) : defLead
      const safetyStock = Number(r.safety_stock)
      const policyTarget = Math.max(Number(r.target_stock), safetyStock)
      const forecastDemand = mode === 'replenishment' ? 0 : adu * (leadTimeDays + P)
      const entryUnit = r.entry_unit || r.unit
      const expectedArrivals = arrivals.get(key) || []
      const demandDate = r.earliest_demand_date ? (r.earliest_demand_date instanceof Date ? beijingTodayYmd(r.earliest_demand_date) : String(r.earliest_demand_date).slice(0, 10)) : null
      const conversionRate = Number(r.conversion_rate)
      const data = {
        id: `${r.product_id}-${r.warehouse_id}`, productId: Number(r.product_id), warehouseId: Number(r.warehouse_id), productCode: r.product_code, productName: r.product_name,
        unit: r.unit, articleNumber: r.article_number || null, spec: r.spec || null, color: r.color || null, warehouseName: r.warehouse_name,
        supplierId: r.supplier_id == null ? null : Number(r.supplier_id), supplierName: r.supplier_name || null, earliestDemandDate: demandDate, expectedArrivals,
        arrivalUnconfirmedQty: round4(expectedArrivals.filter(a => !a.expectedDate).reduce((sum, a) => sum + a.quantity, 0)),
        lateSupplyQty: demandDate ? round4(expectedArrivals.filter(a => a.expectedDate && a.expectedDate > demandDate).reduce((sum, a) => sum + a.quantity, 0)) : 0,
        onHand: stock.quantity, reserved: stock.reserved, available: stock.available, inTransit: expected.byPair.get(key) || 0, expectedBound: expected.boundByPair.get(key) || 0,
        safetyStock, reorderPoint: Number(r.reorder_point), targetStock: policyTarget, adu: round4(adu), leadTimeDays,
        suggestReorderPoint: round4(adu * leadTimeDays + safetyStock), expectedArrival: beijingYmdAddDays(leadTimeDays), draftSalesDemand: Number(r.draft_demand),
        packMultiple: round4(Number(r.pack_multiple) * conversionRate), minimumOrderQty: round4(Number(r.minimum_order_qty) * conversionRate), entryUnit, conversionRate,
        ...coverage.get(key),
      }
      // A replenishment target already includes safety stock: add target once, never target+safety.
      const calculation = calculateSupply({ ...data, forecastDemand, confirmedDemand: Number(r.confirmed_demand), safetyStock: mode === 'replenishment' ? policyTarget : safetyStock })
      const availableAfterDemand = stock.quantity + data.inTransit - Math.max(Number(r.confirmed_demand), stock.reserved)
      const triggered = mode !== 'replenishment' || availableAfterDemand < data.reorderPoint || availableAfterDemand < 0
      list.push({ ...data, ...calculation, triggered, sourceForecastDemand: round4(adu * (leadTimeDays + P)) })
    }
    if (rows.length < 500) break
  }
  const byProduct = new Map()
  for (const row of list) {
    const surplus = transferSurplus({ ...row, forecastDemand: row.sourceForecastDemand, safetyStock: Math.max(row.safetyStock, row.targetStock) })
    if (surplus > 0) {
      if (!byProduct.has(row.productId)) byProduct.set(row.productId, [])
      byProduct.get(row.productId).push({ warehouseId: row.warehouseId, warehouseName: row.warehouseName, quantity: surplus, arrivalCondition: '需人工确认出库、运输和上架时间；确认前不抵扣采购需求', expectedArrival: null })
    }
  }
  const output = list.filter(r => (!warehouseId || r.warehouseId === Number(warehouseId)) && r.triggered && (options.includeAll || (includeCovered ? r.physicalNet > 0 : r.netRequirement > 0)))
    .map(r => ({ ...r, transferCandidates: (byProduct.get(r.productId) || []).filter(c => c.warehouseId !== r.warehouseId).map(c => ({ ...c, quantity: Math.min(c.quantity, r.netRequirement) })).filter(c => c.quantity > 0) }))
    .sort((a, b) => b.netRequirement - a.netRequirement || a.productId - b.productId || a.warehouseId - b.warehouseId)
  return { list: output, params: { window: N, horizon: P, defaultLeadTime: defLead, forecastMethod: method } }
}

async function getProcurementPlan(options = {}, conn = pool) { return getSupplyRows({ ...options, mode: 'plan' }, conn) }
module.exports = { getProcurementPlan, getSupplyRows, getCoverage }
