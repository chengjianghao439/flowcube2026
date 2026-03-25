const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')

const STATUS = { 1:'草稿', 2:'已确认', 3:'已收货', 4:'已取消' }

function fmtOrder(row) {
  return {
    id: row.id,
    orderNo: row.order_no,
    supplierId: row.supplier_id,
    supplierName: row.supplier_name,
    warehouseId: row.warehouse_id,
    warehouseName: row.warehouse_name,
    status: row.status,
    statusName: STATUS[row.status],
    expectedDate: row.expected_date,
    totalAmount: Number(row.total_amount),
    remark: row.remark,
    operatorId: row.operator_id,
    operatorName: row.operator_name,
    createdAt: row.created_at,
    openInboundTaskId: row.open_inbound_task_id != null ? Number(row.open_inbound_task_id) : null,
    openInboundTaskNo: row.open_inbound_task_no || null,
  }
}

/**
 * 未完结入库任务判定（须与 inbound_tasks.createFromPoId 中 dup 检测一致）
 * 注意：避免 SELECT po.*, 标量子查询 — mysql2 等驱动在列名合并时可能覆盖别名，导致前端永远拿不到 openInboundTaskId。
 */
const OPEN_INBOUND_TASK_ID_SQL = `(SELECT it.id FROM inbound_tasks it
  WHERE it.purchase_order_id = po.id AND it.deleted_at IS NULL
    AND it.status NOT IN (4, 5) ORDER BY it.id ASC LIMIT 1)`
const OPEN_INBOUND_TASK_NO_SQL = `(SELECT it.task_no FROM inbound_tasks it
  WHERE it.purchase_order_id = po.id AND it.deleted_at IS NULL
    AND it.status NOT IN (4, 5) ORDER BY it.id ASC LIMIT 1)`

/** 显式列清单（勿用 po.*，保证标量子查询别名稳定出现在结果中） */
const PO_COLUMNS = `po.id, po.order_no, po.supplier_id, po.supplier_name, po.warehouse_id, po.warehouse_name,
  po.status, po.expected_date, po.total_amount, po.remark, po.operator_id, po.operator_name,
  po.created_at, po.updated_at, po.deleted_at`

async function attachOpenInboundFields(row) {
  if (!row) return row
  const poId = row.id
  const [[open]] = await pool.query(
    `SELECT id AS open_inbound_task_id, task_no AS open_inbound_task_no
     FROM inbound_tasks
     WHERE purchase_order_id = ? AND deleted_at IS NULL AND status NOT IN (4, 5)
     ORDER BY id ASC LIMIT 1`,
    [poId],
  )
  return {
    ...row,
    open_inbound_task_id: open?.open_inbound_task_id ?? null,
    open_inbound_task_no: open?.open_inbound_task_no ?? null,
  }
}

const genOrderNo = conn => generateDailyCode(conn, 'PO', 'purchase_orders', 'order_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const whereStatus = status ? 'AND po.status = ?' : ''
  const extra = status ? [like, like, status, pageSize, offset] : [like, like, pageSize, offset]
  const cntExtra = status ? [like, like, status] : [like, like]
  const [rows] = await pool.query(
    `SELECT ${PO_COLUMNS},
      ${OPEN_INBOUND_TASK_ID_SQL} AS open_inbound_task_id,
      ${OPEN_INBOUND_TASK_NO_SQL} AS open_inbound_task_no
     FROM purchase_orders po
     WHERE po.deleted_at IS NULL AND (po.order_no LIKE ? OR po.supplier_name LIKE ?) ${whereStatus}
     ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
    extra,
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchase_orders po
     WHERE po.deleted_at IS NULL AND (po.order_no LIKE ? OR po.supplier_name LIKE ?) ${whereStatus}`,
    cntExtra,
  )
  return { list: rows.map(fmtOrder), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT * FROM purchase_orders WHERE id=? AND deleted_at IS NULL',
    [id],
  )
  if (!rows[0]) throw new AppError('采购单不存在', 404)
  const merged = await attachOpenInboundFields(rows[0])
  const order = fmtOrder(merged)
  const [items] = await pool.query('SELECT * FROM purchase_order_items WHERE order_id=?',[id])
  order.items = items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, quantity:Number(r.quantity), unitPrice:Number(r.unit_price), amount:Number(r.amount), remark:r.remark }))
  return order
}

async function create({ supplierId, supplierName, warehouseId, warehouseName, expectedDate, remark, items, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderNo = await genOrderNo(conn)
    const total = items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r] = await conn.query(
      `INSERT INTO purchase_orders (order_no,supplier_id,supplier_name,warehouse_id,warehouse_name,expected_date,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [orderNo,supplierId,supplierName,warehouseId,warehouseName,expectedDate||null,total,remark||null,operator.userId,operator.realName]
    )
    const orderId = r.insertId
    for(const item of items) {
      await conn.query(
        `INSERT INTO purchase_order_items (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?)`,
        [orderId,item.productId,item.productCode,item.productName,item.unit,item.quantity,item.unitPrice,item.quantity*item.unitPrice,item.remark||null]
      )
    }
    await conn.commit()
    return { id:orderId, orderNo }
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

async function confirm(id, operator) {
  const order = await findById(id)
  if(order.status !== 1) throw new AppError('只有草稿状态的采购单可以确认',400)
  await pool.query('UPDATE purchase_orders SET status=2 WHERE id=?', [id])
}

async function receive(id, operator) {
  throw new AppError('采购一键收货已停用：请在「入库任务」中收货生成容器，再上架入库', 410)
}

async function cancel(id) {
  const order = await findById(id)
  if(order.status === 3) throw new AppError('已收货的采购单不能取消',400)
  if(order.status === 4) throw new AppError('采购单已取消',400)
  await pool.query('UPDATE purchase_orders SET status=4 WHERE id=?',[id])
}

module.exports = { findAll, findById, create, confirm, receive, cancel }
