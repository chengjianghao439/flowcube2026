const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { MOVE_TYPE, writeInventoryLog } = require('../../engine/inventoryEngine')
const { adjustContainersForStockcheck, SOURCE_TYPE, CONTAINER_STATUS, lockStockDimension, syncStockFromContainers } = require('../../engine/containerEngine')
const { generateDailyCode } = require('../../utils/codeGenerator')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { scopeFilter, assertInScope } = require('../../utils/warehouseScope')
const { normalizePagination } = require('../../utils/pagination')

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
        p.unit,
        p.article_number,
        p.spec,
        p.color
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

async function findAll({ page=1, pageSize=20, keyword='', status=null, scopeWarehouseIds=null }) {
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize }), like=`%${keyword}%`
  let cond=status?'AND status=?':''
  const scope = scopeFilter(scopeWarehouseIds, 'warehouse_id')
  const scopeParams = []
  if (scope.sql) { cond += scope.sql; scopeParams.push(...scope.params) }
  const base=status?[like,like,status,...scopeParams]:[like,like,...scopeParams]
  const extra=[...base,ps,offset]
  const cntExtra=base
  const [rows] = await pool.query(`SELECT * FROM inventory_checks WHERE deleted_at IS NULL AND (check_no LIKE ? OR warehouse_name LIKE ?) ${cond} ORDER BY created_at DESC LIMIT ? OFFSET ?`,extra)
  const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM inventory_checks WHERE deleted_at IS NULL AND (check_no LIKE ? OR warehouse_name LIKE ?) ${cond}`,cntExtra)
  return { list:rows.map(fmt), pagination:{page,pageSize:ps,total} }
}

async function findById(id, scopeWarehouseIds = null) {
  const [rows] = await pool.query('SELECT * FROM inventory_checks WHERE id=? AND deleted_at IS NULL',[id])
  if(!rows[0]) throw new AppError('盘点单不存在',404)
  assertInScope(scopeWarehouseIds, rows[0].warehouse_id, '盘点单')
  const check = fmt(rows[0])
  const [items] = await pool.query(
    `SELECT ici.*, p.article_number, p.spec, p.color,
            (SELECT COUNT(*) FROM inventory_check_item_containers s WHERE s.check_item_id = ici.id) AS scanned_container_count
       FROM inventory_check_items ici
       JOIN product_items p ON p.id = ici.product_id
       WHERE ici.check_id=? ORDER BY ici.id ASC`, [id])
  check.items = items.map(r=>({ id:r.id, productId:r.product_id, productCode:r.product_code, productName:r.product_name, unit:r.unit, articleNumber:r.article_number||null, spec:r.spec||null, color:r.color||null, bookQty:Number(r.book_qty), actualQty:r.actual_qty!=null?Number(r.actual_qty):null, diffQty:r.diff_qty!=null?Number(r.diff_qty):null,
    // PDA 扫码盘点（文档13 §4.3）：有扫码记录的行实盘数由扫码集派生，ERP 手填锁定
    scanDriven: Number(r.scanned_container_count) > 0,
    scannedContainerCount: Number(r.scanned_container_count),
  }))
  return check
}

/** PDA 扫码盘点任务池：进行中的盘点单 + 各行填写进度（受仓库数据范围约束） */
async function listPendingScanChecks(scopeWarehouseIds = null) {
  const scope = scopeFilter(scopeWarehouseIds, 'ic.warehouse_id')
  const [rows] = await pool.query(
    `SELECT ic.id, ic.check_no, ic.warehouse_id, ic.warehouse_name, ic.created_at,
            COUNT(ici.id) AS itemCount,
            SUM(CASE WHEN ici.actual_qty IS NULL THEN 1 ELSE 0 END) AS pendingCount
       FROM inventory_checks ic
       JOIN inventory_check_items ici ON ici.check_id = ic.id
      WHERE ic.status = 1 AND ic.deleted_at IS NULL${scope.sql}
      GROUP BY ic.id, ic.check_no, ic.warehouse_id, ic.warehouse_name, ic.created_at
      ORDER BY ic.created_at ASC`,
    scope.params,
  )
  return rows.map(r => ({
    id: Number(r.id), checkNo: r.check_no,
    warehouseId: Number(r.warehouse_id), warehouseName: r.warehouse_name,
    createdAt: r.created_at,
    itemCount: Number(r.itemCount), pendingCount: Number(r.pendingCount),
  }))
}

/** PDA 扫码盘点作业页：该单明细行 + 各行账面容器数 / 已扫容器数 / 已扫明细（供断点续扫回显） */
async function getScanItems(id, scopeWarehouseIds = null) {
  const [[check]] = await pool.query('SELECT id, check_no, warehouse_id, warehouse_name, status FROM inventory_checks WHERE id=? AND deleted_at IS NULL', [id])
  if (!check) throw new AppError('盘点单不存在', 404)
  assertInScope(scopeWarehouseIds, check.warehouse_id, '盘点单')
  const [items] = await pool.query(
    `SELECT ici.id, ici.product_id, ici.product_code, ici.product_name, ici.unit, ici.book_qty, ici.actual_qty,
            (SELECT COUNT(*) FROM inventory_containers c
              WHERE c.product_id = ici.product_id AND c.warehouse_id = ? AND c.status = 1 AND c.deleted_at IS NULL) AS book_container_count,
            (SELECT COUNT(*) FROM inventory_check_item_containers s WHERE s.check_item_id = ici.id) AS scanned_container_count
       FROM inventory_check_items ici
      WHERE ici.check_id = ? ORDER BY ici.id ASC`,
    [check.warehouse_id, id],
  )
  const itemIds = items.map(i => i.id)
  const scansByItem = new Map()
  if (itemIds.length) {
    const [scanRows] = await pool.query(
      `SELECT s.check_item_id, s.container_id, s.barcode, s.counted_qty,
              (c.container_type = 1 AND c.initial_qty = 1) AS individual
         FROM inventory_check_item_containers s
         LEFT JOIN inventory_containers c ON c.id = s.container_id
        WHERE s.check_item_id IN (?) ORDER BY s.id ASC`,
      [itemIds],
    )
    for (const r of scanRows) {
      const k = Number(r.check_item_id)
      if (!scansByItem.has(k)) scansByItem.set(k, [])
      scansByItem.get(k).push({ containerId: Number(r.container_id), barcode: r.barcode, countedQty: Number(r.counted_qty), individual: Number(r.individual) === 1 })
    }
  }
  return {
    id: Number(check.id), checkNo: check.check_no,
    warehouseId: Number(check.warehouse_id), warehouseName: check.warehouse_name, status: Number(check.status),
    items: items.map(r => ({
      id: Number(r.id), productId: Number(r.product_id), productCode: r.product_code, productName: r.product_name,
      unit: r.unit, bookQty: Number(r.book_qty),
      actualQty: r.actual_qty != null ? Number(r.actual_qty) : null,
      bookContainerCount: Number(r.book_container_count),
      scannedContainerCount: Number(r.scanned_container_count),
      scans: scansByItem.get(Number(r.id)) || [],
    })),
  }
}

/**
 * 保存某明细行的现场扫码容器集（PDA 扫完一次性提交，**整行替换语义**——天然幂等，断网重扫直接覆盖）。
 * 实盘数 = 各容器实盘数之和（派生，非手填）。
 *
 * 校验（宁可当场拒，不让现场扫完整仓才发现）：
 *  - 条码必须是「本行商品 × 本仓 × 在库(ACTIVE)」的容器，否则是别处的货/已失效的码，拒收让现场核实；
 *  - 个体容器（一件一码）实盘恒为 1，不接受填数；
 *  - 数量容器实盘须 ≥0 且不得多于账面剩余——盘盈不是仓库现场能决策的事，走 ERP 手工调整；
 *  - 同一条码本批重复 → 拒。
 */
async function saveItemContainerScans(id, itemId, scans, operator, scopeWarehouseIds = null) {
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

    const list = Array.isArray(scans) ? scans : []
    const seen = new Set()
    const normalized = []
    for (const raw of list) {
      const bc = String(raw?.barcode ?? '').trim()
      if (!bc) throw new AppError('存在空条码，请重新扫描', 400)
      if (seen.has(bc.toUpperCase())) throw new AppError(`条码 ${bc} 本批重复扫描`, 400, 'SCAN_DUP_IN_BATCH')
      seen.add(bc.toUpperCase())
      normalized.push({ barcode: bc, countedQty: raw?.countedQty })
    }

    const containerByBarcode = new Map()
    if (normalized.length) {
      const [rows] = await conn.query(
        `SELECT id, barcode, remaining_qty, container_type, initial_qty
           FROM inventory_containers
          WHERE barcode IN (${normalized.map(() => '?').join(',')}) AND deleted_at IS NULL`,
        normalized.map(n => n.barcode),
      )
      for (const c of rows) containerByBarcode.set(String(c.barcode).toUpperCase(), c)
    }

    const rows = []
    for (const n of normalized) {
      const c = containerByBarcode.get(n.barcode.toUpperCase())
      if (!c) throw new AppError(`条码 ${n.barcode} 不存在或已失效，请核实实物`, 400, 'SCAN_CONTAINER_INVALID')
      const [[full]] = await conn.query(
        'SELECT product_id, warehouse_id, status FROM inventory_containers WHERE id = ?',
        [c.id],
      )
      if (Number(full.product_id) !== Number(item.product_id)) {
        throw new AppError(`条码 ${n.barcode} 不是商品「${item.product_name}」的库存条码，请核实实物归属`, 400, 'SCAN_PRODUCT_MISMATCH')
      }
      if (Number(full.warehouse_id) !== Number(checkRow.warehouse_id) || Number(full.status) !== CONTAINER_STATUS.ACTIVE) {
        throw new AppError(`条码 ${n.barcode} 不是本仓在库条码（可能在其他仓库或已出库），请核实`, 400, 'SCAN_CONTAINER_NOT_IN_STOCK')
      }
      const individual = Number(c.container_type) === 1 && Number(c.initial_qty) === 1
      let counted
      if (individual) {
        counted = 1   // 个体扫到即计 1，不接受填数
      } else {
        counted = Number(n.countedQty)
        if (!Number.isFinite(counted) || counted < 0) throw new AppError(`条码 ${n.barcode} 请填写该容器实盘数量`, 400, 'SCAN_COUNT_REQUIRED')
        if (counted > Number(c.remaining_qty) + 1e-9) {
          throw new AppError(`条码 ${n.barcode} 实盘 ${counted} 多于账面 ${Number(c.remaining_qty)}，请核实是否扫错；盘盈请走 ERP 手工调整`, 409, 'SCAN_OVER_COUNT')
        }
      }
      rows.push({ containerId: Number(c.id), barcode: n.barcode, countedQty: counted })
    }

    await conn.query('DELETE FROM inventory_check_item_containers WHERE check_item_id=?', [itemId])
    for (const r of rows) {
      await conn.query(
        'INSERT INTO inventory_check_item_containers (check_item_id, container_id, barcode, counted_qty, scanned_by, scanned_by_name) VALUES (?,?,?,?,?,?)',
        [itemId, r.containerId, r.barcode, r.countedQty, operator?.userId ?? null, operator?.realName ?? null],
      )
    }
    // 实盘数 = 各容器实盘之和（派生）；一个都没扫 = 0（全行盘亏），与序列号盘点同语义
    const actualQty = rows.reduce((sum, r) => sum + r.countedQty, 0)
    await conn.query(
      'UPDATE inventory_check_items SET actual_qty=?, diff_qty=? WHERE id=?',
      [actualQty, actualQty - Number(item.book_qty), itemId],
    )
    await conn.commit()
    return { itemId: Number(itemId), scannedContainers: rows.length, actualQty, bookQty: Number(item.book_qty), diffQty: actualQty - Number(item.book_qty) }
  } catch (e) { await conn.rollback(); throw e }
  finally { conn.release() }
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
    }    await conn.commit()
    return { id:checkId, checkNo }
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

// 填写实盘数量
async function updateItems(id, items, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, columns: 'id, status, warehouse_id', entityName: '盘点单' })
    assertInScope(scopeWarehouseIds, checkRow.warehouse_id, '盘点单')
    assertStatusAction('stockcheck', 'edit', checkRow.status)
    const [itemRows] = await conn.query('SELECT * FROM inventory_check_items WHERE check_id=? ORDER BY id ASC', [id])
    const [scanRows] = await conn.query(
      `SELECT DISTINCT check_item_id FROM inventory_check_item_containers
        WHERE check_item_id IN (SELECT id FROM inventory_check_items WHERE check_id=?)`, [id])
    const scanDrivenIds = new Set(scanRows.map(r => Number(r.check_item_id)))
    for(const item of items) {
      const row = itemRows.find(i => Number(i.id) === Number(item.id))
      // 该行已由 PDA 扫码盘点：实盘数以扫码集为准，手填会与之打架（文档13 §4.3）
      if (row && scanDrivenIds.has(Number(row.id))) {
        throw new AppError(`商品「${row.product_name}」已由 PDA 扫码盘点，实盘数以扫码为准，不能手工填写`, 400, 'SCAN_DRIVEN_ITEM')
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

/**
 * 批量读账面数（2026-08-22 性能）：盘点提交校验阶段此前逐行调 getCurrentBookQty
 * （每次 SUM ... FOR UPDATE 锁该商品全部 ACTIVE 容器），千级 SKU 全仓盘点 =
 * 千次串行往返。改为一次查询批量取回全部被盘商品的容器合计（FOR UPDATE 一次锁全），
 * 锁顺序不变（维度锁已先取），事务语义与逐行完全等价。
 */
async function getCurrentBookQties(conn, productWhPairs) {
  const pairs = [...new Set(productWhPairs.map(p => `${Number(p.productId)}:${Number(p.warehouseId)}`))]
  if (!pairs.length) return new Map()
  const values = pairs.map(p => p.split(':').map(Number))
  const placeholders = values.map(() => '(?,?)').join(',')
  const params = values.flat()
  const [rows] = await conn.query(
    `SELECT product_id, warehouse_id, COALESCE(SUM(remaining_qty), 0) AS qty
     FROM inventory_containers
     WHERE (product_id, warehouse_id) IN (${placeholders})
       AND status=? AND deleted_at IS NULL
     GROUP BY product_id, warehouse_id
     FOR UPDATE`,
    [...params, CONTAINER_STATUS.ACTIVE],
  )
  const map = new Map()
  for (const r of rows) map.set(`${Number(r.product_id)}:${Number(r.warehouse_id)}`, Number(r.qty))
  return map
}

// 提交盘点，批量调整库存
async function submit(id, operator, scopeWarehouseIds = null, requestKey = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    // 幂等（2026-08-22 补）：盘点提交是多表写事务，连点两次/断网重试会重复入账
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'stockcheck.submit',
      userId: operator?.userId ?? null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, entityName: '盘点单' })
    assertInScope(scopeWarehouseIds, checkRow.warehouse_id, '盘点单')
    const rule = assertStatusAction('stockcheck', 'submit', checkRow.status)
    const [itemRows] = await conn.query(
      'SELECT * FROM inventory_check_items WHERE check_id=? ORDER BY id ASC', [id])
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
    // 批量读账面（性能）：一次 FOR UPDATE 取回全部被盘商品容器合计，替代逐行查询。
    const bookQtyMap = await getCurrentBookQties(
      conn,
      check.items.map(i => ({ productId: i.productId, warehouseId: check.warehouseId })),
    )
    const staleLines = []
    for (const item of check.items) {
      const currentBookQty = bookQtyMap.get(`${item.productId}:${check.warehouseId}`) ?? 0
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
      // PDA 扫码盘点行（文档13 §4.3）：按容器精确对账——账面 ACTIVE 而现场没扫到的容器即盘亏
      // （精确扣这些容器，不走 FIFO：FIFO 会扣最早的容器，与"丢的是哪几只"对不上）；扫到但实盘
      // 少于账面剩余的按差额扣；实盘多于账面剩余在扫码时已拒，这里是漂移兜底（重扫后提交）。
      const [scanRows] = await conn.query(
        'SELECT container_id, barcode, counted_qty FROM inventory_check_item_containers WHERE check_item_id=? ORDER BY id ASC',
        [item.id],
      )
      if (scanRows.length) {
        const scannedMap = new Map(scanRows.map(r => [Number(r.container_id), Number(r.counted_qty)]))
        const scannedTotal = scanRows.reduce((sum, r) => sum + Number(r.counted_qty), 0)
        if (Math.abs(scannedTotal - item.actualQty) > 1e-9) {
          throw new AppError(`商品「${item.productName}」的实盘数(${item.actualQty})与扫码集合计(${scannedTotal})不一致，请重新扫描后提交`, 409, 'SCAN_COUNT_MISMATCH')
        }
        const [bookContainers] = await conn.query(
          `SELECT id, barcode, remaining_qty FROM inventory_containers
            WHERE product_id=? AND warehouse_id=? AND status=? AND deleted_at IS NULL
            ORDER BY id ASC FOR UPDATE`,
          [item.productId, check.warehouseId, CONTAINER_STATUS.ACTIVE],
        )
        const losses = []
        for (const bc of bookContainers) {
          const counted = scannedMap.get(Number(bc.id)) ?? 0   // 没扫到 = 这只不在现场 = 全亏
          const remaining = Number(bc.remaining_qty)
          if (counted > remaining + 1e-9) {
            throw new AppError(`条码 ${bc.barcode} 实盘 ${counted} 多于账面 ${remaining}（盘点期间可能发生过移动），请刷新该行重扫`, 409, 'SCAN_OVER_COUNT')
          }
          if (remaining - counted > 1e-9) losses.push({ id: Number(bc.id), barcode: bc.barcode, lose: remaining - counted, left: counted })
        }
        if (!losses.length) continue

        const before = item.bookQty
        // 批量 UPDATE（2026-08-22 性能）：逐容器 UPDATE 改 CASE WHEN 一条语句，
        // 语义等价（remaining_qty 更新 + 0 时置 EMPTY）
        if (losses.length) {
          const states = losses.map(l => l.left === 0 ? CONTAINER_STATUS.EMPTY : CONTAINER_STATUS.ACTIVE)
          const params = []
          let updateSql = 'UPDATE inventory_containers SET remaining_qty = CASE id '
          losses.forEach((l) => { updateSql += 'WHEN ? THEN ? '; params.push(l.id, l.left) })
          updateSql += 'END, status = CASE id '
          losses.forEach((l, i) => { updateSql += 'WHEN ? THEN ? '; params.push(l.id, states[i]) })
          updateSql += 'END WHERE id IN ('
          params.push(...losses.map(l => l.id))
          updateSql += losses.map(() => '?').join(',') + ')'
          await conn.query(updateSql, params)
        }
        const after = await syncStockFromContainers(conn, item.productId, check.warehouseId)
        // 每只亏损容器一条流水：容器时间线能精确看到「这只少了多少」，而不是只有一行商品级总数
        for (const loss of losses) {
          await writeInventoryLog(conn, {
            moveType: MOVE_TYPE.STOCKCHECK,
            type: 2,
            productId: item.productId,
            warehouseId: check.warehouseId,
            quantity: loss.lose,
            beforeQty: before,
            afterQty: after,
            refType: 'stockcheck',
            refId: check.id,
            refNo: check.checkNo,
            containerId: loss.id,
            sourceType: SOURCE_TYPE.STOCKCHECK,
            sourceRefId: check.id,
            remark: `盘点盘亏 ${check.checkNo}：条码 ${loss.barcode} 账面少 ${loss.lose}${loss.left === 0 ? '（未扫到，整只计亏）' : ''}`,
            operatorId: operator.userId,
            operatorName: operator.realName,
          })
        }
        continue
      }

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
      await writeInventoryLog(conn, {
        moveType: MOVE_TYPE.STOCKCHECK,
        type: item.diffQty > 0 ? 1 : 2,     // 盘盈=1(入库方向), 盘亏=2(出库方向)
        productId: item.productId,
        warehouseId: check.warehouseId,
        quantity: Math.abs(item.diffQty),
        beforeQty: before,
        afterQty: after,
        refType: 'stockcheck',
        refId: check.id,
        refNo: check.checkNo,
        containerId,
        sourceType: SOURCE_TYPE.STOCKCHECK,
        sourceRefId: check.id,
        remark: `盘点调整 ${check.checkNo}（差异 ${item.diffQty > 0 ? '+' : ''}${item.diffQty}）`,
        operatorId: operator.userId,
        operatorName: operator.realName,
      })
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
    await completeOperationRequest(conn, requestState, {
      data: { id: Number(id), checkNo: check.checkNo },
      message: '盘点已提交',
      resourceType: 'stockcheck',
      resourceId: Number(id),
    })
    await conn.commit()
  } catch(e){ await conn.rollback(); throw e }
  finally { conn.release() }
}

// 刷新单行账面数：盘点期间该商品发生过出入库时，把 book_qty 重置为当前账面，
// 并清空实盘/差异（实盘数是基于旧库存状态点的实物计数，账面变了必须重数）。
async function refreshItem(id, itemId, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, columns: 'id, warehouse_id, status', entityName: '盘点单' })
    assertInScope(scopeWarehouseIds, checkRow.warehouse_id, '盘点单')
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
    // 账面变了说明期间有出入库，之前扫的那一轮已不可信，必须重扫
    await conn.query('DELETE FROM inventory_check_item_containers WHERE check_item_id=?', [item.id])
    await conn.commit()
    return { itemId: Number(item.id), productName: item.product_name, bookQty: currentBookQty }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function cancel(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const checkRow = await lockStatusRow(conn, { table: 'inventory_checks', id, columns: 'id, status, warehouse_id', entityName: '盘点单' })
    assertInScope(scopeWarehouseIds, checkRow.warehouse_id, '盘点单')
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

module.exports = { findAll, findById, create, updateItems, submit, refreshItem, cancel, listPendingScanChecks, getScanItems, saveItemContainerScans }
