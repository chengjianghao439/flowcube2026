const { pool } = require('../../config/db')

/**
 * 全局搜索（跨单据 + 基础资料）。
 *
 * 覆盖 16 类：商品/供应商/客户/采购单/销售单/采购请购/调拨/采购退货/销售退货/
 * 收货订单/费用报销/呆滞处置/退款单/超额放行申请/盘点单/发票。
 * 每类最多 5 条，按类型分组返回；path 指向具体单据详情。
 *
 * 仓库数据权限（2026-08-21 审计 A.4 修复）：有 warehouseColumn 的实体按用户仓库
 * 范围过滤（限仓用户只搜到自己仓库的单据）；无仓库列的实体（基础资料/费用/退款/
 * 放行/发票）保持全量。调拨是跨仓实体（from/to 任一在范围内即可见）。
 */

const ENTITIES = [
  { type: 'product',      label: '商品',       pathBase: '/products',             table: 'product_items',              noField: 'code',      subtitleField: 'code',       searchFields: ['name', 'code'] },
  { type: 'supplier',     label: '供应商',     pathBase: '/suppliers',            table: 'supply_suppliers',          noField: 'code',      subtitleField: 'code',       searchFields: ['name'] },
  { type: 'customer',     label: '客户',       pathBase: '/customers',            table: 'sale_customers',            noField: 'code',      subtitleField: 'code',       searchFields: ['name'] },
  { type: 'purchase',     label: '采购单',     pathBase: '/purchase',             table: 'purchase_orders',           noField: 'order_no',  subtitleField: 'supplier_name', searchFields: ['order_no'], warehouseColumn: 'warehouse_id' },
  { type: 'sale',         label: '销售单',     pathBase: '/sale',                 table: 'sale_orders',               noField: 'order_no',  subtitleField: 'customer_name', searchFields: ['order_no'], warehouseColumn: 'warehouse_id' },
  { type: 'requisition',  label: '采购请购',   pathBase: '/purchase-requisitions', table: 'purchase_requisitions',    noField: 'requisition_no', subtitleField: 'applicant_name', searchFields: ['requisition_no', 'title'], warehouseColumn: 'warehouse_id' },
  { type: 'transfer',     label: '调拨单',     pathBase: '/transfer',             table: 'transfer_orders',           noField: 'order_no',  subtitleField: 'from_warehouse_name', searchFields: ['order_no'], warehouseColumn: 'from_warehouse_id', warehouseColumnOr: 'to_warehouse_id' },
  { type: 'purchaseReturn', label: '采购退货', pathBase: '/returns/purchase',      table: 'purchase_returns',          noField: 'return_no', subtitleField: 'supplier_name', searchFields: ['return_no'], warehouseColumn: 'warehouse_id' },
  { type: 'saleReturn',   label: '销售退货',   pathBase: '/returns/sale',          table: 'sale_returns',              noField: 'return_no', subtitleField: 'customer_name', searchFields: ['return_no'], warehouseColumn: 'warehouse_id' },
  { type: 'inbound',      label: '收货订单',   pathBase: '/inbound-tasks',        table: 'inbound_tasks',             noField: 'task_no',   subtitleField: 'supplier_name', searchFields: ['task_no'], warehouseColumn: 'warehouse_id' },
  { type: 'expense',      label: '费用报销',   pathBase: '/expenses',              table: 'expense_claims',            noField: 'claim_no',  subtitleField: 'applicant_name', searchFields: ['claim_no', 'title'] },
  { type: 'disposal',     label: '呆滞处置',   pathBase: '/disposals',             table: 'inventory_disposal_orders', noField: 'disposal_no', subtitleField: 'warehouse_name', searchFields: ['disposal_no'], warehouseColumn: 'warehouse_id' },
  { type: 'refund',       label: '退款单',     pathBase: '/refunds',               table: 'refund_orders',             noField: 'refund_no', subtitleField: 'customer_name', searchFields: ['refund_no'] },
  { type: 'creditOverride', label: '超额放行', pathBase: '/credit-overrides',      table: 'sale_credit_overrides',     noField: 'override_no', subtitleField: 'customer_name', searchFields: ['override_no'] },
  { type: 'stockcheck',   label: '盘点单',     pathBase: '/stockcheck',            table: 'inventory_checks',          noField: 'check_no',  subtitleField: 'warehouse_name', searchFields: ['check_no'], warehouseColumn: 'warehouse_id' },
  { type: 'invoice',      label: '发票',       pathBase: '/accounting/invoices',   table: 'fin_invoices',              noField: 'invoice_no', subtitleField: 'party_name',    searchFields: ['invoice_no'] },
]

async function searchGlobal(rawQuery, scopeWarehouseIds = null, { startDate = '', endDate = '' } = {}) {
  const keyword = String(rawQuery || '').trim()
  if (!keyword) return { data: [], message: '请输入搜索词' }

  const like = `%${keyword}%`
  const results = []
  // 时间筛选（2026-08-21）：按 created_at 过滤，startDate/endDate 为 YYYY-MM-DD
  const hasDateRange = Boolean(startDate || endDate)

  // 逐实体查询（每类 LIMIT 5），并行执行
  await Promise.all(ENTITIES.map(async (ent) => {
    const searchCond = ent.searchFields.map(f => `${f} LIKE ?`).join(' OR ')
    const conds = [`deleted_at IS NULL`, `(${searchCond})`]
    const params = ent.searchFields.map(() => like)

    // 时间范围过滤（全部实体都有 created_at）
    if (hasDateRange) {
      if (startDate) { conds.push('created_at >= ?'); params.push(`${startDate} 00:00:00`) }
      if (endDate)   { conds.push('created_at <= ?'); params.push(`${endDate} 23:59:59`) }
    }

    // 仓库数据权限（2026-08-21 审计 A.4 修复）：限仓用户只搜到自己仓库的单据；
    // 调拨实体 from/to 任一在范围内即可见（对齐 transferScopeFilter 语义）
    if (Array.isArray(scopeWarehouseIds) && ent.warehouseColumn) {
      if (scopeWarehouseIds.length) {
        if (ent.warehouseColumnOr) {
          conds.push(`(${ent.warehouseColumn} IN (?) OR ${ent.warehouseColumnOr} IN (?))`)
          params.push(scopeWarehouseIds, scopeWarehouseIds)
        } else {
          conds.push(`${ent.warehouseColumn} IN (?)`)
          params.push(scopeWarehouseIds)
        }
      } else {
        conds.push('1=0')
      }
    }

    const sql = `SELECT id, ${ent.noField} AS no_val, ${ent.subtitleField} AS subtitle
                 FROM ${ent.table}
                 WHERE ${conds.join(' AND ')}
                 ORDER BY id DESC LIMIT 5`
    const [rows] = await pool.query(sql, params)
    for (const r of rows) {
      results.push({
        id: Number(r.id),
        type: ent.type,
        typeLabel: ent.label,
        title: r.no_val,
        subtitle: r.subtitle || '',
        path: `${ent.pathBase}/${Number(r.id)}`,
      })
    }
  }))

  // 基础资料类（商品/供应商/客户）跳列表页而非详情（无详情路由，或列表页更常用）
  // —— 上述 path 已统一为详情形式；对无详情页的类型回退到列表
  const noDetailTypes = new Set(['product', 'supplier', 'customer'])
  for (const r of results) {
    if (noDetailTypes.has(r.type)) {
      const ent = ENTITIES.find(e => e.type === r.type)
      r.path = ent.pathBase
    }
  }

  const ordered = ENTITIES.map(e => e.type)
  results.sort((a, b) => ordered.indexOf(a.type) - ordered.indexOf(b.type))

  return { data: results, message: results.length ? '搜索成功' : '未找到相关内容' }
}

module.exports = { searchGlobal, ENTITIES }
