const { pool } = require('../../config/db')
const reportsService = require('../reports/reports.service')
const { ymd } = require('../../utils/excelExport')
const paymentsService = require('../payments/payments.service')
const receiptsService = require('../payments/payment-receipts.service')
const statementsService = require('../payments/reconciliation-statements.service')
const { scopeFilter, transferScopeFilter } = require('../../utils/warehouseScope')
// ── 后加实体导出：复用各业务模块的列表查询与状态映射 ──
const logisticsService = require('../logistics/logistics.service')
const fixedAssetsService = require('../fixed-assets/fixed-assets.service')
const expenseClaimsService = require('../finance/expense-claims.service')
const financeAccountsService = require('../finance/finance-accounts.service')
const disposalService = require('../disposal/disposal.service')
const stockcheckCycleService = require('../stockcheck/stockcheck.cycle')
const creditOverridesService = require('../credit-overrides/credit-overrides.service')
const pickingWavesService = require('../picking-waves/picking-waves.service')
const oplogsService = require('../oplogs/oplogs.service')
const usersService = require('../users/users.service')
const carriersService = require('../carriers/carriers.service')
const suppliersService = require('../suppliers/suppliers.service')
const customersService = require('../customers/customers.service')
const plasticBoxesService = require('../plastic-boxes/plastic-boxes.service')
const locationsService = require('../locations/locations.service')
const racksService = require('../racks/racks.service')
const sortingBinsService = require('../sorting-bins/sorting-bins.service')
const accountingPeriodService = require('../accounting/accounting.period.service')
const taxService = require('../accounting/accounting.tax.service')
const companiesService = require('../accounting/companies.service')

function buildDateStamp() {
  return new Date().toLocaleDateString('zh-CN').replace(/\//g, '')
}

function buildExportPayload({ filenamePrefix, sheetName, columns, rows }) {
  return {
    filename: `${filenamePrefix}_${buildDateStamp()}`,
    sheetName,
    columns,
    rows,
  }
}

async function getPurchaseExportPayload(query) {
  const { startDate, endDate, status, productId, keyword, supplierId, warehouseId, remark, operator, scopeWarehouseIds } = query
  let sql = `SELECT o.order_no,o.supplier_name,o.warehouse_name,
    CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已收货' WHEN 4 THEN '已取消' END AS status_name,
    o.total_amount,o.expected_date,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at,o.remark
    FROM purchase_orders o WHERE o.deleted_at IS NULL`
  const params = []
  const sc = scopeFilter(scopeWarehouseIds, 'o.warehouse_id')
  sql += sc.sql
  params.push(...sc.params)
  if (keyword) {
    sql += ' AND o.order_no LIKE ?'
    params.push(`%${keyword}%`)
  }
  if (remark) { sql += ' AND o.remark LIKE ?'; params.push(`%${remark}%`) }
  if (operator) { sql += ' AND o.operator_name LIKE ?'; params.push(`%${operator}%`) }
  if (status) { sql += ' AND o.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.order_id = o.id AND poi.product_id = ?)'
    params.push(+productId)
  }
  if (supplierId) { sql += ' AND o.supplier_id=?'; params.push(+supplierId) }
  if (warehouseId) { sql += ' AND o.warehouse_id=?'; params.push(+warehouseId) }
  if (startDate) { sql += ' AND DATE(o.created_at)>=?'; params.push(startDate) }
  if (endDate) { sql += ' AND DATE(o.created_at)<=?'; params.push(endDate) }
  sql += ' ORDER BY o.created_at DESC'
  const [rows] = await pool.query(sql, params)
  return buildExportPayload({
    filenamePrefix: '采购单列表',
    sheetName: '采购单',
    columns: [
      { header: '单号', key: 'order_no', width: 22 },
      { header: '供应商', key: 'supplier_name', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '金额', key: 'total_amount', width: 14 },
      { header: '预计到货', key: 'expected_date', width: 14 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

async function getSaleExportPayload(query) {
  const { startDate, endDate, status, productId, keyword, customerId, warehouseId, remark, scopeWarehouseIds } = query
  let sql = `SELECT o.order_no,o.customer_name,o.warehouse_name,
    CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已出库' WHEN 4 THEN '已取消' END AS status_name,
    o.total_amount,o.sale_date,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at,o.remark
    FROM sale_orders o WHERE o.deleted_at IS NULL`
  const params = []
  const sc = scopeFilter(scopeWarehouseIds, 'o.warehouse_id')
  sql += sc.sql
  params.push(...sc.params)
  if (keyword) {
    sql += ' AND o.order_no LIKE ?'
    params.push(`%${keyword}%`)
  }
  if (remark) { sql += ' AND o.remark LIKE ?'; params.push(`%${remark}%`) }
  if (status) { sql += ' AND o.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM sale_order_items soi WHERE soi.order_id = o.id AND soi.product_id = ?)'
    params.push(+productId)
  }
  if (customerId) { sql += ' AND o.customer_id=?'; params.push(+customerId) }
  if (warehouseId) { sql += ' AND o.warehouse_id=?'; params.push(+warehouseId) }
  if (startDate) { sql += ' AND DATE(o.created_at)>=?'; params.push(startDate) }
  if (endDate) { sql += ' AND DATE(o.created_at)<=?'; params.push(endDate) }
  sql += ' ORDER BY o.created_at DESC'
  const [rows] = await pool.query(sql, params)
  return buildExportPayload({
    filenamePrefix: '销售单列表',
    sheetName: '销售单',
    columns: [
      { header: '单号', key: 'order_no', width: 22 },
      { header: '客户', key: 'customer_name', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '金额', key: 'total_amount', width: 14 },
      { header: '销售日期', key: 'sale_date', width: 14 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

async function getReconciliationExportPayload(query) {
  const data = await reportsService.reconciliationReport({
    type: query.type || '1',
    startDate: query.startDate || null,
    endDate: query.endDate || null,
    keyword: query.keyword || '',
    status: query.status || null,
    page: 1,
    pageSize: 10000,
  })
  const sheetName = data.type === 1 ? '供应商对账单' : '客户对账单'
  return {
    filename: `${sheetName}_${buildDateStamp()}`,
    sheetName,
    columns: [
      { header: '单据类型', key: 'statementName', width: 14 },
      { header: '关联单号', key: 'orderNo', width: 22 },
      { header: '往来方', key: 'partyName', width: 20 },
      { header: '源单号', key: 'sourceOrderNo', width: 22 },
      { header: '收货单号', key: 'receiptTaskNo', width: 22 },
      { header: '总金额', key: 'totalAmount', width: 14 },
      { header: '已付/已收', key: 'paidAmount', width: 14 },
      { header: '余额', key: 'balance', width: 14 },
      { header: '状态', key: 'statusName', width: 10 },
      { header: '到期日', key: 'dueDate', width: 14 },
      { header: '创建时间', key: 'createdAt', width: 20 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows: data.list.map((row) => ({
      statementName: row.statementName,
      orderNo: row.orderNo,
      partyName: row.partyName,
      sourceOrderNo: row.sourceOrderNo,
      receiptTaskNo: row.receiptTaskNo || '',
      totalAmount: row.totalAmount,
      paidAmount: row.paidAmount,
      balance: row.balance,
      statusName: row.statusName,
      dueDate: row.dueDate || '',
      createdAt: row.createdAt,
      remark: row.remark || '',
    })),
  }
}

async function getInboundTasksExportPayload(query) {
  const { keyword, status, productId, warehouseId, operatorId, startDate, endDate, remark, supplierId, scopeWarehouseIds } = query
  let sql = `SELECT
    t.task_no,
    t.purchase_order_no,
    t.supplier_name,
    t.warehouse_name,
    CASE t.status WHEN 1 THEN '待收货' WHEN 2 THEN '收货中' WHEN 3 THEN '待上架' WHEN 4 THEN '已完成' WHEN 5 THEN '已取消' END AS status_name,
    t.operator_name,
    DATE_FORMAT(t.created_at,'%Y-%m-%d %H:%i') AS created_at,
    t.remark
    FROM inbound_tasks t
    WHERE t.deleted_at IS NULL`
  const params = []
  const sc = scopeFilter(scopeWarehouseIds, 't.warehouse_id')
  sql += sc.sql
  params.push(...sc.params)
  if (keyword) {
    sql += ' AND (t.task_no LIKE ? OR t.purchase_order_no LIKE ?)'
    params.push(`%${keyword}%`, `%${keyword}%`)
  }
  if (supplierId) {
    sql += ' AND EXISTS (SELECT 1 FROM inbound_task_items iti JOIN purchase_orders po ON po.id = iti.purchase_order_id WHERE iti.task_id = t.id AND po.supplier_id = ?)'
    params.push(+supplierId)
  }
  if (remark) { sql += ' AND t.remark LIKE ?'; params.push(`%${remark}%`) }
  if (status) { sql += ' AND t.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM inbound_task_items iti WHERE iti.task_id = t.id AND iti.product_id = ?)'
    params.push(+productId)
  }
  if (warehouseId) { sql += ' AND t.warehouse_id=?'; params.push(+warehouseId) }
  if (operatorId) { sql += ' AND t.operator_id=?'; params.push(+operatorId) }
  if (startDate) { sql += ' AND DATE(t.created_at)>=?'; params.push(startDate) }
  if (endDate) { sql += ' AND DATE(t.created_at)<=?'; params.push(endDate) }
  sql += ' ORDER BY t.created_at DESC'
  const [rows] = await pool.query(sql, params)
  return buildExportPayload({
    filenamePrefix: '收货订单',
    sheetName: '收货订单',
    columns: [
      { header: '任务单号', key: 'task_no', width: 22 },
      { header: '关联采购', key: 'purchase_order_no', width: 18 },
      { header: '供应商', key: 'supplier_name', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '操作人', key: 'operator_name', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

async function getStockExportPayload(scopeWarehouseIds = null) {
  const sc = scopeFilter(scopeWarehouseIds, 's.warehouse_id')
  const [rows] = await pool.query(
    `SELECT p.code,p.name,c.name AS category_name,p.unit,w.name AS warehouse_name,
      s.quantity,COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0) AS cost_price,ROUND(s.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0),4) AS value
     FROM inventory_stock s
     JOIN product_items p ON s.product_id=p.id
     JOIN inventory_warehouses w ON s.warehouse_id=w.id
     LEFT JOIN product_categories c ON p.category_id=c.id
     WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL${sc.sql}
     ORDER BY w.name,p.code`,
    sc.params,
  )
  return buildExportPayload({
    filenamePrefix: '当前库存',
    sheetName: '库存',
    columns: [
      { header: '商品编码', key: 'code', width: 16 },
      { header: '商品名称', key: 'name', width: 22 },
      { header: '分类', key: 'category_name', width: 14 },
      { header: '单位', key: 'unit', width: 8 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '库存数量', key: 'quantity', width: 12 },
      { header: '成本单价', key: 'cost_price', width: 12 },
      { header: '库存价值', key: 'value', width: 14 },
    ],
    rows,
  })
}

async function getInventoryLogsExportPayload(query) {
  const { startDate, endDate, scopeWarehouseIds } = query
  let sql = `SELECT DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i') AS time,
    CASE l.type WHEN 1 THEN '入库' WHEN 2 THEN '出库' WHEN 3 THEN '盘点调整' ELSE '其他' END AS type_name,
    p.code AS product_code,p.name AS product_name,w.name AS warehouse_name,
    l.quantity,l.before_qty,l.after_qty,l.unit_price,l.remark,l.operator_name
    FROM inventory_logs l
    JOIN product_items p ON l.product_id=p.id
    JOIN inventory_warehouses w ON l.warehouse_id=w.id
    WHERE 1=1`
  const params = []
  const sc = scopeFilter(scopeWarehouseIds, 'l.warehouse_id')
  sql += sc.sql
  params.push(...sc.params)
  if (startDate) { sql += ' AND DATE(l.created_at)>=?'; params.push(startDate) }
  if (endDate) { sql += ' AND DATE(l.created_at)<=?'; params.push(endDate) }
  sql += ' ORDER BY l.created_at DESC LIMIT 10000'
  const [rows] = await pool.query(sql, params)
  return buildExportPayload({
    filenamePrefix: '库存流水',
    sheetName: '流水',
    columns: [
      { header: '时间', key: 'time', width: 20 },
      { header: '类型', key: 'type_name', width: 10 },
      { header: '商品编码', key: 'product_code', width: 14 },
      { header: '商品名称', key: 'product_name', width: 22 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '变动数量', key: 'quantity', width: 12 },
      { header: '变动前', key: 'before_qty', width: 10 },
      { header: '变动后', key: 'after_qty', width: 10 },
      { header: '单价', key: 'unit_price', width: 10 },
      { header: '备注', key: 'remark', width: 24 },
      { header: '操作人', key: 'operator_name', width: 12 },
    ],
    rows,
  })
}

async function getTransferExportPayload(query = {}) {
  const { keyword, status, productId, warehouseId, operatorId, startDate, endDate, remark, scopeWarehouseIds } = query
  let sql = `SELECT o.order_no,o.from_warehouse_name,o.to_warehouse_name,
      CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '待出库' WHEN 3 THEN '在途' WHEN 4 THEN '已完成' WHEN 5 THEN '已取消' END AS status_name,
      o.remark,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at
     FROM transfer_orders o WHERE o.deleted_at IS NULL`
  const params = []
  const sc = transferScopeFilter(scopeWarehouseIds, 'o.from_warehouse_id', 'o.to_warehouse_id')
  sql += sc.sql
  params.push(...sc.params)
  if (keyword) {
    sql += ' AND (o.order_no LIKE ? OR o.from_warehouse_name LIKE ? OR o.to_warehouse_name LIKE ?)'
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (remark) { sql += ' AND o.remark LIKE ?'; params.push(`%${remark}%`) }
  if (status) { sql += ' AND o.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM transfer_order_items toi WHERE toi.order_id = o.id AND toi.product_id = ?)'
    params.push(+productId)
  }
  if (warehouseId) { sql += ' AND (o.from_warehouse_id=? OR o.to_warehouse_id=?)'; params.push(+warehouseId, +warehouseId) }
  if (operatorId) { sql += ' AND o.operator_id=?'; params.push(+operatorId) }
  if (startDate) { sql += ' AND DATE(o.created_at)>=?'; params.push(startDate) }
  if (endDate) { sql += ' AND DATE(o.created_at)<=?'; params.push(endDate) }
  sql += ' ORDER BY o.created_at DESC'
  const [rows] = await pool.query(sql, params)
  return buildExportPayload({
    filenamePrefix: '调拨单',
    sheetName: '调拨单',
    columns: [
      { header: '单号', key: 'order_no', width: 22 },
      { header: '调出仓库', key: 'from_warehouse_name', width: 18 },
      { header: '调入仓库', key: 'to_warehouse_name', width: 18 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

async function getPurchaseReturnsExportPayload(query = {}) {
  const { keyword, status, productId, supplierId, warehouseId, operatorId, startDate, endDate, remark, scopeWarehouseIds } = query
  let sql = `SELECT r.return_no,r.supplier_name,r.warehouse_name,r.purchase_order_no,
      CASE r.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已退货' WHEN 4 THEN '已取消' END AS status_name,
      r.total_amount,r.operator_name,DATE_FORMAT(r.created_at,'%Y-%m-%d %H:%i') AS created_at,r.remark
     FROM purchase_returns r WHERE r.deleted_at IS NULL`
  const params = []
  const sc = scopeFilter(scopeWarehouseIds, 'r.warehouse_id')
  sql += sc.sql
  params.push(...sc.params)
  if (keyword) {
    sql += ' AND (r.return_no LIKE ? OR r.supplier_name LIKE ? OR r.purchase_order_no LIKE ?)'
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (remark) { sql += ' AND r.remark LIKE ?'; params.push(`%${remark}%`) }
  if (status) { sql += ' AND r.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM purchase_return_items pri WHERE pri.return_id = r.id AND pri.product_id = ?)'
    params.push(+productId)
  }
  if (supplierId) { sql += ' AND r.supplier_id=?'; params.push(+supplierId) }
  if (warehouseId) { sql += ' AND r.warehouse_id=?'; params.push(+warehouseId) }
  if (operatorId) { sql += ' AND r.operator_id=?'; params.push(+operatorId) }
  if (startDate) { sql += ' AND DATE(r.created_at)>=?'; params.push(startDate) }
  if (endDate) { sql += ' AND DATE(r.created_at)<=?'; params.push(endDate) }
  sql += ' ORDER BY r.created_at DESC'
  const [rows] = await pool.query(sql, params)
  return buildExportPayload({
    filenamePrefix: '采购退货单',
    sheetName: '采购退货',
    columns: [
      { header: '退货单号', key: 'return_no', width: 22 },
      { header: '供应商', key: 'supplier_name', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '关联采购单', key: 'purchase_order_no', width: 20 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '金额', key: 'total_amount', width: 14 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 },
    ],
    rows,
  })
}

async function getSaleReturnsExportPayload(query = {}) {
  const { keyword, status, productId, customerId, warehouseId, operatorId, startDate, endDate, remark, scopeWarehouseIds } = query
  let sql = `SELECT r.return_no,r.customer_name,r.warehouse_name,r.sale_order_no,
      CASE r.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已退货入库' WHEN 4 THEN '已取消' END AS status_name,
      r.total_amount,r.operator_name,DATE_FORMAT(r.created_at,'%Y-%m-%d %H:%i') AS created_at,r.remark
     FROM sale_returns r WHERE r.deleted_at IS NULL`
  const params = []
  const sc = scopeFilter(scopeWarehouseIds, 'r.warehouse_id')
  sql += sc.sql
  params.push(...sc.params)
  if (keyword) {
    sql += ' AND (r.return_no LIKE ? OR r.customer_name LIKE ? OR r.sale_order_no LIKE ?)'
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (remark) { sql += ' AND r.remark LIKE ?'; params.push(`%${remark}%`) }
  if (status) { sql += ' AND r.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM sale_return_items sri WHERE sri.return_id = r.id AND sri.product_id = ?)'
    params.push(+productId)
  }
  if (customerId) { sql += ' AND r.customer_id=?'; params.push(+customerId) }
  if (warehouseId) { sql += ' AND r.warehouse_id=?'; params.push(+warehouseId) }
  if (operatorId) { sql += ' AND r.operator_id=?'; params.push(+operatorId) }
  if (startDate) { sql += ' AND DATE(r.created_at)>=?'; params.push(startDate) }
  if (endDate) { sql += ' AND DATE(r.created_at)<=?'; params.push(endDate) }
  sql += ' ORDER BY r.created_at DESC'
  const [rows] = await pool.query(sql, params)
  return buildExportPayload({
    filenamePrefix: '销售退货单',
    sheetName: '销售退货',
    columns: [
      { header: '退货单号', key: 'return_no', width: 22 },
      { header: '客户', key: 'customer_name', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '关联销售单', key: 'sale_order_no', width: 20 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '金额', key: 'total_amount', width: 14 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 },
    ],
    rows,
  })
}

// ── 账款 / 核销 / 对账单导出 ──────────────────────────────────────────────────

/** 账款列表：按页面范围（现结或月结）导出，列与页面一致 */
async function getPaymentsExportPayload(query) {
  const data = await paymentsService.findAll({
    type: query.type || '',
    status: query.status || '',
    keyword: query.keyword || '',
    settlementTypes: query.settlementTypes || null,
    page: 1,
    pageSize: 10000,
  })
  const isPayable = Number(query.type) === 1
  const sheetName = isPayable ? '应付账款' : '应收账款'
  return {
    filename: `${sheetName}_${buildDateStamp()}`,
    sheetName,
    columns: [
      { header: '关联单号', key: 'orderNo', width: 22 },
      { header: isPayable ? '供应商' : '客户', key: 'partyName', width: 20 },
      { header: '总金额', key: 'totalAmount', width: 14 },
      { header: isPayable ? '已付金额' : '已收金额', key: 'paidAmount', width: 14 },
      { header: '余额', key: 'balance', width: 14 },
      { header: '状态', key: 'statusName', width: 10 },
      { header: '结算确认', key: 'confirmText', width: 12 },
      { header: '到期日', key: 'dueDate', width: 14 },
      { header: '创建时间', key: 'createdAt', width: 20 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows: data.list.map(r => ({
      orderNo: r.orderNo,
      partyName: r.partyName,
      totalAmount: r.totalAmount,
      paidAmount: r.paidAmount,
      balance: r.balance,
      statusName: r.statusName,
      confirmText: isPayable ? (r.confirmStatus === 0 ? '待确认' : '已确认') : '',
      dueDate: ymd(r.dueDate),
      createdAt: r.createdAt,
      remark: r.remark || '',
    })),
  }
}

/** 收付款单（汇款）列表 */
async function getPaymentReceiptsExportPayload(query) {
  const data = await receiptsService.findAll({
    type: query.type || '',
    status: query.status || '',
    keyword: query.keyword || '',
    page: 1,
    pageSize: 10000,
  })
  const isPayable = Number(query.type) === 1
  const sheetName = isPayable ? '付款单' : '收款单'
  return {
    filename: `${sheetName}_${buildDateStamp()}`,
    sheetName,
    columns: [
      { header: '单号', key: 'receiptNo', width: 22 },
      { header: isPayable ? '供应商' : '客户', key: 'partyName', width: 20 },
      { header: `${isPayable ? '付款' : '收款'}金额`, key: 'amount', width: 14 },
      { header: '已核销', key: 'settledAmount', width: 14 },
      { header: '未核销', key: 'balance', width: 14 },
      { header: '状态', key: 'statusName', width: 10 },
      { header: '日期', key: 'paymentDate', width: 14 },
      { header: '方式', key: 'method', width: 10 },
      { header: '经办人', key: 'operatorName', width: 12 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows: data.list.map(r => ({
      receiptNo: r.receiptNo,
      partyName: r.partyName,
      amount: r.amount,
      settledAmount: r.settledAmount,
      balance: r.balance,
      statusName: r.statusName,
      paymentDate: ymd(r.paymentDate),
      method: r.method || '',
      operatorName: r.operatorName || '',
      remark: r.remark || '',
    })),
  }
}

/** 对账单列表（不含明细，明细走单张导出） */
async function getStatementsExportPayload(query) {
  const data = await statementsService.findAll({
    type: query.type || '',
    status: query.status || '',
    keyword: query.keyword || '',
    page: 1,
    pageSize: 10000,
  })
  const isPayable = Number(query.type) === 1
  const sheetName = isPayable ? '供应商对账单' : '客户对账单'
  return {
    filename: `${sheetName}汇总_${buildDateStamp()}`,
    sheetName,
    columns: [
      { header: '对账单号', key: 'statementNo', width: 22 },
      { header: isPayable ? '供应商' : '客户', key: 'partyName', width: 20 },
      { header: '对账期间', key: 'period', width: 24 },
      { header: '笔数', key: 'itemCount', width: 8 },
      { header: '汇总金额', key: 'totalAmount', width: 14 },
      { header: '已核销', key: 'settledAmount', width: 14 },
      { header: '未核销', key: 'balance', width: 14 },
      { header: '状态', key: 'statusName', width: 10 },
      { header: '确认人', key: 'confirmedByName', width: 12 },
      { header: '创建时间', key: 'createdAt', width: 20 },
    ],
    rows: data.list.map(r => ({
      statementNo: r.statementNo,
      partyName: r.partyName,
      period: `${ymd(r.periodStart) || '—'} ~ ${ymd(r.periodEnd) || '—'}`,
      itemCount: r.itemCount ?? 0,
      totalAmount: r.totalAmount,
      settledAmount: r.settledAmount,
      balance: r.balance,
      statusName: r.statusName,
      confirmedByName: r.confirmedByName || '',
      createdAt: r.createdAt,
    })),
  }
}

/**
 * 单张对账单明细：正式单据格式（抬头 + 明细 + 合计 + 签章栏），可直接发给往来方核对。
 * 返回 meta/items 交给 exportStatementXlsx 渲染，不走通用的「列+行」表格。
 */
async function getStatementDetailExportPayload(id) {
  const st = await statementsService.findById(id)
  const isPayable = Number(st.type) === 1
  return {
    meta: {
      title: isPayable ? '供应商对账单' : '客户对账单',
      partyLabel: isPayable ? '供应商' : '客户',
      statementNo: st.statementNo,
      partyName: st.partyName,
      periodStart: st.periodStart,
      periodEnd: st.periodEnd,
      remark: st.remark || '',
    },
    items: st.items,
  }
}

// ── 后加实体导出（v0.4.79 批量补齐）───────────────────────────────────────────

/** 物流运单 */
async function getWaybillsExportPayload(query = {}) {
  const { list } = await logisticsService.listWaybills({
    page: 1, pageSize: 999999,
    keyword: query.keyword || '',
    status: query.status || null,
    startDate: query.startDate || '',
    endDate: query.endDate || '',
    carrierId: query.carrierId || null,
    warehouseIds: query.scopeWarehouseIds ?? null,
  })
  const rows = list.map(w => ({
    waybill_no: w.waybillNo,
    sale_order_no: w.saleOrderNo || '—',
    warehouse_name: w.warehouseName || '—',
    carrier_name: w.carrierName || '—',
    tracking_no: w.trackingNo || '—',
    status_name: w.statusLabel,
    freight_type_name: w.freightTypeLabel || '—',
    est_freight: w.estFreight != null ? w.estFreight : '',
    receiver_name: w.receiverName || '—',
    receiver_phone: w.receiverPhone || '—',
    receiver_address: w.receiverAddress || '—',
    track_status: w.trackStatus ? '已揽收/在途' : '未揽收',
    error_message: w.errorMessage || '',
    created_at: w.createdAt ? String(w.createdAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '物流运单列表',
    sheetName: '物流运单',
    columns: [
      { header: '运单号', key: 'waybill_no', width: 24 },
      { header: '销售单', key: 'sale_order_no', width: 18 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '承运商', key: 'carrier_name', width: 16 },
      { header: '物流单号', key: 'tracking_no', width: 20 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '运费方式', key: 'freight_type_name', width: 10 },
      { header: '预估运费', key: 'est_freight', width: 12 },
      { header: '收件人', key: 'receiver_name', width: 12 },
      { header: '收件电话', key: 'receiver_phone', width: 16 },
      { header: '收件地址', key: 'receiver_address', width: 30 },
      { header: '轨迹', key: 'track_status', width: 12 },
      { header: '错误信息', key: 'error_message', width: 24 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ],
    rows,
  })
}

/** 固定资产台账 */
async function getFixedAssetsExportPayload(query = {}) {
  const { list } = await fixedAssetsService.listAssets({
    page: 1, pageSize: 999999,
    keyword: query.keyword || '',
    status: query.status || '',
    companyId: query.companyId || 1,
  })
  // 折旧方法：1 平均年限法（默认）——与前端列表展示一致，无独立常量
  const DEPR_LABEL = { 1: '平均年限法', 2: '双倍余额递减', 3: '工作量法' }
  const ASSET_STATUS = { 1: '在用', 2: '已处置' }
  const rows = list.map(a => ({
    asset_no: a.assetNo,
    asset_name: a.assetName,
    category: a.category || '—',
    department_name: a.departmentName || '—',
    acquire_date: a.acquireDate ? String(a.acquireDate).slice(0, 10) : '',
    original_cost: a.originalCost != null ? a.originalCost : '',
    residual_rate: a.residualRate != null ? a.residualRate : '',
    useful_months: a.usefulMonths ?? '',
    depr_method_name: DEPR_LABEL[Number(a.deprMethod)] || '—',
    monthly_depr: a.monthlyDepr != null ? a.monthlyDepr : '',
    accum_depr: a.accumDepr != null ? a.accumDepr : '',
    net_book_value: a.netBookValue != null ? a.netBookValue : '',
    status_name: ASSET_STATUS[Number(a.status)] || '—',
    dispose_type_name: a.disposeTypeName || '',
    remark: a.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '固定资产台账',
    sheetName: '固定资产',
    columns: [
      { header: '资产编号', key: 'asset_no', width: 16 },
      { header: '资产名称', key: 'asset_name', width: 24 },
      { header: '类别', key: 'category', width: 14 },
      { header: '部门', key: 'department_name', width: 14 },
      { header: '入账日期', key: 'acquire_date', width: 14 },
      { header: '原值', key: 'original_cost', width: 14 },
      { header: '残值率', key: 'residual_rate', width: 10 },
      { header: '使用月数', key: 'useful_months', width: 10 },
      { header: '折旧方法', key: 'depr_method_name', width: 14 },
      { header: '月折旧', key: 'monthly_depr', width: 12 },
      { header: '累计折旧', key: 'accum_depr', width: 14 },
      { header: '账面净值', key: 'net_book_value', width: 14 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '处置方式', key: 'dispose_type_name', width: 10 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

/** 费用报销单 */
async function getExpenseClaimsExportPayload(query = {}) {
  const { list } = await expenseClaimsService.findAll({
    page: 1, pageSize: 999999,
    status: query.status || '',
    keyword: query.keyword || '',
    applicantId: query.applicantId || '',
    startDate: query.startDate || '',
    endDate: query.endDate || '',
  })
  const rows = list.map(c => ({
    claim_no: c.claimNo,
    title: c.title,
    applicant_name: c.applicantName,
    total_amount: c.totalAmount != null ? c.totalAmount : '',
    status_name: c.statusName,
    item_count: c.itemCount ?? '',
    submitted_at: c.submittedAt ? String(c.submittedAt).slice(0, 16) : '',
    approved_by_name: c.approvedByName || '—',
    approved_at: c.approvedAt ? String(c.approvedAt).slice(0, 16) : '',
    reject_reason: c.rejectReason || '',
    paid_account_name: c.paidAccountName || '—',
    paid_at: c.paidAt ? String(c.paidAt).slice(0, 16) : '',
    paid_by_name: c.paidByName || '—',
    remark: c.remark || '',
    created_at: c.createdAt ? String(c.createdAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '费用报销列表',
    sheetName: '费用报销',
    columns: [
      { header: '单号', key: 'claim_no', width: 18 },
      { header: '标题', key: 'title', width: 24 },
      { header: '申请人', key: 'applicant_name', width: 12 },
      { header: '总金额', key: 'total_amount', width: 14 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '明细数', key: 'item_count', width: 8 },
      { header: '提交时间', key: 'submitted_at', width: 18 },
      { header: '审批人', key: 'approved_by_name', width: 12 },
      { header: '审批时间', key: 'approved_at', width: 18 },
      { header: '驳回原因', key: 'reject_reason', width: 20 },
      { header: '付款账户', key: 'paid_account_name', width: 16 },
      { header: '付款时间', key: 'paid_at', width: 18 },
      { header: '付款人', key: 'paid_by_name', width: 12 },
      { header: '备注', key: 'remark', width: 24 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ],
    rows,
  })
}

/** 资金账户 */
async function getFinanceAccountsExportPayload() {
  const { list } = await financeAccountsService.findAll({})
  const rows = list.map(a => ({
    code: a.code,
    name: a.name,
    type_name: a.typeName || '—',
    account_no: a.accountNo || '—',
    bank_name: a.bankName || '—',
    holder: a.holder || '—',
    opening_balance: a.openingBalance != null ? a.openingBalance : '',
    current_balance: a.currentBalance != null ? a.currentBalance : '',
    is_active: a.isActive ? '启用' : '停用',
    remark: a.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '资金账户列表',
    sheetName: '资金账户',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '名称', key: 'name', width: 20 },
      { header: '类型', key: 'type_name', width: 12 },
      { header: '账号', key: 'account_no', width: 20 },
      { header: '开户行', key: 'bank_name', width: 20 },
      { header: '户名', key: 'holder', width: 16 },
      { header: '期初余额', key: 'opening_balance', width: 14 },
      { header: '当前余额', key: 'current_balance', width: 14 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

/** 呆滞处置单 */
async function getDisposalsExportPayload(query = {}) {
  const { list } = await disposalService.findAll({
    page: 1, pageSize: 999999,
    keyword: query.keyword || '',
    status: query.status || null,
    warehouseId: query.warehouseId || null,
    startDate: query.startDate || '',
    endDate: query.endDate || '',
    scopeWarehouseIds: query.scopeWarehouseIds ?? null,
  })
  const rows = list.map(d => ({
    disposal_no: d.disposalNo,
    warehouse_name: d.warehouseName || '—',
    status_name: d.statusName || '—',
    total_value: d.totalValue != null ? d.totalValue : '',
    operator_name: d.operatorName || '—',
    approved_by_name: d.approvedByName || '—',
    approved_at: d.approvedAt ? String(d.approvedAt).slice(0, 16) : '',
    reject_reason: d.rejectReason || '',
    disposed_at: d.disposedAt ? String(d.disposedAt).slice(0, 16) : '',
    remark: d.remark || '',
    created_at: d.createdAt ? String(d.createdAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '呆滞处置列表',
    sheetName: '呆滞处置',
    columns: [
      { header: '处置单号', key: 'disposal_no', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '处置金额', key: 'total_value', width: 14 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '审批人', key: 'approved_by_name', width: 12 },
      { header: '审批时间', key: 'approved_at', width: 18 },
      { header: '驳回原因', key: 'reject_reason', width: 20 },
      { header: '处置时间', key: 'disposed_at', width: 18 },
      { header: '备注', key: 'remark', width: 24 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ],
    rows,
  })
}

/** ABC 分类结果 */
async function getAbcExportPayload(query = {}) {
  const list = await stockcheckCycleService.listAbc({
    warehouseId: query.warehouseId || null,
    abcClass: query.abcClass || null,
    scopeWarehouseIds: query.scopeWarehouseIds ?? null,
  })
  const rows = list.map(a => ({
    warehouse_name: a.warehouseName,
    product_code: a.productCode,
    product_name: a.productName,
    abc_class: a.abcClass,
    metric_type_name: a.metricType === 'sold_value' ? '销售额' : a.metricType === 'sold_qty' ? '销量' : a.metricType || '—',
    metric_value: a.metricValue,
    cumulative_pct: a.cumulativePct,
    window_days: a.windowDays,
    computed_at: a.computedAt ? String(a.computedAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: 'ABC分类结果',
    sheetName: 'ABC分类',
    columns: [
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '商品编码', key: 'product_code', width: 16 },
      { header: '商品名称', key: 'product_name', width: 24 },
      { header: 'ABC分类', key: 'abc_class', width: 10 },
      { header: '指标类型', key: 'metric_type_name', width: 10 },
      { header: '指标值', key: 'metric_value', width: 14 },
      { header: '累计占比(%)', key: 'cumulative_pct', width: 12 },
      { header: '窗口天数', key: 'window_days', width: 10 },
      { header: '计算时间', key: 'computed_at', width: 18 },
    ],
    rows,
  })
}

/** 授信预警申请 */
async function getCreditOverridesExportPayload(query = {}) {
  const { list } = await creditOverridesService.findAll({
    page: 1, pageSize: 999999,
    status: query.status || '',
    keyword: query.keyword || '',
    saleOrderId: query.saleOrderId || '',
    startDate: query.startDate || '',
    endDate: query.endDate || '',
  })
  const rows = list.map(c => ({
    override_no: c.overrideNo,
    sale_order_no: c.saleOrderNo || '—',
    customer_name: c.customerName || '—',
    credit_limit: c.creditLimit != null ? c.creditLimit : '',
    used_credit: c.usedCredit != null ? c.usedCredit : '',
    this_amount: c.thisAmount != null ? c.thisAmount : '',
    over_amount: c.overAmount != null ? c.overAmount : '',
    reason: c.reason || '',
    applicant_name: c.applicantName || '—',
    status_name: c.statusName,
    reject_reason: c.rejectReason || '',
    created_at: c.createdAt ? String(c.createdAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '授信预警列表',
    sheetName: '授信预警',
    columns: [
      { header: '申请单号', key: 'override_no', width: 20 },
      { header: '销售单', key: 'sale_order_no', width: 18 },
      { header: '客户', key: 'customer_name', width: 20 },
      { header: '授信额度', key: 'credit_limit', width: 14 },
      { header: '已用额度', key: 'used_credit', width: 14 },
      { header: '本单金额', key: 'this_amount', width: 14 },
      { header: '超额金额', key: 'over_amount', width: 14 },
      { header: '原因', key: 'reason', width: 24 },
      { header: '申请人', key: 'applicant_name', width: 12 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '驳回原因', key: 'reject_reason', width: 20 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ],
    rows,
  })
}

/** 波次拣货 */
async function getPickingWavesExportPayload(query = {}) {
  const { list } = await pickingWavesService.findAll({
    page: 1, pageSize: 999999,
    keyword: query.keyword || '',
    status: query.status || null,
    warehouseId: query.warehouseId || null,
    startDate: query.startDate || '',
    endDate: query.endDate || '',
  })
  const rows = list.map(w => ({
    wave_no: w.waveNo,
    warehouse_name: w.warehouseName || '—',
    status_name: w.statusName || '—',
    priority_name: w.priority === 1 ? '紧急' : w.priority === 2 ? '普通' : w.priority === 3 ? '低' : '—',
    task_count: w.taskCount ?? '',
    operator_name: w.operatorName || '—',
    remark: w.remark || '',
    created_at: w.createdAt ? String(w.createdAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '波次列表',
    sheetName: '波次拣货',
    columns: [
      { header: '波次号', key: 'wave_no', width: 18 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '优先级', key: 'priority_name', width: 8 },
      { header: '任务数', key: 'task_count', width: 8 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '备注', key: 'remark', width: 24 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ],
    rows,
  })
}

/** 用户 */
async function getUsersExportPayload(query = {}) {
  const { list } = await usersService.findAll({ page: 1, pageSize: 999999, keyword: query.keyword || '' })
  const rows = list.map(u => ({
    username: u.username,
    real_name: u.realName || '—',
    role_name: u.roleName || '—',
    department_name: u.departmentName || '—',
    is_active: u.isActive ? '启用' : '停用',
    created_at: u.createdAt ? String(u.createdAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '用户列表',
    sheetName: '用户',
    columns: [
      { header: '账号', key: 'username', width: 16 },
      { header: '姓名', key: 'real_name', width: 16 },
      { header: '角色', key: 'role_name', width: 16 },
      { header: '部门', key: 'department_name', width: 16 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ],
    rows,
  })
}

/** 操作日志 */
async function getOplogsExportPayload(query = {}) {
  const { list } = await oplogsService.findAll({
    page: 1, pageSize: 999999,
    keyword: query.keyword || '',
    module: query.module || '',
    startDate: query.startDate || '',
    endDate: query.endDate || '',
  })
  const rows = list.map(o => ({
    user_name: o.userName || '—',
    method: o.method || '',
    path: o.path || '',
    module: o.module || '',
    status_code: o.statusCode ?? '',
    ip: o.ip || '',
    created_at: o.createdAt ? String(o.createdAt).slice(0, 19) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '操作日志',
    sheetName: '操作日志',
    columns: [
      { header: '操作人', key: 'user_name', width: 16 },
      { header: '方法', key: 'method', width: 10 },
      { header: '路径', key: 'path', width: 36 },
      { header: '模块', key: 'module', width: 16 },
      { header: '状态码', key: 'status_code', width: 10 },
      { header: 'IP', key: 'ip', width: 16 },
      { header: '时间', key: 'created_at', width: 20 },
    ],
    rows,
  })
}

/** 承运商 */
async function getCarriersExportPayload() {
  const { list } = await carriersService.findAll({ page: 1, pageSize: 999999 })
  const rows = list.map(c => ({
    code: c.code,
    name: c.name,
    type: c.type || 'express',
    contact: c.contact || '—',
    phone: c.phone || '—',
    platform_carrier: c.platformCarrier || '—',
    is_active: c.isActive ? '启用' : '停用',
    remark: c.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '承运商列表',
    sheetName: '承运商',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '名称', key: 'name', width: 20 },
      { header: '类型', key: 'type', width: 10 },
      { header: '联系人', key: 'contact', width: 12 },
      { header: '电话', key: 'phone', width: 16 },
      { header: '电子面单平台', key: 'platform_carrier', width: 16 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

/** 塑料盒 */
async function getPlasticBoxesExportPayload(query = {}) {
  const { list } = await plasticBoxesService.findAll({ page: 1, pageSize: 999999, keyword: query.keyword || '' })
  const rows = list.map(b => ({
    barcode: b.barcode,
    product_name: b.productName || '—',
    product_code: b.productCode || '—',
    warehouse_name: b.warehouseName || '—',
    location_name: b.locationName || '—',
    remaining_qty: b.remainingQty ?? '',
    status_name: Number(b.status) === 1 ? '在库' : '空置',
    unit: b.unit || '',
    created_at: b.createdAt ? String(b.createdAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '塑料盒列表',
    sheetName: '塑料盒',
    columns: [
      { header: '盒条码', key: 'barcode', width: 18 },
      { header: '商品', key: 'product_name', width: 24 },
      { header: '商品编码', key: 'product_code', width: 16 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '库位', key: 'location_name', width: 16 },
      { header: '余量', key: 'remaining_qty', width: 10 },
      { header: '状态', key: 'status_name', width: 8 },
      { header: '单位', key: 'unit', width: 8 },
      { header: '创建时间', key: 'created_at', width: 18 },
    ],
    rows,
  })
}

/** 库位 / 货架 / 分拣格 */
async function getLocationsExportPayload() {
  const { list } = await locationsService.findAll({ page: 1, pageSize: 999999 })
  const rows = list.map(l => ({
    code: l.code,
    barcode: l.barcode || '—',
    name: l.name || '—',
    warehouse_name: l.warehouseName || '—',
    zone: l.zone || '—',
    aisle: l.aisle || '—',
    rack: l.rack || '—',
    level: l.level != null ? l.level : '',
    position: l.position != null ? l.position : '',
    is_active: Number(l.status) === 1 ? '启用' : '停用',
    remark: l.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '库位列表',
    sheetName: '库位',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '条码', key: 'barcode', width: 18 },
      { header: '名称', key: 'name', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '库区', key: 'zone', width: 12 },
      { header: '巷道', key: 'aisle', width: 12 },
      { header: '货架', key: 'rack', width: 12 },
      { header: '层', key: 'level', width: 8 },
      { header: '位', key: 'position', width: 8 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

async function getRacksExportPayload() {
  const { list } = await racksService.findAll({ page: 1, pageSize: 999999 })
  const rows = list.map(r => ({
    code: r.code,
    barcode: r.barcode || '—',
    name: r.name || '—',
    warehouse_name: r.warehouseName || '—',
    zone: r.zone || '—',
    max_levels: r.maxLevels ?? '',
    max_positions: r.maxPositions ?? '',
    is_active: Number(r.status) === 1 ? '启用' : '停用',
    remark: r.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '货架列表',
    sheetName: '货架',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '条码', key: 'barcode', width: 18 },
      { header: '名称', key: 'name', width: 20 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '库区', key: 'zone', width: 12 },
      { header: '层数', key: 'max_levels', width: 8 },
      { header: '位数', key: 'max_positions', width: 8 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

async function getSortingBinsExportPayload() {
  const { list } = await sortingBinsService.findAll({ page: 1, pageSize: 999999 })
  const rows = list.map(b => ({
    code: b.code,
    warehouse_name: b.warehouseName || '—',
    customer_name: b.customerName || '—',
    capacity: b.capacity ?? '',
    is_active: Number(b.status) === 1 ? '启用' : '停用',
    remark: b.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '分拣格列表',
    sheetName: '分拣格',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '仓库', key: 'warehouse_name', width: 16 },
      { header: '客户', key: 'customer_name', width: 20 },
      { header: '容量', key: 'capacity', width: 10 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

/** 供应商 */
async function getSuppliersExportPayload() {
  const { list } = await suppliersService.findAll({ page: 1, pageSize: 999999 })
  const rows = list.map(s => ({
    code: s.code,
    name: s.name,
    contact: s.contact || '—',
    phone: s.phone || '—',
    email: s.email || '—',
    address: s.address || '—',
    settlement_type_name: s.settlementTypeName || '—',
    payment_terms_days: s.paymentTermsDays ?? '',
    lead_time_days: s.leadTimeDays ?? '',
    is_active: s.isActive ? '启用' : '停用',
    remark: s.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '供应商列表',
    sheetName: '供应商',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '名称', key: 'name', width: 24 },
      { header: '联系人', key: 'contact', width: 12 },
      { header: '电话', key: 'phone', width: 16 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '地址', key: 'address', width: 30 },
      { header: '结算方式', key: 'settlement_type_name', width: 12 },
      { header: '账期(天)', key: 'payment_terms_days', width: 10 },
      { header: '备货周期(天)', key: 'lead_time_days', width: 14 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

/** 客户 */
async function getCustomersExportPayload() {
  const { list } = await customersService.findAll({ page: 1, pageSize: 999999 })
  const rows = list.map(c => ({
    code: c.code,
    name: c.name,
    contact: c.contact || '—',
    phone: c.phone || '—',
    email: c.email || '—',
    address: c.address || '—',
    settlement_type_name: c.settlementTypeName || '—',
    payment_terms_days: c.paymentTermsDays ?? '',
    credit_limit: c.creditLimit != null ? c.creditLimit : '',
    price_level: c.priceLevel || '—',
    is_active: c.isActive ? '启用' : '停用',
    remark: c.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '客户列表',
    sheetName: '客户',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '名称', key: 'name', width: 24 },
      { header: '联系人', key: 'contact', width: 12 },
      { header: '电话', key: 'phone', width: 16 },
      { header: '邮箱', key: 'email', width: 24 },
      { header: '地址', key: 'address', width: 30 },
      { header: '结算方式', key: 'settlement_type_name', width: 12 },
      { header: '账期(天)', key: 'payment_terms_days', width: 10 },
      { header: '授信额度', key: 'credit_limit', width: 14 },
      { header: '价格等级', key: 'price_level', width: 10 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

/** 会计期间 */
async function getAccountingPeriodsExportPayload() {
  const list = await accountingPeriodService.listPeriods()
  const rows = list.map(p => ({
    period: p.period,
    status_name: p.closed ? '已结账' : '未结账',
    closing_status: p.closingStatus === 'current' ? '已最新'
      : p.closingStatus === 'stale' ? '待结转'
      : p.closingStatus === 'missing' ? '未生成' : p.closingStatus === 'not_required' ? '无需结转' : '—',
    closed_by_name: p.closedByName || '—',
    closed_at: p.closedAt ? String(p.closedAt).slice(0, 16) : '',
  }))
  return buildExportPayload({
    filenamePrefix: '会计期间列表',
    sheetName: '会计期间',
    columns: [
      { header: '期间', key: 'period', width: 12 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '结转状态', key: 'closing_status', width: 10 },
      { header: '结账人', key: 'closed_by_name', width: 12 },
      { header: '结账时间', key: 'closed_at', width: 18 },
    ],
    rows,
  })
}

/** 报税数据（税会差异调整项） */
async function getTaxAdjustmentsExportPayload(query = {}) {
  const list = await taxService.listAdjustments({
    companyId: query.companyId || 1,
    period: query.period || '',
    taxType: query.taxType || '',
  })
  const TAX_TYPE_NAME = { 1: '增值税', 2: '所得税' }
  const rows = list.map(t => ({
    period: t.period,
    tax_type_name: TAX_TYPE_NAME[Number(t.taxType)] || '—',
    adjust_item: t.adjustItem,
    amount: t.amount != null ? t.amount : '',
    remark: t.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '报税调整项',
    sheetName: '报税调整',
    columns: [
      { header: '申报期间', key: 'period', width: 12 },
      { header: '税种', key: 'tax_type_name', width: 10 },
      { header: '调整项', key: 'adjust_item', width: 24 },
      { header: '金额', key: 'amount', width: 14 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

/** 合并报表 · 账套列表 */
async function getCompaniesExportPayload() {
  const { list } = await companiesService.listCompanies({ page: 1, pageSize: 999999 })
  const rows = list.map(c => ({
    code: c.code,
    name: c.name,
    tax_no: c.taxNo || '—',
    is_group: c.isGroup ? '是' : '否',
    parent_name: c.parentName || '—',
    currency: c.currency || '—',
    start_period: c.startPeriod || '—',
    is_active: c.isActive ? '启用' : '停用',
    remark: c.remark || '',
  }))
  return buildExportPayload({
    filenamePrefix: '账套列表',
    sheetName: '账套',
    columns: [
      { header: '编码', key: 'code', width: 16 },
      { header: '名称', key: 'name', width: 24 },
      { header: '税号', key: 'tax_no', width: 20 },
      { header: '集团账套', key: 'is_group', width: 10 },
      { header: '上级账套', key: 'parent_name', width: 16 },
      { header: '币种', key: 'currency', width: 10 },
      { header: '启用期间', key: 'start_period', width: 12 },
      { header: '状态', key: 'is_active', width: 8 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

module.exports = {
  getPurchaseExportPayload,
  getSaleExportPayload,
  getReconciliationExportPayload,
  getPaymentsExportPayload,
  getPaymentReceiptsExportPayload,
  getStatementsExportPayload,
  getStatementDetailExportPayload,
  getInboundTasksExportPayload,
  getStockExportPayload,
  getInventoryLogsExportPayload,
  getTransferExportPayload,
  getPurchaseReturnsExportPayload,
  getSaleReturnsExportPayload,
  getWaybillsExportPayload,
  getFixedAssetsExportPayload,
  getExpenseClaimsExportPayload,
  getFinanceAccountsExportPayload,
  getDisposalsExportPayload,
  getAbcExportPayload,
  getCreditOverridesExportPayload,
  getPickingWavesExportPayload,
  getUsersExportPayload,
  getOplogsExportPayload,
  getCarriersExportPayload,
  getPlasticBoxesExportPayload,
  getLocationsExportPayload,
  getRacksExportPayload,
  getSortingBinsExportPayload,
  getSuppliersExportPayload,
  getCustomersExportPayload,
  getAccountingPeriodsExportPayload,
  getTaxAdjustmentsExportPayload,
  getCompaniesExportPayload,
}
