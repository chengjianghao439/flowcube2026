const svc = require('./logistics.service')
const freight = require('./logistics.freight')
const { successResponse } = require('../../utils/response')

const scope = req => req.user?.warehouseIds ?? null

// ─── 运单 ─────────────────────────────────────────────────────────────────────
const list = async (req, res, next) => {
  try {
    return successResponse(res, await svc.listWaybills({
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
      keyword: req.query.keyword || '',
      status: req.query.status ?? null,
      startDate: req.query.startDate || '',
      endDate: req.query.endDate || '',
      carrierId: req.query.carrierId ? Number(req.query.carrierId) : null,
      warehouseIds: scope(req),
    }))
  } catch (e) { next(e) }
}
const detail = async (req, res, next) => {
  try { return successResponse(res, await svc.getWaybillById(+req.params.id, { warehouseIds: scope(req) })) } catch (e) { next(e) }
}
const track = async (req, res, next) => {
  try { return successResponse(res, await svc.getTrackEvents(+req.params.id, { warehouseIds: scope(req) })) } catch (e) { next(e) }
}
const setTracking = async (req, res, next) => {
  try { return successResponse(res, await svc.manualSetTracking(+req.params.id, req.body, { warehouseIds: scope(req) }), '已录入快递单号') } catch (e) { next(e) }
}
const retry = async (req, res, next) => {
  try { return successResponse(res, await svc.retryFetch(+req.params.id, { warehouseIds: scope(req) }), '已重新提交取号') } catch (e) { next(e) }
}
const voidOne = async (req, res, next) => {
  try { return successResponse(res, await svc.voidWaybill(+req.params.id, { reason: req.body?.reason || null }, { warehouseIds: scope(req) }), '运单已作废') } catch (e) { next(e) }
}

// ─── 运费对账 ─────────────────────────────────────────────────────────────────
const listBills = async (req, res, next) => {
  try {
    return successResponse(res, await freight.listFreightBills({
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
      carrierId: req.query.carrierId || null,
      billPeriod: req.query.billPeriod || '',
      reconciled: req.query.reconciled ?? null,
    }))
  } catch (e) { next(e) }
}
const createBill = async (req, res, next) => {
  try { return successResponse(res, await freight.createFreightBill(req.body), '已录入运费账单', 201) } catch (e) { next(e) }
}
const listSettlements = async (req, res, next) => {
  try {
    return successResponse(res, await freight.listSettlements({
      page: +req.query.page || 1,
      pageSize: +req.query.pageSize || 20,
      carrierId: req.query.carrierId || null,
      billPeriod: req.query.billPeriod || '',
    }))
  } catch (e) { next(e) }
}
const generateSettlement = async (req, res, next) => {
  try {
    // 修正 2026-08-22：JWT payload 是 userId 而非 id，此前 createdBy 恒为 null（审计字段缺失）
    return successResponse(res, await freight.generateSettlement(req.body, { createdBy: req.user?.userId ?? null }), '已生成承运商应付')
  } catch (e) { next(e) }
}

module.exports = {
  list, detail, track, setTracking, retry, voidOne,
  listBills, createBill, listSettlements, generateSettlement,
}
