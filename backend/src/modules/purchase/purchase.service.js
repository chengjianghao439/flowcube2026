const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { generateDailyCode } = require('../../utils/codeGenerator')

const STATUS = { 1:'草稿', 2:'已提交', 3:'已完成', 4:'已取消' }

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
  }
}

/** 显式列清单（勿用 po.*，避免返回无关字段） */
const PO_COLUMNS = `po.id, po.order_no, po.supplier_id, po.supplier_name, po.warehouse_id, po.warehouse_name,
  po.status, po.expected_date, po.total_amount, po.remark, po.operator_id, po.operator_name,
  po.created_at, po.updated_at, po.deleted_at`

const genOrderNo = conn => generateDailyCode(conn, 'PO', 'purchase_orders', 'order_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null, productId=null }) {
  const offset = (page - 1) * pageSize
  const like = `%${keyword}%`
  const params = [like, like]
  let whereExtra = ''
  if (status) {
    whereExtra += ' AND po.status = ?'
    params.push(status)
  }
  if (productId) {
    whereExtra += ' AND EXISTS (SELECT 1 FROM purchase_order_items poi WHERE poi.order_id = po.id AND poi.product_id = ?)'
    params.push(productId)
  }
  const [rows] = await pool.query(
    `SELECT ${PO_COLUMNS}
     FROM purchase_orders po
     WHERE po.deleted_at IS NULL AND (po.order_no LIKE ? OR po.supplier_name LIKE ?) ${whereExtra}
     ORDER BY po.created_at DESC LIMIT ? OFFSET ?`,
    [...params, pageSize, offset],
  )
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM purchase_orders po
     WHERE po.deleted_at IS NULL AND (po.order_no LIKE ? OR po.supplier_name LIKE ?) ${whereExtra}`,
    params,
  )
  return { list: rows.map(fmtOrder), pagination: { page, pageSize, total } }
}

async function findById(id) {
  const [rows] = await pool.query(
    'SELECT * FROM purchase_orders WHERE id=? AND deleted_at IS NULL',
    [id],
  )
  if (!rows[0]) throw new AppError('采购单不存在', 404)
  const order = fmtOrder(rows[0])
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
  if(order.status !== 1) throw new AppError('只有草稿状态的采购单可以提交',400)
  await pool.query('UPDATE purchase_orders SET status=2 WHERE id=?', [id])
}

async function cancel(id) {
  const order = await findById(id)
  if(order.status === 3) throw new AppError('已完成的采购单不能取消',400)
  if(order.status === 4) throw new AppError('采购单已取消',400)
  await pool.query('UPDATE purchase_orders SET status=4 WHERE id=?',[id])
}

module.exports = { findAll, findById, create, confirm, cancel }
