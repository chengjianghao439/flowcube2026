const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainerStock } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')

// ─── 采购退货 ────────────────────────────────────────────────
const PR_STATUS = { 1:'草稿', 2:'已确认', 3:'已退货', 4:'已取消' }
const SR_STATUS = { 1:'草稿', 2:'已确认', 3:'已退货入库', 4:'已取消' }

const fmtPR = r => ({ id:r.id, returnNo:r.return_no, supplierId:r.supplier_id, supplierName:r.supplier_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, purchaseOrderNo:r.purchase_order_no, status:r.status, statusName:PR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })
const fmtSR = r => ({ id:r.id, returnNo:r.return_no, customerId:r.customer_id, customerName:r.customer_name, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, saleOrderNo:r.sale_order_no, status:r.status, statusName:SR_STATUS[r.status], totalAmount:Number(r.total_amount), remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

const genNo = (conn, prefix, table, col) => generateDailyCode(conn, prefix, table, col)

// 采购退货
async function findAllPR({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond=status?'AND status=?':''
  const [rows]=await pool.query(`SELECT * FROM purchase_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR supplier_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,status?[like,like,status,pageSize,offset]:[like,like,pageSize,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM purchase_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR supplier_name LIKE ?) ${cond}`,status?[like,like,status]:[like,like])
  return { list:rows.map(fmtPR), pagination:{page,pageSize,total} }
}
async function findByIdPR(id) {
  const [rows]=await pool.query('SELECT * FROM purchase_returns WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('退货单不存在',404)
  const ret=fmtPR(rows[0])
  const [items]=await pool.query('SELECT * FROM purchase_return_items WHERE return_id=?',[id])
  ret.items=items.map(r=>({id:r.id,productId:r.product_id,productCode:r.product_code,productName:r.product_name,unit:r.unit,quantity:Number(r.quantity),unitPrice:Number(r.unit_price),amount:Number(r.amount)}))
  return ret
}
async function createPR({ supplierId, supplierName, warehouseId, warehouseName, purchaseOrderNo, remark, items, operator }) {
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const returnNo=await genNo(conn,'PR','purchase_returns','return_no')
    const total=items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r]=await conn.query(`INSERT INTO purchase_returns (return_no,supplier_id,supplier_name,warehouse_id,warehouse_name,purchase_order_no,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,[returnNo,supplierId,supplierName,warehouseId,warehouseName,purchaseOrderNo||null,total,remark||null,operator.userId,operator.realName])
    for(const item of items) await conn.query(`INSERT INTO purchase_return_items (return_id,product_id,product_code,product_name,unit,quantity,unit_price,amount) VALUES (?,?,?,?,?,?,?,?)`,[r.insertId,item.productId,item.productCode,item.productName,item.unit,item.quantity,item.unitPrice,item.quantity*item.unitPrice])
    await conn.commit(); return { id:r.insertId, returnNo }
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}
async function executePR(id, operator) {
  const ret = await findByIdPR(id)
  if (ret.status !== 2) throw new AppError('只有已确认的退货单可以执行', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const item of ret.items) {
      // 采购退货出库：从仓库扣减容器（FIFO）→ 同步缓存
      const { before, after } = await adjustContainerStock(conn, {
        productId:    item.productId,
        productName:  item.productName,
        warehouseId:  ret.warehouseId,
        qty:          -item.quantity,   // 出库方向
        unit:         item.unit,
        sourceRefType: 'purchase_return',
        sourceRefId:  ret.id,
        sourceRefNo:  ret.returnNo,
        remark:       `采购退货出库 ${ret.returnNo}`,
      })
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id, supplier_id,
            quantity, before_qty, after_qty, unit_price,
            ref_type, ref_id, ref_no, remark, operator_id, operator_name)
         VALUES (?,2,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [MOVE_TYPE.PURCHASE_RET, item.productId, ret.warehouseId, ret.supplierId,
         item.quantity, before, after, item.unitPrice,
         'purchase_return', ret.id, ret.returnNo,
         `采购退货出库 ${ret.returnNo}`, operator.userId, operator.realName]
      )
    }
    await conn.query('UPDATE purchase_returns SET status=3 WHERE id=?', [id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}
async function cancelPR(id) {
  const ret=await findByIdPR(id)
  if(ret.status===3) throw new AppError('已退货的单据不能取消',400)
  if(ret.status===4) throw new AppError('已取消',400)
  await pool.query('UPDATE purchase_returns SET status=4 WHERE id=?',[id])
}

// 销售退货
async function findAllSR({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond=status?'AND status=?':''
  const [rows]=await pool.query(`SELECT * FROM sale_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR customer_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,status?[like,like,status,pageSize,offset]:[like,like,pageSize,offset])
  const [[{total}]]=await pool.query(`SELECT COUNT(*) AS total FROM sale_returns WHERE deleted_at IS NULL AND (return_no LIKE ? OR customer_name LIKE ?) ${cond}`,status?[like,like,status]:[like,like])
  return { list:rows.map(fmtSR), pagination:{page,pageSize,total} }
}
async function findByIdSR(id) {
  const [rows]=await pool.query('SELECT * FROM sale_returns WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('退货单不存在',404)
  const ret=fmtSR(rows[0])
  const [items]=await pool.query('SELECT * FROM sale_return_items WHERE return_id=?',[id])
  ret.items=items.map(r=>({id:r.id,productId:r.product_id,productCode:r.product_code,productName:r.product_name,unit:r.unit,quantity:Number(r.quantity),unitPrice:Number(r.unit_price),amount:Number(r.amount)}))
  return ret
}
async function createSR({ customerId, customerName, warehouseId, warehouseName, saleOrderNo, remark, items, operator }) {
  const conn=await pool.getConnection()
  try {
    await conn.beginTransaction()
    const returnNo=await genNo(conn,'SR','sale_returns','return_no')
    const total=items.reduce((s,i)=>s+i.quantity*i.unitPrice,0)
    const [r]=await conn.query(`INSERT INTO sale_returns (return_no,customer_id,customer_name,warehouse_id,warehouse_name,sale_order_no,total_amount,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?,?)`,[returnNo,customerId,customerName,warehouseId,warehouseName,saleOrderNo||null,total,remark||null,operator.userId,operator.realName])
    for(const item of items) await conn.query(`INSERT INTO sale_return_items (return_id,product_id,product_code,product_name,unit,quantity,unit_price,amount) VALUES (?,?,?,?,?,?,?,?)`,[r.insertId,item.productId,item.productCode,item.productName,item.unit,item.quantity,item.unitPrice,item.quantity*item.unitPrice])
    await conn.commit(); return { id:r.insertId, returnNo }
  } catch(e){ await conn.rollback(); throw e } finally { conn.release() }
}
async function executeSR(id, operator) {
  const ret = await findByIdSR(id)
  if (ret.status !== 2) throw new AppError('只有已确认的退货单可以执行', 400)
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const item of ret.items) {
      // 销售退货入库：客户退回商品，创建新容器→ 同步缓存
      const { before, after } = await adjustContainerStock(conn, {
        productId:    item.productId,
        productName:  item.productName,
        warehouseId:  ret.warehouseId,
        qty:          +item.quantity,   // 入库方向
        unit:         item.unit,
        sourceRefType: 'sale_return',
        sourceRefId:  ret.id,
        sourceRefNo:  ret.returnNo,
        remark:       `销售退货入库 ${ret.returnNo}`,
      })
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty, unit_price,
            ref_type, ref_id, ref_no, remark, operator_id, operator_name)
         VALUES (?,1,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [MOVE_TYPE.SALE_RET, item.productId, ret.warehouseId,
         item.quantity, before, after, item.unitPrice,
         'sale_return', ret.id, ret.returnNo,
         `销售退货入库 ${ret.returnNo}`, operator.userId, operator.realName]
      )
    }
    await conn.query('UPDATE sale_returns SET status=3 WHERE id=?', [id])
    await conn.commit()
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}
async function cancelSR(id) {
  const ret=await findByIdSR(id)
  if(ret.status===3||ret.status===4) throw new AppError('该状态不能取消',400)
  await pool.query('UPDATE sale_returns SET status=4 WHERE id=?',[id])
}

module.exports = { findAllPR, findByIdPR, createPR, executePR, cancelPR, findAllSR, findByIdSR, createSR, executeSR, cancelSR }
