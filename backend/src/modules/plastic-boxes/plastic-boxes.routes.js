const { Router } = require('express')
const { z } = require('zod')
const { validateBody } = require('../../utils/route')
const ctrl = require('./plastic-boxes.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { pdaSessionOptional } = require('../../middleware/pdaSession')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

router.get('/',            requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.list)
router.post('/',           requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), validateBody(z.object({
  productId: z.number().int().positive(),
  warehouseId: z.number().int().positive(),
  locationId: z.number().int().positive().nullable().optional(),
  remark: z.string().max(500).optional(),
})), ctrl.create)
router.get('/:id',         requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.detail)
router.get('/:id/movements', requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.movements)
// 来源贡献：本盒各来源容器及贡献量（只读，与库位/货架标签同口径用查看权限）
router.get('/:id/sources', requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.sources)
// 放货：来源整件全部倒入本盒（只收 sourceContainerId，不设可选数量）
// pdaSessionOptional：PC 与 PDA 都可用；带 X-PDA-Session 时必须校验设备与设备仓
router.post('/:id/fill', pdaSessionOptional(), requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), validateBody(z.object({
  sourceContainerId: z.number().int().positive('来源库存条码无效'),
  // 并发快照守卫：与提交时读到的来源实存不一致则要求重扫
  expectedSourceQty: z.number().positive().optional(),
})), ctrl.fill)
// 还原整件：人工逐箱 qty（等量时用 perBoxQty + boxCount 快捷）
// 上限在路由层先挡一道（服务端还有 REPACK_MAX_BOXES 兜底），避免超大数组进入业务层
router.post('/:id/repack', pdaSessionOptional(), requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), validateBody(z.object({
  perBoxQty: z.number().positive('每箱数量须大于 0').optional(),
  boxCount:  z.number().int().positive('箱数须为正整数').max(100, '一次最多还原 100 箱').optional(),
  items:     z.array(z.number().positive('每箱数量须大于 0')).max(100, '一次最多还原 100 箱').optional(),
})), ctrl.repack)
// 重复打印塑料盒条码：只读业务（入队打印、不改库存），与库位/货架标签同口径用查看权限
router.post('/:id/print-label', requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.printLabel)
router.delete('/:id',      requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT), ctrl.remove)

module.exports = router
