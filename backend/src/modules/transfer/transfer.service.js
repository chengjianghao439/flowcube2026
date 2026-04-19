const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { transferContainers, SOURCE_TYPE, getAvailableStockForDecision } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const STATUS = { 1:'草稿', 2:'已确认', 3:'已执行', 4:'已取消' }

const fmt = r => ({ id:r.id, orderNo:r.order_no, fromWarehouseId:r.from_warehouse_id, fromWarehouseName:r.from_warehouse_name, toWarehouseId:r.to_warehouse_id, toWarehouseName:r.to_warehouse_name, status:r.status, statusName:STATUS[r.status], remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

const genNo = conn => generateDailyCode(conn, 'TR', 'transfer_orders', 'order_no')

async function assertTransferAvailability(conn, order) {
  if (!order.items?.length) throw new AppError('调拨单无明细', 400)

  const merged = new Map()
  for (const item of order.items) {
    const key = `${order.fromWarehouseId}:${item.productId}`
    const prev = merged.get(key)
    if (prev) {
      prev.quantity += Number(item.quantity)
    } else {
      merged.set(key, {
        productId: item.productId,
        productName: item.productName,
        quantity: Number(item.quantity),
      })
    }
  }

  for (const item of merged.values()) {
    const { quantity: onHand, reserved, available } = await getAvailableStockForDecision(conn, {
      productId: item.productId,
      warehouseId: order.fromWarehouseId,
      lock: true,
    })
    if (available < item.quantity) {
      throw new AppError(
        `调拨库存不足：${item.productName} 可用 ${available}，申请 ${item.quantity}`,
        400,
      )
    }
  }
}

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
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, entityName: '调拨单' })
    const rule = assertStatusAction('transfer', 'confirm', orderRow.status)
    const [itemRows] = await conn.query('SELECT * FROM transfer_order_items WHERE order_id=? ORDER BY id', [id])
    const o = {
      fromWarehouseId: Number(orderRow.from_warehouse_id),
      items: itemRows.map(r => ({
        productId: r.product_id,
        productName: r.product_name,
        quantity: Number(r.quantity),
      })),
    }
    await assertTransferAvailability(conn, o)
    await compareAndSetStatus(conn, {
      table: 'transfer_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '调拨单',
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function execute(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, entityName: '调拨单' })
    const rule = assertStatusAction('transfer', 'execute', orderRow.status)

    const [itemRows] = await conn.query('SELECT * FROM transfer_order_items WHERE order_id=? ORDER BY id', [id])
    const o = {
      id: Number(orderRow.id),
      orderNo: orderRow.order_no,
      fromWarehouseId: Number(orderRow.from_warehouse_id),
      toWarehouseId: Number(orderRow.to_warehouse_id),
      items: itemRows.map(r => ({
        productId: r.product_id,
        productName: r.product_name,
        quantity: Number(r.quantity),
      })),
    }

    await assertTransferAvailability(conn, o)

    for (const item of o.items) {
      // 容器路径：FIFO 扣减源仓库容器 → 目标仓库创建容器（保留批次）→ 双仓缓存同步
      // 可用库存校验（on_hand - reserved）在 transferContainers 内部完成
      const { fromBefore, fromAfter, toBefore, toAfter, deducted, firstNewContainerId } = await transferContainers(conn, {
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

      const outContainerId = deducted[0]?.containerId ?? null

      // 写库存变动日志：调拨出（源仓库）
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty,
            ref_type, ref_id, ref_no,
            container_id, log_source_type, log_source_ref_id,
            remark, operator_id, operator_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.TRANSFER_OUT, 2, item.productId, o.fromWarehouseId,
          item.quantity, fromBefore, fromAfter,
          'transfer', o.id, o.orderNo,
          outContainerId, SOURCE_TYPE.TRANSFER, o.id,
          `调拨出 ${o.orderNo}`, operator.userId, operator.realName,
        ]
      )

      // 写库存变动日志：调拨入（目标仓库）
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty,
            ref_type, ref_id, ref_no,
            container_id, log_source_type, log_source_ref_id,
            remark, operator_id, operator_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.TRANSFER_IN, 1, item.productId, o.toWarehouseId,
          item.quantity, toBefore, toAfter,
          'transfer', o.id, o.orderNo,
          firstNewContainerId, SOURCE_TYPE.TRANSFER, o.id,
          `调拨入 ${o.orderNo}`, operator.userId, operator.realName,
        ]
      )
    }

    await compareAndSetStatus(conn, {
      table: 'transfer_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '调拨单',
    })
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

async function cancel(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const orderRow = await lockStatusRow(conn, { table: 'transfer_orders', id, columns: 'id, status', entityName: '调拨单' })
    const rule = assertStatusAction('transfer', 'cancel', orderRow.status)
    await compareAndSetStatus(conn, {
      table: 'transfer_orders',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '调拨单',
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { findAll, findById, create, confirm, execute, cancel }
