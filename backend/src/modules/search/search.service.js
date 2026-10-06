const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertSqlIdentifier, assertSqlColumnList } = require('../../utils/sqlIdentifier')

/**
 * 全局搜索（跨单据 + 基础资料）。
 *
 * 覆盖 16 类：商品/供应商/客户/采购单/销售单/采购请购/调拨/采购退货/销售退货/
 * 收货订单/费用报销/呆滞处置/退款单/超额放行申请/盘点单/发票。
 * 搜索全部历史记录，不按创建日期过滤。每类按 20 条游标分页，可继续加载全部匹配结果，按类型分组返回；path 指向具体单据详情。
 *
 * 仓库数据权限（2026-08-21 审计 A.4 修复）：有 warehouseColumn 的实体按用户仓库
 * 范围过滤（限仓用户只搜到自己仓库的单据）；无仓库列的实体（基础资料/费用/退款/
 * 放行/发票）保持全量。调拨是跨仓实体（from/to 任一在范围内即可见）。
 */

const { PERMISSIONS: P } = require('../../constants/permissions')

const ENTITIES = [
  { type: 'product', permission: P.PRODUCT_VIEW,      label: '商品',       pathBase: '/products',             table: 'product_items',              noField: 'code',      subtitleField: 'code',       searchFields: ['name', 'code'] },
  { type: 'supplier', permission: P.SUPPLIER_VIEW,     label: '供应商',     pathBase: '/suppliers',            table: 'supply_suppliers',          noField: 'code',      subtitleField: 'code',       searchFields: ['name'] },
  { type: 'customer', permission: P.CUSTOMER_VIEW,     label: '客户',       pathBase: '/customers',            table: 'sale_customers',            noField: 'code',      subtitleField: 'code',       searchFields: ['name'] },
  { type: 'purchase', permission: P.PURCHASE_ORDER_VIEW,     label: '采购单',     pathBase: '/purchase',             table: 'purchase_orders',           noField: 'order_no',  subtitleField: 'supplier_name', searchFields: ['order_no'], warehouseColumn: 'warehouse_id' },
  { type: 'sale', permission: P.SALE_ORDER_VIEW,         label: '销售单',     pathBase: '/sale',                 table: 'sale_orders',               noField: 'order_no',  subtitleField: 'customer_name', searchFields: ['order_no'], warehouseColumn: 'warehouse_id' },
  { type: 'requisition', permission: P.PURCHASE_REQUISITION_VIEW,  label: '采购申请',   pathBase: '/purchase-requisitions', table: 'purchase_requisitions',    noField: 'requisition_no', subtitleField: 'applicant_name', searchFields: ['requisition_no', 'title'], warehouseColumn: 'warehouse_id' },
  { type: 'transfer', permission: P.TRANSFER_ORDER_VIEW,     label: '调拨单',     pathBase: '/transfer',             table: 'transfer_orders',           noField: 'order_no',  subtitleField: 'from_warehouse_name', searchFields: ['order_no'], warehouseColumn: 'from_warehouse_id', warehouseColumnOr: 'to_warehouse_id' },
  { type: 'purchaseReturn', permission: P.RETURN_ORDER_VIEW, label: '采购退货', pathBase: '/returns/purchase',      table: 'purchase_returns',          noField: 'return_no', subtitleField: 'supplier_name', searchFields: ['return_no'], warehouseColumn: 'warehouse_id' },
  { type: 'saleReturn', permission: P.RETURN_ORDER_VIEW,   label: '销售退货',   pathBase: '/returns/sale',          table: 'sale_returns',              noField: 'return_no', subtitleField: 'customer_name', searchFields: ['return_no'], warehouseColumn: 'warehouse_id' },
  { type: 'inbound', permission: P.INBOUND_ORDER_VIEW,      label: '收货订单',   pathBase: '/inbound-tasks',        table: 'inbound_tasks',             noField: 'task_no',   subtitleField: 'supplier_name', searchFields: ['task_no'], warehouseColumn: 'warehouse_id' },
  { type: 'expense', permission: P.FINANCE_EXPENSE_VIEW,      label: '费用报销',   pathBase: '/expenses',              table: 'expense_claims',            noField: 'claim_no',  subtitleField: 'applicant_name', searchFields: ['claim_no', 'title'] },
  { type: 'disposal', permission: P.INVENTORY_DISPOSAL_VIEW,     label: '呆滞处置',   pathBase: '/disposals',             table: 'inventory_disposal_orders', noField: 'disposal_no', subtitleField: 'warehouse_name', searchFields: ['disposal_no'], warehouseColumn: 'warehouse_id' },
  { type: 'refund', permission: P.REFUND_ORDER_VIEW,       label: '退款单',     pathBase: '/refunds',               table: 'refund_orders',             noField: 'refund_no', subtitleField: 'customer_name', searchFields: ['refund_no'] },
  { type: 'creditOverride', permission: P.SALE_CREDIT_OVERRIDE_VIEW, label: '超额放行', pathBase: '/credit-overrides',      table: 'sale_credit_overrides',     noField: 'override_no', subtitleField: 'customer_name', searchFields: ['override_no'] },
  { type: 'stockcheck', permission: P.STOCKCHECK_VIEW,   label: '盘点单',     pathBase: '/stockcheck',            table: 'inventory_checks',          noField: 'check_no',  subtitleField: 'warehouse_name', searchFields: ['check_no'], warehouseColumn: 'warehouse_id' },
  { type: 'invoice', permission: P.INVOICE_VIEW,      label: '发票',       pathBase: '/accounting/invoices',   table: 'fin_invoices',              noField: 'invoice_no', subtitleField: 'party_name',    searchFields: ['invoice_no'] },
]

const PAGE_SIZE = 20
const DETAIL_FIELDS = {
  product: [['article_number', '供应商型号'], ['spec', '型号'], ['color', '颜色'], ['unit', '单位']],
  supplier: [['contact', '联系人'], ['phone', '电话'], ['address', '地址']],
  customer: [['contact', '联系人'], ['phone', '电话'], ['address', '地址']],
  purchase: [['warehouse_name', '仓库'], ['operator_name', '经办人']],
  sale: [['warehouse_name', '仓库'], ['operator_name', '经办人']],
  requisition: [['title', '申请标题'], ['warehouse_name', '仓库']],
  transfer: [['to_warehouse_name', '调入仓'], ['operator_name', '经办人']],
  purchaseReturn: [['purchase_order_no', '原采购单'], ['warehouse_name', '仓库']],
  saleReturn: [['sale_order_no', '原销售单'], ['warehouse_name', '仓库']],
  inbound: [['purchase_order_no', '采购单'], ['warehouse_name', '仓库']],
  expense: [['title', '报销标题']],
  disposal: [['operator_name', '经办人']],
  refund: [['sale_order_no', '销售单'], ['operator_name', '经办人']],
  creditOverride: [['sale_order_no', '销售单'], ['applicant_name', '申请人']],
  stockcheck: [['operator_name', '经办人']],
  invoice: [['source_no', '来源单号'], ['operator_name', '经办人']],
}
const MASTER_TYPES = new Set(['product', 'supplier', 'customer'])

async function searchGlobal(rawQuery, scopeWarehouseIds = null, options = {}) {
  const keyword = String(rawQuery || '').trim()
  const { type, beforeId, user = null, companyId = 1 } = options
  const isAdmin = Number(user?.roleId) === 1
  const permissions = new Set(user?.permissions || [])
  // 分类必须来自静态白名单，游标只作为 SQL 参数传递。
  if ((type != null && !ENTITIES.some(e => e.type === type)) ||
      (beforeId != null && (!type || !Number.isSafeInteger(Number(beforeId)) || Number(beforeId) <= 0))) {
    throw new AppError('搜索分页参数无效', 400)
  }
  if (!keyword) return { data: [], nextCursors: {}, message: '请输入搜索词' }
  const entities = ENTITIES.filter(e => (!type || e.type === type) && user && (isAdmin || permissions.has(e.permission)))
  const pages = await Promise.all(entities.map(async (ent) => {
    const conds = ['deleted_at IS NULL', `(${ent.searchFields.map(f => `${f} LIKE ?`).join(' OR ')})`]
    const params = ent.searchFields.map(() => `%${keyword}%`)
    if (Array.isArray(scopeWarehouseIds) && ent.warehouseColumn) {
      if (!scopeWarehouseIds.length) conds.push('1=0')
      else if (ent.warehouseColumnOr) {
        conds.push(`(${ent.warehouseColumn} IN (?) OR ${ent.warehouseColumnOr} IN (?))`)
        params.push(scopeWarehouseIds, scopeWarehouseIds)
      } else {
        conds.push(`${ent.warehouseColumn} IN (?)`)
        params.push(scopeWarehouseIds)
      }
    }
    // 单据归属规则与原模块一致；知道游标或分类也不能跳过授权。
    if (ent.type === 'expense' && !isAdmin && !permissions.has(P.FINANCE_EXPENSE_VIEW_ALL)) {
      conds.push('applicant_id = ?')
      params.push(Number(user.userId))
    }
    if (ent.type === 'invoice') {
      conds.push('company_id = ?')
      params.push(Number.isSafeInteger(Number(companyId)) && Number(companyId) > 0 ? Number(companyId) : 1)
    }
    if (Array.isArray(scopeWarehouseIds) && ['sale', 'refund', 'creditOverride'].includes(ent.type)) {
      if (!scopeWarehouseIds.length) conds.push('1=0')
      else if (ent.type === 'sale') {
        conds.push('NOT EXISTS (SELECT 1 FROM sale_order_items scope_item WHERE scope_item.order_id=sale_orders.id AND scope_item.warehouse_id NOT IN (?))')
        params.push(scopeWarehouseIds)
      } else {
        const orderLink = ent.type === 'refund' ? 'refund_orders.sale_order_id' : 'sale_credit_overrides.sale_order_id'
        conds.push(`EXISTS (SELECT 1 FROM sale_orders scope_order WHERE scope_order.id=${orderLink} AND scope_order.warehouse_id IN (?) AND NOT EXISTS (SELECT 1 FROM sale_order_items scope_item WHERE scope_item.order_id=scope_order.id AND scope_item.warehouse_id NOT IN (?)))`)
        params.push(scopeWarehouseIds, scopeWarehouseIds)
      }
    }
    if (beforeId != null) { conds.push('id < ?'); params.push(Number(beforeId)) }
    const fields = DETAIL_FIELDS[ent.type]
    const master = MASTER_TYPES.has(ent.type)
    const columns = [...new Set([...fields.map(([field]) => field), ...(master ? ['name'] : [])])]
    // 表名/列名全部来自本文件的 ENTITIES / DETAIL_FIELDS 常量注册表；校验是为了
    // 万一将来注册表改由配置或外部数据生成时仍然拦住注入（2026-09-18 收口）。
    assertSqlIdentifier(ent.table, 'ent.table')
    assertSqlIdentifier(ent.noField, 'ent.noField')
    assertSqlIdentifier(ent.subtitleField, 'ent.subtitleField')
    assertSqlColumnList(columns.join(', '), 'columns')
    const [rows] = await pool.query(
      `SELECT id, ${ent.noField} AS no_val, ${ent.subtitleField} AS subtitle, ${columns.join(', ')}
       FROM ${ent.table} WHERE ${conds.join(' AND ')} ORDER BY id DESC LIMIT ${PAGE_SIZE + 1}`, params,
    )
    const visible = rows.slice(0, PAGE_SIZE)
    return {
      type: ent.type,
      cursor: rows.length > PAGE_SIZE ? Number(visible[visible.length - 1].id) : null,
      items: visible.map(r => ({
        id: Number(r.id), type: ent.type, typeLabel: ent.label,
        title: (master ? r.name : r.no_val) || r.no_val,
        subtitle: master ? r.no_val : (r.subtitle || ''),
        details: fields.filter(([field]) => r[field] != null && String(r[field]).trim())
          .map(([field, label]) => ({ label, value: String(r[field]) })),
        path: master ? ent.pathBase : `${ent.pathBase}/${Number(r.id)}`,
      })),
    }
  }))
  const data = pages.flatMap(p => p.items)
  return { data, nextCursors: Object.fromEntries(pages.map(p => [p.type, p.cursor])), message: data.length ? '搜索成功' : '未找到相关内容' }
}

module.exports = { searchGlobal, ENTITIES }
