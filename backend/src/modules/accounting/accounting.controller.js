/**
 * 会计核算 Controller（文档 10 · Phase 0）
 * 取参 → 调 service → successResponse，无 SQL、无业务规则。
 */
const svc = require('./accounting.service')
const voucherSvc = require('./accounting.voucher.service')
const { exportVouchers } = require('./accounting.export')
const { successResponse } = require('../../utils/response')

// ── 科目 ──────────────────────────────────────────────────────────────
const accountTree = async (req, res, next) => {
  try { return successResponse(res, await svc.getTree(), '查询成功') } catch (e) { next(e) }
}
const accountFlat = async (req, res, next) => {
  try {
    return successResponse(res, await svc.getFlat({
      onlyLeaf:   req.query.onlyLeaf === '1' || req.query.onlyLeaf === 'true',
      onlyActive: req.query.onlyActive === '1' || req.query.onlyActive === 'true',
    }), '查询成功')
  } catch (e) { next(e) }
}
const accountDetail = async (req, res, next) => {
  try { return successResponse(res, await svc.getById(+req.params.id), '查询成功') } catch (e) { next(e) }
}
const accountCreate = async (req, res, next) => {
  try { return successResponse(res, await svc.create(req.body, req.user?.userId), '创建成功', 201) } catch (e) { next(e) }
}
const accountUpdate = async (req, res, next) => {
  try { await svc.update(+req.params.id, req.body, req.user?.userId); return successResponse(res, null, '更新成功') } catch (e) { next(e) }
}
const accountRemove = async (req, res, next) => {
  try { await svc.remove(+req.params.id, req.user?.userId); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}
const accountToggle = async (req, res, next) => {
  try { await svc.toggleStatus(+req.params.id, !!req.body.isActive, req.user?.userId); return successResponse(res, null, '更新成功') } catch (e) { next(e) }
}

// ── 凭证 ──────────────────────────────────────────────────────────────
const voucherList = async (req, res, next) => {
  try {
    const { list, pagination } = await voucherSvc.listVouchers({
      period: req.query.period, sourceType: req.query.sourceType, status: req.query.status,
      keyword: req.query.keyword, page: req.query.page, pageSize: req.query.pageSize,
    })
    return successResponse(res, { list, pagination }, '查询成功')
  } catch (e) { next(e) }
}
const voucherDetail = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.getVoucher(+req.params.id), '查询成功') } catch (e) { next(e) }
}
const voucherGenerate = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.generatePeriodVouchers({ period: req.body?.period || null, userId: req.user?.userId }), '生成完成') } catch (e) { next(e) }
}
const voucherCreateManual = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.createManualVoucher(req.body, req.user?.userId), '创建成功', 201) } catch (e) { next(e) }
}
const voucherRemove = async (req, res, next) => {
  try { await voucherSvc.removeVoucher(+req.params.id, req.user?.userId); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}
const voucherReverse = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.reverseVoucher(+req.params.id, req.user?.userId), '冲销成功') } catch (e) { next(e) }
}
const voucherReconciliation = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.reconciliation(), '查询成功') } catch (e) { next(e) }
}
const voucherExport = async (req, res, next) => {
  try {
    const { buffer, filename } = await exportVouchers({ period: req.query.period, format: req.query.format })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return res.send(Buffer.from(buffer))
  } catch (e) { next(e) }
}

module.exports = {
  accountTree, accountFlat, accountDetail, accountCreate, accountUpdate, accountRemove, accountToggle,
  voucherList, voucherDetail, voucherGenerate, voucherCreateManual, voucherRemove, voucherReverse,
  voucherReconciliation, voucherExport,
}
