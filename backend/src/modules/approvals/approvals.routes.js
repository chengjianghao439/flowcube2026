const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./approvals.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const stepSchema = z.object({
  stepOrder: z.number().int().positive(),
  approverType: z.number().int().min(1).max(3, '审批人类型 1角色 2部门负责人 3指定用户'),
  roleId: z.number().int().positive().nullable().optional(),
  departmentId: z.number().int().nonnegative().nullable().optional(),
  userId: z.number().int().positive().nullable().optional(),
})
const flowSchema = z.object({
  bizType: z.string().min(1, '请选择业务类型'),
  name: z.string().min(1, '流程名称不能为空').max(80),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().nonnegative().nullable().optional(),
  isActive: z.boolean().optional(),
  remark: z.string().max(200).optional(),
  steps: z.array(stepSchema).min(1, '至少配置一个审批节点'),
})
const updateFlowSchema = z.object({
  name: z.string().min(1, '流程名称不能为空').max(80).optional(),
  minAmount: z.number().nonnegative().optional(),
  maxAmount: z.number().nonnegative().nullable().optional(),
  isActive: z.boolean().optional(),
  remark: z.string().max(200).nullable().optional(),
  steps: z.array(stepSchema).min(1, '至少配置一个审批节点').optional(),
})

router.use(authMiddleware)

// 审批流配置（系统级管理能力）
router.get('/flows',            requirePermission(PERMISSIONS.APPROVAL_FLOW_MANAGE), ctrl.listFlows)
router.get('/flows/:id',        requirePermission(PERMISSIONS.APPROVAL_FLOW_MANAGE), ctrl.getFlow)
router.post('/flows',           requirePermission(PERMISSIONS.APPROVAL_FLOW_MANAGE), validateBody(flowSchema), ctrl.createFlow)
router.put('/flows/:id',        requirePermission(PERMISSIONS.APPROVAL_FLOW_MANAGE), validateBody(updateFlowSchema), ctrl.updateFlow)
router.delete('/flows/:id',     requirePermission(PERMISSIONS.APPROVAL_FLOW_MANAGE), ctrl.removeFlow)

// 业务单据的审批进度（详情页展示）
router.get('/biz/:bizType/:bizId', requirePermission(PERMISSIONS.APPROVAL_TASK_VIEW), ctrl.getBizApproval)

// 待我审批（每人自己的任务，全部角色可见）
router.get('/pending',          requirePermission(PERMISSIONS.APPROVAL_TASK_VIEW), ctrl.listPending)

module.exports = router
