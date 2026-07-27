const { pool } = require('../../config/db')
const reportsService = require('../reports/reports.service')
const { ymd } = require('../../utils/excelExport')
const paymentsService = require('../payments/payments.service')
const receiptsService = require('../payments/payment-receipts.service')
const statementsService = require('../payments/reconciliation-statements.service')

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
  const { startDate, endDate, status, productId, keyword, supplierId, warehouseId, remark, operator } = query
  let sql = `SELECT o.order_no,o.supplier_name,o.warehouse_name,
    CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已收货' WHEN 4 THEN '已取消' END AS status_name,
    o.total_amount,o.expected_date,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at,o.remark
    FROM purchase_orders o WHERE o.deleted_at IS NULL`
  const params = []
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
  const { startDate, endDate, status, productId, keyword, customerId, warehouseId, remark } = query
  let sql = `SELECT o.order_no,o.customer_name,o.warehouse_name,
    CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已出库' WHEN 4 THEN '已取消' END AS status_name,
    o.total_amount,o.sale_date,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at,o.remark
    FROM sale_orders o WHERE o.deleted_at IS NULL`
  const params = []
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
  const { keyword, status, productId, warehouseId, operatorId, startDate, endDate, remark, supplierId } = query
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

async function getStockExportPayload() {
  const [rows] = await pool.query(
    `SELECT p.code,p.name,c.name AS category_name,p.unit,w.name AS warehouse_name,
      s.quantity,COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0) AS cost_price,ROUND(s.quantity * COALESCE(NULLIF(p.cost_price, 0), p.sale_price, 0),4) AS value
     FROM inventory_stock s
     JOIN product_items p ON s.product_id=p.id
     JOIN inventory_warehouses w ON s.warehouse_id=w.id
     LEFT JOIN product_categories c ON p.category_id=c.id
     WHERE p.deleted_at IS NULL AND w.deleted_at IS NULL
     ORDER BY w.name,p.code`,
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
  const { startDate, endDate } = query
  let sql = `SELECT DATE_FORMAT(l.created_at,'%Y-%m-%d %H:%i') AS time,
    CASE l.type WHEN 1 THEN '入库' WHEN 2 THEN '出库' WHEN 3 THEN '盘点调整' ELSE '其他' END AS type_name,
    p.code AS product_code,p.name AS product_name,w.name AS warehouse_name,
    l.quantity,l.before_qty,l.after_qty,l.unit_price,l.remark,l.operator_name
    FROM inventory_logs l
    JOIN product_items p ON l.product_id=p.id
    JOIN inventory_warehouses w ON l.warehouse_id=w.id
    WHERE 1=1`
  const params = []
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
  const { keyword, status, productId, warehouseId, operatorId, startDate, endDate, remark } = query
  let sql = `SELECT o.order_no,o.from_warehouse_name,o.to_warehouse_name,
      CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '待出库' WHEN 3 THEN '在途' WHEN 4 THEN '已完成' WHEN 5 THEN '已取消' END AS status_name,
      o.remark,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at
     FROM transfer_orders o WHERE o.deleted_at IS NULL`
  const params = []
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
  const { keyword, status, productId, supplierId, warehouseId, operatorId, startDate, endDate, remark } = query
  let sql = `SELECT r.return_no,r.supplier_name,r.warehouse_name,r.purchase_order_no,
      CASE r.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已退货' WHEN 4 THEN '已取消' END AS status_name,
      r.total_amount,r.operator_name,DATE_FORMAT(r.created_at,'%Y-%m-%d %H:%i') AS created_at,r.remark
     FROM purchase_returns r WHERE r.deleted_at IS NULL`
  const params = []
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
  const { keyword, status, productId, customerId, warehouseId, operatorId, startDate, endDate, remark } = query
  let sql = `SELECT r.return_no,r.customer_name,r.warehouse_name,r.sale_order_no,
      CASE r.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已退货入库' WHEN 4 THEN '已取消' END AS status_name,
      r.total_amount,r.operator_name,DATE_FORMAT(r.created_at,'%Y-%m-%d %H:%i') AS created_at,r.remark
     FROM sale_returns r WHERE r.deleted_at IS NULL`
  const params = []
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
}
