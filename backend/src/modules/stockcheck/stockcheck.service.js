const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainersForStockcheck, SOURCE_TYPE, CONTAINER_STATUS, lockStockDimension } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')

const STATUS = { 1:'进行中', 2:'已完成', 3:'已取消' }
const fmt = r => ({ id:r.id, checkNo:r.check_no, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, status:r.status, statusName:STATUS[r.status], remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

const genNo = conn => generateDailyCode(conn, 'SC', 'inventory_checks', 'check_no')

function assertValidActualQty(actualQty) {
  const normalized = Number(actualQty)
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw new AppError('实盘数量必须为大于或等于 0 的数字', 400)
  }
  return normalized
}

/**
 * 盘点账面口径统一入口：
 * - 只统计 ACTIVE 容器（与主库存事实层一致）
 * - 明确排除待上架/空容器/作废容器，避免生成第二套库存口径
 */
async function listBookStocksFromActiveContainers(conn, warehouseId) {
  const [rows] = await conn.query(
    `SELECT
        c.product_id,
        COALESCE(SUM(c.remaining_qty), 0) AS quantity,
        p.code AS product_code,
        p.name AS product_name,
        p.unit
     FROM inventory_containers c
     JOIN product_items p ON c.product_id = p.id
     WHERE c.warehouse_id = ?
       AND c.status = ?
       AND c.deleted_at IS NULL
       AND p.deleted_at IS NULL
     GROUP BY c.product_id, p.code, p.name, p.unit
     HAVING COALESCE(SUM(c.remaining_qty), 0) > 0`,
    [warehouseId, CONTAINER_STATUS.ACTIVE],
  )
  return rows
}

async function findAll({ page=1, pageSize=20, keyword='', status=null, scopeWarehouseIds=null }) {
  const offset=(page-1)*pageSize, like=`%${keyword}%`
  let cond=status?'AND status=?':''
  const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const scopeParams = []
  if (scope.sql) { cond += scope.sql; scopeParams.push(...scope.params) }
  const base=status?[like,like,status,...scopeParams]:[like,like,...scopeParams]
  const extra=[...base,pageSize,offset]
  const cntExtra=base
  const [rows] = await pool.query(`SELECT * FROM inventory_checks WHERE deleted_at IS NULL AND (check_no LIKE ? OR warehouse_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,extra)
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM inventory_checks WHERE deleted_at IS NULL AND (check_no LIKE ? OR warehouse_name LIKE ?) ${cond}`,cntExtra)
  return { list:rows.map(fmt), pagination:{page,pageSize,total} }
}

async function findById(id, scopeWarehouseIds = null) {
  const [rows] = await pool.query('SELECT * FROM inventory_checks WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('盘点单不存在',404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '盘点单')
  const check = fmt(rows[0])
  const [items] = await pool.query('SELECT * FROM inventory_check_items WHERE check_id=? ORDER BY id ASC',[id])
  check.items = items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, bookQty:Number(r.book_qty), actualQty:r.actual_qty!=null?Number(r.actual_qty):null, diffQty:r.diff_qty!=null?Number(r.diff_qty):null }))
  return check
}

// 新建盘点单，自动拉取该仓库所有有库存的商品为盘点明细
async function create({ warehouseId, warehouseName, remark, operator, scopeWarehouseIds = null }) {
  assertInScope(scopeWarehouseIds, warehouseId, '盘点单')
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkNo = await genNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inventory_checks (check_no,warehouse_id,warehouse_name,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?)`,
      [checkNo,warehouseId,warehouseName,remark||null,operator.userId,operator.realName]
    )
    const checkId = r.insertId
    // 盘点账面数必须与主库存事实层一致：只统计 ACTIVE 容器，不信任全容器汇总。
    const stocks = await listBookStocksFromActiveContainers(conn, warehouseId)
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
      const actualQty = assertValidActualQty(item.actualQty)
      const bookQty = Number(itemRows.find(i => Number(i.id) === Number(item.id))?.book_qty || 0)
      const diff = actualQty - bookQty
      await conn.query('UPDATE inventory_check_items SET actual_qty=?,diff_qty=? WHERE id=? AND check_id=?',[actualQty,diff,item.id,id])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 读取单商品当前账面数（ACTIVE 容器合计，加行锁）。
 * 提交盘点前用它逐行核对：盘点单创建后若该商品发生过出入库，book_qty 已过期，
 * 按旧账面算的 diff 会把正常业务变动误记成盘盈/盘亏，必须拦截并要求重盘。
 */
async function getCurrentBookQty(conn, productId, warehouseId) {
  const [[{ qty }]] = await conn.query(
    `SELECT COALESCE(SUM(remaining_qty), 0) AS qty
     FROM inventory_containers
     WHERE product_id=? AND warehouse_id=? AND status=? AND deleted_at IS NULL
     FOR UPDATE`,
    [productId, warehouseId, CONTAINER_STATUS.ACTIVE],
  )
  return Number(qty)
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
        bookQty:Number(r.book_qty),
        actualQty:r.actual_qty!=null?Number(r.actual_qty):null,
        diffQty:r.diff_qty!=null?Number(r.diff_qty):null,
      })),
    }
    const unfilled = check.items.filter(i=>i.actualQty===null)
    if(unfilled.length) throw new AppError(`还有 ${unfilled.length} 条明细未填写实盘数量`,400)
    check.items.forEach(item => { item.actualQty = assertValidActualQty(item.actualQty) })

    // 统一加锁顺序：先按 product_id 升序对每个被盘商品取 inventory_stock 维度锁，再做账面
    // 漂移校验(getCurrentBookQty 会 FOR UPDATE 锁容器)与调整。否则本事务是「先容器后 stock」，
    // 与出库(moveStock)/上架(lockStockDimension)的「先 stock 后容器」相反，盘点提交与并发
    // 出库/上架会 ABBA 死锁（见 containerEngine.lockStockDimension 注释）。
    const lockProductIds = [...new Set(check.items.map(i => Number(i.productId)))].sort((a, b) => a - b)
    for (const productId of lockProductIds) {
      await lockStockDimension(conn, productId, check.warehouseId)
    }

    // 先整单校验再调整：任何一行账面已漂移都不动库存，把漂移行一次性列全，
    // 避免"调到一半才报错"给现场造成部分行已生效的错觉（事务虽会回滚，但报错要完整）。
    const staleLines = []
    for (const item of check.items) {
      const currentBookQty = await getCurrentBookQty(conn, item.productId, check.warehouseId)
      if (currentBookQty !== item.bookQty) {
        staleLines.push(`「${item.productName}」账面 ${item.bookQty}→${currentBookQty}`)
      }
    }
    if (staleLines.length) {
      throw new AppError(
        `以下商品在盘点期间发生过出入库，账面数已变化，请刷新账面并重盘后再提交：${staleLines.join('；')}`,
        409,
      )
    }
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
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
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

// 刷新单行账面数：盘点期间该商品发生过出入库时，把 book_qty 重置为当前账面，
// 并清空实盘/差异（实盘数是基于旧库存状态点的实物计数，账面变了必须重数）。
async function refreshItem(id, itemId) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, columns: 'id, warehouse_id, status', entityName: '盘点单' })
    assertStatusAction('stockcheck', 'edit', checkRow.status)
    const [[item]] = await conn.query(
      'SELECT id, product_id, product_name FROM inventory_check_items WHERE id=? AND check_id=?',
      [itemId, id],
    )
    if (!item) throw new AppError('盘点明细不存在', 404)
    const currentBookQty = await getCurrentBookQty(conn, item.product_id, Number(checkRow.warehouse_id))
    await conn.query(
      'UPDATE inventory_check_items SET book_qty=?, actual_qty=NULL, diff_qty=NULL WHERE id=?',
      [currentBookQty, item.id],
    )
    await conn.commit()
    return { itemId: Number(item.id), productName: item.product_name, bookQty: currentBookQty }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
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

module.exports = { findAll, findById, create, updateItems, submit, refreshItem, cancel }
