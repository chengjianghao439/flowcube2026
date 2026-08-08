const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./inventory.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const router = Router()

const changeSchema = z.object({
  productId:   z.number().int().positive('请选择商品'),
  warehouseId: z.number().int().positive('请选择仓库'),
  quantity:    z.number().positive('数量必须大于0'),
  supplierId:  z.number().int().positive().optional().nullable(),
  unitPrice:   z.number().nonnegative().optional().nullable(),
  remark:      z.string().max(500).optional(),
})

const adjustSchema = z.object({
  productId:   z.number().int().positive('请选择商品'),
  warehouseId: z.number().int().positive('请选择仓库'),
  quantity:    z.number().nonnegative('调整数量不能为负'),
  remark:      z.string().max(500).optional(),
})

const policiesSchema = z.object({
  items: z.array(z.object({
    productId:    z.number().int().positive('productId 无效'),
    warehouseId:  z.number().int().min(0, 'warehouseId 无效'),   // 0=通用默认
    safetyStock:  z.number().nonnegative().optional(),
    reorderPoint: z.number().nonnegative().optional(),
    targetStock:  z.number().nonnegative().nullable().optional(),
  })).min(1, '至少提交一条补货策略'),
})

router.use(authMiddleware)
router.get('/check-consistency',      requirePermission(PERMISSIONS.INVENTORY_TRACE_VIEW), ctrl.checkConsistency)
router.get('/trace/:productId',       requirePermission(PERMISSIONS.INVENTORY_TRACE_VIEW), ctrl.trace)
router.get('/overview',                requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.overview)
router.get('/replenishment',           requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.replenishment)
router.get('/stock-policies',          requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.stockPolicies)
router.put('/stock-policies',          requirePermission(PERMISSIONS.INVENTORY_ADJUST), validateBody(policiesSchema), ctrl.saveStockPolicies)
router.get('/aging',                   requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.inventoryAging)
router.get('/aging/expiry',            requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.expiryAlerts)
router.get('/procurement-plan',        requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.procurementPlan)
router.get('/containers',              requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.containers)
router.get('/containers/barcode/:bc',  requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.containerByBarcode)
router.get('/containers/:id/logs',     requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.containerLogs)
router.get('/stock',                   requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.stock)
router.get('/logs',                    requirePermission(PERMISSIONS.INVENTORY_VIEW), ctrl.logs)
router.post('/inbound',     requirePermission(PERMISSIONS.INVENTORY_ADJUST), validateBody(changeSchema), ctrl.inbound)
router.post('/outbound',    requirePermission(PERMISSIONS.INVENTORY_ADJUST), validateBody(changeSchema), ctrl.outbound)
router.post('/adjust',      requirePermission(PERMISSIONS.INVENTORY_ADJUST), validateBody(adjustSchema), ctrl.adjust)
router.put('/containers/:containerId/location',
  requirePermission(PERMISSIONS.INVENTORY_CONTAINER_MOVE),
  validateBody(z.object({ locationId: z.number().int().positive('locationId 必须为正整数') })),
  ctrl.assignContainerLocation
)
router.post('/containers/:id/split',
  requirePermission(PERMISSIONS.INVENTORY_CONTAINER_SPLIT),
  validateBody(z.object({
    qty: z.number().positive('拆分数量须大于 0'),
    remark: z.string().max(500).optional(),
    printLabel: z.boolean().optional(),
    targetContainerId: z.number().int().positive().optional(),
  })),
  ctrl.splitContainer,
)

module.exports = router
