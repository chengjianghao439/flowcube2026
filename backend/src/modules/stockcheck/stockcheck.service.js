const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainersForStockcheck, SOURCE_TYPE } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')

const STATUS = { 1:'进行中', 2:'已完成', 3:'已取消' }
const fmt = r => ({ id:r.id, checkNo:r.check_no, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, status:r.status, statusName:STATUS[r.status], remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

const genNo = conn => generateDailyCode(conn, 'SC', 'inventory_checks', 'check_no')

async function findAll({ page=1, pageSize=20, keyword='', status=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  const cond=status?'AND status=?':''
  const extra=status?[like,like,status,pageSize,offset]:[like,like,pageSize,offset]
  const cntExtra=status?[like,like,status]:[like,like]
  const [rows] = await pool.query(`SELECT * FROM inventory_checks WHERE deleted_at IS NULL AND (check_no LIKE ? OR warehouse_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,extra)
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM inventory_checks WHERE deleted_at IS NULL AND (check_no LIKE ? OR warehouse_name LIKE ?) ${cond}`,cntExtra)
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}

async function findById(id) {
  const [rows] = await pool.query('SELECT * FROM inventory_checks WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('盘点单不存在',404)
  const check = fmt(rows[0])
  const [items] = await pool.query('SELECT * FROM inventory_check_items WHERE check_id=? ORDER BY id ASC',[id])
  check.items = items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, bookQty:Number(r.book_qty), actualQty:r.actual_qty!=null?Number(r.actual_qty):null, diffQty:r.diff_qty!=null?Number(r.diff_qty):null }))
  return check
}

// 新建盘点单，自动拉取该仓库所有有库存的商品为盘点明细
async function create({ warehouseId, warehouseName, remark, operator }) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkNo = await genNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inventory_checks (check_no,warehouse_id,warehouse_name,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?)`,
      [checkNo,warehouseId,warehouseName,remark||null,operator.userId,operator.realName]
    )
    const checkId = r.insertId
    // 盘点账面数以容器汇总为准，避免直接信任缓存表 inventory_stock。
    const [stocks] = await conn.query(
      `SELECT
          c.product_id,
          COALESCE(SUM(c.remaining_qty), 0) AS quantity,
          p.code AS product_code,
          p.name AS product_name,
          p.unit
       FROM inventory_containers c
       JOIN product_items p ON c.product_id = p.id
       WHERE c.warehouse_id = ?
         AND c.deleted_at IS NULL
         AND p.deleted_at IS NULL
       GROUP BY c.product_id, p.code, p.name, p.unit
       HAVING COALESCE(SUM(c.remaining_qty), 0) > 0`,
      [warehouseId],
    )
    for(const s of stocks) {
      await conn.query(`INSERT INTO inventory_check_items (check_id,product_id,product_code,product_name,unit,book_qty) VALUES (?,?,?,?,?,?)`,[checkId,s.product_id,s.product_code,s.product_name,s.unit,s.quantity])
    }
    await conn.commit()
    return { id:checkId, checkNo }
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

// 填写实盘数量
async function updateItems(id, items) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, columns: 'id, status', entityName: '盘点单' })
    assertStatusAction('stockcheck', 'edit', checkRow.status)
    const [itemRows] = await conn.query('SELECT * FROM inventory_check_items WHERE check_id=? ORDER BY id ASC', [id])
    for(const item of items) {
      const bookQty = Number(itemRows.find(i => Number(i.id) === Number(item.id))?.book_qty || 0)
      const diff = item.actualQty - bookQty
      await conn.query('UPDATE inventory_check_items SET actual_qty=?,diff_qty=? WHERE id=? AND check_id=?',[item.actualQty,diff,item.id,id])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// 提交盘点，批量调整库存
async function submit(id, operator) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, entityName: '盘点单' })
    const rule = assertStatusAction('stockcheck', 'submit', checkRow.status)
    const [itemRows] = await conn.query('SELECT * FROM inventory_check_items WHERE check_id=? ORDER BY id ASC', [id])
    const check = {
      id: Number(checkRow.id),
      checkNo: checkRow.check_no,
      warehouseId: Number(checkRow.warehouse_id),
      items: itemRows.map(r => ({
        id:r.id,
        productId:r.product_id,
        productName:r.product_name,
        unit:r.unit,
        actualQty:r.actual_qty!=null?Number(r.actual_qty):null,
        diffQty:r.diff_qty!=null?Number(r.diff_qty):null,
      })),
    }
    const unfilled = check.items.filter(i=>i.actualQty===null)
    if(unfilled.length) throw new AppError(`还有 ${unfilled.length} 条明细未填写实盘数量`,400)
    for (const item of check.items) {
      if (item.diffQty === 0) continue

      // 容器路径：盘盈创建新容器，盘亏 FIFO 扣减容器，同步刷新缓存
      const { before, after, createdContainerId, primaryDeductContainerId } = await adjustContainersForStockcheck(conn, {
        productId:    item.productId,
        productName:  item.productName,
        warehouseId:  check.warehouseId,
        diffQty:      item.diffQty,
        unit:         item.unit,
        sourceRefType: 'stockcheck',
        sourceRefId:  check.id,
        sourceRefNo:  check.checkNo,
        remark:       `盘点调整 ${check.checkNo}`,
      })

      const containerId = item.diffQty > 0 ? createdContainerId : primaryDeductContainerId

      // 写库存变动日志
      await conn.query(
        `INSERT INTO inventory_logs
           (move_type, type, product_id, warehouse_id,
            quantity, before_qty, after_qty,
            ref_type, ref_id, ref_no,
            container_id, log_source_type, log_source_ref_id,
            remark, operator_id, operator_name)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          MOVE_TYPE.STOCKCHECK,
          item.diffQty > 0 ? 1 : 2,     // 盘盈=1(入库方向), 盘亏=2(出库方向)
          item.productId, check.warehouseId,
          Math.abs(item.diffQty), before, after,
          'stockcheck', check.id, check.checkNo,
          containerId, SOURCE_TYPE.STOCKCHECK, check.id,
          `盘点调整 ${check.checkNo}（差异 ${item.diffQty > 0 ? '+' : ''}${item.diffQty}）`,
          operator.userId, operator.realName,
        ]
      )
    }
    await compareAndSetStatus(conn, {
      table: 'inventory_checks',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '盘点单',
    })
    await conn.commit()
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

async function cancel(id) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, columns: 'id, status', entityName: '盘点单' })
    const rule = assertStatusAction('stockcheck', 'cancel', checkRow.status)
    await compareAndSetStatus(conn, {
      table: 'inventory_checks',
      id,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '盘点单',
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { findAll, findById, create, updateItems, submit, cancel }
