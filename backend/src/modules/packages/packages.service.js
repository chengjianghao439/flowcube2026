const { assertQtyPrecision, assertQtyScale } = require('../../utils/qtyPrecision')
const { roundQty } = require('../../utils/unitConversion')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const printJobs = require('../print-jobs/print-jobs.service')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertTaskScope } = require('../warehouse-tasks/warehouse-tasks.helpers')

const { WT_STATUS, WT_STATUS_NAME } = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('../warehouse-tasks/warehouse-task-events.service')
const { getInboundClosureThresholds } = require('../../utils/inboundThresholds')
const { buildPackagePrintSummary } = require('../../utils/printSummary')
const logisticsSvc = require('../logistics/logistics.service')

// ─── 查询任务下所有箱子（含明细）────────────────────────────────────────────
async function listByTask(taskId) {
  const [pkgs] = await pool.query(
    `SELECT p.id, p.barcode, p.status, p.remark, p.created_at
     FROM packages p
     WHERE p.warehouse_task_id = ?
     ORDER BY p.created_at ASC`,
    [taskId],
  )
  if (!pkgs.length) return []

  const ids = pkgs.map(p => p.id)
  const [items] = await pool.query(
    `SELECT pi.package_id, pi.id, pi.product_id, pi.product_code,
            pi.product_name, pi.unit, pi.qty, pi.label_container_id,
            lc.barcode AS label_barcode
     FROM package_items pi
     LEFT JOIN inventory_containers lc ON lc.id = pi.label_container_id
     WHERE pi.package_id IN (${ids.map(() => '?').join(',')})`,
    ids,
  )

  const itemMap = {}
  items.forEach(i => {
    if (!itemMap[i.package_id]) itemMap[i.package_id] = []
    itemMap[i.package_id].push({
      id: i.id,
      productId:   i.product_id,
      productCode: i.product_code,
      productName: i.product_name,
      unit:        i.unit,
      qty:         Number(i.qty),
      // 来源取货标签：NULL 表示按商品码装的旧 SKU 份额。同一商品可能多行（旧 SKU 一行 +
      // 各取货标签各一行），所以界面必须按行展示来源，不能按商品合并成"种"。
      labelContainerId: i.label_container_id != null ? Number(i.label_container_id) : null,
      labelBarcode:     i.label_barcode || null,
    })
  })

  // 箱贴打印状态：PDA 打包页要能看出「为什么完成打包被拦」。此前打印未完成只在
  // 服务端校验里报错，页面什么都不显示，操作员只能反复点「完成打包并进入待出库」
  // （2026-09-17 验收 ISSUE-003）。
  const { statusKey, printStateLabel } = require('../print-jobs/print-jobs.status')
  const [jobs] = await pool.query(
    `SELECT j.ref_id, j.status, j.error_message
       FROM print_jobs j
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
           FROM print_jobs
          WHERE ref_type = 'package' AND ref_id IN (${ids.map(() => '?').join(',')})
          GROUP BY ref_id
       ) latest ON latest.max_id = j.id`,
    ids,
  )
  const jobMap = {}
  jobs.forEach(j => {
    jobMap[j.ref_id] = {
      key: statusKey(j.status),
      label: printStateLabel(j.status),
      errorMessage: j.error_message || null,
    }
  })

  return pkgs.map(p => ({
    id:        p.id,
    barcode:   p.barcode,
    status:    p.status,
    statusName: p.status === 3 ? '已取消' : p.status === 2 ? '已完成' : '打包中',
    remark:    p.remark  || null,
    createdAt: p.created_at,
    items:     itemMap[p.id] || [],
    // 没有打印任务 = 还没生成箱贴任务（例如刚装箱、还没点「打印箱贴」）
    printStatus: jobMap[p.id] || { key: 'no_job', label: '未生成箱贴', errorMessage: null },
  }))
}

// ─── 创建新物流条码（L + 6位 ID）───────────────────────────────────────────────
async function createPackage(taskId, remark = null, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const [[task]] = await conn.query(
      'SELECT id, status, warehouse_id, cancel_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [taskId],
    )
    if (!task) throw new AppError('任务不存在', 404)
    assertInScope(scopeWarehouseIds, task.warehouse_id, '仓库任务')
    if (task.cancel_requested_at) {
      throw new AppError('该任务正在拣货退回中，禁止继续打包操作', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('仅「待打包」任务可创建装箱', 400)
    }

    const [result] = await conn.query(
      'INSERT INTO packages (barcode, warehouse_task_id, remark) VALUES (?, ?, ?)',
      ['TMP', taskId, remark],
    )
    const newId  = result.insertId
    const barcode = `L${String(newId).padStart(6, '0')}`
    await conn.query('UPDATE packages SET barcode=? WHERE id=?', [barcode, newId])
    await conn.commit()

    return { id: newId, barcode, warehouseTaskId: taskId, status: 1, items: [] }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

const QTY_SCALE = 100

function toQtyUnits(value) {
  const n = Number(value)
  if (!Number.isFinite(n)) return NaN
  return Math.round(n * QTY_SCALE)
}

function fromQtyUnits(units) {
  return Number((Number(units) / QTY_SCALE).toFixed(2))
}

function throwOverpacked({ taskId, product, requestedUnits, packedUnits, limitUnits, requiredUnits, checkedUnits }) {
  const remainingUnits = Math.max(0, limitUnits - packedUnits)
  throw new AppError(
    `${product.name} 超出可装箱数量，最多还能装 ${fromQtyUnits(remainingUnits)} ${product.unit}`,
    409,
    'PACKAGE_ITEM_OVERPACKED',
    {
      taskId: Number(taskId),
      productId: Number(product.id),
      productCode: product.code,
      requestedQty: fromQtyUnits(requestedUnits),
      packedQty: fromQtyUnits(packedUnits),
      packableQty: fromQtyUnits(limitUnits),
      remainingQty: fromQtyUnits(remainingUnits),
      requiredQty: fromQtyUnits(requiredUnits),
      checkedQty: fromQtyUnits(checkedUnits),
    },
  )
}

// ─── 向箱子添加商品（商品码路径 / 取货标签路径）────────────────────────────────
// 两条路径共用同一个 `package_items` 表与同一个 `(package_id, product_id, label_container_id)`
// 粒度：`label_container_id IS NULL` 表示按**商品码**装的旧 SKU 份额，非空表示来自某张取货标签。
// 统计一律**按该粒度分行**——只按商品累计会让旧 SKU 与标签互相吞掉份额。
// 入参用 **`labelBarcode`**（条码字符串）而不是 id：`I` 码的条码是**独立序号**，
// 与 `inventory_containers.id` 并不相等，PDA 端只能拿到扫到的字符串。
async function addItem(packageId, { productCode, labelBarcode, qty }, { requestKey, userId, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const hasLabel = labelBarcode != null && String(labelBarcode).trim() !== ''
  if (hasLabel && productCode) throw new AppError('取货标签与商品条码只能二选一', 400)
  if (!hasLabel && !productCode) throw new AppError('必须提供商品条码或取货标签', 400)
  if (qty != null) assertQtyScale(qty, '装箱数量')

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 锁序：**无锁 peek 所属任务 → 锁任务 → 锁箱 → 复查归属**。
    // 取消流程走的是 task → `UPDATE packages WHERE warehouse_task_id=?`（锁箱行）；
    // 这里若反过来先锁箱再锁任务，两条链交叉即死锁。受影响路径统一为 task → pkg。
    const [[peek]] = await conn.query('SELECT warehouse_task_id FROM packages WHERE id=?', [packageId])
    if (!peek) throw new AppError('箱子不存在', 404)

    const [[task]] = await conn.query(
      'SELECT id, status, warehouse_id, cancel_requested_at, adjustment_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [peek.warehouse_task_id],
    )
    if (!task) throw new AppError('任务不存在', 404)
    // 范围 / PDA 设备仓校验必须**先于**幂等 begin：否则重放会绕过越权校验拿到原回执
    assertTaskScope(task, { scopeWarehouseIds, pdaWarehouseId })

    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      // base action：helper 会**无条件**再拼 `.resourceId`（`scopedAction = base.resourceId`），
      // 所以这里传 `package.add`，由 resourceId 绑定到具体箱子
      action: 'package.add',
      userId: userId || null,
      resourceType: 'package',
      resourceId: packageId,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    if (task.cancel_requested_at) {
      throw new AppError('该任务正在拣货退回中，禁止继续打包操作', 409)
    }
    if (task.adjustment_requested_at) {
      throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止装箱', 400)
    }

    const [[pkg]] = await conn.query(
      'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
      [packageId],
    )
    if (!pkg) throw new AppError('箱子不存在', 404)
    // peek 只用来定锁序，锁到手后必须复查归属
    if (Number(pkg.warehouse_task_id) !== Number(task.id)) {
      throw new AppError('箱子所属任务已变化，请刷新后重试', 409, 'PACKAGE_TASK_CHANGED')
    }
    if (Number(pkg.status) === 2) throw new AppError('该箱已完成，无法继续添加商品', 400)
    if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无法继续添加商品', 400)

    let product
    let targetLabelId = null
    let labelBarcodeForResult = null
    let qtyUnits

    if (hasLabel) {
      const [[c]] = await conn.query(
        'SELECT id, barcode, container_type, product_id, locked_by_task_id, warehouse_id FROM inventory_containers WHERE barcode=? AND deleted_at IS NULL',
        [String(labelBarcode).trim()],
      )
      if (!c) throw new AppError('取货标签不存在', 404, 'PACK_LABEL_NOT_FOUND')
      // 只有整件码（container_type=1）能当取货标签；塑料盒条码扫错了要明确拒绝
      if (Number(c.container_type) !== 1) {
        throw new AppError('该条码是塑料盒条码，不是取货码；请扫取货码或商品条码', 400, 'PACK_LABEL_NOT_INDIVIDUAL')
      }
      targetLabelId = Number(c.id)
      if (Number(c.locked_by_task_id) !== Number(task.id)) {
        throw new AppError('该取货标签未锁定于本任务，无法装箱', 409, 'PACK_LABEL_NOT_IN_TASK')
      }
      if (Number(c.warehouse_id) !== Number(task.warehouse_id)) {
        throw new AppError('取货标签所属仓库与任务不一致，无法装箱', 409, 'PACK_LABEL_WAREHOUSE_MISMATCH')
      }

      // **真实盒取货记录**：`source_container_id` 非空才算「这张码是从塑料盒取出来的」。
      // 不能只看容器历史上的 `source_ref_type`——容器被取消/归还后可合法作为普通整件
      // 再给下一个任务拣，那时它仍是历史取货来源，却不是本任务的取货标签。
      const [picks] = await conn.query(
        `SELECT sl.item_id, wti.product_id
         FROM scan_logs sl
         JOIN warehouse_task_items wti ON wti.id = sl.item_id AND wti.task_id = sl.task_id
         WHERE sl.task_id = ? AND sl.container_id = ?
           AND COALESCE(sl.scan_purpose, 1) = 1 AND sl.source_container_id IS NOT NULL
         GROUP BY sl.item_id, wti.product_id`,
        [task.id, targetLabelId],
      )
      if (picks.length !== 1) {
        throw new AppError('该取货标签在本任务下没有唯一的有效盒取货记录，无法装箱', 409, 'PACK_LABEL_NO_PICK')
      }
      if (Number(picks[0].product_id) !== Number(c.product_id)) {
        throw new AppError('取货标签上的商品与该任务明细不一致', 409, 'PACK_LABEL_PRODUCT_MISMATCH')
      }

      const [[p]] = await conn.query(
        'SELECT id, code, name, unit, article_number, spec, color FROM product_items WHERE id=? AND deleted_at IS NULL',
        [picks[0].product_id],
      )
      if (!p) throw new AppError('取货标签对应商品不存在', 404)
      product = p
      labelBarcodeForResult = c.barcode

      // **真实复核量**：该容器在本任务的 CHECK 合计（未复核不得装箱）
      const [[chk]] = await conn.query(
        'SELECT COALESCE(SUM(qty), 0) AS s FROM scan_logs WHERE task_id=? AND container_id=? AND scan_purpose=2',
        [task.id, targetLabelId],
      )
      const checkedLabelQty = roundQty(Number(chk.s))
      if (checkedLabelQty <= 0) {
        throw new AppError('该取货标签尚未完成复核扫码，不能装箱', 409, 'PACK_LABEL_NOT_CHECKED')
      }

      // 该标签**已装箱**的量（作废箱不计）
      const [[packedLabel]] = await conn.query(
        `SELECT COALESCE(SUM(pi.qty), 0) AS s
         FROM package_items pi INNER JOIN packages p ON p.id = pi.package_id
         WHERE p.warehouse_task_id = ? AND pi.label_container_id = ? AND p.status != 3`,
        [task.id, targetLabelId],
      )
      const labelRemaining = roundQty(checkedLabelQty - Number(packedLabel.s))

      // 默认**整份**（该标签的未装余量），不是 1；显式给量则不得超
      if (qty == null && labelRemaining <= 0) {
        throw new AppError(
          `该取货标签已无未装箱余量（已复核 ${checkedLabelQty}，已装 ${Number(packedLabel.s)}）`,
          409, 'PACK_LABEL_NO_REMAINING',
        )
      }
      qtyUnits = toQtyUnits(qty == null ? labelRemaining : qty)
      if (!Number.isFinite(qtyUnits) || qtyUnits <= 0) throw new AppError('数量必须大于 0', 400)
      // 精度校验要在**最终数量定下来之后**做（默认整份也走这里）：整数商品不能靠标签整份装进小数
      await assertQtyPrecision(conn, [{ productId: product.id, qty: fromQtyUnits(qtyUnits), label: '装箱数量' }])
      if (qtyUnits > toQtyUnits(labelRemaining)) {
        throw new AppError(
          `装箱数量超过该取货标签的未装余量（已复核 ${checkedLabelQty}，已装 ${Number(packedLabel.s)}，最多可装 ${labelRemaining}）`,
          409, 'PACK_LABEL_OVER_REMAINING',
        )
      }
    } else {
      const [[p]] = await conn.query(
        'SELECT id, code, name, unit, article_number, spec, color FROM product_items WHERE code=? AND deleted_at IS NULL',
        [productCode],
      )
      if (!p) throw new AppError(`商品 ${productCode} 不存在`, 404)
      product = p
      await assertQtyPrecision(conn, [{ productId: product.id, qty, label: '装箱数量' }])
      qtyUnits = toQtyUnits(qty)
      if (!Number.isFinite(qtyUnits) || qtyUnits <= 0) throw new AppError('数量必须大于 0', 400)
    }

    // 用任务明细行作为同任务同商品的并发闸门；无论装入哪个箱子，同商品装箱都必须串行校验。
    const [taskItems] = await conn.query(
      `SELECT id, required_qty, checked_qty
       FROM warehouse_task_items
       WHERE task_id=? AND product_id=?
       FOR UPDATE`,
      [task.id, product.id],
    )
    if (!taskItems.length) throw new AppError(`商品 ${product.code} 不属于当前任务，禁止装箱`, 400)

    const requiredUnits = taskItems.reduce((sum, item) => sum + toQtyUnits(item.required_qty), 0)
    const checkedUnits = taskItems.reduce((sum, item) => sum + toQtyUnits(item.checked_qty ?? 0), 0)
    const limitUnits = Math.min(requiredUnits, checkedUnits)

    // 旧商品码路径的**份额上限**：已复核量里**不属于任何取货标签**的那部分。
    // 依据是标签的**真实复核量**（尚未装箱的标签货也已占住份额），不能用「已装箱的标签量」，
    // 否则未装的标签货会被旧 SKU 吞掉。
    if (!hasLabel) {
      const [[labelChecked]] = await conn.query(
        `SELECT COALESCE(SUM(sl.qty), 0) AS s
         FROM scan_logs sl
         INNER JOIN warehouse_task_items wti ON wti.id = sl.item_id AND wti.task_id = sl.task_id
         WHERE sl.task_id = ? AND wti.product_id = ?
           AND sl.scan_purpose = 2
           AND sl.container_id IN (
             SELECT DISTINCT container_id FROM scan_logs
             WHERE task_id = ? AND COALESCE(scan_purpose,1) = 1 AND source_container_id IS NOT NULL
           )`,
        [task.id, product.id, task.id],
      )
      const legacyLimitUnits = Math.max(0, checkedUnits - toQtyUnits(labelChecked.s))
      const [[packedLegacy]] = await conn.query(
        `SELECT COALESCE(SUM(pi.qty), 0) AS s
         FROM package_items pi INNER JOIN packages p ON p.id = pi.package_id
         WHERE p.warehouse_task_id = ? AND pi.product_id = ? AND pi.label_container_id IS NULL AND p.status != 3`,
        [task.id, product.id],
      )
      if (toQtyUnits(packedLegacy.s) + qtyUnits > legacyLimitUnits) {
        throw new AppError(
          `${product.name} 超出旧商品码可装箱份额（已复核 ${fromQtyUnits(checkedUnits)}，取货标签已占 ${fromQtyUnits(toQtyUnits(labelChecked.s))}，最多可装 ${fromQtyUnits(legacyLimitUnits)}）`,
          409, 'PACKAGE_LEGACY_OVER_LIMIT',
        )
      }
    }

    const [packedRows] = await conn.query(
      `SELECT pi.id, pi.qty
       FROM package_items pi
       INNER JOIN packages p ON p.id = pi.package_id
       WHERE p.warehouse_task_id=? AND pi.product_id=? AND p.status != 3
       FOR UPDATE`,
      [task.id, product.id],
    )
    const packedUnits = packedRows.reduce((sum, row) => sum + toQtyUnits(row.qty), 0)
    if (packedUnits + qtyUnits > limitUnits) {
      throwOverpacked({
        taskId: task.id,
        product,
        requestedUnits: qtyUnits,
        packedUnits,
        limitUnits,
        requiredUnits,
        checkedUnits,
      })
    }

    // 同箱同商品**同来源**才累加：旧 SKU 与各取货标签各自成行，互不覆盖。
    const labelCond = targetLabelId == null ? 'label_container_id IS NULL' : 'label_container_id = ?'
    const labelParams = targetLabelId == null ? [] : [targetLabelId]
    const [[existing]] = await conn.query(
      `SELECT id, qty FROM package_items WHERE package_id=? AND product_id=? AND ${labelCond} FOR UPDATE`,
      [packageId, product.id, ...labelParams],
    )

    let result
    if (existing) {
      const newQtyUnits = toQtyUnits(existing.qty) + qtyUnits
      const newQty = fromQtyUnits(newQtyUnits)
      await conn.query('UPDATE package_items SET qty=? WHERE id=?', [newQty, existing.id])
      result = {
        itemId:      existing.id,
        productId:   product.id,
        productCode: product.code,
        productName: product.name,
        unit:        product.unit,
        qty:         newQty,
        // 本次**增量**：`qty` 是该行的累计量，界面提示要区分「本次装了多少」与「累计多少」
        addedQty:    fromQtyUnits(qtyUnits),
        labelContainerId: targetLabelId,
        // 原条码也回给前端：它是**回执定位**用的稳定标识（列表/查询接口已有同名字段）
        labelBarcode: labelBarcodeForResult,
      }
    } else {
      const [ins] = await conn.query(
        `INSERT INTO package_items
           (package_id, label_container_id, product_id, product_code, product_name, unit, article_number, spec, color, qty)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [packageId, targetLabelId, product.id, product.code, product.name, product.unit, product.article_number || null, product.spec || null, product.color || null, fromQtyUnits(qtyUnits)],
      )
      result = {
        itemId:      ins.insertId,
        productId:   product.id,
        productCode: product.code,
        productName: product.name,
        unit:        product.unit,
        qty:         fromQtyUnits(qtyUnits),
        addedQty:    fromQtyUnits(qtyUnits),
        labelContainerId: targetLabelId,
        labelBarcode: labelBarcodeForResult,
      }
    }

    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '商品已加入箱子',
      resourceType: 'package',
      resourceId: packageId,
    })
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ─── 从箱子移出商品（扫错/多扫纠正）────────────────────────────────────────────
async function removeItem(packageId, { itemId, qty }, { requestKey, userId, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 锁序与 addItem 统一：先 peek 定所属任务 → 锁任务 → 锁箱 → 复查归属。
    // 反过来先锁箱会和取消流程的 task → packages 交叉死锁。
    const [[peek]] = await conn.query('SELECT warehouse_task_id FROM packages WHERE id=?', [packageId])
    if (!peek) throw new AppError('箱子不存在', 404)

    const [[task]] = await conn.query(
      'SELECT id, status, warehouse_id, cancel_requested_at, adjustment_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [peek.warehouse_task_id],
    )
    if (!task) throw new AppError('任务不存在', 404)
    // 范围 / PDA 设备仓校验必须**先于**幂等 begin：否则重放会绕过越权校验拿到原回执（同 addItem）
    assertTaskScope(task, { scopeWarehouseIds, pdaWarehouseId })

    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      // base action：helper 会**无条件**再拼 `.resourceId`，所以这里传 `package.remove-item`
      action: 'package.remove-item',
      userId: userId || null,
      resourceType: 'package',
      resourceId: packageId,
    })
    if (requestState.replay) {
      // **重放分支排在查明细之前**：整行移出会把 `package_items` 行删掉，之后再重放若还去查明细，
      // 就会用「该商品明细不存在」404 把**已经成功过**的操作挡回去，前端永远确认不了结果。
      await conn.rollback()
      return requestState.responseData
    }

    const [[pkg]] = await conn.query(
      'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
      [packageId],
    )
    if (!pkg) throw new AppError('箱子不存在', 404)
    if (Number(pkg.warehouse_task_id) !== Number(task.id)) {
      throw new AppError('箱子所属任务已变化，请刷新后重试', 409, 'PACKAGE_TASK_CHANGED')
    }
    if (Number(pkg.status) !== 1) throw new AppError('该箱已完成或已作废，无法移除商品', 400)
    if (task.cancel_requested_at) {
      throw new AppError('该任务正在拣货退回中，禁止继续打包操作', 409)
    }
    if (task.adjustment_requested_at) {
      throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止移除商品', 400)
    }

    const [[item]] = await conn.query(
      'SELECT id, product_id, product_code, product_name, unit, qty, label_container_id FROM package_items WHERE id=? AND package_id=? FOR UPDATE',
      [itemId, packageId],
    )
    if (!item) throw new AppError('该商品明细不存在', 404)

    if (qty != null) await assertQtyPrecision(conn, [{ productId: item.product_id, qty, label: '移除数量' }])
    const currentUnits = toQtyUnits(item.qty)
    const removeUnits = qty == null ? currentUnits : toQtyUnits(qty)
    if (!Number.isFinite(removeUnits) || removeUnits <= 0) throw new AppError('移除数量必须大于 0', 400)
    if (removeUnits > currentUnits) throw new AppError('移除数量不能超过箱内现有数量', 400)

    let result
    if (removeUnits >= currentUnits) {
      await conn.query('DELETE FROM package_items WHERE id=?', [item.id])
      result = {
        itemId: item.id, productId: item.product_id, productCode: item.product_code,
        productName: item.product_name, unit: item.unit, removed: true, qty: 0,
        labelContainerId: item.label_container_id != null ? Number(item.label_container_id) : null,
      }
    } else {
      const newQty = fromQtyUnits(currentUnits - removeUnits)
      await conn.query('UPDATE package_items SET qty=? WHERE id=?', [newQty, item.id])
      result = {
        itemId: item.id, productId: item.product_id, productCode: item.product_code,
        productName: item.product_name, unit: item.unit, removed: false, qty: newQty,
        labelContainerId: item.label_container_id != null ? Number(item.label_container_id) : null,
      }
    }

    await completeOperationRequest(conn, requestState, {
      data: result,
      message: result.removed ? '商品已移出箱子' : '数量已调整',
      resourceType: 'package',
      resourceId: packageId,
    })
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ─── 作废单箱（整箱装错重来，不影响任务下其它箱子）────────────────────────────────
async function voidPackage(packageId, { requestKey, userId, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 锁序同 addItem/removeItem：peek → 锁任务 → 锁箱 → 复查归属
    const [[peek]] = await conn.query('SELECT warehouse_task_id FROM packages WHERE id=?', [packageId])
    if (!peek) throw new AppError('箱子不存在', 404)

    const [[task]] = await conn.query(
      'SELECT id, status, warehouse_id, cancel_requested_at, adjustment_requested_at FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [peek.warehouse_task_id],
    )
    if (!task) throw new AppError('任务不存在', 404)
    assertTaskScope(task, { scopeWarehouseIds, pdaWarehouseId })

    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      // base action：helper 会**无条件**再拼 `.resourceId`，所以这里传 `package.void`
      action: 'package.void',
      userId: userId || null,
      resourceType: 'package',
      resourceId: packageId,
    })
    if (requestState.replay) {
      // **重放分支排在状态检查之前**：作废是终态，重放时箱已经是「已作废」，
      // 若先跑状态检查就会用「无需重复操作」400 把**已经成功过**的作废挡回去。
      // 新键（非重放）对已作废箱仍然走下面的 400 拒绝——幂等只救**同一个操作**。
      await conn.rollback()
      return requestState.responseData
    }

    const [[pkg]] = await conn.query(
      'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
      [packageId],
    )
    if (!pkg) throw new AppError('箱子不存在', 404)
    if (Number(pkg.warehouse_task_id) !== Number(task.id)) {
      throw new AppError('箱子所属任务已变化，请刷新后重试', 409, 'PACKAGE_TASK_CHANGED')
    }
    if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无需重复操作', 400)
    if (Number(pkg.status) === 2) throw new AppError('该箱已完成，无法作废', 400)
    if (task.cancel_requested_at) {
      throw new AppError('该任务正在拣货退回中，请通过「拣货退回」流程处理该箱子', 409)
    }
    if (task.adjustment_requested_at) {
      throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
    }
    if (Number(task.status) !== WT_STATUS.PACKING) {
      throw new AppError('任务不在待打包状态，禁止作废箱子', 400)
    }

    await conn.query('UPDATE packages SET status=3 WHERE id=?', [packageId])

    const result = { id: packageId, warehouseTaskId: Number(pkg.warehouse_task_id), status: 3, statusName: '已取消' }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '箱子已作废',
      resourceType: 'package',
      resourceId: packageId,
    })
    await conn.commit()
    return result
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// ─── 作废已完成箱子（改单减量专用）───────────────────────────────────────────
// 与 voidPackage 的区别：voidPackage 只允许作废 status=1（打包中，尚未打印箱贴）的箱子，
// 且要求任务处于 PACKING 状态；本函数专门处理已完成（status=2，已打印箱贴）的箱子，
// 允许任务处于拣货中~待出库任一活跃阶段（改单可能发生在打包完成之后）。
// package_items 与 inventory_containers 无关联（装箱不影响容器库存数字，见
// warehouse-tasks.command.js 里取消逆向归还的同一说明），作废本身不需要任何数量回滚——
// 该商品的 packedUnits 统计口径本就是 `WHERE package.status != 3` 实时 SUM，作废后自动归零，
// 调用方（warehouse-tasks.adjust.js）负责后续把因此腾出的数量纳入分层处理。
async function voidCompletedPackage(conn, packageId, { operator, reason = '改单调整' } = {}) {
  const [[pkg]] = await conn.query(
    'SELECT id, status, warehouse_task_id, barcode FROM packages WHERE id=? FOR UPDATE',
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)
  if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无需重复操作', 400)

  const [[task]] = await conn.query(
    'SELECT id, status FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
    [pkg.warehouse_task_id],
  )
  if (!task) throw new AppError('任务不存在', 404)

  const [items] = await conn.query(
    'SELECT product_id, product_code, product_name, unit, qty FROM package_items WHERE package_id=?',
    [packageId],
  )

  await conn.query('UPDATE packages SET status=3 WHERE id=?', [packageId])

  // 已完成箱子大概率已经进入打印链，参照 warehouse-tasks.command.js 取消流程里的既有处理：
  // 未完成/未确认的打印任务作废，已完成的打印记录保留作审计，不回滚。
  await conn.query(
    `UPDATE print_jobs SET status = 3, error_message = ?
     WHERE ref_type = 'package' AND ref_id = ? AND status IN (0, 1)`,
    [reason, packageId],
  )

  return {
    id: Number(packageId),
    barcode: pkg.barcode,
    warehouseTaskId: Number(pkg.warehouse_task_id),
    status: 3,
    statusName: '已作废',
    items: items.map(i => ({
      productId: Number(i.product_id),
      productCode: i.product_code,
      productName: i.product_name,
      unit: i.unit,
      qty: Number(i.qty),
    })),
    operator: operator ? { userId: operator.userId ?? null, realName: operator.realName ?? null } : null,
  }
}

function packageLabelJobKey(packageId) {
  return `package_label:package:${Number(packageId)}`
}

async function findActivePackageLabelJob(exec, packageId) {
  const [[job]] = await exec.query(
    `SELECT id, status
     FROM print_jobs
     WHERE job_unique_key=? AND status IN (0, 1, 2)
     ORDER BY id DESC LIMIT 1`,
    [packageLabelJobKey(packageId)],
  )
  return job || null
}

async function buildFinishedPackagePrintResult(exec, packageId, warehouseTaskId, job) {
  const [[{ remaining }]] = await exec.query(
    'SELECT COUNT(*) AS remaining FROM packages WHERE warehouse_task_id=? AND status=1',
    [warehouseTaskId],
  )
  // unprintable（无可用打印机，只留记录）不参与派发提示判断，否则会被说成「客户端未绑定」
  const dispatchHint = job?.id && !job.unprintable
    ? await printJobs.getDispatchHintForJob(job.printerCode, Number(job.id), exec)
    : null
  return {
    id: Number(packageId),
    warehouseTaskId: Number(warehouseTaskId),
    status: 2,
    statusName: '已完成',
    allPackagesDone: Number(remaining) === 0,
    printQueued: true,
    printJobId: Number(job.id),
    printJobStatus: Number(job.status),
    printJob: {
      id: Number(job.id),
      jobType: job.jobType ?? 'package_label',
      status: Number(job.status),
      statusKey: job.statusKey ?? null,
      printStateLabel: job.printStateLabel ?? null,
      printerId: job.printerId ?? null,
      printerCode: job.printerCode ?? null,
      printerName: job.printerName ?? null,
      dispatchHint,
    },
  }
}

// ─── 完成箱子并保持打印链原子性 ────────────────────────────────────────────────
async function markPackageFinishedWithinTransaction(conn, packageId) {
  // 锁序同 addItem/removeItem/voidPackage：peek → 锁任务 → 锁箱 → 复查归属
  const [[peek]] = await conn.query('SELECT warehouse_task_id FROM packages WHERE id=?', [packageId])
  if (!peek) throw new AppError('箱子不存在', 404)

  const [[taskRow]] = await conn.query(
    'SELECT id, status, task_no, cancel_requested_at, adjustment_requested_at FROM warehouse_tasks WHERE id=? FOR UPDATE',
    [peek.warehouse_task_id],
  )
  if (!taskRow || Number(taskRow.status) !== WT_STATUS.PACKING) {
    throw new AppError('任务不在待打包状态，禁止完成装箱', 400)
  }
  if (taskRow.cancel_requested_at) {
    throw new AppError('该任务正在拣货退回中，禁止继续打包操作', 409)
  }
  if (taskRow.adjustment_requested_at) {
    throw new AppError('该任务有改单正在等待仓库确认，请先处理完成', 409)
  }

  const [[pkg]] = await conn.query(
    'SELECT id, status, warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
    [packageId],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)
  if (Number(pkg.warehouse_task_id) !== Number(taskRow.id)) {
    throw new AppError('箱子所属任务已变化，请刷新后重试', 409, 'PACKAGE_TASK_CHANGED')
  }
  if (Number(pkg.status) === 3) throw new AppError('该箱已作废，无法完成打包', 400)
  const alreadyFinished = Number(pkg.status) === 2

  if (!alreadyFinished) {
    const [[{ cnt }]] = await conn.query(
      'SELECT COUNT(*) AS cnt FROM package_items WHERE package_id=?',
      [packageId],
    )
    if (cnt === 0) throw new AppError('箱子内没有商品，无法完成打包', 400)

    await conn.query('UPDATE packages SET status=2 WHERE id=?', [packageId])
  }

  const [[{ remaining }]] = await conn.query(
    'SELECT COUNT(*) AS remaining FROM packages WHERE warehouse_task_id=? AND status=1',
    [pkg.warehouse_task_id],
  )
  if (!alreadyFinished && remaining > 0) {
    try {
      await recordEvent(conn, {
        taskId: pkg.warehouse_task_id,
        taskNo: taskRow.task_no ?? '',
        eventType: WT_EVENT.PACK_PROGRESS,
        detail: { packageId, remaining },
      })
    } catch (_) {
      // 打包进度事件为 best-effort：记录失败不应阻断打包主流程，故静默忽略
    }
  }

  return {
    id: packageId,
    warehouseTaskId: Number(pkg.warehouse_task_id),
    status: 2,
    statusName: '已完成',
    allPackagesDone: Number(remaining) === 0,
  }
}

/**
 * 完成箱子（finish）。**幂等回执与业务在同一个 conn、同一个事务内**。
 *
 * 修前是两段：controller 用 **pool** 做 `beginResourceOperationRequest`（先于范围 / 设备仓校验），
 * service 的业务在**自己的事务**里 commit，controller 之后才 `completeOperationRequest` 写回执；
 * 且回执构建 `buildFinishedPackagePrintResult(pool, ...)` 发生在 **commit 之后**。
 * 这留下三处问题：① 重放绕过范围 / 设备仓校验；② 「业务已提交、回执未落」的窗口；
 * ③ 回执构建自身失败时业务已提交、调用方却拿不到结果。
 * 现在统一为：**锁任务 → 范围 / 设备仓校验 → 幂等 begin/replay → 业务 → 同事务内构建回执 → 落回执 → commit**。
 *
 * 锁序与 addItem/removeItem/voidPackage 一致：peek → 锁任务 → 锁箱 → 复查归属（task → package）。
 */
async function finishPackage(packageId, { requestKey, userId, createdBy, scopeWarehouseIds = null, pdaWarehouseId = null } = {}) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const [[peek]] = await conn.query('SELECT warehouse_task_id FROM packages WHERE id=?', [packageId])
    if (!peek) throw new AppError('箱子不存在', 404)

    const [[taskRow]] = await conn.query(
      'SELECT id, status, warehouse_id FROM warehouse_tasks WHERE id=? AND deleted_at IS NULL FOR UPDATE',
      [peek.warehouse_task_id],
    )
    if (!taskRow) throw new AppError('任务不存在', 404)
    // 范围 / PDA 设备仓校验必须**先于**幂等 begin：否则重放会绕过越权校验拿到原回执
    assertTaskScope(taskRow, { scopeWarehouseIds, pdaWarehouseId })

    // peek 是**无锁**读：期间箱可能已被移到别的任务。在幂等 begin / replay **之前**锁箱并复查归属，
    // 避免把**过时的、其实属于别的任务**的原回执（或原箱状态）当作本任务的完成结果回放出去。
    const [[pkgPeek]] = await conn.query(
      'SELECT warehouse_task_id FROM packages WHERE id=? FOR UPDATE',
      [packageId],
    )
    if (!pkgPeek) throw new AppError('箱子不存在', 404)
    if (Number(pkgPeek.warehouse_task_id) !== Number(taskRow.id)) {
      throw new AppError('箱子所属任务已变化，请刷新后重试', 409, 'PACKAGE_TASK_CHANGED')
    }

    const requestState = await beginResourceOperationRequest(conn, {
      requestKey,
      // base action：helper 会**无条件**再拼 `.resourceId`，所以这里传 `package.finish`
      action: 'package.finish',
      userId: userId || null,
      resourceType: 'package',
      resourceId: packageId,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    // 已完成箱的「重复完成」捷径：保留既有语义 —— 无键（或新键）再次完成时返回既有结果，
    // **不重复入队**打印任务。注意这发生在**成功重放之后**，不会顶替原回执。
    const [[pkgNow]] = await conn.query('SELECT id, status FROM packages WHERE id=? FOR UPDATE', [packageId])
    if (Number(pkgNow?.status) === 2) {
      const existingJob = await findActivePackageLabelJob(conn, packageId)
      if (existingJob) {
        const shortcut = await buildFinishedPackagePrintResult(conn, packageId, peek.warehouse_task_id, existingJob)
        await completeOperationRequest(conn, requestState, {
          data: shortcut,
          message: '箱子已完成并已进入打印链',
          resourceType: 'package',
          resourceId: packageId,
        })
        await conn.commit()
        return shortcut
      }
    }

    await printJobs.assertQueueReady({
      warehouseId: Number(taskRow.warehouse_id),
      jobType: 'package_label',
      contentType: 'zpl',
      requireClientOnline: false,
    })

    const result = await markPackageFinishedWithinTransaction(conn, packageId)

    const job = await printJobs.enqueuePackageLabelJob({
      conn,
      packageId,
      createdBy: createdBy ?? null,
      jobUniqueKey: packageLabelJobKey(packageId),
    })
    if (!job) {
      throw new AppError(
        '箱贴未进入打印链，请先检查 package_label 打印机绑定和用途配置',
        409,
        'PACKAGE_LABEL_JOB_NOT_QUEUED',
      )
    }

    // 电子面单（文档 06）：销售单已指定承运商时，在同一事务内写一条"待取号"运单记录。
    // 纯 DB INSERT、零 HTTP（真正取号由 scheduler 异步 worker 事务外完成），
    // uk_package 幂等；未指定承运商则返回 null 不建单，对打包主流程零影响。
    await logisticsSvc.createPendingWaybillTx(conn, { packageId, createdBy: createdBy ?? null })

    // 回执**在同一事务内**构建：打印任务是本事务刚 INSERT 的行，必须用同一个 conn 读，
    // 用 pool 会因为读不到未提交行而抛 `PRINT_JOB_NOT_FOUND` 404，把整个完成动作回滚。
    const payload = await buildFinishedPackagePrintResult(conn, packageId, result.warehouseTaskId, job)
    await completeOperationRequest(conn, requestState, {
      data: payload,
      message: '箱子已完成并已进入打印链',
      resourceType: 'package',
      resourceId: packageId,
    })
    await conn.commit()
    return payload
  } catch (e) {
    await conn.rollback()
    // 失败即**整体回滚**：业务改动与 begin 写的 pending 行一并消失。**不**另开一条事务补失败回执：
    //   · 未通过范围 / 设备校验的请求不该留下任何回执行（否则等于给越权请求留痕）；
    //   · 瞬时故障（读 / 回执写入）之后，调用方**用原键重试必须能正常成功** ——
    //     补一条 failed 行会把这次重试永久挡成 409；
    //   · 与本模块其它关键操作（add / remove / void）一致：回滚即无行，不额外造回执。
    throw e
  } finally {
    conn.release()
  }
}

// ─── 按条码查询箱子（含任务信息 + 所有箱的明细）────────────────────────────────
async function getByBarcode(barcode) {
  const inboundThresholds = await getInboundClosureThresholds()
  const [[pkg]] = await pool.query(
    `SELECT p.id, p.barcode, p.status, p.warehouse_task_id,
            wt.task_no, wt.customer_name, wt.warehouse_name,
            wt.status AS task_status
     FROM packages p
     JOIN warehouse_tasks wt ON wt.id = p.warehouse_task_id
     WHERE p.barcode = ?`,
    [barcode],
  )
  if (!pkg) throw new AppError('箱子不存在', 404)

  // 返回该任务下所有箱子的明细（方便一次展示全订单）
  const allPkgs = await listByTask(pkg.warehouse_task_id)
  const [printRows] = await pool.query(
    `SELECT
        j.id AS job_id,
        j.status,
        j.updated_at,
        j.error_message,
        pr.code AS printer_code,
        pr.name AS printer_name
     FROM packages p
     LEFT JOIN (
       SELECT j1.*
       FROM print_jobs j1
       INNER JOIN (
         SELECT ref_id, MAX(id) AS max_id
         FROM print_jobs
         WHERE ref_type = 'package'
         GROUP BY ref_id
       ) latest ON latest.max_id = j1.id
     ) j ON j.ref_id = p.id AND j.ref_type = 'package'
     LEFT JOIN printers pr ON pr.id = j.printer_id
     WHERE p.warehouse_task_id = ?`,
    [pkg.warehouse_task_id],
  )
  const printSummary = buildPackagePrintSummary(printRows, allPkgs.length, {
    timeoutMinutes: inboundThresholds.printTimeoutMinutes,
  })

  return {
    packageId:        pkg.id,
    barcode:          pkg.barcode,
    packageStatus:    pkg.status,
    packageStatusName: pkg.status === 3 ? '已取消' : pkg.status === 2 ? '已完成' : '打包中',
    warehouseTaskId:  pkg.warehouse_task_id,
    taskNo:           pkg.task_no,
    customerName:     pkg.customer_name,
    warehouseName:    pkg.warehouse_name,
    warehouseTaskStatus:     pkg.task_status,
    warehouseTaskStatusName: WT_STATUS_NAME[Number(pkg.task_status)] ?? null,
    taskStatus:       pkg.task_status,
    taskStatusName:   WT_STATUS_NAME[Number(pkg.task_status)] ?? null,
    printSummary,
    packages:         allPkgs,
  }
}

// ─── 取消任务下所有未取消包裹 ────────────────────────────────────────────────
async function cancelByTaskId(conn, taskId) {
  const [result] = await conn.query(
    `UPDATE packages SET status = 3
     WHERE warehouse_task_id = ? AND status IN (1, 2)`,
    [taskId],
  )
  return result.affectedRows
}

module.exports = {
  listByTask,
  createPackage,
  addItem,
  removeItem,
  voidPackage,
  voidCompletedPackage,
  finishPackage,
  getByBarcode,
  cancelByTaskId,
}
