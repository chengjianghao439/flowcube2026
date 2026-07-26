const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { enqueueContainerLabelJob } = require('../print-jobs/print-jobs.service')
const {
  genTaskNo,
  appendInboundEvent,
  fmtItem,
  parseJson,
  assertPurchaseOrdersOpen,
} = require('./inbound-tasks.helpers')
const { env } = require('../../config/env')
const { assertInScope } = require('../../utils/warehouseScope')
const {
  distributePackagesToLines,
  ensureInboundTaskExists,
  assertTaskCanSubmit,
  assertTaskCanReceive,
  assertTaskCanCancel,
} = require('./inbound-tasks.status')
const { findById, loadPurchasableCandidates } = require('./inbound-tasks.query')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')

async function createFromPoId(purchaseOrderId) {
  const purchaseSvc = require('../purchase/purchase.service')
  const order = await purchaseSvc.findById(purchaseOrderId)
  assertStatusAction('purchase', 'createInboundTask', order.status)
  if (!order.items.length) throw new AppError('采购单无明细', 400)

  // 混单收货单的 inbound_tasks.purchase_order_id 头字段为空，必须按明细行关联查找，
  // 否则混单场景下查重会漏检，导致同一采购单被重复建单、超收。
  const [[dup]] = await pool.query(
    `SELECT it.id FROM inbound_tasks it
     JOIN inbound_task_items iti ON iti.task_id = it.id
     WHERE iti.purchase_order_id = ? AND it.deleted_at IS NULL AND it.status NOT IN (4, 5) LIMIT 1`,
    [purchaseOrderId],
  )
  if (dup) throw new AppError('该采购单已有未完结的入库任务', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 用剩余未建单量而非采购单原始下单量：若该采购单此前已通过「混单建单」建过部分
    // 数量的收货单（并已收讫结案），这里如果直接用 order.items[].quantity（原始下单量）
    // 建单，会把已经收过的部分重新算一遍，造成后续收货超收、应付重复计算。
    // 同时用 forUpdate 锁住这批采购明细行，和 createManualTask 的建单校验互斥。
    const candidates = await loadPurchasableCandidates(conn, {
      supplierId: order.supplierId,
      purchaseItemIds: order.items.map(item => item.id),
      forUpdate: true,
    })
    const remainingItems = candidates.filter(c => c.remainingQty > 0)
    if (!remainingItems.length) {
      throw new AppError('该采购单明细均已建单收讫，无需重复建单', 400)
    }

    const taskNo = await genTaskNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status)
       VALUES (?,?,?,?,?,?,1)`,
      [taskNo, order.id, order.orderNo, order.supplierName, order.warehouseId, order.warehouseName],
    )
    const taskId = r.insertId
    for (const item of remainingItems) {
      await conn.query(
        `INSERT INTO inbound_task_items (task_id, purchase_order_id, purchase_order_no, purchase_item_id, product_id, product_code, product_name, article_number, spec, color, unit, ordered_qty)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [taskId, order.id, order.orderNo, item.purchaseItemId, item.productId, item.productCode, item.productName, item.articleNumber || null, item.spec || null, item.color || null, item.unit, item.remainingQty],
      )
    }
    await appendInboundEvent(conn, taskId, 'created', '创建收货订单', `收货订单 ${taskNo} 已创建，等待提交到 PDA`, null, {
      purchaseOrderNo: order.orderNo,
      warehouseName: order.warehouseName,
    })
    await conn.commit()
    return { taskId, taskNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function createManualTask({ supplierId, supplierName, remark, items }) {
  const supplierIdN = Number(supplierId)
  if (!Number.isFinite(supplierIdN) || supplierIdN <= 0) throw new AppError('请选择供应商', 400)
  if (!supplierName?.trim()) throw new AppError('供应商名称不能为空', 400)
  if (!Array.isArray(items) || items.length === 0) throw new AppError('请至少选择一条采购明细', 400)

  const normalized = items.map(item => ({
    purchaseItemId: Number(item.purchaseItemId),
    qty: Number(item.qty),
  }))

  if (normalized.some(item => !Number.isFinite(item.purchaseItemId) || item.purchaseItemId <= 0)) {
    throw new AppError('采购明细无效', 400)
  }
  if (normalized.some(item => !Number.isFinite(item.qty) || item.qty <= 0)) {
    throw new AppError('收货数量必须大于 0', 400)
  }

  const purchaseItemIds = [...new Set(normalized.map(item => item.purchaseItemId))]

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    // 候选明细查询在事务内加锁读取（FOR UPDATE），与并发的建单请求相互排队，
    // 避免同一采购明细在两次并发请求里都读到"还有余量"而被超额分配。
    const candidates = await loadPurchasableCandidates(conn, {
      supplierId: supplierIdN,
      purchaseItemIds,
      forUpdate: true,
    })
    if (candidates.length !== purchaseItemIds.length) throw new AppError('存在不可用的采购明细，请刷新后重试', 400)
    const candidateMap = new Map(candidates.map(c => [c.purchaseItemId, c]))

    const warehouseIds = new Set()
    const taskItems = normalized.map(item => {
      const candidate = candidateMap.get(item.purchaseItemId)
      if (!candidate) throw new AppError('存在不可用的采购明细，请刷新后重试', 400)
      if (candidate.remainingQty < item.qty) {
        throw new AppError(`${candidate.productName} 超出可建单数量，最多还能建 ${candidate.remainingQty}`, 400)
      }
      warehouseIds.add(candidate.warehouseId)
      return {
        ...candidate,
        qty: item.qty,
      }
    })

    if (warehouseIds.size !== 1) throw new AppError('同一张收货单仅支持同仓到货，请按仓库分别建单', 400)

    const warehouseId = taskItems[0].warehouseId
    const warehouseName = taskItems[0].warehouseName
    const purchaseOrders = [...new Set(taskItems.map(item => `${item.purchaseOrderId}:${item.purchaseOrderNo}`))]
    const headerPurchaseOrderId = purchaseOrders.length === 1 ? taskItems[0].purchaseOrderId : null
    const headerPurchaseOrderNo = purchaseOrders.length === 1
      ? taskItems[0].purchaseOrderNo
      : `${purchaseOrders.length} 单混合`

    const taskNo = await genTaskNo(conn)
    const [r] = await conn.query(
      `INSERT INTO inbound_tasks (task_no, purchase_order_id, purchase_order_no, supplier_name, warehouse_id, warehouse_name, status, remark)
       VALUES (?,?,?,?,?,?,1,?)`,
      [taskNo, headerPurchaseOrderId, headerPurchaseOrderNo, supplierName.trim(), warehouseId, warehouseName, remark?.trim() || null],
    )
    const taskId = r.insertId

    for (const item of taskItems) {
      await conn.query(
        `INSERT INTO inbound_task_items (task_id, purchase_order_id, purchase_order_no, purchase_item_id, product_id, product_code, product_name, article_number, spec, color, unit, ordered_qty)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          taskId,
          item.purchaseOrderId,
          item.purchaseOrderNo,
          item.purchaseItemId,
          item.productId,
          item.productCode,
          item.productName,
          item.articleNumber || null,
          item.spec || null,
          item.color || null,
          item.unit,
          item.qty,
        ],
      )
    }

    await appendInboundEvent(conn, taskId, 'created', '创建收货订单', `收货订单 ${taskNo} 已创建，等待提交到 PDA`, null, {
      supplierName: supplierName.trim(),
      mixedPurchaseOrders: purchaseOrders.length,
      warehouseName,
    })

    await conn.commit()
    return { taskId, taskNo }
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function submit(taskId, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, { table: 'inbound_tasks', id: taskId, entityName: '收货订单' })
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')
    assertTaskCanSubmit(taskRow)
    await compareAndSetStatus(conn, {
      table: 'inbound_tasks',
      id: taskId,
      fromStatus: Number(taskRow.status),
      toStatus: Number(taskRow.status),
      entityName: '收货订单',
      extraSet: {
        submitted_at: new Date(),
        submitted_by: operator?.userId ?? null,
        submitted_by_name: operator?.realName ?? operator?.username ?? null,
        operator_id: operator?.userId ?? null,
        operator_name: operator?.realName ?? operator?.username ?? null,
      },
    })
    await appendInboundEvent(
      conn,
      taskId,
      'submitted_to_pda',
      '提交到PDA',
      `收货订单 ${taskRow.task_no} 已提交到 PDA，等待现场收货`,
      operator,
      null,
    )
    await conn.commit()
    return findById(taskId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// 超收确认闸门：比例 OR 绝对金额，任一超限都要求前端显式带 confirmOverReceive:true 才放行。
// 审核环节下线后（v0.4.22），这是唯一挡在"扫错数量直接进正式账"前面的安全网。
//
// 为什么不能只看比例（审计 P1-3）：比例阈值对大单形同虚设——应到 10000 件时可以静默超收
// 1999 件，上架完成即自动结算，直接多付供应商这笔钱，且单据上不留任何异常痕迹。
// 金额闸门按「超收量 × 该商品在本任务中的最高采购单价」估算，取最高价是刻意保守：
// 混单时宁可多问一次，也不要让贵重商品的超收从便宜那行的单价里溜过去。
const OVER_RECEIVE_CONFIRM_RATIO = 0.2

// 重复扫码判定时间窗（秒）。见 detectDuplicateScan。
const DUPLICATE_SCAN_WINDOW_SECONDS = 30

/**
 * 评估本次收货造成的超收情况。返回 null 表示该商品不在本任务明细里（由后续逻辑报错）。
 * needsConfirm 为 true 时必须有 confirmOverReceive 才能放行；overQty>0 一律留痕（不阻断）。
 */
async function evaluateOverReceive(conn, { taskId, productId, taskItems, totalQty }) {
  const productLines = taskItems.filter(i => i.productId === productId)
  if (!productLines.length) return null

  const orderedTotal = productLines.reduce((s, i) => s + Number(i.orderedQty || 0), 0)
  const receivedBefore = productLines.reduce((s, i) => s + Number(i.receivedQty || 0), 0)
  const overQty = receivedBefore + totalQty - orderedTotal
  const base = {
    orderedTotal,
    receivedBefore,
    thisQty: totalQty,
    overQty: Math.max(0, overQty),
    overRatio: 0,
    overAmount: 0,
    unitPrice: null,
    needsConfirm: false,
    reasons: [],
    unit: productLines[0]?.unit || '',
  }
  if (overQty <= 0) return base

  const [[priceRow]] = await conn.query(
    `SELECT MAX(poi.unit_price) AS maxPrice
       FROM inbound_task_items iti
       JOIN purchase_order_items poi ON poi.id = iti.purchase_item_id
      WHERE iti.task_id = ? AND iti.product_id = ?`,
    [taskId, productId],
  )
  const unitPrice = Number(priceRow?.maxPrice) || 0
  const overRatio = orderedTotal > 0 ? overQty / orderedTotal : Infinity
  const overAmount = Number((overQty * unitPrice).toFixed(2))
  const reasons = []
  if (overRatio > OVER_RECEIVE_CONFIRM_RATIO) reasons.push('ratio')
  // 单价查不到（历史脏数据）时不触发金额闸门，避免把 0 元当成"没超"或误判成超限
  if (unitPrice > 0 && overAmount > env.OVER_RECEIVE_CONFIRM_AMOUNT) reasons.push('amount')

  return {
    ...base,
    overQty,
    overRatio,
    overAmount,
    unitPrice: unitPrice > 0 ? unitPrice : null,
    needsConfirm: reasons.length > 0,
    reasons,
  }
}

/**
 * 业务级重复扫码防护（审计 P1-5）。
 *
 * operationRequest 的幂等键只能防住「网络重试」——同一个 requestKey 重放会返回缓存结果。
 * 它防不住人为重复：员工把同一箱扫两次、或提交后界面卡顿再点一次（前端会生成新的
 * requestKey），服务端此前没有任何"这箱是不是刚收过"的判断，直接重复入账，凭空多出
 * 一个容器和一批库存。收 100 箱时重复 1 箱只造成 1% 超收，远低于比例闸门，静默通过，
 * 且该库存有合法容器、合法条码，事后无法与真实到货区分。
 *
 * 判定：时间窗内该任务同一商品出现过「箱数与总量完全相同」的收货。命中即要求确认，
 * 不直接拒绝——真实场景里连续收两批一模一样的货是完全可能的，只是需要人确认一次。
 */
async function detectDuplicateScan(conn, { taskId, productId, totalQty, packageCount }) {
  const [rows] = await conn.query(
    `SELECT payload_json, created_at,
            TIMESTAMPDIFF(SECOND, created_at, NOW()) AS secondsAgo
       FROM inbound_task_events
      WHERE task_id = ? AND event_type = 'receive_recorded'
        AND created_at > DATE_SUB(NOW(), INTERVAL ? SECOND)
      ORDER BY id DESC
      LIMIT 5`,
    [taskId, DUPLICATE_SCAN_WINDOW_SECONDS],
  )
  for (const row of rows) {
    const payload = parseJson(row.payload_json)
    if (!payload) continue
    if (Number(payload.productId) !== Number(productId)) continue
    if (Number(payload.totalQty) !== Number(totalQty)) continue
    if (Number(payload.packages) !== Number(packageCount)) continue
    return {
      secondsAgo: Math.max(0, Number(row.secondsAgo) || 0),
      productName: payload.productName || '',
      totalQty: Number(payload.totalQty),
      packages: Number(payload.packages),
    }
  }
  return null
}

async function receive(taskId, payload, { userId, requestKey, pdaWarehouseId, scopeWarehouseIds = null } = {}) {
  const { productId, qty, packages: rawPackages, confirmOverReceive, confirmDuplicate, scannedBarcode, batchNo, mfgDate } = payload
  let { expDate } = payload
  const productIdN = Number(productId)
  const packages = Array.isArray(rawPackages) && rawPackages.length
    ? rawPackages
    : [{ qty }]
  const normalizedPackages = packages.map((pkg, index) => ({
    lineNo: index + 1,
    qty: Number(pkg.qty),
  }))
  const totalQty = normalizedPackages.reduce((sum, pkg) => sum + pkg.qty, 0)

  if (!Number.isFinite(productIdN) || productIdN <= 0) throw new AppError('请选择有效商品', 400)
  if (!normalizedPackages.length) throw new AppError('请至少填写一箱数量', 400)
  if (normalizedPackages.some(pkg => !Number.isFinite(pkg.qty) || pkg.qty <= 0)) throw new AppError('箱数量必须大于 0', 400)

  const [[productRow]] = await pool.query(
    'SELECT barcode, code, batch_managed, shelf_life_days FROM product_items WHERE id=? AND deleted_at IS NULL',
    [productIdN],
  )
  if (!productRow) throw new AppError('商品不存在', 404)

  // 错货防护：PDA 端做过商品条码核对时会带上 scannedBarcode，后端兜底再验一次
  // （防止绕过前端直接调 API 用错误条码入账）。扫码值匹配商品条码或商品编码任一即可；
  // 未传则不校验（商品可能未维护条码，前端有"未核对二次确认"闸门兜底）。
  if (scannedBarcode) {
    const scanned = String(scannedBarcode).trim().toUpperCase()
    const candidates = [productRow.barcode, productRow.code]
      .map(v => String(v || '').trim().toUpperCase())
      .filter(Boolean)
    if (candidates.length && !candidates.includes(scanned)) {
      throw new AppError('扫描的商品条码与所选商品不符，请核对实物后重试', 400)
    }
  }

  // 批次管理商品：强制录入批次；效期缺省由 生产日期 + 保质期天数 推算（迁移 121）
  if (Number(productRow.batch_managed) === 1) {
    if (!batchNo || !String(batchNo).trim()) throw new AppError('该商品启用了批次管理，收货必须录入批次号', 400)
    if (!expDate && mfgDate && Number(productRow.shelf_life_days) > 0) {
      const d = new Date(`${mfgDate}T00:00:00`)
      d.setDate(d.getDate() + Number(productRow.shelf_life_days))
      expDate = d.toISOString().slice(0, 10)
    }
    if (!expDate) throw new AppError('该商品启用了批次管理，请录入效期（或录入生产日期并在商品资料维护保质期天数）', 400)
  }

  const conn = await pool.getConnection()
  let result = {
    containerCode: null,
    containerId: null,
    productName: '',
    qty: totalQty,
    totalQty,
    printJobId: null,
    printJobIds: [],
    containers: [],
  }
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, {
      requestKey,
      action: 'inbound.receive',
      userId: userId || null,
    })
    if (requestState.replay) {
      await conn.rollback()
      return requestState.responseData
    }

    const taskRow = await lockStatusRow(conn, { table: 'inbound_tasks', id: taskId, entityName: '入库任务' })
    // PDA 设备绑定了仓库时，强制校验设备所属仓库与任务仓库一致，防止跨仓库误操作
    if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(taskRow.warehouse_id)) {
      throw new AppError('当前设备绑定仓库与该收货订单所属仓库不一致，无法收货', 403)
    }
    // 用户级仓库权限：设备会话尚未接入前端时（req.pda 恒为 null），这才是实际生效的那道闸门
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')
    assertTaskCanReceive(taskRow)
    await assertPurchaseOrdersOpen(conn, taskId)

    if (Number(taskRow.status) === 1) {
      const receiveStartRule = assertStatusAction('inboundTask', 'receiveStart', taskRow.status)
      await compareAndSetStatus(conn, {
        table: 'inbound_tasks',
        id: taskId,
        fromStatus: receiveStartRule.from,
        toStatus: receiveStartRule.to,
        entityName: '入库任务',
      })
      await appendInboundEvent(
        conn,
        taskId,
        'receive_started',
        'PDA 开始收货',
        `现场开始收货 ${taskRow.task_no}`,
        { userId, realName: null },
        null,
      )
    }

    const [itemRowsFresh] = await conn.query(
      'SELECT * FROM inbound_task_items WHERE task_id = ? ORDER BY id',
      [taskId],
    )
    if (!itemRowsFresh.length) throw new AppError('任务无明细', 400)
    const taskItems = itemRowsFresh.map(fmtItem)

    const warehouseId = Number(taskRow.warehouse_id)
    const taskNo = taskRow.task_no

    // 业务级重复扫码防护（P1-5）：先于超收闸门判断——重复扫码往往同时表现为轻微超收，
    // 提示"疑似重复扫码"比提示"超收"更贴近现场真实原因，也更容易让员工做对处置。
    if (!confirmDuplicate) {
      const duplicate = await detectDuplicateScan(conn, {
        taskId,
        productId: productIdN,
        totalQty,
        packageCount: normalizedPackages.length,
      })
      if (duplicate) {
        throw new AppError(
          `${duplicate.secondsAgo} 秒前刚登记过完全相同的 ${duplicate.packages} 箱共 ${totalQty}，疑似重复扫码。若确实是另一批实物，请再次提交确认`,
          409,
          'DUPLICATE_SCAN_CONFIRM_REQUIRED',
          {
            productId: productIdN,
            totalQty,
            packages: normalizedPackages.length,
            secondsAgo: duplicate.secondsAgo,
          },
        )
      }
    }

    const overReceive = await evaluateOverReceive(conn, {
      taskId,
      productId: productIdN,
      taskItems,
      totalQty,
    })
    if (overReceive?.needsConfirm && !confirmOverReceive) {
      const amountHint = overReceive.reasons.includes('amount') && overReceive.overAmount > 0
        ? `，涉及金额约 ${overReceive.overAmount} 元`
        : ''
      throw new AppError(
        `本次收货后将超收 ${overReceive.overQty}${overReceive.unit}（应到 ${overReceive.orderedTotal}，已收 ${overReceive.receivedBefore}，本次 ${totalQty}）${amountHint}，请确认后重试`,
        409,
        'OVER_RECEIVE_CONFIRM_REQUIRED',
        {
          productId: productIdN,
          orderedQty: overReceive.orderedTotal,
          receivedQty: overReceive.receivedBefore,
          thisQty: totalQty,
          overQty: overReceive.overQty,
          overAmount: overReceive.overAmount,
          unitPrice: overReceive.unitPrice,
          reasons: overReceive.reasons,
        },
      )
    }

    // 逐箱分配：既算出各明细行的实收增量（与历史 first-fit 顺序一致），又记录每箱的归属行，
    // 供下面建容器时写入 inbound_task_item_id，让上架能精确回写 putaway_qty（P1-4）。
    const { updates, assignments } = distributePackagesToLines(taskItems, productIdN, normalizedPackages)
    const ownerByLineNo = new Map(assignments.map(a => [a.lineNo, a.itemId]))
    for (const u of updates) {
      await conn.query(
        'UPDATE inbound_task_items SET received_qty = received_qty + ? WHERE id = ?',
        [u.add, u.itemId],
      )
      const ti = taskItems.find(x => x.id === u.itemId)
      if (ti) ti.receivedQty += u.add
    }

    const line = taskItems.find(i => i.productId === productIdN)
    const unit = line?.unit || null
    const productName = line?.productName || ''
    const itemCount = normalizedPackages.length

    const containers = []
    for (const pkg of normalizedPackages) {
      const { containerId, barcode } = await createContainer(conn, {
        productId: productIdN,
        warehouseId,
        initialQty: pkg.qty,
        unit,
        batchNo: batchNo ? String(batchNo).trim() : null,
        mfgDate: mfgDate || null,
        expDate: expDate || null,
        locationId: null,
        inboundTaskId: taskId,
        inboundTaskItemId: ownerByLineNo.get(pkg.lineNo) ?? null,
        containerStatus: CONTAINER_STATUS.PENDING_PUTAWAY,
        sourceType: SOURCE_TYPE.INBOUND_TASK,
        sourceRefId: taskId,
        sourceRefType: 'inbound_task',
        sourceRefNo: taskNo,
        remark: `收货待上架 ${taskNo} 第${pkg.lineNo}箱`,
      })
      containers.push({
        containerId,
        containerCode: barcode,
        qty: pkg.qty,
      })
    }

    await appendInboundEvent(
      conn,
      taskId,
      'receive_recorded',
      '收货登记',
      `${productName} 已登记 ${itemCount} 箱，共 ${totalQty}${unit ? ` ${unit}` : ''}`,
      { userId, realName: null },
      {
        productId: productIdN,
        productName,
        totalQty,
        packages: normalizedPackages.length,
      },
    )

    // 任何超收都留痕（哪怕 1 件、哪怕没触发确认闸门），供财务日终复核——不阻断现场作业。
    // 自动结算把"超收多少钱"直接写进应付，此前单据上没有任何可供事后追溯的异常记录，
    // 对账时只能靠人肉比对采购单和收货单（审计 P1-3）。
    if (overReceive && overReceive.overQty > 0) {
      await appendInboundEvent(
        conn,
        taskId,
        'over_receive',
        '超收登记',
        `${productName} 超收 ${overReceive.overQty}${overReceive.unit}`
        + `（应到 ${overReceive.orderedTotal}，本次收货后累计 ${overReceive.receivedBefore + totalQty}）`
        + (overReceive.overAmount > 0 ? `，涉及金额约 ${overReceive.overAmount} 元` : '')
        + (confirmOverReceive ? '，已由操作员确认' : ''),
        { userId, realName: null },
        {
          productId: productIdN,
          productName,
          orderedQty: overReceive.orderedTotal,
          receivedBefore: overReceive.receivedBefore,
          thisQty: totalQty,
          overQty: overReceive.overQty,
          overAmount: overReceive.overAmount,
          unitPrice: overReceive.unitPrice,
          gateTriggered: overReceive.needsConfirm,
          gateReasons: overReceive.reasons,
          confirmed: Boolean(confirmOverReceive),
        },
      )
    }

    const [updatedItems] = await conn.query('SELECT * FROM inbound_task_items WHERE task_id = ?', [taskId])
    const allReceived = updatedItems.every(i => Number(i.received_qty) >= Number(i.ordered_qty))
    if (allReceived) {
      const receiveCompleteRule = assertStatusAction('inboundTask', 'receiveComplete', Number(taskRow.status) === 1 ? 2 : taskRow.status)
      await compareAndSetStatus(conn, {
        table: 'inbound_tasks',
        id: taskId,
        fromStatus: receiveCompleteRule.from,
        toStatus: receiveCompleteRule.to,
        entityName: '入库任务',
      })
    }

    await conn.query('UPDATE inbound_tasks SET lock_version = lock_version + 1 WHERE id = ?', [taskId])
    result = {
      containerCode: containers[0]?.containerCode ?? null,
      containerId: containers[0]?.containerId ?? null,
      productName,
      qty: totalQty,
      totalQty,
      warehouseId,
      printJobId: null,
      printJobIds: [],
      containers,
    }
    // 收货是"货已经在库"这个事实的记录，不应该因为打印基础设施暂时没就绪而回滚。
    // enqueueContainerLabelJob 在真正找不到可用打印机时返回 null（预期状态，非异常），
    // 这里只跳过该容器的打印任务、不中断收货；后续可通过整单/明细补打把标签补上。
    // 若打印任务写入本身出错（如 DB 异常），enqueueContainerLabelJob 内部会直接抛错，
    // 仍然会正确回滚整个收货事务。
    let noPrinterCount = 0
    for (const container of containers) {
      const job = await enqueueContainerLabelJob({
        conn,
        type: 'container_label',
        containerId: container.containerId,
        warehouseId,
        data: {
          container_code: container.containerCode,
          product_name: productName,
          qty: container.qty,
        },
        createdBy: userId ?? null,
        jobUniqueKey: `inbound_receive:${taskId}:container:${container.containerId}`,
      })
      if (!job?.id) {
        noPrinterCount += 1
        continue
      }
      result.printJobIds.push(Number(job.id))
    }
    result.printJobId = result.printJobIds[0] ?? null
    result.noPrinterCount = noPrinterCount
    if (result.printJobIds.length > 0) {
      await appendInboundEvent(
        conn,
        taskId,
        'print_queued',
        '打印提交',
        `${productName} 已提交 ${result.printJobIds.length} 条库存条码打印任务`,
        { userId, realName: null },
        {
          printJobIds: result.printJobIds,
          containerCodes: containers.map(item => item.containerCode),
        },
      )
    }
    if (noPrinterCount > 0) {
      await appendInboundEvent(
        conn,
        taskId,
        'print_skipped_no_printer',
        '暂无可用打印机',
        `${productName} 有 ${noPrinterCount} 个容器暂未生成打印任务（无可用标签打印机），收货已正常记录，可稍后整单/明细补打`,
        { userId, realName: null },
        { noPrinterCount },
      )
    }
    await completeOperationRequest(conn, requestState, {
      data: result,
      message: '收货成功',
      resourceType: 'inbound_task',
      resourceId: taskId,
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

async function reprint(taskId, { mode = 'task', itemId = null, barcode = null } = {}, operator = null) {
  const normalizedMode = String(mode || 'task').trim().toLowerCase()
  if (!['task', 'item', 'barcode'].includes(normalizedMode)) throw new AppError('补打模式无效', 400)
  const reprintBucket = Math.floor(Date.now() / 10000)

  const conn = await pool.getConnection()
  try {
    const taskRow = await ensureInboundTaskExists(conn, taskId)

    let containers = []
    let title = '发起补打'
    let description = ''
    let payload = null

    if (normalizedMode === 'task') {
      const [rows] = await conn.query(
        `SELECT id, barcode, remaining_qty, warehouse_id, product_name
         FROM inventory_containers
         WHERE inbound_task_id = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         ORDER BY id ASC`,
        [taskId],
      )
      containers = rows
      title = '整单补打'
      description = `收货订单 ${taskRow.task_no} 发起整单补打`
      payload = { mode: 'task' }
    } else if (normalizedMode === 'item') {
      const [[item]] = await conn.query(
        `SELECT id, product_id, product_name
         FROM inbound_task_items
         WHERE id = ? AND task_id = ?`,
        [itemId, taskId],
      )
      if (!item) throw new AppError('收货明细不存在', 404)
      const [rows] = await conn.query(
        `SELECT id, barcode, remaining_qty, warehouse_id, product_name
         FROM inventory_containers
         WHERE inbound_task_id = ? AND product_id = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         ORDER BY id ASC`,
        [taskId, item.product_id],
      )
      containers = rows
      title = '明细补打'
      description = `收货订单 ${taskRow.task_no} 对商品 ${item.product_name} 发起补打`
      payload = { mode: 'item', itemId: Number(item.id), productId: Number(item.product_id) }
    } else {
      const code = String(barcode || '').trim()
      if (!code) throw new AppError('库存条码不能为空', 400)
      const [rows] = await conn.query(
        `SELECT id, barcode, remaining_qty, warehouse_id, product_name
         FROM inventory_containers
         WHERE inbound_task_id = ? AND barcode = ? AND deleted_at IS NULL AND (is_legacy = 0 OR is_legacy IS NULL)
         LIMIT 1`,
        [taskId, code],
      )
      containers = rows
      title = '条码补打'
      description = `收货订单 ${taskRow.task_no} 对库存条码 ${code} 发起补打`
      payload = { mode: 'barcode', barcode: code }
    }

    if (!containers.length) throw new AppError('没有可补打的库存条码', 400)

    const jobs = []
    for (const container of containers) {
      const job = await enqueueContainerLabelJob({
        containerId: Number(container.id),
        warehouseId: container.warehouse_id != null ? Number(container.warehouse_id) : null,
        data: {
          container_code: container.barcode,
          product_name: container.product_name,
          qty: container.remaining_qty,
        },
        createdBy: operator?.userId ?? null,
        jobUniqueKey: `reprint_inbound:${taskId}:${normalizedMode}:${container.id}:${reprintBucket}`,
      })
      if (job) jobs.push(job)
    }

    await appendInboundEvent(
      pool,
      taskId,
      'print_requeued',
      title,
      `${description}，共 ${jobs.length} 条`,
      operator,
      { ...payload, jobIds: jobs.map(job => Number(job.id)) },
    )
    return {
      taskId: Number(taskId),
      mode: normalizedMode,
      count: jobs.length,
      jobIds: jobs.map(job => Number(job.id)),
      barcodes: containers.map(item => item.barcode),
    }
  } finally {
    conn.release()
  }
}

async function cancel(taskId, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, { table: 'inbound_tasks', id: taskId, entityName: '收货订单' })
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')
    assertTaskCanCancel(taskRow)
    const [[{ n }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM inventory_containers WHERE inbound_task_id = ? AND deleted_at IS NULL',
      [taskId],
    )
    if (Number(n) > 0) throw new AppError('任务已产生容器，无法取消', 400)
    const cancelRule = assertStatusAction('inboundTask', 'cancel', taskRow.status)
    await compareAndSetStatus(conn, {
      table: 'inbound_tasks',
      id: taskId,
      fromStatus: cancelRule.from,
      toStatus: cancelRule.to,
      entityName: '收货订单',
    })
    await appendInboundEvent(
      conn,
      taskId,
      'cancelled',
      '取消收货订单',
      `收货订单 ${taskRow.task_no} 已取消`,
      null,
      null,
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

// 短装结案第一步：把「收货中(2)」的收货订单手动推进到「待上架(3)」，剩余未收量作罢。
// 状态机层面 receiveComplete 本来就允许 2→3（正常路径是收满后自动触发），这里只是补一个
// 手动强推入口——否则短装后任务会永久卡在收货中，且连带堵死 purchase.closeRemaining（它要求
// 关联收货订单要么已取消要么已全部上架完成，见 purchase.service.js:227-231）。
async function closeReceiving(taskId, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, {
      table: 'inbound_tasks', id: taskId,
      columns: 'id, task_no, status, warehouse_id',
      entityName: '收货订单',
    })
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')
    if (Number(taskRow.status) !== 2) {
      throw new AppError('只有"收货中"状态才能提前结束收货', 409)
    }
    const [[{ receivedTotal }]] = await conn.query(
      'SELECT COALESCE(SUM(received_qty),0) AS receivedTotal FROM inbound_task_items WHERE task_id=?',
      [taskId],
    )
    if (Number(receivedTotal) <= 0) {
      throw new AppError('尚无任何实收数量，不能结束收货（如需终止请改用取消）', 409)
    }
    const rule = assertStatusAction('inboundTask', 'receiveComplete', taskRow.status)
    await compareAndSetStatus(conn, {
      table: 'inbound_tasks',
      id: taskId,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '收货订单',
      extraSet: { closed_reason: 'short_close' },
    })
    await appendInboundEvent(
      conn,
      taskId,
      'receiving_closed',
      '提前结束收货',
      `收货订单 ${taskRow.task_no} 已提前结束收货，剩余未收量作罢，进入待上架`,
      operator ? { userId: operator.userId, realName: operator.realName } : null,
      null,
    )
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = {
  createFromPoId,
  createManualTask,
  submit,
  receive,
  reprint,
  cancel,
  closeReceiving,
}
