const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { adjustContainersForStockcheck, SOURCE_TYPE, CONTAINER_STATUS, lockStockDimension } = require('../../engine/containerEngine')
const { isSerialManaged, getBookSerialsForStocktake, normalizeSerialList } = require('../../engine/serialEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')

const STATUS = { 1:'进行中', 2:'已完成', 3:'已取消' }
const fmt = r => ({ id:r.id, checkNo:r.check_no, warehouseId:r.warehouse_id, warehouseName:r.warehouse_name, checkType:r.check_type!=null?Number(r.check_type):1, scopeType:r.scope_type||null, scopeValue:r.scope_value||null, status:r.status, statusName:STATUS[r.status], remark:r.remark, operatorId:r.operator_id, operatorName:r.operator_name, createdAt:r.created_at })

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
async function listBookStocksFromActiveContainers(conn, warehouseId, productIds = null) {
  const hasFilter = Array.isArray(productIds) && productIds.length > 0
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
       ${hasFilter ? `AND c.product_id IN (${productIds.map(() => '?').join(',')})` : ''}
     GROUP BY c.product_id, p.code, p.name, p.unit
     HAVING COALESCE(SUM(c.remaining_qty), 0) > 0`,
    hasFilter ? [warehouseId, CONTAINER_STATUS.ACTIVE, ...productIds] : [warehouseId, CONTAINER_STATUS.ACTIVE],
  )
  return rows
}

/**
 * 序列号级盘点（文档04 Phase3b·C-full）：算某明细行的「现场扫到集」与「账面在库集」之差。
 *   盘亏 missing = 账面有、现场没扫到（这些具体台丢了）
 *   盘盈 surplus = 现场扫到、账面没有（发现系统不知道的实物台）
 * 实盘数 = 扫到台数，差异 = 扫到 − 账面 = |surplus| − |missing|（三者恒自洽）。
 * exec 可以是 pool（详情预览，只读）或事务 conn（提交时，配 forUpdate 防并发漂移）。
 */
async function computeSerialDiff(exec, { itemId, productId, warehouseId, forUpdate = false }) {
  const book = await getBookSerialsForStocktake(exec, { productId, warehouseId, forUpdate })
  const [scanRows] = await exec.query(
    'SELECT serial_no FROM inventory_check_item_serials WHERE check_item_id=? ORDER BY serial_no ASC',
    [itemId],
  )
  const scanned = scanRows.map(r => r.serial_no)
  const scannedSet = new Set(scanned)
  const bookSet = new Set(book.map(b => b.serialNo))
  return {
    scanned,
    bookSerials: book,
    missing: book.filter(b => !scannedSet.has(b.serialNo)),        // [{id, serialNo, containerId}]
    surplus: scanned.filter(sn => !bookSet.has(sn)),               // [serialNo]
  }
}

/**
 * 保存某明细行的现场扫码序列号（PDA 逐台扫完一次性提交，**整行替换语义**——
 * 天然幂等，断网重扫直接覆盖，不需要 requestKey 累加）。实盘数由扫到台数派生，
 * 不接受手填（防"填 5 实扫 3"）。
 */
async function saveItemSerials(id, itemId, serialNos, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table:'inventory_checks', id, columns:'id, warehouse_id, status', entityName:'盘点单' })
    assertInScope(scopeWarehouseIds, checkRow.warehouse_id, '盘点单')
    assertStatusAction('stockcheck', 'edit', checkRow.status)

    const [[item]] = await conn.query(
      'SELECT id, product_id, product_name, book_qty FROM inventory_check_items WHERE id=? AND check_id=? FOR UPDATE',
      [itemId, id],
    )
    if (!item) throw new AppError('盘点明细不存在', 404)
    if (!(await isSerialManaged(conn, item.product_id))) {
      throw new AppError(`商品「${item.product_name}」不是序列号管控商品，请直接填写实盘数量`, 400, 'SERIAL_SCAN_NOT_APPLICABLE')
    }
    const list = normalizeSerialList(serialNos)   // 去空白/拒空/拒本批重复

    // 早失败：扫到但账面没有的台（盘盈候选），若此刻已被别处认领为在库(1)，提交时必然被
    // registerStocktakeSurplusSerials 拒；在这里就报出来，别让现场扫完一整轮才发现。
    const book = await getBookSerialsForStocktake(conn, { productId: item.product_id, warehouseId: Number(checkRow.warehouse_id) })
    const bookSet = new Set(book.map(b => b.serialNo))
    const surplusCandidates = list.filter(sn => !bookSet.has(sn))
    if (surplusCandidates.length) {
      const [conflicts] = await conn.query(
        `SELECT serial_no FROM product_serials
          WHERE product_id=? AND status=1 AND serial_no IN (${surplusCandidates.map(() => '?').join(',')})`,
        [item.product_id, ...surplusCandidates],
      )
      if (conflicts.length) {
        throw new AppError(
          `序列号 ${conflicts.map(c => c.serial_no).join('、')} 已在库（挂在本仓其它容器或别的仓库），不能作为本仓盘盈登记，请核实实物位置`,
          409, 'SERIAL_ALREADY_IN_STOCK',
        )
      }
    }

    await conn.query('DELETE FROM inventory_check_item_serials WHERE check_item_id=?', [itemId])
    for (const sn of list) {
      await conn.query(
        'INSERT INTO inventory_check_item_serials (check_item_id, serial_no, scanned_by, scanned_by_name) VALUES (?,?,?,?)',
        [itemId, sn, operator?.userId ?? null, operator?.realName ?? null],
      )
    }
    // 实盘数 = 扫到台数（派生，非手填）
    const actualQty = list.length
    await conn.query(
      'UPDATE inventory_check_items SET actual_qty=?, diff_qty=? WHERE id=?',
      [actualQty, actualQty - Number(item.book_qty), itemId],
    )
    await conn.commit()
    return { itemId: Number(itemId), scannedCount: actualQty, bookQty: Number(item.book_qty), diffQty: actualQty - Number(item.book_qty) }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
}

/** PDA 盘点任务池：进行中(1)、且含序列号管控商品的盘点单（受仓库数据范围约束） */
async function listPendingSerialChecks(scopeWarehouseIds = null) {
  const scope = scopeFilter(scopeWarehouseIds, 'ic.warehouse_id')
  const [rows] = await pool.query(
    `SELECT ic.id, ic.check_no, ic.warehouse_id, ic.warehouse_name, ic.created_at,
            COUNT(ici.id) AS serialItemCount,
            SUM(CASE WHEN ici.actual_qty IS NULL THEN 1 ELSE 0 END) AS pendingCount
       FROM inventory_checks ic
       JOIN inventory_check_items ici ON ici.check_id = ic.id
       JOIN product_items p ON p.id = ici.product_id AND p.serial_managed = 1
      WHERE ic.status = 1 AND ic.deleted_at IS NULL${scope.sql}
      GROUP BY ic.id, ic.check_no, ic.warehouse_id, ic.warehouse_name, ic.created_at
      ORDER BY ic.created_at ASC`,
    scope.params,
  )
  return rows.map(r => ({
    id: Number(r.id), checkNo: r.check_no,
    warehouseId: Number(r.warehouse_id), warehouseName: r.warehouse_name,
    createdAt: r.created_at,
    serialItemCount: Number(r.serialItemCount), pendingCount: Number(r.pendingCount),
  }))
}

/** PDA 盘点作业详情：该盘点单里的序列号商品行 + 各行已扫台数/账面台数 */
async function getSerialItems(id, scopeWarehouseIds = null) {
  const [[check]] = await pool.query('SELECT id, check_no, warehouse_id, warehouse_name, status FROM inventory_checks WHERE id=? AND deleted_at IS NULL', [id])
  if (!check) throw new AppError('盘点单不存在', 404)
  assertInScope(scopeWarehouseIds, check.warehouse_id, '盘点单')
  const [items] = await pool.query(
    `SELECT ici.id, ici.product_id, ici.product_code, ici.product_name, ici.unit, ici.book_qty, ici.actual_qty,
            (SELECT COUNT(*) FROM inventory_check_item_serials s WHERE s.check_item_id = ici.id) AS scannedCount
       FROM inventory_check_items ici
       JOIN product_items p ON p.id = ici.product_id AND p.serial_managed = 1
      WHERE ici.check_id = ? ORDER BY ici.id ASC`,
    [id],
  )
  return {
    id: Number(check.id), checkNo: check.check_no,
    warehouseId: Number(check.warehouse_id), warehouseName: check.warehouse_name, status: Number(check.status),
    items: items.map(r => ({
      id: Number(r.id), productId: Number(r.product_id), productCode: r.product_code, productName: r.product_name,
      unit: r.unit, bookQty: Number(r.book_qty),
      actualQty: r.actual_qty != null ? Number(r.actual_qty) : null,
      scannedCount: Number(r.scannedCount),
    })),
  }
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
  const [items] = await pool.query(
    `SELECT ici.*, COALESCE(p.serial_managed,0) AS serial_managed
       FROM inventory_check_items ici LEFT JOIN product_items p ON p.id = ici.product_id
      WHERE ici.check_id=? ORDER BY ici.id ASC`, [id])
  check.items = items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, bookQty:Number(r.book_qty), actualQty:r.actual_qty!=null?Number(r.actual_qty):null, diffQty:r.diff_qty!=null?Number(r.diff_qty):null, serialManaged: Number(r.serial_managed) === 1 }))

  // 序列号商品行：附上「盘亏哪几台 / 盘盈哪几台」预览，让管理者提交前看清将要发生什么
  // （ERP 侧有决策权，看得见才敢按提交；仓库侧只负责扫，不做判断）。
  for (const item of check.items) {
    if (!item.serialManaged) continue
    const d = await computeSerialDiff(pool, { itemId: item.id, productId: item.productId, warehouseId: check.warehouseId })
    item.scannedSerials = d.scanned
    item.missingSerials = d.missing.map(m => m.serialNo)
    item.surplusSerials = d.surplus
  }
  return check
}

// 新建盘点单，自动拉取该仓库所有有库存的商品为盘点明细
async function create({ warehouseId, warehouseName, remark, operator, scopeWarehouseIds = null, checkType = 1, scopeType = null, scopeValue = null, productIds = null }) {
  assertInScope(scopeWarehouseIds, warehouseId, '盘点单')
  const type = Number(checkType) === 2 ? 2 : 1
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkNo = await genNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inventory_checks (check_no,warehouse_id,warehouse_name,check_type,scope_type,scope_value,remark,operator_id,operator_name) VALUES (?,?,?,?,?,?,?,?,?)`,
      [checkNo,warehouseId,warehouseName, type, type === 2 ? scopeType : null, type === 2 ? scopeValue : null, remark||null,operator.userId,operator.realName]
    )
    const checkId = r.insertId
    // 盘点账面数必须与主库存事实层一致：只统计 ACTIVE 容器，不信任全容器汇总。
    // 循环抽盘(type=2)只拉命中范围的商品；全盘(type=1)拉全仓（productIds 传 null）。
    const stocks = await listBookStocksFromActiveContainers(conn, warehouseId, type === 2 ? productIds : null)
    if (type === 2 && !stocks.length) throw new AppError('该抽盘范围内没有有货商品，无需盘点', 400)
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
      const row = itemRows.find(i => Number(i.id) === Number(item.id))
      // 序列号商品的实盘数只能由 PDA 逐台扫码派生，不接受手填——否则"填 5 实扫 3"会让
      // 数量差异与逐台比对结果打架，提交时无从判断哪几台盈亏（文档04 Phase3b·C-full）。
      if (row && await isSerialManaged(conn, row.product_id)) {
        throw new AppError(`商品「${row.product_name}」是序列号管控商品，实盘数需用 PDA 逐台扫描在架序列号，不能手工填写`, 400, 'SERIAL_ACTUAL_QTY_MANUAL_FORBIDDEN')
      }
      const actualQty = assertValidActualQty(item.actualQty)
      const bookQty = Number(row?.book_qty || 0)
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
    const [itemRows] = await conn.query(
      `SELECT ici.*, COALESCE(p.serial_managed,0) AS serial_managed
         FROM inventory_check_items ici LEFT JOIN product_items p ON p.id = ici.product_id
        WHERE ici.check_id=? ORDER BY ici.id ASC`, [id])
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
        serialManaged: Number(r.serial_managed) === 1,
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
      // 序列号商品：由「现场扫到集 vs 账面在库集」算出要盘亏的具体台与要盘盈的台，交给引擎逐台落账。
      // 注意不能因 diffQty===0 就跳过——盘盈盘亏台数相等时净差为 0，但换了几台（丢了 A 补了 X），
      // 台账仍必须更正，否则 A 还挂在库、X 不在账上，两边都不对。
      let serialPlan = null
      if (item.serialManaged) {
        const d = await computeSerialDiff(conn, {
          itemId: item.id, productId: item.productId, warehouseId: check.warehouseId, forUpdate: true,
        })
        // 扫码集派生的实盘数必须与落库的 actual_qty 一致（扫完后又被改过则拒，避免账实错位）
        if (d.scanned.length !== item.actualQty) {
          throw new AppError(`商品「${item.productName}」的实盘数(${item.actualQty})与现场扫码台数(${d.scanned.length})不一致，请重新扫描后提交`, 409, 'SERIAL_SCAN_COUNT_MISMATCH')
        }
        if (!d.missing.length && !d.surplus.length) continue
        serialPlan = { missing: d.missing, surplus: d.surplus }
      } else if (item.diffQty === 0) continue

      // 容器路径：盘盈创建新容器，盘亏 FIFO 扣减容器，同步刷新缓存
      // （序列号商品走 adjustSerialContainersForStockcheck：盘亏精确扣丢失台所在容器，不走 FIFO）
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
        serialPlan,
      })

      const containerId = item.diffQty > 0 ? createdContainerId : primaryDeductContainerId
      // 序列号行把「盘亏几台/盘盈几台」写进备注：净差可能为 0（丢了 A 又补了 X），
      // 这时数量维度看不出任何变化，唯有备注 + serial_events 能还原发生了什么。
      const serialNote = serialPlan
        ? `；逐台核对：盘亏 ${serialPlan.missing.length} 台、盘盈 ${serialPlan.surplus.length} 台`
        : ''

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
          `盘点调整 ${check.checkNo}（差异 ${item.diffQty > 0 ? '+' : ''}${item.diffQty}）${serialNote}`,
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
    // 循环盘覆盖游标：本单涉及商品刷新 last_counted_at（全盘/抽盘都写，统一游标）。同事务、不碰库存。
    for (const pid of lockProductIds) {
      await conn.query(
        `INSERT INTO inventory_count_coverage (warehouse_id,product_id,last_counted_at,last_check_id)
         VALUES (?,?,NOW(),?)
         ON DUPLICATE KEY UPDATE last_counted_at=NOW(), last_check_id=VALUES(last_check_id)`,
        [check.warehouseId, pid, id],
      )
    }
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
    // 序列号商品同步清空已扫台（账面变了说明期间有出入库，之前扫的那一轮已不可信，必须重扫）
    await conn.query('DELETE FROM inventory_check_item_serials WHERE check_item_id=?', [item.id])
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

module.exports = { findAll, findById, create, updateItems, submit, refreshItem, cancel, saveItemSerials, listPendingSerialChecks, getSerialItems }
