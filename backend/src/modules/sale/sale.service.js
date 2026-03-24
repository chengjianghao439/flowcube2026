const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { reserve, releaseByRef } = require('../../engine/reservationEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')

const STATUS = { 1:'草稿', 2:'已占库', 3:'拣货中', 4:'已出库', 5:'已取消' }
const FREIGHT_TYPE = { 1:'寄付', 2:'到付', 3:'第三方付' }
const fmt = row => ({
  id:row.id, orderNo:row.order_no,
  customerId:row.customer_id, customerName:row.customer_name,
  warehouseId:row.warehouse_id, warehouseName:row.warehouse_name,
  status:row.status, statusName:STATUS[row.status],
  saleDate:row.sale_date, totalAmount:Number(row.total_amount), remark:row.remark,
  taskId:row.task_id||null, taskNo:row.task_no||null,
  carrierId:row.carrier_id||null,
  carrier: row.carrier_name || row.carrier || null,   // 优先承运商表名称，回退文本字段
  freightType:row.freight_type||null,
  freightTypeName:row.freight_type ? (FREIGHT_TYPE[row.freight_type]||null) : null,
  receiverName:row.receiver_name||null, receiverPhone:row.receiver_phone||null,
  receiverAddress:row.receiver_address||null,
  operatorId:row.operator_id, operatorName:row.operator_name, createdAt:row.created_at,
})

const genOrderNo = conn => generateDailyCode(conn, 'SO', 'sale_orders', 'order_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond=status?'AND status=?':''
  const extra=status?[like,like,status,pageSize,offset]:[like,like,pageSize,offset]
  const cntExtra=status?[like,like,status]:[like,like]
  const [rows] = await pool.query(`SELECT * FROM sale_orders WHERE deleted_at IS NULL AND (order_no LIKE ? OR customer_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,extra)
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM sale_orders WHERE deleted_at IS NULL AND (order_no LIKE ? OR customer_name LIKE ?) ${cond}`,cntExtra)
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}

async function findById(id) {
  const [rows] = await pool.query(
    `SELECT so.*, c.name AS carrier_name
     FROM sale_orders so
     LEFT JOIN carriers c ON c.id = so.carrier_id AND c.deleted_at IS NULL
     WHERE so.id=? AND so.deleted_at IS NULL`,
    [id]
  )
  if(!rows[0]) throw new AppError('销售单不存在',404)
  const order = fmt(rows[0])
  const [items] = await pool.query('SELECT * FROM sale_order_items WHERE order_id=?',[id])
  order.items = items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, quantity:Number(r.quantity), unitPrice:Number(r.unit_price), amount:Number(r.amount), remark:r.remark }))
  return order
}

async function create({ customerId, customerName, warehouseId, warehouseName, remark,
  carrierId, carrier, freightType, receiverName, receiverPhone, receiverAddress, items, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderNo = await genOrderNo(conn)
    const total = items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r] = await conn.query(
      `INSERT INTO sale_orders (order_no,customer_id,customer_name,warehouse_id,warehouse_name,sale_date,total_amount,remark,carrier_id,carrier,freight_type,receiver_name,receiver_phone,receiver_address,operator_id,operator_name) VALUES (?,?,?,?,?,CURDATE(),?,?,?,?,?,?,?,?,?,?)`,
      [orderNo,customerId,customerName,warehouseId,warehouseName,total,remark||null,carrierId||null,carrier||null,freightType||null,receiverName||null,receiverPhone||null,receiverAddress||null,operator.userId,operator.realName]
    )
    const orderId = r.insertId
    for(const item of items) {
      await conn.query(`INSERT INTO sale_order_items (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?)`,[orderId,item.productId,item.productCode,item.productName,item.unit,item.quantity,item.unitPrice,item.quantity*item.unitPrice,item.remark||null])
    }
    await conn.commit()
    return { id:orderId, orderNo }
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

// 编辑草稿：仅在 status=1（草稿）时允许，整体替换明细行
async function update(id, { customerId, customerName, warehouseId, warehouseName, remark,
  carrierId, carrier, freightType, receiverName, receiverPhone, receiverAddress, items }) {
  const order = await findById(id)
  if (order.status !== 1) throw new AppError('只有草稿状态的销售单可以编辑', 400)
  if (!items || !items.length) throw new AppError('至少需要一条商品明细', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const total = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0)
    await conn.query(
      `UPDATE sale_orders SET customer_id=?,customer_name=?,warehouse_id=?,warehouse_name=?,total_amount=?,remark=?,carrier_id=?,carrier=?,freight_type=?,receiver_name=?,receiver_phone=?,receiver_address=? WHERE id=?`,
      [customerId, customerName, warehouseId, warehouseName, total, remark||null, carrierId||null, carrier||null, freightType||null, receiverName||null, receiverPhone||null, receiverAddress||null, id]
    )
    await conn.query('DELETE FROM sale_order_items WHERE order_id=?', [id])
    for (const item of items) {
      await conn.query(
        `INSERT INTO sale_order_items (order_id,product_id,product_code,product_name,unit,quantity,unit_price,amount,remark) VALUES (?,?,?,?,?,?,?,?,?)`,
        [id, item.productId, item.productCode, item.productName, item.unit, item.quantity, item.unitPrice, item.quantity*item.unitPrice, item.remark||null]
      )
    }
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ① 占用库存：仅调用 reservationEngine.reserve()，不创建仓库任务
async function reserveStock(id) {
  const order = await findById(id)
  if (order.status !== 1) throw new AppError('只有草稿状态可以占用库存', 400)
  if (!order.items.length) throw new AppError('销售单无明细，无法占用库存', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const item of order.items) {
      await reserve(conn, {
        productId:   item.productId,
        productName: item.productName,
        warehouseId: order.warehouseId,
        qty:         item.quantity,
        refType:     'sale_order',
        refId:       order.id,
        refNo:       order.orderNo,
      })
    }
    await conn.query('UPDATE sale_orders SET status=2 WHERE id=?', [id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// ② 发起出库：仅创建仓库任务，不扣减库存，订单进入拣货中（status=3）
async function ship(id) {
  const order = await findById(id)
  if (order.status !== 2) throw new AppError('只有已占库的销售单可以发起出库', 400)
  if (!order.items.length) throw new AppError('销售单无明细', 400)
  if (order.taskId) throw new AppError(`已存在仓库任务（${order.taskNo}），请勿重复操作`, 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskSvc = require('../warehouse-tasks/warehouse-tasks.service')
    const { taskId, taskNo } = await taskSvc.createForSaleOrder({
      saleOrderId:   order.id,
      saleOrderNo:   order.orderNo,
      customerId:    order.customerId,
      customerName:  order.customerName,
      warehouseId:   order.warehouseId,
      warehouseName: order.warehouseName,
      items:         order.items,
      conn,
    })
    await conn.query('UPDATE sale_orders SET status=3, task_id=?, task_no=? WHERE id=?', [taskId, taskNo, id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消占库：RESERVED(2) → DRAFT(1)，释放预占
async function releaseStock(id) {
  const order = await findById(id)
  if (order.status !== 2) throw new AppError('只有已占库的订单可以取消占库', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await releaseByRef(conn, 'sale_order', id)
    await conn.query('UPDATE sale_orders SET status=1 WHERE id=?', [id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

// 取消订单：仅 DRAFT(1) → CANCELLED(5)
async function cancel(id) {
  const order = await findById(id)
  if (order.status !== 1) throw new AppError('只有草稿状态的订单可以取消', 400)
  await pool.query('UPDATE sale_orders SET status=5 WHERE id=?', [id])
}

// 删除订单：仅 CANCELLED(5) 可删
async function deleteOrder(id) {
  const order = await findById(id)
  if (order.status !== 5) throw new AppError('只有已取消的订单可以删除', 400)
  await pool.query('UPDATE sale_orders SET deleted_at=NOW() WHERE id=?', [id])
}

module.exports = { findAll, findById, create, update, reserveStock, releaseStock, ship, cancel, deleteOrder }
