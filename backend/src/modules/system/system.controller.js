const AppError = require('../../utils/AppError')
const { successResponse } = require('../../utils/response')
const { getScopedOperationRequestStatus } = require('../../utils/operationRequest')
const { assertPrintLabelReceiptConsistent } = require('../packages/packages.receipt-guard')
const logger = require('../../utils/logger')

/**
 * 查询一次关键操作的提交回执。
 *
 * PDA 的关键动作（收货/上架/拣货/复核/打包/出库/调拨/退货）在提交前会先写一条
 * operation_requests 记录，网络中断导致「提交出去了但没收到响应」时，前端靠这个接口
 * 回来问服务端「我那次到底成没成」，而不是让员工凭经验决定要不要重扫。
 *
 * 只能查自己的回执：底层按 (request_key, action, user_id) 三元组匹配，
 * user_id 取自 JWT，不接受调用方传入，因此不存在越权查他人操作结果的路径。
 *
 * 2026-09-18 审计 P2[6]：资源级幂等的 action 已落库为 `<base>.<单据ID>`，而客户端
 * （尤其老版本 PDA）保存/上报的仍是固定 action，因此这里走通用作用域解析——先精确匹配，
 * 再用 `action = <base> OR action LIKE '<base>.%'` 兜底，恰好一条才回执。调拨原先的专用
 * 分支已被该通用实现完全覆盖（同样的 exact→legacy 顺序、同样的「同键多单保持待核实」、
 * 同样的回执行归属校验），故不再单独调用，避免两套逻辑漂移。
 */
const requestStatus = async (req, res, next) => {
  try {
    if (String(req.query.action ?? '').startsWith('purchase.requisition.')) throw new AppError('采购申请功能已移除', 410)
    const receiptContext = { requestedAction: req.query.action, requestedWarehouseId: req.query.warehouseId, requestedFingerprint: req.query.requestFingerprint, requestedKey: req.params.key, requestedUserId: req.user?.userId ?? null }
    await require('../inbound-tasks/inbound-tasks.create-receipt').ensureInboundCreateReceiptView(req, res, receiptContext)
    await require('../inbound-tasks/inbound-tasks.edit-receipt').ensureInboundEditReceiptView(req, res, receiptContext)
    await require('../print-jobs/print-jobs.reprint-intent').ensureReprintReceiptPermission(req, res, receiptContext)
    const data = await getScopedOperationRequestStatus({
      requestKey: req.params.key,
      action: req.query.action,
      userId: req.user?.userId ?? null,
      receiptContext,
    })
    if ([receiptContext.requestedAction, receiptContext.matchedAction].some(action => /^purchase\.closeRemaining(?:\.[1-9]\d*)?$/.test(String(action ?? '')))) {
      await require('../purchase/purchase.close-receipt').assertPurchaseCloseReceipt(require('../../config/db').pool, data, req.user?.warehouseIds, receiptContext)
    }
    if ([receiptContext.requestedAction, receiptContext.matchedAction].some(action => /^inbound\.closeReceiving(?:\.[1-9]\d*)?$/.test(String(action ?? '')))) {
      await require('../inbound-tasks/inbound-tasks.short-receipt').assertCloseReceivingReceipt(require('../../config/db').pool, data, req.user?.warehouseIds, receiptContext)
    }
    // 本人采购创建结果也须按实际命中动作核当前原采购仓；宽查询不能绕过。
    if (/^purchase\.create(?:\.[a-f0-9]{16})?$/.test(String(receiptContext.matchedAction ?? ''))) {
      await require('../purchase/purchase.create-receipt').assertPurchaseCreateReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    }
    if (/^procurement\.plan\.convert(?:\.[1-9]\d*)?$/.test(String(receiptContext.matchedAction ?? ''))) {
      await require('../procurement/procurement.convert-receipt').assertConvertReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    }
    if (String(receiptContext.matchedAction ?? '').startsWith('purchase.requisition.')) throw new AppError('采购申请功能已移除', 410)
    if (/^refund\.execute(?:\.[1-9]\d*)?$/.test(String(receiptContext.matchedAction ?? ''))) {
      await require('../refunds/refund-orders.scope').assertRefundReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    }
    await require('./system.split-device').ensureSplitReceiptDevice(req, res, receiptContext.matchedAction)
    await require('../inventory/inventory.split-receipt').assertSplitReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, { ...receiptContext, isPda: Boolean(req.pda), pdaWarehouseId: req.pda?.warehouseId ?? null })
    if ([receiptContext.requestedAction, receiptContext.matchedAction].some(action => /^plastic_box\.(fill|repack)(?:\.[1-9]\d*)?$/.test(String(action ?? '')))) {
      await require('../plastic-boxes/plastic-boxes.receipt').assertPlasticBoxReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, { ...receiptContext, isPda: Boolean(req.pda), pdaWarehouseId: req.pda?.warehouseId ?? null })
    }
    // 宽prefix在实际命中收货域后也补当前VIEW，不能借其它领域query绕过。
    await require('../inbound-tasks/inbound-tasks.create-receipt').ensureInboundCreateReceiptView(req, res, receiptContext)
    await require('../inbound-tasks/inbound-tasks.edit-receipt').ensureInboundEditReceiptView(req, res, receiptContext)
    await require('../inbound-tasks/inbound-tasks.create-receipt').assertInboundCreateReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    await require('../inbound-tasks/inbound-tasks.edit-receipt').assertInboundEditReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    await require('../sale/sale.commercial-receipts').assertReceiptScope(require('../../config/db').pool,data,req.user?.warehouseIds ?? null,receiptContext)
    if (/^sale\.(reserve|release|ship):/.test(String(receiptContext.matchedAction ?? ''))) {
      await require('../sale/sale.ordinary-receipt').assertOrdinarySaleReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    }
    if ([receiptContext.requestedAction, receiptContext.matchedAction].some(action => String(action ?? '').startsWith('disposal.dispose'))) {
      await require('../disposal/disposal.receipt').assertDisposalReceipt(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    }
    // 箱贴回执的**领域自洽校验**（纯函数，只读）：修复「同 requestKey 跨箱」之前落库的成功回执
    // 可能是「B 箱的资源 id + A 箱的 job」。前端恢复正是靠这个查询入口，一看到 success 就会清掉
    // 待确认记录并当作本次成功，之后再无校验点 —— 所以这里必须与写重放用同一把闸。
    // 不改 operationRequest 的查询匹配语义，也不改写历史行；不一致时 409 要求人工核对。
    assertPrintLabelReceiptConsistent(req.query.action, data)
    await require('../print-jobs/print-jobs.reprint-intent').ensureReprintReceiptPermission(req, res, receiptContext)
    await require('../print-jobs/print-jobs.reprint-intent').assertReprintReceiptScope(require('../../config/db').pool, data, req.user?.warehouseIds ?? null, receiptContext)
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
}

/**
 * 前端错误上报（P2-12 错误追踪）：GlobalErrorBoundary 捕获 render 错误时调用。
 * 用 logger.error 记录 → 配置了 LOKI_URL 时自动进 Loki（与后端错误同一检索源）。
 * 只记一条 warn 级日志，绝不抛错影响响应。
 *
 * 加固（2026-08-22）：url 剥查询串（防 query 里的敏感参数进日志）；stack 截断+脱敏字符。
 */
const reportError = async (req, res, next) => {
  try {
    const { message, stack, componentStack, url } = req.body || {}
    const safeUrl = String(url || '').split('?')[0].slice(0, 500)
    const sanitize = s => String(s || '').replace(/[^\x20-\x7E一-龥]/g, '?').slice(0, 2000)
    logger.error('[frontend-error] ' + String(message || '未知前端错误').slice(0, 500),
      { url: safeUrl, stack: sanitize(stack), componentStack: sanitize(componentStack) },
      { module: 'frontend' },
    )
    return successResponse(res, null, '已记录')
  } catch (e) { next(e) }
}

module.exports = { requestStatus, reportError }
