const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')

/** 一次还原整件最多生成的箱数（服务端上限，防无限数组造码） */
const REPACK_MAX_BOXES = 100
const { normalizePagination } = require('../../utils/pagination')
const { assertInScope, scopeFilter } = require('../../utils/warehouseScope')

function requireDeviceWarehouse(isPda, warehouseId) {
  if (isPda && (warehouseId == null || !Number.isSafeInteger(Number(warehouseId)) || Number(warehouseId) <= 0)) {
    throw new AppError('设备尚未绑定有效仓库，无法执行塑料盒作业', 403, 'PDA_WAREHOUSE_REQUIRED')
  }
}

function assertBoxScope(box, scopeWarehouseIds, pdaWarehouseId) {
  assertInScope(scopeWarehouseIds, box.warehouse_id, '塑料盒')
  if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(box.warehouse_id)) {
    throw new AppError('该 PDA 设备未绑定到目标仓库，不能在此仓库作业', 403, 'PDA_WAREHOUSE_MISMATCH')
  }
}

async function assertReplayBoxScope(conn, boxId, scopeWarehouseIds, pdaWarehouseId) {
  // 幂等锁可能等待其它事务提交；RR 探维度快照不能继续用于授权原回执。
  const [[box]] = await conn.query(
    "SELECT warehouse_id FROM inventory_containers WHERE id = ? AND barcode LIKE 'B%' AND deleted_at IS NULL FOR SHARE",
    [boxId],
  )
  if (!box) throw new AppError('塑料盒不存在', 404)
  assertBoxScope(box, scopeWarehouseIds, pdaWarehouseId)
}

async function findAll({ page = 1, pageSize = 20, keyword, warehouseId, productId, scopeWarehouseIds = null } = {}) {
  const conditions = ["c.deleted_at IS NULL", "c.barcode LIKE 'B%'"]
  const params = []

  if (keyword) {
    conditions.push('(c.barcode LIKE ? OR p.name LIKE ? OR p.code LIKE ?)')
    params.push(`%${keyword}%`, `%${keyword}%`, `%${keyword}%`)
  }
  if (warehouseId) {
    conditions.push('c.warehouse_id = ?')
    params.push(Number(warehouseId))
  }
  if (productId) {
    conditions.push('c.product_id = ?')
    params.push(Number(productId))
  }

  const scope = scopeFilter(scopeWarehouseIds, 'c.warehouse_id')
  const where = `WHERE ${conditions.join(' AND ')}${scope.sql}`
  params.push(...scope.params)
  // clamp：防止 pageSize=99999 全表拉取（此前手写 offset 无上限）
  const { pageSize: ps, offset } = normalizePagination({ page, pageSize })

  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM inventory_containers c LEFT JOIN product_items p ON p.id = c.product_id ${where}`, params)
  const [rows] = await pool.query(
    `SELECT c.id, c.barcode, c.product_id, c.warehouse_id, c.location_id, c.remaining_qty, c.status, c.unit, c.created_at, c.updated_at,
            p.name AS product_name, p.code AS product_code, p.article_number, p.spec, p.color, w.name AS warehouse_name, l.name AS location_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations l ON l.id = c.location_id
     ${where} ORDER BY c.id DESC LIMIT ? OFFSET ?`,
    [...params, ps, offset],
  )

  return {
    list: rows.map(fmt),
    pagination: { page, pageSize: ps, total: Number(total) },
  }
}

async function findById(id, scopeWarehouseIds = null) {
  const [[row]] = await pool.query(
    `SELECT c.*, p.name AS product_name, p.code AS product_code, p.article_number, p.spec, p.color, w.name AS warehouse_name, l.name AS location_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     LEFT JOIN inventory_warehouses w ON w.id = c.warehouse_id
     LEFT JOIN warehouse_locations l ON l.id = c.location_id
     WHERE c.id = ? AND c.barcode LIKE 'B%' AND c.deleted_at IS NULL`,
    [id],
  )
  if (!row) throw new AppError('塑料盒不存在', 404)
  assertInScope(scopeWarehouseIds, row.warehouse_id, '塑料盒')
  return fmt(row)
}

// 流水查询复用库存模块的通用实现（inventory_logs 的数量列是 quantity——本接口此前
// 误用不存在的 il.qty，一直 500，从未成功过）
async function findMovements(id, scopeWarehouseIds = null) {
  await findById(id, scopeWarehouseIds)
  return require('../inventory/inventory.service').getContainerLogs(id)
}

// warehouseName 由前端一并传来但这里不落库（容器只存 warehouse_id，名字查表取），
// 保留在签名里是为了让接口形状与其它建单接口一致。
async function create({ productId, warehouseId, locationId, remark }, scopeWarehouseIds = null) {
  if (!productId) throw new AppError('请选择产品', 400)
  if (!warehouseId) throw new AppError('请选择仓库', 400)
  assertInScope(scopeWarehouseIds, warehouseId, '塑料盒')

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[product]] = await conn.query('SELECT id, name, unit FROM product_items WHERE id=? AND deleted_at IS NULL AND is_active=1 FOR SHARE', [Number(productId)])
    if (!product) throw new AppError('商品不存在或已停用', 400)
    const [[warehouse]] = await conn.query('SELECT id FROM inventory_warehouses WHERE id=? AND deleted_at IS NULL AND is_active=1 FOR SHARE', [Number(warehouseId)])
    if (!warehouse) throw new AppError('仓库不存在或已停用', 400)
    if (locationId != null && locationId !== '') {
      const [[location]] = await conn.query('SELECT id FROM warehouse_locations WHERE id=? AND warehouse_id=? AND deleted_at IS NULL AND status=1 FOR SHARE', [Number(locationId), Number(warehouseId)])
      if (!location) throw new AppError('库位不存在、已停用或不属于目标仓库', 400)
    }
    const { containerId, barcode } = await createContainer(conn, {
      productId: Number(productId),
      warehouseId: Number(warehouseId),
      initialQty: 0,
      unit: product.unit || '',
      sourceType: 'manual',
      sourceRefType: 'plastic_box_create',
      remark: remark || `为 ${product.name} 创建塑料盒`,
      barcodePrefix: 'B',
      containerType: 2,
      locationId: locationId ? Number(locationId) : null,
      containerStatus: 1,
    })
    await conn.commit()
    return { id: containerId, barcode }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

/**
 * 放货（批 A · 塑料盒作业流）：把来源整件的**全部实存**倒入指定塑料盒。
 *
 * 只按来源全部放入，**不设可选数量**——「全量倒入」被做成部分拆分是现场最容易出现的误操作。
 * `expectedSourceQty` 是并发快照守卫：与提交时读到的来源量不一致就要求重扫。
 * 幂等按**目标盒**绑定（`plastic_box.fill.<盒id>`），稳定键重放直接返回原结果，
 * 不会再去读来源（因此来源已空的场景重放仍成功）。
 */
async function fill(id, { sourceContainerId, expectedSourceQty, requestKey }, { userId = null, userName = null, isPda = false, pdaWarehouseId = null }, scopeWarehouseIds = null) {
  const { splitContainer, lockStockDimension } = require('../../engine/containerEngine')
  const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')

  const boxId = Number(id)
  if (!Number.isFinite(boxId) || boxId <= 0) throw new AppError('塑料盒不存在', 404)
  const srcId = Number(sourceContainerId)
  if (!Number.isFinite(srcId) || srcId <= 0) throw new AppError('来源库存条码无效', 400)
  requireDeviceWarehouse(isPda, pdaWarehouseId)

  const conn = await pool.getConnection()
  let result
  try {
    await conn.beginTransaction()
    // 先做仓库范围校验、再判断幂等重放：命中重放同样不能跳过权限核对，
    // 否则「用同一个请求键重放」会成为绕过仓库数据权限的通道。
    const [[box]] = await conn.query(
      "SELECT id, barcode, product_id, warehouse_id, status, locked_by_task_id FROM inventory_containers WHERE id = ? AND barcode LIKE 'B%' AND deleted_at IS NULL",
      [boxId],
    )
    if (!box) throw new AppError('塑料盒不存在', 404)
    // 仓库数据权限：放货会改库存与流水，必须先确认调用方有权访问该仓库。
    assertBoxScope(box, scopeWarehouseIds, pdaWarehouseId)

    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      action: 'plastic_box.fill',
      userId,
      resourceType: 'inventory_container',
      resourceId: boxId,
    })
    if (requestState.replay) {
      await assertReplayBoxScope(conn, boxId, scopeWarehouseIds, pdaWarehouseId)
      await conn.rollback()
      return requestState.responseData
    }
    if (box.locked_by_task_id != null) throw new AppError('塑料盒已被拣货任务锁定，不能放货', 409)

    // 锁序（与引擎全局约定一致）：**先维度锁，再锁来源容器**，且全量数量必须在**锁下重读**——
    // 不能在无锁快照上算 fullQty 再交给引擎转移，否则并发新增余量时只转走旧数量、留下余量，
    // 违反「按来源整件全部放入」。
    await lockStockDimension(conn, box.product_id, box.warehouse_id)
    const [[src]] = await conn.query(
      `SELECT id, barcode, product_id, warehouse_id, remaining_qty, status, locked_by_task_id,
              container_type, initial_qty
       FROM inventory_containers WHERE id = ? AND deleted_at IS NULL
       FOR UPDATE`,
      [srcId],
    )
    if (!src) throw new AppError('来源库存条码不存在', 404)
    if (Number(src.container_type) !== 1) throw new AppError('来源必须是整件库存条码，塑料盒不能作为放货来源', 400)
    if (Number(src.product_id) !== Number(box.product_id)) throw new AppError('来源与塑料盒的商品不一致，不能放入', 400)
    if (Number(src.warehouse_id) !== Number(box.warehouse_id)) throw new AppError('来源与塑料盒不在同一仓库，不能放入', 400)
    if (Number(src.status) !== CONTAINER_STATUS.ACTIVE) throw new AppError('来源库存条码须为「在库」状态', 400)
    if (src.locked_by_task_id != null) throw new AppError('来源库存条码已被拣货任务锁定，不能放货', 409)

    const fullQty = Number(src.remaining_qty)
    if (!(fullQty > 0)) throw new AppError('来源库存条码已无余量，无法放货', 400)
    if (expectedSourceQty != null && Number(expectedSourceQty) !== fullQty) {
      throw new AppError(`来源实存已变化（当前 ${fullQty}），请重新扫码后再放货`, 409, 'SOURCE_QTY_CHANGED')
    }

    // 锁序由 splitContainer 内部保证：先 lockStockDimension(商品,仓库)，再锁来源、再锁目标盒。
    result = await splitContainer(conn, {
      containerId: srcId,
      qty: fullQty,
      targetContainerId: boxId,
      operatorId: userId ?? null,
      operatorName: userName,
    })
    const [[boxAfter]] = await conn.query('SELECT is_mixed_batch FROM inventory_containers WHERE id = ?', [boxId])
    result.mixedBatch = Number(boxAfter?.is_mixed_batch) === 1

    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '放货成功',
      resourceType: 'inventory_container',
      resourceId: boxId,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return result
}

/**
 * 还原整件（批 A · 塑料盒作业流）：人工逐箱填 `qty`（等量时用「每箱数量 + 箱数」快捷），
 * 从盒里生成若干**独立整件库存码**（`I`），余量留在盒内。
 *
 * 锁序与放货一致：先 `lockStockDimension(商品,仓库)`，再 `FOR UPDATE` 盒——
 * 绝不能先锁盒再锁维度，否则与上架/出库路径构成 ABBA 死锁面。
 * 幂等按盒绑定（`plastic_box.repack.<盒id>`），稳定键重放返回**原生成的容器清单**，不重复建码。
 */
async function repack(id, { perBoxQty, boxCount, items, requestKey }, { userId = null, userName = null, isPda = false, pdaWarehouseId = null }, scopeWarehouseIds = null) {
  const { lockStockDimension, createContainersBatch, logContainerSplitBatch, syncStockFromContainers } = require('../../engine/containerEngine')
  const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
  const { roundQty } = require('../../utils/unitConversion')
  const { assertQtyPrecision } = require('../../utils/qtyPrecision')

  const boxId = Number(id)
  if (!Number.isFinite(boxId) || boxId <= 0) throw new AppError('塑料盒不存在', 404)
  requireDeviceWarehouse(isPda, pdaWarehouseId)

  // 互斥按「字段是否出现」判定：`items: []` 也是明确占位，不能被非空真假掩盖成走快捷分支
  const hasItems = items !== undefined && items !== null
  const hasQuick = (perBoxQty !== undefined && perBoxQty !== null) || (boxCount !== undefined && boxCount !== null)
  if (hasItems && hasQuick) throw new AppError('「逐箱清单」与「每箱数量+箱数」只能填一种', 400)
  if (!hasItems && !hasQuick) throw new AppError('请填写逐箱清单，或每箱数量与箱数', 400)

  let itemsList = null
  let quickQty = null
  let boxTotal
  if (hasItems) {
    if (!Array.isArray(items)) throw new AppError('逐箱清单格式无效', 400)
    itemsList = items
    boxTotal = items.length
  } else {
    const n = Number(boxCount)
    const q = Number(perBoxQty)
    if (!Number.isInteger(n) || n <= 0) throw new AppError('箱数须为正整数', 400)
    if (!Number.isFinite(q) || q <= 0) throw new AppError('每箱数量须大于 0', 400)
    quickQty = q
    boxTotal = n
  }
  // 上限必须在「展开数组 / 取整」之前判定：否则巨大 boxCount 会先造出大数组再被拒
  if (boxTotal > REPACK_MAX_BOXES) {
    throw new AppError(`一次最多还原 ${REPACK_MAX_BOXES} 箱，请分批操作`, 400)
  }
  if (boxTotal <= 0) throw new AppError('箱数须大于 0', 400)

  const conn = await pool.getConnection()
  let result
  try {
    await conn.beginTransaction()
    // 先做仓库范围校验、再判断幂等重放：命中重放同样不能跳过仓库数据权限
    const [[boxDim]] = await conn.query(
      'SELECT product_id, warehouse_id FROM inventory_containers WHERE id = ? AND barcode LIKE \'B%\' AND deleted_at IS NULL',
      [boxId],
    )
    if (!boxDim) throw new AppError('塑料盒不存在', 404)
    assertBoxScope(boxDim, scopeWarehouseIds, pdaWarehouseId)

    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      action: 'plastic_box.repack',
      userId,
      resourceType: 'inventory_container',
      resourceId: boxId,
    })
    if (requestState.replay) {
      await assertReplayBoxScope(conn, boxId, scopeWarehouseIds, pdaWarehouseId)
      await conn.rollback()
      return requestState.responseData
    }

    // 精度：先用**原始输入**校验两位小数与商品小数策略，再 roundQty——不得先取整后校验
    const rawList = hasItems ? itemsList : Array.from({ length: boxTotal }, () => quickQty)
    await assertQtyPrecision(conn, rawList.map((q) => ({ productId: boxDim.product_id, qty: q, label: '每箱数量' })))
    const qtys = rawList.map((q) => roundQty(Number(q)))
    if (qtys.some((q) => !Number.isFinite(q) || q <= 0)) throw new AppError('每箱数量须大于 0', 400)

    // 锁序：先维度锁，再锁盒
    await lockStockDimension(conn, boxDim.product_id, boxDim.warehouse_id)

    const [[box]] = await conn.query(
      `SELECT id, barcode, product_id, warehouse_id, location_id, remaining_qty, status, unit,
              batch_no, mfg_date, exp_date, is_mixed_batch, locked_by_task_id
       FROM inventory_containers
       WHERE id = ? AND barcode LIKE 'B%' AND deleted_at IS NULL
       FOR UPDATE`,
      [boxId],
    )
    if (!box) throw new AppError('塑料盒不存在', 404)
    assertBoxScope(box, scopeWarehouseIds, pdaWarehouseId)
    if (Number(box.product_id) !== Number(boxDim.product_id) || Number(box.warehouse_id) !== Number(boxDim.warehouse_id)) {
      throw new AppError('塑料盒所属商品或仓库已变化，请重新扫码后还原整件', 409, 'CONTAINER_DIMENSION_CHANGED')
    }
    if (Number(box.status) !== CONTAINER_STATUS.ACTIVE) throw new AppError('塑料盒当前不可用（状态异常或已清空）', 400)
    if (box.locked_by_task_id != null) throw new AppError('塑料盒已被拣货任务锁定，不能还原整件', 409)

    const total = roundQty(qtys.reduce((s, q) => s + q, 0))
    const boxRem = Number(box.remaining_qty)
    if (total > boxRem) {
      throw new AppError(`各箱合计 ${total} 超过盒内余量 ${boxRem}，请调整`, 400)
    }

    const boxMixed = Number(box.is_mixed_batch) === 1
    const newRem = roundQty(boxRem - total)
    await conn.query(
      'UPDATE inventory_containers SET remaining_qty = ?, status = ? WHERE id = ?',
      [newRem, newRem === 0 ? CONTAINER_STATUS.EMPTY : CONTAINER_STATUS.ACTIVE, boxId],
    )

    // 一次取号 + 一次 INSERT（避免逐箱 createContainer 往返）；语义与来源校验由
    // createContainersBatch 显式限定为「同仓拆分 + 在库」，其余组合会直接拒绝
    const created = await createContainersBatch(conn, {
      shared: {
        productId:       box.product_id,
        warehouseId:     box.warehouse_id,
        unit:            box.unit,
        // 盒为混合来源时不挂单一批次（不冒充单批）；单批盒才继承
        batchNo:         boxMixed ? null : box.batch_no,
        mfgDate:         boxMixed ? null : box.mfg_date,
        expDate:         boxMixed ? null : box.exp_date,
        sourceType:      SOURCE_TYPE.CONTAINER_SPLIT,
        sourceRefType:   'plastic_box_repack',
        sourceRefId:     boxId,
        remark:          `自塑料盒 ${box.barcode} 还原整件`,
        barcodePrefix:   'I',
        containerType:   1,
        locationId:      box.location_id,
        containerStatus: CONTAINER_STATUS.ACTIVE,
        isMixedBatch:    boxMixed ? 1 : 0,
      },
      qtys,
    })

    // 库存快照：写流水之前先同步一次，用**真实值**记录前后库存
    // （转移不改总量，但此前单条留痕传 0，会让库存日志的前后库存列失真）
    const stockAfter = await syncStockFromContainers(conn, box.product_id, box.warehouse_id)
    await logContainerSplitBatch(conn, {
      productId: box.product_id,
      warehouseId: box.warehouse_id,
      stockQty: stockAfter,
      sourceContainerId: boxId,
      sourceBarcode: box.barcode,
      targets: created,
      operatorId: userId ?? null,
      operatorName: userName,
    })

    result = { boxId, boxRemainingAfter: newRem, created, printJobIds: [], noPrinterCount: 0, renderFailedCount: 0 }

    // 打印只入队、失败不回滚库存；**按真实原因分开计数**——「没有可用打印机」与
    // 「标签渲染失败」是两种不同的降级，混成一个数字会让界面说错原因。
    const { enqueueContainerLabelJob } = require('../print-jobs/print-jobs.service')
    for (const c of created) {
      const job = await enqueueContainerLabelJob({
        conn,
        containerId: c.containerId,
        warehouseId: box.warehouse_id,
        // 不传 product_name：让标签模板变量里的真实商品名生效（传 null 会把它覆盖成空名）
        data: { container_code: c.barcode, qty: c.qty },
        createdBy: userId ?? null,
        jobUniqueKey: `repack_cnt_${c.containerId}`,
      })
      if (job?.id && !job.unprintable) {
        result.printJobIds.push(Number(job.id))
      } else if (job?.unprintable) {
        if (/label render failed/.test(String(job.errorMessage || ''))) result.renderFailedCount += 1
        else result.noPrinterCount += 1
      }
    }

    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '还原整件成功',
      resourceType: 'inventory_container',
      resourceId: boxId,
    })
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
  return result
}

async function remove(id, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[box]] = await conn.query("SELECT warehouse_id,remaining_qty,locked_by_task_id FROM inventory_containers WHERE id=? AND barcode LIKE 'B%' AND deleted_at IS NULL FOR UPDATE", [id])
    if (!box) throw new AppError('塑料盒不存在', 404)
    assertInScope(scopeWarehouseIds, box.warehouse_id, '塑料盒')
    if (Number(box.remaining_qty) > 0 || box.locked_by_task_id != null) throw new AppError('塑料盒尚有库存或被任务锁定，无法删除', 400)
    await conn.query('UPDATE inventory_containers SET deleted_at=NOW() WHERE id=?', [id])
    await conn.commit()
  } catch (error) {
    await conn.rollback()
    throw error
  } finally { conn.release() }
}

/**
 * 重复打印塑料盒条码（2026-09-14 用户规则）。
 *
 * 塑料盒自身的码是可复用的固定码，**不进补打中心**（那里只放唯一对象的打印记录），
 * 所以「对应的功能里可以重复打印」这条要由本页提供：不校验历史打印记录，随时可重打一份。
 */
async function printLabel(id, { userId = null, scopeWarehouseIds = null } = {}) {
  const { enqueueContainerLabelJob } = require('../print-jobs/print-jobs.service')
  const boxId = Number(id)
  if (!Number.isFinite(boxId) || boxId <= 0) throw new AppError('塑料盒不存在', 404)
  const [[row]] = await pool.query(
    `SELECT c.id, c.barcode, c.remaining_qty, c.warehouse_id, p.name AS product_name
     FROM inventory_containers c
     LEFT JOIN product_items p ON p.id = c.product_id
     WHERE c.id = ? AND c.barcode LIKE 'B%' AND c.deleted_at IS NULL`,
    [boxId],
  )
  if (!row) throw new AppError('塑料盒不存在', 404)
  assertInScope(scopeWarehouseIds, row.warehouse_id, '塑料盒')
  // 找不到可用打印机时 enqueueContainerLabelJob 返回 null（预期状态，非异常），由控制器提示。
  return enqueueContainerLabelJob({
    containerId: Number(row.id),
    warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
    data: {
      container_code: row.barcode,
      product_name: row.product_name,
      qty: row.remaining_qty,
    },
    createdBy: userId,
    jobUniqueKey: `plastic_box_label:${row.id}:${Date.now()}`,
  })
}

function fmt(row) {
  return {
    id: Number(row.id),
    barcode: row.barcode,
    productId: row.product_id != null ? Number(row.product_id) : null,
    productName: row.product_name || null,
    productCode: row.product_code || null,
    articleNumber: row.article_number || null,
    spec: row.spec || null,
    color: row.color || null,
    warehouseId: row.warehouse_id != null ? Number(row.warehouse_id) : null,
    warehouseName: row.warehouse_name || null,
    locationId: row.location_id != null ? Number(row.location_id) : null,
    locationName: row.location_name || null,
    remainingQty: Number(row.remaining_qty),
    status: Number(row.status),
    // 混合来源标识（批 A）：盒内混有多个来源批次时不再挂单一批次
    mixedBatch: Number(row.is_mixed_batch) === 1,
    batchLabel: Number(row.is_mixed_batch) === 1 ? '混合来源' : (row.batch_no || null),
    unit: row.unit || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

/**
 * 来源贡献：本盒各来源容器及贡献量。
 *
 * 口径固定为「来源贡献」——**不折算当前剩余、不做 FIFO 分摊、不声称逐批实物可追溯**。
 * 数据来源是 inventory_logs 的 target 视角流水（log_source_ref_id = 来源容器 ID），
 * 由 logContainerSplit 写入，无需额外表。
 */
async function findSources(id, scopeWarehouseIds = null) {
  const box = await findById(id, scopeWarehouseIds)
  const [rows] = await pool.query(
    `SELECT il.log_source_ref_id AS source_container_id,
            src.barcode          AS source_barcode,
            src.batch_no         AS source_batch_no,
            SUM(il.quantity)     AS contributed_qty
     FROM inventory_logs il
     LEFT JOIN inventory_containers src ON src.id = il.log_source_ref_id
     WHERE il.container_id = ? AND il.log_source_type = ?
       -- 排除「本容器自己的拆出视角」：那种流水 log_source_ref_id 指向自己，
       -- 不是来源容器（来源贡献只取转入视角，保持历史贡献而非当前余额）
       AND il.log_source_ref_id IS NOT NULL
       AND il.log_source_ref_id <> il.container_id
     GROUP BY il.log_source_ref_id, src.barcode, src.batch_no
     ORDER BY MIN(il.id) ASC`,
    [Number(box.id), SOURCE_TYPE.CONTAINER_SPLIT],
  )
  return {
    boxId: Number(box.id),
    barcode: box.barcode,
    mixedBatch: box.mixedBatch === true,
    sources: rows.map((r) => ({
      sourceContainerId: Number(r.source_container_id),
      sourceBarcode: r.source_barcode || null,
      sourceBatchNo: r.source_batch_no || null,
      contributedQty: Number(r.contributed_qty),
    })),
  }
}

module.exports = { findAll, findById, findMovements, findSources, create, remove, printLabel, fill, repack }
