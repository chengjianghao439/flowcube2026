const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { createContainer, CONTAINER_STATUS, SOURCE_TYPE } = require('../../engine/containerEngine')
const { lockStatusRow } = require('../../utils/statusTransition')
const { beginOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { appendInboundEvent } = require('./inbound-tasks.helpers')
const { assertInScope } = require('../../utils/warehouseScope')

const PENDING_QA = CONTAINER_STATUS.PENDING_QA            // 5 待质检
const PENDING_PUTAWAY = CONTAINER_STATUS.PENDING_PUTAWAY  // 4 待上架
const REJECTED = CONTAINER_STATUS.REJECTED               // 6 不合格

function fmtSqlDate(d) {
  if (!d) return null
  if (d instanceof Date) return d.toISOString().slice(0, 10)
  return String(d).slice(0, 10)
}

/**
 * 来料质检容器分流（文档 07）。照搬 return-tasks.allocateQaContainers，两点差异：
 *  ① 来源改为 INBOUND_TASK / 'inbound_task'，并继承 inbound_task_item_id 归属（混单结算按行）；
 *  ② 跨界拆分时**同步更新原容器 initial_qty = passTake**（return 版只改 remaining_qty）——否则合格部分
 *     上架成 ACTIVE 后 remaining(60)≠initial(100)，会被 voidReceipt 的「remaining≠initial 视为被动过」闸门误拦。
 * 把本任务某商品的 PENDING_QA 容器 FIFO 分流为 合格→PENDING_PUTAWAY / 不合格→REJECTED。
 */
async function allocateInboundQaContainers(conn, { taskId, taskNo, productId, passedQty, rejectedQty }) {
  let passRemaining = Number(passedQty)
  let rejRemaining = Number(rejectedQty)
  if (passRemaining <= 0 && rejRemaining <= 0) return

  const [containers] = await conn.query(
    `SELECT id, barcode, product_id, warehouse_id, location_id, unit, batch_no, mfg_date, exp_date, remaining_qty, inbound_task_item_id
     FROM inventory_containers
     WHERE inbound_task_id = ? AND source_ref_type = 'inbound_task' AND status = ? AND product_id = ?
     ORDER BY id FOR UPDATE`,
    [taskId, PENDING_QA, productId],
  )
  for (const c of containers) {
    if (passRemaining <= 0 && rejRemaining <= 0) break
    const rem = Number(c.remaining_qty)
    if (rem <= 0) continue
    const passTake = Math.min(passRemaining, rem)
    const rejTake = Math.min(rejRemaining, rem - passTake)

    if (passTake > 0 && rejTake > 0) {
      await conn.query(
        'UPDATE inventory_containers SET remaining_qty = ?, initial_qty = ?, status = ? WHERE id = ?',
        [passTake, passTake, PENDING_PUTAWAY, c.id],
      )
      await createContainer(conn, {
        productId: c.product_id,
        warehouseId: c.warehouse_id,
        initialQty: rejTake,
        unit: c.unit,
        batchNo: c.batch_no,
        mfgDate: fmtSqlDate(c.mfg_date),
        expDate: fmtSqlDate(c.exp_date),
        inboundTaskId: taskId,
        inboundTaskItemId: c.inbound_task_item_id,
        sourceType: SOURCE_TYPE.INBOUND_TASK,
        sourceRefType: 'inbound_task',
        sourceRefId: taskId,
        sourceRefNo: taskNo,
        containerStatus: REJECTED,
        barcodePrefix: 'I',
        remark: `来料质检不合格，自 ${c.barcode} 拆分`,
      })
    } else if (passTake > 0) {
      await conn.query('UPDATE inventory_containers SET status = ? WHERE id = ?', [PENDING_PUTAWAY, c.id])
    } else if (rejTake > 0) {
      await conn.query('UPDATE inventory_containers SET status = ? WHERE id = ?', [REJECTED, c.id])
    }
    passRemaining -= passTake
    rejRemaining -= rejTake
  }
  if (passRemaining > 0 || rejRemaining > 0) throw new AppError('质检数量超出待质检容器可用数量', 409)
}

/**
 * PDA 采购收货质检（文档 07 · 方案A）。自管事务（与 receive/putaway 同款）。
 * 三种处置：合格放行 / 让步接收 / 拒收。合格放行与让步接收都计入 passedQty→上架→结算（口径一字不改），
 * 让步量另记入旁路 concession_qty（合格量的子集，concession≤passed，只作质量统计，文档07 §11）；
 * 拒收（rejectedQty→REJECTED，不入库不结算）。
 * 只改容器状态与明细 checked/rejected/concession 量，绝不碰 inventory_stock / avg_cost（合格量真正进缓存仍在上架时）。
 */
async function check(taskId, { productId, passedQty, rejectedQty = 0, concessionQty = 0, reason = null, requestKey, userId, pdaWarehouseId = null, scopeWarehouseIds = null } = {}) {
  const productIdN = Number(productId)
  const passed = Number(passedQty) || 0
  const rejected = Number(rejectedQty) || 0
  // 让步接收量：合格量(passed)的子集，只作质量统计（旁路 concession_qty），不改主数量流/结算（文档07 §11）。
  const concession = Number(concessionQty) || 0
  if (!Number.isFinite(productIdN) || productIdN <= 0) throw new AppError('请选择有效商品', 400)
  if (passed < 0 || rejected < 0 || concession < 0) throw new AppError('质检数量不能为负', 400)
  if (passed <= 0 && rejected <= 0) throw new AppError('质检数量必须大于 0', 400)
  if (concession > passed) throw new AppError('让步接收量不能超过合格量', 400)

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const requestState = await beginOperationRequest(conn, { requestKey, action: 'inbound.qa.check', userId: userId || null })
    if (requestState.replay) { await conn.rollback(); return requestState.responseData }

    const taskRow = await lockStatusRow(conn, {
      table: 'inbound_tasks', id: taskId,
      columns: 'id, task_no, status, warehouse_id, qa_status',
      entityName: '收货订单',
    })
    // 设备级跨仓拦截（同 receive）+ 用户级仓库权限兜底
    if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(taskRow.warehouse_id)) {
      throw new AppError('当前设备绑定仓库与该收货订单所属仓库不一致，无法质检', 403)
    }
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')
    // 质检在「待上架(3)」阶段先行（收货完成后、上架前）
    if (Number(taskRow.status) !== 3) throw new AppError('只有待上架状态的收货订单可以质检', 400)

    // FIFO 记入 checked_qty / rejected_qty（仅质检行，cap = received − checked）
    const [items] = await conn.query(
      'SELECT * FROM inbound_task_items WHERE task_id = ? AND product_id = ? AND qa_required = 1 ORDER BY id FOR UPDATE',
      [taskId, productIdN],
    )
    if (!items.length) throw new AppError('该商品无需质检或不在本任务中', 400)
    let remaining = passed + rejected
    let rejRemaining = rejected
    let concRemaining = concession   // 让步接收量在合格(passTake=take−rejTake)部分内按 FIFO 分摊
    for (const item of items) {
      if (remaining <= 0) break
      const cap = Number(item.received_qty) - Number(item.checked_qty)
      if (cap <= 0) continue
      const take = Math.min(remaining, cap)
      const rejTake = Math.min(rejRemaining, take)
      const concTake = Math.min(concRemaining, take - rejTake)   // 让步只落在合格量内，concession≤passed 保证全额落位
      await conn.query(
        'UPDATE inbound_task_items SET checked_qty = checked_qty + ?, rejected_qty = rejected_qty + ?, concession_qty = concession_qty + ? WHERE id = ?',
        [take, rejTake, concTake, item.id],
      )
      remaining -= take
      rejRemaining -= rejTake
      concRemaining -= concTake
    }
    if (remaining > 0) throw new AppError('质检数量超出已收货未质检数量', 409)

    // 容器分流：合格→PENDING_PUTAWAY / 不合格→REJECTED
    await allocateInboundQaContainers(conn, { taskId, taskNo: taskRow.task_no, productId: productIdN, passedQty: passed, rejectedQty: rejected })

    // 全部质检完（任务再无 PENDING_QA 容器）→ qa_status=2
    const [[{ n: qaLeft }]] = await conn.query(
      'SELECT COUNT(*) AS n FROM inventory_containers WHERE inbound_task_id = ? AND status = ? AND deleted_at IS NULL',
      [taskId, PENDING_QA],
    )
    const doneAll = Number(qaLeft) === 0
    if (doneAll) await conn.query('UPDATE inbound_tasks SET qa_status = 2 WHERE id = ?', [taskId])

    await appendInboundEvent(
      conn, taskId, 'qa_checked', '来料质检',
      `质检确认：合格${passed}${concession > 0 ? `（其中让步${concession}）` : ''}、拒收${rejected}${reason ? `（原因：${reason}）` : ''}`,
      { userId, realName: null },
      { productId: productIdN, passed, rejected, concession, reason: reason || null, allDone: doneAll },
    )

    const payload = { taskId, passed, rejected, concession, qaStatus: doneAll ? 2 : 1 }
    if (requestState.enabled) {
      await completeOperationRequest(conn, requestState, {
        data: payload, message: `质检确认 合格${passed} 拒收${rejected}`,
        resourceType: 'inbound_task', resourceId: taskId,
      })
    }
    await conn.commit()
    return payload
  } catch (e) { await conn.rollback(); throw e } finally { conn.release() }
}

module.exports = { check, allocateInboundQaContainers }
