const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE, MOVE_TYPE_LABEL } = require('../../engine/inventoryEngine')
const { createContainer, syncStockFromContainers } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')

const STATUS = { 1:'草稿', 2:'已确认', 3:'已收货', 4:'已取消' }

function fmtOrder(row) {
  return { id:row.id, orderNo:row.order_no, supplierId:row.supplier_id, supplierName:row.supplier_name, warehouseId:row.warehouse_id, warehouseName:row.warehouse_name, status:row.status, statusName:STATUS[row.status], expectedDate:row.expected_date, totalAmount:Number(row.total_amount), remark:row.remark, operatorId:row.operator_id, operatorName:row.operator_name, createdAt:row.created_at }
}

const genOrderNo = conn => generateDailyCode(conn, 'PO', 'purchase_orders', 'order_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond = status ? 'AND status=?' : ''
  const extra = status ? [like,like,status,pageSize,offset] : [like,like,pageSize,offset]
  const cntExtra = status ? [like,like,status] : [like,like]
  const [rows] = await pool.query(`SELECT * FROM purchase_orders WHERE deleted_at IS NULL AND (order_no LIKE ? OR supplier_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`, extra)
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM purchase_orders WHERE deleted_at IS NULL AND (order_no LIKE ? OR supplier_name LIKE ?) ${cond}`, cntExtra)
  return { list:rows.map(fmtOrder), pagination:{page,pageSize,total} }
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM purchase_orders WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('采购单不存在',404)
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
  if(order.status !== 1) throw new AppError('只有草稿状态的采购单可以确认',400)

  const inboundSvc = require('../inbound-tasks/inbound-tasks.service')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    await conn.query('UPDATE purchase_orders SET status=2 WHERE id=?', [id])

    await inboundSvc.createForPurchaseOrder({
      purchaseOrderId: order.id,
      purchaseOrderNo: order.orderNo,
      supplierName:    order.supplierName,
      warehouseId:     order.warehouseId,
      warehouseName:   order.warehouseName,
      items:           order.items,
      conn,
    })

    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

async function receive(id, operator) {
  const order = await findById(id)
  if(order.status !== 2) throw new AppError('只有已确认的采购单可以收货',400)
  if(!order.items.length) throw new AppError('采购单无明细',400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    for (const item of order.items) {
      // 1. 生成标准容器（STANDARD），记录来源单据
      const { containerId, barcode } = await createContainer(conn, {
        productId:     item.productId,
        warehouseId:   order.warehouseId,
        initialQty:    item.quantity,
        unit:          item.unit,
        sourceRefType: 'purchase_order',
        sourceRefId:   order.id,
        sourceRefNo:   order.orderNo,
        remark:        `采购入库 ${order.orderNo}`,
      })

      // 2. inventory_stock.quantity = SUM(container.remaining_qty)，禁止直接递增
      const afterQty = await syncStockFromContainers(conn, item.productId, order.warehouseId)

      // 3. 写入库存变动日志（与其他路径格式一致）
      const beforeQty = afterQty - item.quantity
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id, supplier_id,
            quantity, before_qty, after_qty, unit_price,
            ref_type, ref_id, ref_no,
            remark, operator_id, operator_name)
         VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.PURCHASE_IN,
          item.productId, order.warehouseId, order.supplierId,
          item.quantity, beforeQty, afterQty, item.unitPrice,
          'purchase_order', order.id, order.orderNo,
          `采购入库 ${order.orderNo} 容器#${barcode}`,
          operator.userId, operator.realName,
        ]
      )
    }

    await conn.query('UPDATE purchase_orders SET status=3 WHERE id=?', [id])
    await conn.query(
      `INSERT IGNORE INTO payment_records (type,order_id,order_no,party_name,total_amount,balance,due_date)
       VALUES (1,?,?,?,?,?,DATE_ADD(NOW(), INTERVAL 30 DAY))`,
      [order.id, order.orderNo, order.supplierName, order.totalAmount, order.totalAmount]
    )
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

async function cancel(id) {
  const order = await findById(id)
  if(order.status === 3) throw new AppError('已收货的采购单不能取消',400)
  if(order.status === 4) throw new AppError('采购单已取消',400)
  await pool.query('UPDATE purchase_orders SET status=4 WHERE id=?',[id])
}

module.exports = { findAll, findById, create, confirm, receive, cancel }
