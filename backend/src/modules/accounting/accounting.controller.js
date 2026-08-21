/**
 * 会计核算 Controller（文档 10 · Phase 0）
 * 取参 → 调 service → successResponse，无 SQL、无业务规则。
 */
const svc = require('./accounting.service')
const voucherSvc = require('./accounting.voucher.service')
const ledgerSvc = require('./accounting.ledger.service')
const invoiceSvc = require('./accounting.invoice.service')
const periodSvc = require('./accounting.period.service')
const { exportVouchers } = require('./accounting.export')
const { successResponse } = require('../../utils/response')

// 多账套隔离（2026-08-21 审计高危修复）：companyScope 中间件挂载后 req.companyId
// 默认 1（主账套）。所有查询/写路径必须把 req.companyId 传入 service 做账套过滤。
const companyOf = (req) => req.companyId ?? 1

// ── 科目 ──────────────────────────────────────────────────────────────
const accountTree = async (req, res, next) => {
  try { return successResponse(res, await svc.getTree(companyOf(req)), '查询成功') } catch (e) { next(e) }
}
const accountFlat = async (req, res, next) => {
  try {
    return successResponse(res, await svc.getFlat({
      onlyLeaf:   req.query.onlyLeaf === '1' || req.query.onlyLeaf === 'true',
      onlyActive: req.query.onlyActive === '1' || req.query.onlyActive === 'true',
      companyId:  companyOf(req),
    }), '查询成功')
  } catch (e) { next(e) }
}
const accountDetail = async (req, res, next) => {
  try { return successResponse(res, await svc.getById(+req.params.id, companyOf(req)), '查询成功') } catch (e) { next(e) }
}
const accountCreate = async (req, res, next) => {
  try { return successResponse(res, await svc.create({ ...req.body, companyId: companyOf(req) }, req.user?.userId), '创建成功', 201) } catch (e) { next(e) }
}
const accountUpdate = async (req, res, next) => {
  try { await svc.update(+req.params.id, { ...req.body, companyId: companyOf(req) }, req.user?.userId); return successResponse(res, null, '更新成功') } catch (e) { next(e) }
}
const accountRemove = async (req, res, next) => {
  try { await svc.remove(+req.params.id, req.user?.userId, companyOf(req)); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}
const accountToggle = async (req, res, next) => {
  try { await svc.toggleStatus(+req.params.id, !!req.body.isActive, req.user?.userId, companyOf(req)); return successResponse(res, null, '更新成功') } catch (e) { next(e) }
}

// ── 凭证 ──────────────────────────────────────────────────────────────
const voucherList = async (req, res, next) => {
  try {
    const { list, pagination } = await voucherSvc.listVouchers({
      period: req.query.period, sourceType: req.query.sourceType, status: req.query.status,
      keyword: req.query.keyword, page: req.query.page, pageSize: req.query.pageSize,
      companyId: companyOf(req),
    })
    return successResponse(res, { list, pagination }, '查询成功')
  } catch (e) { next(e) }
}
const voucherDetail = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.getVoucher(+req.params.id, companyOf(req)), '查询成功') } catch (e) { next(e) }
}
const voucherGenerate = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.generatePeriodVouchers({ period: req.body?.period || null, userId: req.user?.userId, companyId: companyOf(req) }), '生成完成') } catch (e) { next(e) }
}
const voucherCreateManual = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.createManualVoucher({ ...req.body, companyId: companyOf(req) }, req.user?.userId), '创建成功', 201) } catch (e) { next(e) }
}
const voucherRemove = async (req, res, next) => {
  try { await voucherSvc.removeVoucher(+req.params.id, req.user?.userId, companyOf(req)); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}
const voucherReverse = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.reverseVoucher(+req.params.id, req.user?.userId, companyOf(req)), '冲销成功') } catch (e) { next(e) }
}
const voucherReconciliation = async (req, res, next) => {
  try { return successResponse(res, await voucherSvc.reconciliation(companyOf(req)), '查询成功') } catch (e) { next(e) }
}
const voucherExport = async (req, res, next) => {
  try {
    const { buffer, filename } = await exportVouchers({ period: req.query.period, format: req.query.format, companyId: companyOf(req) })
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`)
    return res.send(Buffer.from(buffer))
  } catch (e) { next(e) }
}

// ── 总账 / 报表（Phase 2） ────────────────────────────────────────────
const ledgerTrialBalance = async (req, res, next) => {
  try { return successResponse(res, await ledgerSvc.getTrialBalance({ period: req.query.period, companyId: companyOf(req) }), '查询成功') } catch (e) { next(e) }
}
const ledgerAccount = async (req, res, next) => {
  try { return successResponse(res, await ledgerSvc.getAccountLedger({ accountId: +req.params.accountId, period: req.query.period, companyId: companyOf(req) }), '查询成功') } catch (e) { next(e) }
}
const reportIncome = async (req, res, next) => {
  try { return successResponse(res, await ledgerSvc.getIncomeStatement({ period: req.query.period, companyId: companyOf(req) }), '查询成功') } catch (e) { next(e) }
}
const reportBalanceSheet = async (req, res, next) => {
  try { return successResponse(res, await ledgerSvc.getBalanceSheet({ period: req.query.period, companyId: companyOf(req) }), '查询成功') } catch (e) { next(e) }
}
const reportCashFlow = async (req, res, next) => {
  try { return successResponse(res, await ledgerSvc.getCashFlow({ period: req.query.period, companyId: companyOf(req) }), '查询成功') } catch (e) { next(e) }
}

// ── 发票（Phase 3） ───────────────────────────────────────────────────
const invoiceList = async (req, res, next) => {
  try {
    const { list, pagination } = await invoiceSvc.listInvoices({
      invoiceType: req.query.invoiceType, status: req.query.status, keyword: req.query.keyword,
      page: req.query.page, pageSize: req.query.pageSize,
    })
    return successResponse(res, { list, pagination }, '查询成功')
  } catch (e) { next(e) }
}
const invoiceDetail = async (req, res, next) => {
  try { return successResponse(res, await invoiceSvc.getInvoice(+req.params.id), '查询成功') } catch (e) { next(e) }
}
const invoiceCreate = async (req, res, next) => {
  try { return successResponse(res, await invoiceSvc.createInvoice(req.body, req.user), '创建成功', 201) } catch (e) { next(e) }
}
const invoiceUpdate = async (req, res, next) => {
  try { await invoiceSvc.updateInvoice(+req.params.id, req.body, req.user); return successResponse(res, null, '更新成功') } catch (e) { next(e) }
}
const invoiceStatus = async (req, res, next) => {
  try { return successResponse(res, await invoiceSvc.changeStatus(+req.params.id, req.body.action, req.user), '操作成功') } catch (e) { next(e) }
}
const invoiceRemove = async (req, res, next) => {
  try { await invoiceSvc.removeInvoice(+req.params.id, req.user); return successResponse(res, null, '删除成功') } catch (e) { next(e) }
}

// ── 期末结转 / 期间锁定 ───────────────────────────────────────────────
const periodList = async (req, res, next) => {
  try { return successResponse(res, await periodSvc.listPeriods(companyOf(req)), '查询成功') } catch (e) { next(e) }
}
const periodGenerateClosing = async (req, res, next) => {
  try { return successResponse(res, await periodSvc.generateClosingVouchers(req.body?.period, req.user?.userId, companyOf(req)), '结转凭证已生成') } catch (e) { next(e) }
}
const periodClose = async (req, res, next) => {
  try { return successResponse(res, await periodSvc.closePeriod(req.body?.period, req.user, companyOf(req)), '已结账') } catch (e) { next(e) }
}
const periodReopen = async (req, res, next) => {
  try { return successResponse(res, await periodSvc.reopenPeriod(req.body?.period, req.user, companyOf(req)), '已反结账') } catch (e) { next(e) }
}

// ── 账套管理（文档10 多账套） ──────────────────────────────────────────
const companiesSvc = require('./companies.service')
const companyList = async (req, res, next) => {
  try { return successResponse(res, await companiesSvc.listCompanies({ page: +req.query.page || 1, pageSize: +req.query.pageSize || 20, keyword: req.query.keyword || '' }), '查询成功') } catch (e) { next(e) }
}
const companyCreate = async (req, res, next) => {
  try { return successResponse(res, await companiesSvc.createCompany(req.body), '账套已创建并复制科目', 201) } catch (e) { next(e) }
}
const companyUpdate = async (req, res, next) => {
  try { return successResponse(res, await companiesSvc.updateCompany(+req.params.id, req.body), '已更新') } catch (e) { next(e) }
}

// ── 合并报表（文档10 多账套合并） ──────────────────────────────────────
const consolidationSvc = require('./consolidation.service')
const consolidationBalanceSheet = async (req, res, next) => {
  try { return successResponse(res, await consolidationSvc.getConsolidatedBalanceSheet({ groupId: +req.query.groupId || +req.query.companyId || 1, period: req.query.period }), '查询成功') } catch (e) { next(e) }
}
const consolidationIncome = async (req, res, next) => {
  try { return successResponse(res, await consolidationSvc.getConsolidatedIncomeStatement({ groupId: +req.query.groupId || +req.query.companyId || 1, period: req.query.period }), '查询成功') } catch (e) { next(e) }
}

// ── 替代报税数据（文档10 功能5） ──────────────────────────────────────
const taxSvc = require('./accounting.tax.service')
const taxVat = async (req, res, next) => {
  try { return successResponse(res, await taxSvc.getVatReport({ companyId: +req.query.companyId || 1, period: req.query.period }), '查询成功') } catch (e) { next(e) }
}
const taxIncome = async (req, res, next) => {
  try { return successResponse(res, await taxSvc.getIncomeTaxReport({ companyId: +req.query.companyId || 1, period: req.query.period, taxRate: req.query.taxRate ? +req.query.taxRate : undefined }), '查询成功') } catch (e) { next(e) }
}
const taxAdjustmentList = async (req, res, next) => {
  try { return successResponse(res, await taxSvc.listAdjustments({ companyId: +req.query.companyId || 1, period: req.query.period || '', taxType: req.query.taxType || '' }), '查询成功') } catch (e) { next(e) }
}
const taxAdjustmentUpsert = async (req, res, next) => {
  try { return successResponse(res, await taxSvc.upsertAdjustment({ ...req.body, companyId: +req.body.companyId || 1 }, req.user?.userId), '已保存') } catch (e) { next(e) }
}
const taxAdjustmentRemove = async (req, res, next) => {
  try { return successResponse(res, await taxSvc.removeAdjustment(+req.params.id, +req.query.companyId || 1), '已删除') } catch (e) { next(e) }
}

module.exports = {
  accountTree, accountFlat, accountDetail, accountCreate, accountUpdate, accountRemove, accountToggle,
  voucherList, voucherDetail, voucherGenerate, voucherCreateManual, voucherRemove, voucherReverse,
  voucherReconciliation, voucherExport,
  ledgerTrialBalance, ledgerAccount, reportIncome, reportBalanceSheet, reportCashFlow,
  invoiceList, invoiceDetail, invoiceCreate, invoiceUpdate, invoiceStatus, invoiceRemove,
  periodList, periodGenerateClosing, periodClose, periodReopen,
  companyList, companyCreate, companyUpdate,
  consolidationBalanceSheet, consolidationIncome,
  taxVat, taxIncome, taxAdjustmentList, taxAdjustmentUpsert, taxAdjustmentRemove,
}
