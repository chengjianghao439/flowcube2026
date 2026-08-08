const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./pda-devices.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const createSchema = z.object({
  deviceName: z.string().trim().min(1, '设备名称不能为空').max(128, '设备名称过长'),
  // 允许不绑仓库：这类设备能在任何仓作业，仅用于跨仓巡检等场景，绑定后才有跨仓拦截
  warehouseId: z.number().int().positive().nullable().optional(),
})

const updateSchema = z.object({
  deviceName: z.string().trim().min(1, '设备名称不能为空').max(128, '设备名称过长').optional(),
  warehouseId: z.number().int().positive().nullable().optional(),
})

const statusSchema = z.object({
  status: z.enum(['active', 'disabled', 'retired'], { errorMap: () => ({ message: '设备状态无效' }) }),
})

router.use(authMiddleware)

router.get('/',    requirePermission(PERMISSIONS.PDA_DEVICE_VIEW), ctrl.list)
router.get('/:id', requirePermission(PERMISSIONS.PDA_DEVICE_VIEW), ctrl.detail)
router.post('/',   requirePermission(PERMISSIONS.PDA_DEVICE_MANAGE), validateBody(createSchema), ctrl.create)
router.put('/:id', requirePermission(PERMISSIONS.PDA_DEVICE_MANAGE), validateBody(updateSchema), ctrl.update)
router.put('/:id/status', requirePermission(PERMISSIONS.PDA_DEVICE_MANAGE), validateBody(statusSchema), ctrl.setStatus)
// 重置密钥单独一个动作：旧密钥立即作废且吊销全部票据，误点代价大，不与改名改仓混在一起
router.post('/:id/reset-secret', requirePermission(PERMISSIONS.PDA_DEVICE_MANAGE), ctrl.resetSecret)

module.exports = router
