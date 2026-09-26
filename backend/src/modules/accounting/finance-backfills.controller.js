'use strict'

/**
 * 跨期补录审批 Controller（2026-09-26 一致性审查 · 任务 7 第二期）。
 * 取参 → 调 service → successResponse，无 SQL、无业务规则。
 *
 * 这一层只做两件 service 做不了的事（它拿不到 req）：
 *   1. 判断调用者**是否持审批权限**，据此决定「看全部还是只看自己提交的」、
 *      「能不能作废一张已批准的单子」；
 *   2. 传账套（companyId）。
 * 权限判定用 hasPermission 同一套超管豁免规则（roleId=1 硬编码放行），
 * 不在这里自己写一遍 `roleId === 1`，否则两处规则会漂移。
 */

const svc = require('./finance-backfills.service')
const { PERMISSIONS } = require('../../constants/permissions')
const { getOperatorFromRequest } = require('../../utils/operator')
const { successResponse } = require('../../utils/response')

const companyOf = (req) => req.companyId ?? 1

/** 是否持「跨期补录审批」权限（含超管豁免，与 middleware/auth.hasPermission 同规则） */
const canApproveOf = (req) => Number(req.user?.roleId) === 1
  || (req.user?.permissions ?? []).includes(PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE)

/**
 * 列表/详情的可见范围：持审批权限者看全部（审批页要有完整队列）；
 * 只持申请权限者只看自己提交的——出纳提交完要能回查自己的单子批了没有，
 * 但没有理由看到别人的补录金额与原因。
 * 不持审批权限时用 `applicantId = 自己`；userId 缺失（理论上不会）时传 -1，
 * 宁可查不到也不能退化成「看全部」。
 */
const viewScopeOf = (req) => (canApproveOf(req) ? {} : { applicantId: req.user?.userId ?? -1 })

const list = async (req, res, next) => {
  try {
    const { status = '', bizType = '', page = 1, pageSize = 20 } = req.query
    return successResponse(res, await svc.findAll(
      { status, bizType, ...viewScopeOf(req), page, pageSize },
      companyOf(req),
    ), '查询成功')
  } catch (e) { next(e) }
}

const detail = async (req, res, next) => {
  try {
    return successResponse(res, await svc.findOne(+req.params.id, companyOf(req), viewScopeOf(req)), '查询成功')
  } catch (e) { next(e) }
}

const approve = async (req, res, next) => {
  try {
    const data = await svc.approve(+req.params.id, getOperatorFromRequest(req), {
      remark: req.body?.remark ?? null,
    }, companyOf(req))
    // 执行失败时凭证仍可能没就绪（voucherError），列表页据此显示「已记账 · 凭证待重试」，
    // 不用另一句「批准成功」把它盖过去。
    const msg = data?.voucherError
      ? '已批准并记账，但调整凭证未生成成功，请在列表里重试生成'
      : '已批准并记账'
    return successResponse(res, data, msg)
  } catch (e) { next(e) }
}

const reject = async (req, res, next) => {
  try {
    return successResponse(res, await svc.reject(+req.params.id, getOperatorFromRequest(req), {
      remark: req.body?.remark ?? null,
    }, companyOf(req)), '已驳回')
  } catch (e) { next(e) }
}

const cancel = async (req, res, next) => {
  try {
    const data = await svc.cancel(+req.params.id, getOperatorFromRequest(req), {
      reason: req.body?.reason ?? null,
      canApprove: canApproveOf(req),
    }, companyOf(req))
    return successResponse(res, data, '已作废，这笔业务没有记账。如需补录请重新申请')
  } catch (e) { next(e) }
}

/** 重试执行「已批准但业务没写进去」的单子（业务已漂移的单子会再次失败，届时请作废重报） */
const execute = async (req, res, next) => {
  try {
    const data = await svc.execute(+req.params.id, getOperatorFromRequest(req), companyOf(req))
    const msg = data?.voucherError
      ? '已记账，但调整凭证未生成成功，请重试生成'
      : '已记账'
    return successResponse(res, data, msg)
  } catch (e) { next(e) }
}

/** 业务已记账、调整凭证没生成出来时的重试入口 */
const regenerateVoucher = async (req, res, next) => {
  try {
    return successResponse(res, await svc.regenerateVoucher(
      +req.params.id, getOperatorFromRequest(req), companyOf(req),
    ), '调整凭证已生成')
  } catch (e) { next(e) }
}

module.exports = { list, detail, approve, reject, cancel, execute, regenerateVoucher }
