'use strict'

/**
 * 跨期补录审批路由（2026-09-26 一致性审查 · 任务 7 第二期）。
 * 挂载点 /api/accounting/backfills（由 accounting.routes 挂到 /api/accounting 之下）。
 *
 * 权限分两档，按「这个动作会改变什么」划：
 *   · finance.period.backfill         —— 申请，以及**待审批**时撤回自己的申请；
 *   · finance.period.backfill.approve —— 批准 / 驳回 / 作废已批准的单 / 执行 / 重生成凭证。
 * 作废为什么路由级只要申请权限：待审批的单子申请人自己就能撤（撤销自己的申请不推翻任何
 * 审批结论），而作废一张**已批准**的单需要审批权限——这个区分按状态而定，路由中间件做不到
 * （它只能看权限、看不了状态），所以在 service.cancel 里判，controller 把 canApprove 传下去。
 * 若这里卡死 APPROVE，没有审批权限的出纳连自己的申请都收不回。
 *
 * 这两个权限码都不 seed 给任何角色（超管 roleId=1 硬编码豁免），与 finance.period.backfill
 * 同先例，由产品在权限管理页手动开放——见 constants/permissions.js。
 */

const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./finance-backfills.controller')
const { requirePermission, requireAnyPermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody, validateParams } = require('../../utils/route')

const router = Router()

const idParam = z.object({ id: z.coerce.number().int().positive('补录申请 ID 必须为正整数') })
const vParams = validateParams(idParam)

// 驳回必须写原因：申请人要知道为什么被驳回，否则只能反复提交同一张单
const rejectSchema = z.object({
  remark: z.string().min(2, '驳回必须填写原因').max(300),
})

// 作废/撤回必须写原因：事后要能回答「这张申请为什么没执行」——这正是留痕的意义
const cancelSchema = z.object({
  reason: z.string().min(2, '请填写作废/撤回原因').max(300),
})

router.get('/',    requireAnyPermission([PERMISSIONS.FINANCE_PERIOD_BACKFILL, PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE]), ctrl.list)
router.get('/:id', vParams, requireAnyPermission([PERMISSIONS.FINANCE_PERIOD_BACKFILL, PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE]), ctrl.detail)

router.post('/:id/approve', vParams, requirePermission(PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE),
  validateBody(z.object({ remark: z.string().max(300).optional().nullable() })), ctrl.approve)
router.post('/:id/reject', vParams, requirePermission(PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE),
  validateBody(rejectSchema), ctrl.reject)
// 作废对两档权限都开放：待审批时申请人自己撤回（持 BACKFILL），已批准的单子由审批侧作废
// （持 APPROVE）。具体按状态与 canApprove 在 service.cancel 里判——路由中间件看不了状态。
router.post('/:id/cancel', vParams,
  requireAnyPermission([PERMISSIONS.FINANCE_PERIOD_BACKFILL, PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE]),
  validateBody(cancelSchema), ctrl.cancel)
router.post('/:id/execute', vParams, requirePermission(PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE), ctrl.execute)
router.post('/:id/regenerate-voucher', vParams, requirePermission(PERMISSIONS.FINANCE_PERIOD_BACKFILL_APPROVE), ctrl.regenerateVoucher)

module.exports = router
