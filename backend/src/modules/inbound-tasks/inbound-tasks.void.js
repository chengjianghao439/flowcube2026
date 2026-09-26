const { commitFulfillment } = require('../fulfillment/fulfillment.refresh')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { CONTAINER_STATUS, syncStockFromContainers, lockStockDimension, getStockProjection } = require('../../engine/containerEngine')
const { MOVE_TYPE, writeInventoryLog } = require('../../engine/inventoryEngine')
const { appendInboundEvent, assertPurchaseOrdersOpen } = require('./inbound-tasks.helpers')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const { assertInScope } = require('../../utils/warehouseScope')
const { assertStatusAction } = require('../../constants/documentStatusRules')
const { recomputePurchasePayable } = require('./inbound-tasks.settle')
const { findById } = require('./inbound-tasks.query')

/**
 * 撤回收货：把已收货（含已上架、已完成自动结算）的收货订单整单打回「待收货(1)」，
 * 反冲已上架容器造成的库存与已自动结算的应付，允许现场重新收货。
 *
 * 安全边界：只要该任务名下任何一个容器的 remaining_qty 与 initial_qty 不一致
 * （说明已经被后续拣货/拆分/调拨等动作动过），整单拒绝撤回——这些容器已经不是
 * "收货这件事本身"能单方面撤销的了，须走盘点处理实际差异。
 */
async function voidReceipt(taskId, operator, scopeWarehouseIds = null) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const taskRow = await lockStatusRow(conn, {
      table: 'inbound_tasks',
      id: taskId,
      columns: 'id, task_no, status, audit_status, warehouse_id',
      entityName: '收货订单',
    })
    assertInScope(scopeWarehouseIds, taskRow.warehouse_id, '收货订单')
    const rule = assertStatusAction('inboundTask', 'voidReceipt', Number(taskRow.status))
    await assertPurchaseOrdersOpen(conn, taskId, '撤回收货')

    // 已登记付款的收货单不得撤回（2026-09-26 一致性审查 · 任务 2 层 2）。
    // 本函数末尾会调 recomputePurchasePayable 按「剩余收货」全量重算该采购单应付（此处归零），
    // 但已登记的付款（payment_records.paid_amount 与 payment_entries 资金流水）不会回滚：
    // 账面会留下「已付 ¥X、应付 ¥0」的无主差额，而这笔钱在系统里没有任何撤销付款登记的入口，
    // 一旦放过就再也对不平。故在动容器之前显式拒绝，并指向真实可用的替代路径。
    // 只拦 paid_amount > 0：仅财务已确认(confirm_status>0)而尚未付款的，重算会自动打回待确认
    // （见 inbound-tasks.settle.js 的 confirm_status CASE），那是既有的、可恢复的设计，
    // 拦下来反而会锁死——因为同样没有「取消确认」的入口。
    const [paidRows] = await conn.query(
      `SELECT DISTINCT pr.order_no, pr.paid_amount
         FROM inbound_task_items iti
         JOIN payment_records pr ON pr.type = 1 AND pr.order_id = iti.purchase_order_id
        WHERE iti.task_id = ? AND pr.paid_amount > 0`,
      [taskId],
    )
    if (paidRows.length) {
      const paidTotal = paidRows.reduce((sum, r) => sum + Number(r.paid_amount), 0)
      const detail = paidRows
        .map(r => `${r.order_no} 已付 ¥${Number(r.paid_amount).toFixed(2)}`)
        .join('、')
      throw new AppError(
        `该收货单对应的应付已登记付款（${detail}），不能撤回收货：`
        + '撤回会把应付金额反冲，已付出的钱在账面上将失去对应的应付，而付款登记无法撤销。'
        + '如确需把货退回供应商，请改用采购退货单（冲减应付，多付部分与供应商对账）。',
        409,
        'INBOUND_TASK_PAYABLE_PAID',
        {
          paidTotal,
          orders: paidRows.map(r => ({ orderNo: r.order_no, paidAmount: Number(r.paid_amount) })),
        },
      )
    }

    // 统一加锁顺序：先按 (product_id, warehouse_id) 升序对涉及维度取 inventory_stock 单行锁，
    // 再锁容器。撤回收货本质是「反向上架」（改容器状态后 syncStockFromContainers 汇总该维度
    // 全部 ACTIVE 容器），必须与 putaway 一样先取维度锁，否则两者对同一商品+仓库 ABBA 死锁
    // （void 持容器等汇总锁、putaway 持维度锁等容器锁）。见 containerEngine.lockStockDimension 注释。
    const [dimRows] = await conn.query(
      `SELECT DISTINCT product_id, warehouse_id
       FROM inventory_containers
       WHERE inbound_task_id = ? AND deleted_at IS NULL AND status IN (?, ?, ?)
       ORDER BY product_id ASC, warehouse_id ASC`,
      [taskId, CONTAINER_STATUS.ACTIVE, CONTAINER_STATUS.PENDING_PUTAWAY, CONTAINER_STATUS.EMPTY],
    )
    for (const d of dimRows) {
      await lockStockDimension(conn, d.product_id, d.warehouse_id)
    }

    const [containers] = await conn.query(
      `SELECT id, product_id, warehouse_id, remaining_qty, initial_qty, status, locked_by_task_id, transfer_order_id
       FROM inventory_containers
       WHERE inbound_task_id = ? AND deleted_at IS NULL AND status IN (?, ?, ?)
       FOR UPDATE`,
      [taskId, CONTAINER_STATUS.ACTIVE, CONTAINER_STATUS.PENDING_PUTAWAY, CONTAINER_STATUS.EMPTY],
    )
    // EMPTY 也纳入查询范围：已被后续销售/出库耗尽的容器同样属于"被后续动作碰过"，
    // 靠下面的 remaining_qty≠initial_qty 判断自然拦下，避免把已卖出的货当成从未收到过而误撤
    const locked = containers.filter(c => c.locked_by_task_id != null)
    if (locked.length) {
      throw new AppError(
        `存在 ${locked.length} 个库存条码正被其它仓库任务锁定拣货，无法撤回收货，请等待相关出库任务完成或取消后重试`,
        409,
      )
    }
    // 在途调拨必须单独拦截，不能只靠下面的数量比对：整箱调拨复用同一容器行
    // （transfer.service.js 的 scanOut 只改 warehouse_id / status / transfer_order_id），
    // remaining_qty 与 initial_qty 完全一致，locked_by_task_id 也为空——两道既有守卫
    // 全部放行。一旦被置 VOID：源仓已减、目的仓未入，货从账上静默消失且不留流水，
    // 调拨单还会因容器被作废而永久卡在「在途」（scanIn 校验 status=PENDING_PUTAWAY 失败）。
    // 2026-09-18 审计 P0-5 修复。
    const inTransit = containers.filter(c => c.transfer_order_id != null)
    if (inTransit.length) {
      throw new AppError(
        `存在 ${inTransit.length} 个库存条码正在调拨在途，无法撤回收货，请先在调拨单完成扫入或异常了结后重试`,
        409,
      )
    }
    const touched = containers.filter(c => Number(c.remaining_qty) !== Number(c.initial_qty))
    if (touched.length) {
      throw new AppError(
        `存在 ${touched.length} 个库存条码已被后续拣货/拆分/移动，无法整单撤回收货，请通过库存盘点处理实际差异`,
        409,
      )
    }

    // 上架已把预计绑定兑现为现货预占；撤收不得移除这些预占的实物支撑。
    // 操作员先释放相关销售预占，或准备足够的其它现货后才可撤回。
    for (const d of dimRows) {
      const removed = containers.filter(c => Number(c.status) === CONTAINER_STATUS.ACTIVE
        && Number(c.product_id) === Number(d.product_id) && Number(c.warehouse_id) === Number(d.warehouse_id))
        .reduce((sum, c) => sum + Number(c.remaining_qty), 0)
      if (removed <= 0) continue
      const projection = await getStockProjection(conn, { productId: d.product_id, warehouseId: d.warehouse_id, lock: true })
      const [[binding]] = await conn.query(
        `SELECT COALESCE(SUM(qty),0) AS qty FROM sale_order_expected_bindings
         WHERE product_id=? AND warehouse_id=? AND released_at IS NULL FOR UPDATE`,
        [d.product_id, d.warehouse_id],
      )
      const physicalReserved = Math.max(0, projection.reserved - Number(binding.qty))
      if (projection.quantity - removed + 1e-6 < physicalReserved) {
        throw new AppError('已上架库存正在支撑销售预占，请先释放相关销售预占后再撤回收货', 409)
      }
    }

    for (const c of containers) {
      const wasActive = Number(c.status) === CONTAINER_STATUS.ACTIVE
      let beforeQty = null
      if (wasActive) {
        const [[stockRow]] = await conn.query(
          'SELECT quantity FROM inventory_stock WHERE product_id = ? AND warehouse_id = ?',
          [c.product_id, c.warehouse_id],
        )
        beforeQty = Number(stockRow?.quantity || 0)
      }
      await conn.query(
        `UPDATE inventory_containers SET status = ?, remaining_qty = 0, location_id = NULL WHERE id = ?`,
        [CONTAINER_STATUS.VOID, c.id],
      )
      if (wasActive) {
        const afterQty = await syncStockFromContainers(conn, c.product_id, c.warehouse_id)
        await writeInventoryLog(conn, {
          moveType: MOVE_TYPE.RECEIPT_VOID,
          type: 3,
          productId: c.product_id,
          warehouseId: c.warehouse_id,
          quantity: Number(c.remaining_qty),
          beforeQty,
          afterQty,
          refType: 'inbound_task',
          refId: taskId,
          refNo: taskRow.task_no,
          containerId: c.id,
          remark: `撤回收货 ${taskRow.task_no} 容器#${c.id}`,
          operatorId: operator?.userId || null,
          operatorName: operator?.realName || null,
        })
      }
    }

    await conn.query(
      'UPDATE inbound_task_items SET received_qty = 0, putaway_qty = 0 WHERE task_id = ?',
      [taskId],
    )

    await compareAndSetStatus(conn, {
      table: 'inbound_tasks',
      id: taskId,
      fromStatus: rule.from,
      toStatus: rule.to,
      entityName: '收货订单',
      extraSet: {
        audit_status: 0,
        audited_at: null,
        audited_by: null,
        audited_by_name: null,
        closed_reason: null,
      },
    })
    // submitted_at 有意保留不重置：PDA 端只看 submitted_at 是否已设置就允许收货
    // （assertTaskCanReceive），不要求状态一定是 2；保留它可以让现场撤回后直接
    // 重新扫码收货，不用再回 ERP 点一次「提交到 PDA」。

    // 若该任务此前已把应付结算过（或部分结算），把涉及的采购单应付重新按剩余（此任务归零后）全量重算；
    // 若采购单因此不再满足全部收齐，且此前已被自动完成，需要退回「已提交(2)」，
    // 避免"已完成"的采购单底下还挂着一个被撤回重开的收货订单这种自相矛盾状态。
    const [poRows] = await conn.query(
      'SELECT DISTINCT purchase_order_id FROM inbound_task_items WHERE task_id = ?',
      [taskId],
    )
    for (const row of poRows) {
      const poId = Number(row.purchase_order_id)
      if (!Number.isFinite(poId) || poId <= 0) continue
      await recomputePurchasePayable(conn, poId)
      const [[po]] = await conn.query('SELECT status FROM purchase_orders WHERE id = ?', [poId])
      if (po && Number(po.status) === 3) {
        const reopenRule = assertStatusAction('purchase', 'reopen', Number(po.status))
        await compareAndSetStatus(conn, {
          table: 'purchase_orders',
          id: poId,
          fromStatus: reopenRule.from,
          toStatus: reopenRule.to,
          entityName: '采购单',
          extraSet: { closed_reason: null },
        })
      }
    }

    await appendInboundEvent(
      conn,
      taskId,
      'receipt_voided',
      '撤回收货',
      `收货订单 ${taskRow.task_no} 已整单撤回收货，恢复为待收货，可重新扫码收货`,
      operator,
      { containerCount: containers.length },
    )

    await commitFulfillment(conn, 'inbound', taskId)
    return findById(taskId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { voidReceipt }
