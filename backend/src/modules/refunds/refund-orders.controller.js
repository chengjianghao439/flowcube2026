const svc = require('./refund-orders.service')
const { successResponse } = require('../../utils/response')
const { getOperatorFromRequest } = require('../../utils/operator')
const { extractRequestKey } = require('../../utils/requestKey')
const { resolveBackfillRequest } = require('../accounting/finance-period.guard')

async function list(req, res, next) {
  try {
    const q = req.query || {}
    const result = await svc.findAll({
      page: +q.page || 1,
      pageSize: +q.pageSize || 20,
      keyword: q.keyword || '',
      status: q.status ? +q.status : null,
      startDate: q.startDate || null,
      endDate: q.endDate || null,
      scopeWarehouseIds: req.user?.warehouseIds ?? null,
    })
    return successResponse(res, result, '查询成功')
  } catch (e) { next(e) }
}

async function detail(req, res, next) {
  try {
    return successResponse(res, await svc.findById(+req.params.id, req.user?.warehouseIds ?? null), '查询成功')
  } catch (e) { next(e) }
}

async function create(req, res, next) {
  try {
    const result = await svc.create(req.body || {}, getOperatorFromRequest(req), req.user?.warehouseIds ?? null)
    return successResponse(res, result, '退款单已创建')
  } catch (e) { next(e) }
}

async function submit(req, res, next) {
  try {
    await svc.submit(+req.params.id, getOperatorFromRequest(req), req.user?.warehouseIds ?? null)
    return successResponse(res, null, '退款单已确认')
  } catch (e) { next(e) }
}

async function execute(req, res, next) {
  try {
    // 跨期补录**申请**（2026-09-26 一致性审查 · 任务 7）：权限与原因长度在这里校验；
    // 「期间是否真的已结账」由 service 判断（它才知道业务日期取 refund_date）。
    // service 返回 backfillApplication 时业务数据一行未写、只落了一张待审批申请单，
    // 必须回 **202**——这不是「退款完成」，是「已提交待审批」。
    const r = resolveBackfillRequest(req)
    const result = await svc.execute(+req.params.id, getOperatorFromRequest(req), req.user?.warehouseIds ?? null, extractRequestKey(req), {
      backfill: r ? { mode: 'apply', ...r } : null,
    })
    return result?.backfillApplication
      ? successResponse(res, result.backfillApplication, '已提交跨期补录申请，审批通过后才会记账', 202)
      : successResponse(res, result, '退款已完成')
  } catch (e) { next(e) }
}

async function cancel(req, res, next) {
  try {
    await svc.cancel(+req.params.id, req.user?.warehouseIds ?? null)
    return successResponse(res, null, '退款单已取消')
  } catch (e) { next(e) }
}

module.exports = { list, detail, create, submit, execute, cancel }
