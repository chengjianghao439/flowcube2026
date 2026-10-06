const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { splitContainer, lockStockDimension } = require('../../engine/containerEngine')
const { beginResourceOperationRequest, completeOperationRequest } = require('../../utils/operationRequest')
const { enqueueContainerLabelJob } = require('../print-jobs/print-jobs.service')
const { assertSplitReceipt, requireSplitDeviceWarehouse } = require('./inventory.split-receipt')

/** 旧电脑无键兼容；PDA 必须稳定键。库存、标签任务、原结果回执同一事务。 */
async function splitContainerOp(containerId, { qty, remark, printLabel, targetContainerId, requestKey, userId, userName = null, isPda = false, pdaWarehouseId = null }, scopeWarehouseIds = null) {
  if (isPda && !String(requestKey || '').trim()) throw new AppError('拆分请求缺少原请求键，请重新提交前核对原操作', 400, 'REQUEST_KEY_REQUIRED')
  requireSplitDeviceWarehouse(isPda, pdaWarehouseId)
  const conn = await pool.getConnection()
  let requestState
  try {
    await conn.beginTransaction()
    const [[dim]] = await conn.query('SELECT product_id, warehouse_id FROM inventory_containers WHERE id=? AND deleted_at IS NULL', [containerId])
    if (!dim) throw new AppError('库存条码不存在', 404)
    assertInScope(scopeWarehouseIds, dim.warehouse_id, '库存容器')
    // 维度→容器，按锁后当前读核范围，避免等锁期间调拨改变仓库。
    await lockStockDimension(conn, dim.product_id, dim.warehouse_id)
    const [[source]] = await conn.query('SELECT id, barcode, product_id, warehouse_id, remaining_qty FROM inventory_containers WHERE id=? AND deleted_at IS NULL FOR UPDATE', [containerId])
    if (!source) throw new AppError('库存条码不存在', 404)
    if (Number(source.product_id) !== Number(dim.product_id) || Number(source.warehouse_id) !== Number(dim.warehouse_id)) throw new AppError('库存条码所属仓库已变，请重新扫码', 409)
    assertInScope(scopeWarehouseIds, source.warehouse_id, '库存容器')
    if (pdaWarehouseId != null && Number(pdaWarehouseId) !== Number(source.warehouse_id)) throw new AppError('该库存条码不属于当前PDA绑定仓库', 403)
    const state = await beginResourceOperationRequest(conn, { requestKey, action: 'inventory.container.split', userId, resourceType: 'inventory_container', resourceId: containerId })
    requestState = state
    if (state.replay) {
      await assertSplitReceipt(conn, { status: 'success', resourceType: 'inventory_container', resourceId: Number(containerId), data: state.responseData }, scopeWarehouseIds, { matchedAction: state.action || `inventory.container.split.${containerId}`, requestedAction: `inventory.container.split.${containerId}`, isPda, pdaWarehouseId, currentRead: true })
      await conn.commit()
      return state.responseData
    }
    // PDA 保留原部分拆分限制；电脑的合法全量不被此限制改写。
    if (isPda && Number(qty) >= Number(source.remaining_qty)) throw new AppError('拆分数量须小于剩余数量', 400)
    const result = await splitContainer(conn, { containerId, qty, remark, targetContainerId, operatorId: userId ?? null, operatorName: userName })
    Object.assign(result, { printJobId: null, printJobIds: [], noPrinterCount: 0, renderFailedCount: 0 })
    if (printLabel && !targetContainerId) {
      const [[row]] = await conn.query('SELECT c.barcode, c.remaining_qty, p.name AS product_name FROM inventory_containers c JOIN product_items p ON p.id=c.product_id WHERE c.id=?', [result.newContainerId])
      if (!row) throw new AppError('拆分后新库存条码不存在，无法创建标签打印任务', 500)
      const job = await enqueueContainerLabelJob({ conn, containerId: result.newContainerId, warehouseId: result.warehouseId, data: { container_code: row.barcode, product_name: row.product_name, qty: row.remaining_qty }, createdBy: userId ?? null, jobUniqueKey: `split_cnt_${result.newContainerId}` })
      if (!job?.id) throw new AppError(`库存条码 ${row.barcode} 的打印任务创建失败`, 500)
      if (job.unprintable) {
        if (/label render failed/.test(String(job.errorMessage || ''))) result.renderFailedCount = 1
        else result.noPrinterCount = 1
      } else {
        result.printJobId = Number(job.id)
        result.printJobIds.push(Number(job.id))
      }
    }
    await completeOperationRequest(conn, state, { data: result, message: '拆分成功', resourceType: 'inventory_container', resourceId: containerId })
    await conn.commit()
    return result
  } catch (error) {
    await conn.rollback()
    // 只证明本事务新建的请求已回滚；重复/待确认/重放冲突不能据此宣布原操作未执行。
    if (requestState?.enabled && requestState.id && !requestState.replay && error.isOperational && error.statusCode >= 400 && error.statusCode < 500) {
      error.data = { ...error.data, containerSplitNotExecuted: true }
    }
    throw error
  } finally { conn.release() }
}
module.exports = { splitContainerOp }
