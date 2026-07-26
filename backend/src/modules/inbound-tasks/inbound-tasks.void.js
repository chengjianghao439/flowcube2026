const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { CONTAINER_STATUS, syncStockFromContainers } = require('../../engine/containerEngine')
const { MOVE_TYPE } = require('../../engine/inventoryEngine')
const { appendInboundEvent } = require('./inbound-tasks.helpers')
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

    const [containers] = await conn.query(
      `SELECT id, product_id, warehouse_id, remaining_qty, initial_qty, status, locked_by_task_id
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
    const touched = containers.filter(c => Number(c.remaining_qty) !== Number(c.initial_qty))
    if (touched.length) {
      throw new AppError(
        `存在 ${touched.length} 个库存条码已被后续拣货/拆分/移动，无法整单撤回收货，请通过库存盘点处理实际差异`,
        409,
      )
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
        await conn.query(
          `INSERT INTO inventory_logs
             (move_type, type, product_id, warehouse_id, quantity, before_qty, after_qty,
              ref_type, ref_id, ref_no, container_id, remark, operator_id, operator_name)
           VALUES (?, 3, ?, ?, ?, ?, ?, 'inbound_task', ?, ?, ?, ?, ?, ?)`,
          [
            MOVE_TYPE.RECEIPT_VOID, c.product_id, c.warehouse_id,
            Number(c.remaining_qty), beforeQty, afterQty,
            taskId, taskRow.task_no, c.id,
            `撤回收货 ${taskRow.task_no} 容器#${c.id}`,
            operator?.userId || null, operator?.realName || null,
          ],
        )
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

    await conn.commit()
    return findById(taskId)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { voidReceipt }
