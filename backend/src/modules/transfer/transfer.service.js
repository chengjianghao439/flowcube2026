const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { transferContainers } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const STATUS = { 1:'草稿', 2:'已确认', 3:'已执行', 4:'已取消' }

const fmt = r => ({ id:r.id, orderNo:r.order_no, fromWarehouseId:r.from_warehouse_id, fromWarehouseName:r.from_warehouse_name, toWarehouseId:r.to_warehouse_id, toWarehouseName:r.to_warehouse_name, status:r.status, statusName:STATUS[r.status], remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

const genNo = conn => generateDailyCode(conn, 'TR', 'transfer_orders', 'order_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond=status?'AND status=?':''
  const ext=status?[like,like,status,pageSize,offset]:[like,like,pageSize,offset]
  const cntExt=status?[like,like,status]:[like,like]
  const [rows]=await pool.query(`SELECT * FROM transfer_orders WHERE deleted_at IS NULL AND (order_no LIKE ? OR from_warehouse_name LIKE ? OR to_warehouse_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,status?[like,like,like,status,pageSize,offset]:[like,like,like,pageSize,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM transfer_orders WHERE deleted_at IS NULL AND (order_no LIKE ? OR from_warehouse_name LIKE ? OR to_warehouse_name LIKE ?) ${cond}`,status?[like,like,like,status]:[like,like,like])
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}

async function findById(id) {
  const [rows]=await pool.query('SELECT * FROM transfer_orders WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('调拨单不存在',404)
  const order=fmt(rows[0])
  const [items]=await pool.query('SELECT * FROM transfer_order_items WHERE order_id=? ORDER BY id',[id])
  order.items=items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, quantity:Number(r.quantity), remark:r.remark }))
  return order
}

async function create({ fromWarehouseId, fromWarehouseName, toWarehouseId, toWarehouseName, remark, items, operator }) {
  if(fromWarehouseId===toWarehouseId) throw new AppError('源仓库和目标仓库不能相同',400)
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderNo=await genNo(conn)
    const [r]=await conn.query(`INSERT INTO transfer_orders (order_no,from_warehouse_id,from_warehouse_name,to_warehouse_id,to_warehouse_name,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?)`,[orderNo,fromWarehouseId,fromWarehouseName,toWarehouseId,toWarehouseName,remark||null,operator.userId,operator.realName])
    for(const item of items) await conn.query(`INSERT INTO transfer_order_items (order_id,product_id,product_code,product_name,unit,quantity,remark) VALUES (?,?,?,?,?,?,?)`,[r.insertId,item.productId,item.productCode,item.productName,item.unit,item.quantity,item.remark||null])
    await conn.commit()
    return { id:r.insertId, orderNo }
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}

async function confirm(id) {
  const o=await findById(id)
  if(o.status!==1) throw new AppError('只有草稿可以确认',400)
  await pool.query('UPDATE transfer_orders SET status=2 WHERE id=?',[id])
}

async function execute(id, operator) {
  const o = await findById(id)
  if (o.status !== 2) throw new AppError('只有已确认的调拨单可以执行', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    for (const item of o.items) {
      // 容器路径：FIFO 扣减源仓库容器 → 目标仓库创建容器（保留批次）→ 双仓缓存同步
      // 可用库存校验（on_hand - reserved）在 transferContainers 内部完成
      const { fromBefore, fromAfter, toBefore, toAfter } = await transferContainers(conn, {
        productId:      item.productId,
        productName:    item.productName,
        fromWarehouseId: o.fromWarehouseId,
        toWarehouseId:  o.toWarehouseId,
        qty:            item.quantity,
        sourceRefType:  'transfer',
        sourceRefId:    o.id,
        sourceRefNo:    o.orderNo,
        remark:         `调拨 ${o.orderNo}`,
      })

      // 写库存变动日志：调拨出（源仓库）
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty,
            ref_type, ref_id, ref_no,
            remark, operator_id, operator_name)
         VALUES (?,2,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.TRANSFER_OUT,
          item.productId, o.fromWarehouseId,
          item.quantity, fromBefore, fromAfter,
          'transfer', o.id, o.orderNo,
          `调拨出 ${o.orderNo}`, operator.userId, operator.realName,
        ]
      )

      // 写库存变动日志：调拨入（目标仓库）
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty,
            ref_type, ref_id, ref_no,
            remark, operator_id, operator_name)
         VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.TRANSFER_IN,
          item.productId, o.toWarehouseId,
          item.quantity, toBefore, toAfter,
          'transfer', o.id, o.orderNo,
          `调拨入 ${o.orderNo}`, operator.userId, operator.realName,
        ]
      )
    }

    await conn.query('UPDATE transfer_orders SET status=3 WHERE id=?', [id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

async function cancel(id) {
  const o=await findById(id)
  if(o.status===3) throw new AppError('已执行的调拨单不能取消',400)
  if(o.status===4) throw new AppError('调拨单已取消',400)
  await pool.query('UPDATE transfer_orders SET status=4 WHERE id=?',[id])
}

module.exports = { findAll, findById, create, confirm, execute, cancel }
