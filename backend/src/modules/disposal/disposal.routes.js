const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./disposal.controller')
const { authMiddleware, requirePermission, requireAnyPermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')

const { disposalSourceSchema, rejectSource } = require('./disposal.handling.contracts')
const router = Router()

const itemSchema = z.object({
  productId: z.number().int().positive('请选择商品'),
  quantity: z.number().positive('处置数量必须大于 0'),
  disposeType: z.literal(3, { errorMap: () => ({ message: '新独立处理单仅支持报废' }) }),
  remark: z.string().max(300).optional().nullable(),
})

const createSchema = z.object({
  disposalSource: disposalSourceSchema.optional(),
  warehouseId: z.number().int().positive('请选择仓库'),
  warehouseName: z.string().min(1).max(100),
  remark: z.string().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1, '至少添加一条处置明细'),
})

const updateSchema = z.object({
  warehouseId: z.number().int().positive('请选择仓库'),
  warehouseName: z.string().min(1).max(100),
  remark: z.string().max(500).optional().nullable(),
  items: z.array(itemSchema).min(1, '至少添加一条处置明细'),
})

const rejectSchema = z.object({
  reason: z.string().max(500).optional().nullable(),
})

const handlingSourceSchema = z.object({
  intentUuid: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
  operationUuid: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
  productId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  warehouseId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  unit: z.string().min(1).refine(value => Array.from(value).length <= 20),
  handlingType: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  quantity: z.number().positive().max(9999999999.99),
}).strict()

const releaseSchema = z.object({
  operationUuid: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
  expectedRevision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  reason: z.string().min(1).refine(value => !!value.trim() && Array.from(value).length <= 500),
}).strict()

const conversionSchema = z.object({
  operationUuid: z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i),
  snapshotFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  reason: z.string().min(1).refine(value => !!value.trim() && Array.from(value).length <= 500),
}).strict()
router.use(authMiddleware)
// 本人永久原结果仅认证；精确身份与当前仓范围在领域服务核对，不授新建/原单查看权。
router.get('/handling-operations/:operationUuid', ctrl.ownHandlingOperation)
router.get('/handling-sources', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.handlingSources)
router.get('/handling-sources/:id', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.handlingSource)
router.post('/handling-sources/:id/links/:linkId/release', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), requireAnyPermission([PERMISSIONS.INVENTORY_DISPOSAL_CREATE, PERMISSIONS.INVENTORY_DISPOSAL_APPROVE]), validateBody(releaseSchema), ctrl.releaseHandlingLink)
router.post('/handling-sources', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), validateBody(handlingSourceSchema), ctrl.createHandlingSource)
router.get('/suggestions',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.suggestions)
// 静态子路径须在 /:id 之前注册，否则 /suggestions 会被 /:id 误匹配
router.get('/',             requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.list)
router.get('/:id/conversion-snapshot', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.conversionSnapshot)
router.post('/:id/sign-conversion', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE), validateBody(conversionSchema), ctrl.signConversion)
router.get('/:id',          requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_VIEW), ctrl.detail)
router.post('/',            requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), validateBody(createSchema), ctrl.create)
router.put('/:id',          requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), rejectSource, validateBody(updateSchema), ctrl.update)
router.post('/:id/submit',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), ctrl.submit)
router.post('/:id/approve', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE), ctrl.approve)
router.post('/:id/reject',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_APPROVE), validateBody(rejectSchema), ctrl.reject)
router.post('/:id/dispose', requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_EXECUTE), ctrl.dispose)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.INVENTORY_DISPOSAL_CREATE), ctrl.cancel)

module.exports = router
