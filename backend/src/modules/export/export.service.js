const { pool } = require('../../config/db')
const reportsService = require('../reports/reports.service')

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
  const { startDate, endDate, status, productId } = query
  let sql = `SELECT o.order_no,o.supplier_name,o.warehouse_name,
    CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已收货' WHEN 4 THEN '已取消' END AS status_name,
    o.total_amount,o.expected_date,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at,o.remark
    FROM purchase_orders o WHERE o.deleted_at IS NULL`
  const params = []
  if (status) { sql += ' AND o.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.order_id = o.id AND poi.product_id = ?)'
    params.push(+productId)
  }
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
  const { startDate, endDate, status, productId } = query
  let sql = `SELECT o.order_no,o.customer_name,o.warehouse_name,
    CASE o.status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已出库' WHEN 4 THEN '已取消' END AS status_name,
    o.total_amount,o.sale_date,o.operator_name,DATE_FORMAT(o.created_at,'%Y-%m-%d %H:%i') AS created_at,o.remark
    FROM sale_orders o WHERE o.deleted_at IS NULL`
  const params = []
  if (status) { sql += ' AND o.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM sale_order_items soi WHERE soi.order_id = o.id AND soi.product_id = ?)'
    params.push(+productId)
  }
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
  const { status, productId } = query
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
  if (status) { sql += ' AND t.status=?'; params.push(+status) }
  if (productId) {
    sql += ' AND EXISTS (SELECT 1 FROM inbound_task_items iti WHERE iti.task_id = t.id AND iti.product_id = ?)'
    params.push(+productId)
  }
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

async function getTransferExportPayload() {
  const [rows] = await pool.query(
    `SELECT order_no,from_warehouse_name,to_warehouse_name,
      CASE status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已执行' WHEN 4 THEN '已取消' END AS status_name,
      remark,operator_name,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS created_at
     FROM transfer_orders WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  )
  return buildExportPayload({
    filenamePrefix: '调拨单',
    sheetName: '调拨单',
    columns: [
      { header: '单号', key: 'order_no', width: 22 },
      { header: '源仓库', key: 'from_warehouse_name', width: 18 },
      { header: '目标仓库', key: 'to_warehouse_name', width: 18 },
      { header: '状态', key: 'status_name', width: 10 },
      { header: '经办人', key: 'operator_name', width: 12 },
      { header: '创建时间', key: 'created_at', width: 20 },
      { header: '备注', key: 'remark', width: 24 },
    ],
    rows,
  })
}

async function getPurchaseReturnsExportPayload() {
  const [rows] = await pool.query(
    `SELECT return_no,supplier_name,warehouse_name,purchase_order_no,
      CASE status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已退货' WHEN 4 THEN '已取消' END AS status_name,
      total_amount,operator_name,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS created_at,remark
     FROM purchase_returns WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  )
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

async function getSaleReturnsExportPayload() {
  const [rows] = await pool.query(
    `SELECT return_no,customer_name,warehouse_name,sale_order_no,
      CASE status WHEN 1 THEN '草稿' WHEN 2 THEN '已确认' WHEN 3 THEN '已退货入库' WHEN 4 THEN '已取消' END AS status_name,
      total_amount,operator_name,DATE_FORMAT(created_at,'%Y-%m-%d %H:%i') AS created_at,remark
     FROM sale_returns WHERE deleted_at IS NULL ORDER BY created_at DESC`,
  )
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

module.exports = {
  getPurchaseExportPayload,
  getSaleExportPayload,
  getReconciliationExportPayload,
  getInboundTasksExportPayload,
  getStockExportPayload,
  getInventoryLogsExportPayload,
  getTransferExportPayload,
  getPurchaseReturnsExportPayload,
  getSaleReturnsExportPayload,
}
