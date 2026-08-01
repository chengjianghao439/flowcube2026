/**
 * serialEngine —— 序列号（个体制）唯一合法写入口（文档 04）。
 *
 * ┌─ 最高原则 ────────────────────────────────────────────────────────────────┐
 * │ 序列号是**容器的下挂个体**，容器（inventory_containers）仍是库存唯一事实源。      │
 * │ 核心不变量：对 serial_managed 商品，任一容器的 remaining_qty 必须等于挂在它上、    │
 * │ status=1(在库) 的序列号行数。绝不允许"序列号说有 5、容器说有 4"。                 │
 * └───────────────────────────────────────────────────────────────────────────┘
 *
 * 与三大引擎同约定：
 *  - 每个方法**只接收调用方开启的 conn，绝不自开事务**；调用方负责 BEGIN/COMMIT/ROLLBACK。
 *  - 每次改 product_serials.status / container_id 必须同一事务追加一条 serial_events（追溯）。
 *  - 序列号写入必须**搭在现有建容器/扣容器的事务里**，不另开库存写入口、不旁路。
 *  - 写完关键动作后调 assertSerialCountMatchesContainer 兜底，类比库存 assertNonNegativeQty。
 */
const AppError = require('../utils/AppError')

const SERIAL_STATUS = { IN_STOCK: 1, SHIPPED: 2, RETURNED: 3 }

/** 清洗 + 本批内查重：去空白、拒空、拒本批重复 */
function normalizeSerialList(serialNos) {
  if (!Array.isArray(serialNos)) throw new AppError('序列号列表格式错误', 400, 'SERIAL_LIST_INVALID')
  const out = []
  const seen = new Set()
  for (const raw of serialNos) {
    const sn = String(raw ?? '').trim()
    if (!sn) throw new AppError('序列号不能为空', 400, 'SERIAL_EMPTY')
    if (sn.length > 64) throw new AppError(`序列号过长：${sn.slice(0, 20)}…`, 400, 'SERIAL_TOO_LONG')
    if (seen.has(sn)) throw new AppError(`本次提交存在重复序列号：${sn}`, 400, 'SERIAL_DUP_IN_BATCH')
    seen.add(sn)
    out.push(sn)
  }
  return out
}

async function writeEvent(conn, { serialId, eventType, fromStatus = null, toStatus = null, containerId = null, warehouseId = null, refType = null, refId = null, operatorId = null, remark = null }) {
  await conn.query(
    `INSERT INTO serial_events
       (serial_id, event_type, from_status, to_status, container_id, warehouse_id, ref_type, ref_id, operator_id, remark)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [serialId, eventType, fromStatus, toStatus, containerId, warehouseId, refType, refId, operatorId, remark],
  )
}

async function isSerialManaged(conn, productId) {
  const [[p]] = await conn.query('SELECT serial_managed FROM product_items WHERE id = ?', [productId])
  return !!(p && Number(p.serial_managed) === 1)
}

/**
 * 收货逐台登记（文档 5.1）。在建容器的同一事务内调用。
 * 校验：同商品在库态相同 SN → 拒绝（重复入库）；已出库/已退态相同 SN → 复用该行改回在库（二次入库合法）。
 * @returns {Promise<number[]>} 登记的 product_serials.id 列表
 */
async function registerSerials(conn, { productId, warehouseId, containerId, serialNos, inboundTaskId = null, inboundTaskItemId = null, purchaseOrderId = null, operatorId = null }) {
  const list = normalizeSerialList(serialNos)
  const ids = []
  for (const sn of list) {
    const [[existing]] = await conn.query(
      'SELECT id, status FROM product_serials WHERE product_id = ? AND serial_no = ? FOR UPDATE',
      [productId, sn],
    )
    if (existing) {
      if (Number(existing.status) === SERIAL_STATUS.IN_STOCK) {
        throw new AppError(`序列号已在库，不能重复入库：${sn}`, 409, 'SERIAL_ALREADY_IN_STOCK')
      }
      await conn.query(
        `UPDATE product_serials
         SET status = ?, warehouse_id = ?, container_id = ?, inbound_task_id = ?, inbound_task_item_id = ?, purchase_order_id = ?,
             warehouse_task_id = NULL, sale_order_id = NULL, shipped_at = NULL, return_ref_type = NULL, return_ref_id = NULL
         WHERE id = ?`,
        [SERIAL_STATUS.IN_STOCK, warehouseId, containerId, inboundTaskId, inboundTaskItemId, purchaseOrderId, existing.id],
      )
      await writeEvent(conn, { serialId: existing.id, eventType: 'register', fromStatus: existing.status, toStatus: SERIAL_STATUS.IN_STOCK, containerId, warehouseId, refType: 'inbound_task', refId: inboundTaskId, operatorId, remark: '二次入库复用' })
      ids.push(existing.id)
    } else {
      const [r] = await conn.query(
        `INSERT INTO product_serials
           (product_id, serial_no, warehouse_id, container_id, status, inbound_task_id, inbound_task_item_id, purchase_order_id)
         VALUES (?,?,?,?,?,?,?,?)`,
        [productId, sn, warehouseId, containerId, SERIAL_STATUS.IN_STOCK, inboundTaskId, inboundTaskItemId, purchaseOrderId],
      )
      await writeEvent(conn, { serialId: r.insertId, eventType: 'register', fromStatus: null, toStatus: SERIAL_STATUS.IN_STOCK, containerId, warehouseId, refType: 'inbound_task', refId: inboundTaskId, operatorId })
      ids.push(r.insertId)
    }
  }
  return ids
}

/**
 * 历史序列号导入（文档 04 · Phase 2）。给开关打开前收的存量货补齐个体账，使商品可开启 serial_managed。
 * 与 registerSerials 同款"复用或插入 status=1、绑定容器、写事件"，差别仅：来源是历史导入（无收货单，
 * source 列留空）、事件 type='import'。**只增 product_serials + serial_events，绝不改容器 remaining_qty**
 * （容器是库存唯一事实源，导入是给既有数量补个体账，不是入库）。
 * 必须由 serials.service.importHistorical 在校验"逐容器 SN 数==remaining_qty、全覆盖、无 PENDING/锁定"、
 * 并已把 serial_managed 置 1 之后，于同一事务内逐容器调用；调用方随后调 assertSerialCountMatchesContainer 兜底。
 * @returns {Promise<number[]>} product_serials.id 列表
 */
async function importHistoricalSerials(conn, { productId, warehouseId, containerId, serialNos, operatorId = null }) {
  const list = normalizeSerialList(serialNos)
  const ids = []
  for (const sn of list) {
    const [[existing]] = await conn.query(
      'SELECT id, status FROM product_serials WHERE product_id = ? AND serial_no = ? FOR UPDATE',
      [productId, sn],
    )
    if (existing) {
      if (Number(existing.status) === SERIAL_STATUS.IN_STOCK) {
        throw new AppError(`序列号已在库，不能重复导入：${sn}`, 409, 'SERIAL_ALREADY_IN_STOCK')
      }
      await conn.query(
        `UPDATE product_serials
         SET status = ?, warehouse_id = ?, container_id = ?, inbound_task_id = NULL, inbound_task_item_id = NULL, purchase_order_id = NULL,
             warehouse_task_id = NULL, sale_order_id = NULL, shipped_at = NULL, return_ref_type = NULL, return_ref_id = NULL
         WHERE id = ?`,
        [SERIAL_STATUS.IN_STOCK, warehouseId, containerId, existing.id],
      )
      await writeEvent(conn, { serialId: existing.id, eventType: 'import', fromStatus: existing.status, toStatus: SERIAL_STATUS.IN_STOCK, containerId, warehouseId, refType: 'serial_import', refId: null, operatorId, remark: '历史序列号导入(复用)' })
      ids.push(existing.id)
    } else {
      const [r] = await conn.query(
        `INSERT INTO product_serials
           (product_id, serial_no, warehouse_id, container_id, status)
         VALUES (?,?,?,?,?)`,
        [productId, sn, warehouseId, containerId, SERIAL_STATUS.IN_STOCK],
      )
      await writeEvent(conn, { serialId: r.insertId, eventType: 'import', fromStatus: null, toStatus: SERIAL_STATUS.IN_STOCK, containerId, warehouseId, refType: 'serial_import', refId: null, operatorId, remark: '历史序列号导入' })
      ids.push(r.insertId)
    }
  }
  return ids
}

/**
 * 逆向：作废某些容器上的在库序列号（文档 04 · Phase 3）。用于撤回收货 / 质检拒收处置——
 * 这些容器被整只 VOID（remaining_qty→0，货从没真正入库或被物理处置掉），其上登记的在库(1) SN
 * 应随之消失。删除主行 + 其事件（这批 SN 是本次收货/处置产生的，undo 即删除，不留悬挂账）。
 * 只对 status=1 在库 SN 生效；调用方须保证这些容器是"整只作废、未被后续拆分"（voidReceipt 的
 * remaining==initial 闸门已保证），否则不该走这里。返回删除条数。
 */
async function voidSerialsForContainers(conn, { containerIds, operatorId = null } = {}) {
  const ids = [...new Set((containerIds || []).map(Number).filter(Boolean))]
  if (!ids.length) return 0
  const [rows] = await conn.query(
    `SELECT id FROM product_serials WHERE container_id IN (${ids.map(() => '?').join(',')}) AND status = ?`,
    [...ids, SERIAL_STATUS.IN_STOCK],
  )
  if (!rows.length) return 0
  const serialIds = rows.map(r => r.id)
  // 先写一条 void 事件留痕（虽随后删主行，事件同批删，但保持"每次状态变更写事件"的一致纪律）
  for (const sid of serialIds) {
    await writeEvent(conn, { serialId: sid, eventType: 'void', fromStatus: SERIAL_STATUS.IN_STOCK, toStatus: null, operatorId, remark: '容器作废，序列号回冲删除' })
  }
  await conn.query(`DELETE FROM serial_events WHERE serial_id IN (${serialIds.map(() => '?').join(',')})`, serialIds)
  await conn.query(`DELETE FROM product_serials WHERE id IN (${serialIds.map(() => '?').join(',')})`, serialIds)
  return serialIds.length
}

/**
 * 逆向：退货重新入库核销（文档 04 · 5.4）。销售退货收货时逐台扫退回的 SN：原本出库时已置
 * status=2 已出库、container_id=NULL；退货回来把它改回 status=1 在库、绑到新建的退货容器
 * （PENDING_QA），写 return_ref 与 'return_in' 事件。
 *
 * 口径说明：退回单位统一置 status=1（而非设计原稿的 3已退货中间态）——因为核心不变量
 * assertSerialCountMatchesContainer 要求"容器 remaining_qty == 该容器 status=1 SN 数"，PENDING_QA
 * 容器上若挂 status=3 会被断言判为不一致。是否可售由**容器状态**（PENDING_QA 不计入可用库存）
 * 把关，不靠 SN 状态；SN 的退货语义由 serial_events('return_in') + return_ref 承载。
 * @returns {Promise<number[]>} product_serials.id 列表
 */
async function returnSerials(conn, { productId, serialNos, warehouseId, containerId, returnRefType = null, returnRefId = null, operatorId = null }) {
  const list = normalizeSerialList(serialNos)
  const ids = []
  for (const sn of list) {
    const [[s]] = await conn.query(
      'SELECT id, status FROM product_serials WHERE product_id = ? AND serial_no = ? FOR UPDATE',
      [productId, sn],
    )
    if (!s) throw new AppError(`序列号未曾出库，无法作为退货入库：${sn}`, 400, 'SERIAL_RETURN_NOT_FOUND')
    if (Number(s.status) === SERIAL_STATUS.IN_STOCK) throw new AppError(`序列号已在库，不能作为退货重复入库：${sn}`, 409, 'SERIAL_ALREADY_IN_STOCK')
    await conn.query(
      `UPDATE product_serials
       SET status = ?, warehouse_id = ?, container_id = ?, return_ref_type = ?, return_ref_id = ?,
           warehouse_task_id = NULL, sale_order_id = NULL, shipped_at = NULL
       WHERE id = ?`,
      [SERIAL_STATUS.IN_STOCK, warehouseId, containerId, returnRefType, returnRefId, s.id],
    )
    await writeEvent(conn, { serialId: s.id, eventType: 'return_in', fromStatus: s.status, toStatus: SERIAL_STATUS.IN_STOCK, containerId, warehouseId, refType: returnRefType, refId: returnRefId, operatorId })
    ids.push(s.id)
  }
  return ids
}

/**
 * 逆向/拆分：把 qty 台在库序列号从源容器迁到目标容器（文档 04 · Phase 3）。用于质检边界拆分
 * （合格/不合格分容器）、改单减量拆箱等——容器数量在两容器间重分配时，个体账必须同步迁移，
 * 否则源容器"多账少货"、目标容器"有货无账"，破坏不变量。
 *
 * 个体无天然 FIFO，这里按 id 升序任取 qty 台迁移（保持数量守恒即满足不变量；具体哪台物理上
 * 归到不合格箱，系统不强判——操作员物理挑拣，系统只保证账实台数一致）。调用方在两容器 remaining_qty
 * 都已改成最终值后调用，函数尾部对两容器各断言兜底。
 */
async function moveSerialsOnSplit(conn, { sourceContainerId, targetContainerId, qty, warehouseId = null, operatorId = null }) {
  const need = Number(qty)
  if (!(need > 0)) return []
  // 非序列号商品 no-op：让 QA 拆分等调用方可无条件调用，不必自己判 serial_managed。
  const [[src]] = await conn.query('SELECT product_id FROM inventory_containers WHERE id = ?', [sourceContainerId])
  if (!src || !(await isSerialManaged(conn, src.product_id))) return []
  const [rows] = await conn.query(
    'SELECT id FROM product_serials WHERE container_id = ? AND status = ? ORDER BY id LIMIT ?',
    [sourceContainerId, SERIAL_STATUS.IN_STOCK, need],
  )
  if (rows.length !== need) {
    throw new AppError(`容器 ${sourceContainerId} 可迁移在库序列号不足：需 ${need} 台，实有 ${rows.length} 台`, 409, 'SERIAL_SPLIT_SHORTAGE')
  }
  const movedIds = rows.map(r => r.id)
  await conn.query(
    `UPDATE product_serials SET container_id = ? WHERE id IN (${movedIds.map(() => '?').join(',')})`,
    [targetContainerId, ...movedIds],
  )
  for (const sid of movedIds) {
    await writeEvent(conn, { serialId: sid, eventType: 'transfer', fromStatus: SERIAL_STATUS.IN_STOCK, toStatus: SERIAL_STATUS.IN_STOCK, containerId: targetContainerId, warehouseId, remark: `容器拆分迁移 ${sourceContainerId}→${targetContainerId}`, operatorId })
  }
  await assertSerialCountMatchesContainer(conn, sourceContainerId)
  await assertSerialCountMatchesContainer(conn, targetContainerId)
  return movedIds
}

/**
 * 上架留痕（文档 5.2）。上架不逐台扫，个体随容器整箱移动；只写事件、不改归属。
 * 在 promote 容器 4→1 的同一事务内调用。
 */
async function putawaySerials(conn, { containerId, warehouseId = null, refId = null, operatorId = null }) {
  const [rows] = await conn.query(
    'SELECT id FROM product_serials WHERE container_id = ? AND status = ?',
    [containerId, SERIAL_STATUS.IN_STOCK],
  )
  for (const r of rows) {
    await writeEvent(conn, { serialId: r.id, eventType: 'putaway', fromStatus: SERIAL_STATUS.IN_STOCK, toStatus: SERIAL_STATUS.IN_STOCK, containerId, warehouseId, refType: 'inbound_task', refId, operatorId })
  }
  return rows.length
}

/**
 * 出库逐台核销（文档 5.3）。承接 ship 扣减容器的同一事务，**必须在 unlockContainersByTask 之前调用**
 * （届时容器 remaining_qty 已被 moveStock/deductFromTaskLockedContainers 扣减到目标值）。
 *
 * 防串号强校验：
 *  - 每台必须 status=1 在库、且 container_id ∈ 本任务锁定的该商品容器（allowedContainerIds）；
 *  - 核销台数必须等于本商品出库量（expectedQty）；
 *  - 核销后逐容器断言 remaining_qty == 在库序列号数（用容器数量作真值，抓住"跨容器凑数/漏扫/多扫"）。
 *
 * @param {object} p
 * @param {number}   p.productId
 * @param {string[]} p.serialNos           本次要发出的序列号（PDA 扫）
 * @param {number[]} p.allowedContainerIds 本任务锁定的该商品容器 id（调用方按 locked_by_task_id 查得）
 * @param {number}   p.expectedQty         本商品本次出库量（= 出库明细 qty）
 * @param {number}   [p.warehouseTaskId]
 * @param {number}   [p.saleOrderId]
 * @param {string}   [p.returnRefType]     purchase_return 时传
 * @param {number}   [p.returnRefId]
 * @returns {Promise<number>} 核销台数
 */
async function dispatchSerials(conn, { productId, serialNos, allowedContainerIds, expectedQty, warehouseId = null, warehouseTaskId = null, saleOrderId = null, returnRefType = null, returnRefId = null, operatorId = null }) {
  const list = normalizeSerialList(serialNos)
  if (expectedQty != null && list.length !== Number(expectedQty)) {
    throw new AppError(`应出库 ${expectedQty} 台，但扫描序列号 ${list.length} 台，数量不符`, 409, 'SERIAL_SHIP_COUNT_MISMATCH')
  }
  const allowed = new Set((allowedContainerIds || []).map(Number))
  for (const sn of list) {
    const [[s]] = await conn.query(
      'SELECT id, status, container_id FROM product_serials WHERE product_id = ? AND serial_no = ? FOR UPDATE',
      [productId, sn],
    )
    if (!s) throw new AppError(`序列号不存在：${sn}`, 400, 'SERIAL_NOT_FOUND')
    if (Number(s.status) !== SERIAL_STATUS.IN_STOCK) throw new AppError(`序列号不在库，不能出库：${sn}`, 409, 'SERIAL_NOT_IN_STOCK')
    const cid = Number(s.container_id)
    if (!allowed.has(cid)) throw new AppError(`序列号 ${sn} 不属于本次出库锁定的容器`, 409, 'SERIAL_CONTAINER_MISMATCH')
    await conn.query(
      `UPDATE product_serials
       SET status = ?, container_id = NULL, warehouse_id = ?, warehouse_task_id = ?, sale_order_id = ?, shipped_at = NOW(),
           return_ref_type = ?, return_ref_id = ?
       WHERE id = ?`,
      [SERIAL_STATUS.SHIPPED, warehouseId, warehouseTaskId, saleOrderId, returnRefType, returnRefId, s.id],
    )
    await writeEvent(conn, { serialId: s.id, eventType: 'ship', fromStatus: SERIAL_STATUS.IN_STOCK, toStatus: SERIAL_STATUS.SHIPPED, containerId: cid, warehouseId, refType: returnRefType || 'warehouse_task', refId: warehouseTaskId, operatorId })
  }
  // 核销后逐容器一致性兜底：容器数量（已被扣减）必须等于该容器剩余在库序列号数
  for (const cid of allowed) {
    await assertSerialCountMatchesContainer(conn, cid)
  }
  return list.length
}

/**
 * 核心不变量断言：某容器 remaining_qty == 该容器在库序列号行数（仅对 serial_managed 商品）。
 * 在收货/出库等改动后于事务尾部调用兜底。
 */
async function assertSerialCountMatchesContainer(conn, containerId) {
  const [[c]] = await conn.query('SELECT id, product_id, remaining_qty FROM inventory_containers WHERE id = ?', [containerId])
  if (!c) return
  if (!(await isSerialManaged(conn, c.product_id))) return
  const [[{ cnt }]] = await conn.query(
    'SELECT COUNT(*) AS cnt FROM product_serials WHERE container_id = ? AND status = ?',
    [containerId, SERIAL_STATUS.IN_STOCK],
  )
  if (Number(cnt) !== Number(c.remaining_qty)) {
    throw new AppError(`序列号一致性校验失败：容器 ${containerId} 数量 ${c.remaining_qty}，在库序列号 ${cnt} 台`, 500, 'SERIAL_COUNT_MISMATCH')
  }
}

/**
 * 逆向路径防护（Phase 1）：给定一组商品 id，若其中有 serial_managed 商品则抛错。
 * 用于撤回收货/改单减量/拆分/取消归还等尚未覆盖序列号回冲的逆向路径，宁可挡住也不放任不一致。
 */
async function assertNoSerialManaged(conn, productIds, actionName = '该操作') {
  const ids = [...new Set((productIds || []).map(Number).filter(Boolean))]
  if (!ids.length) return
  const [rows] = await conn.query(
    `SELECT id, code, name FROM product_items WHERE id IN (?) AND serial_managed = 1`,
    [ids],
  )
  if (rows.length) {
    const names = rows.map(r => r.name || r.code).slice(0, 3).join('、')
    throw new AppError(`${actionName}暂不支持序列号管控商品（${names}${rows.length > 3 ? ' 等' : ''}），请联系管理员`, 400, 'SERIAL_REVERSE_UNSUPPORTED')
  }
}

module.exports = {
  SERIAL_STATUS,
  isSerialManaged,
  registerSerials,
  importHistoricalSerials,
  voidSerialsForContainers,
  returnSerials,
  moveSerialsOnSplit,
  putawaySerials,
  dispatchSerials,
  assertSerialCountMatchesContainer,
  assertNoSerialManaged,
  normalizeSerialList,
}
