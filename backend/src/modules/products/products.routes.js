const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./products.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { loadRolePermissions } = require('../../middleware/loadRolePermissions')
const { PERMISSIONS } = require('../../constants/permissions')
const { pool } = require('../../config/db')
const { validateBody } = require('../../utils/route')
const { hasTooManyDecimals } = require('../../utils/qtyPrecision')

const router = Router()

// 作业页面只需 id/allowDecimal，不应为此要求开放含价格的商品主档。
// 仍复用现有权限读取、拒绝审计与超管规则，未匹配时按 PRODUCT_VIEW 拒绝。
const QTY_POLICY_PERMISSIONS = [
  PERMISSIONS.PRODUCT_VIEW,
  PERMISSIONS.INBOUND_RECEIVE_EXECUTE, PERMISSIONS.RETURN_ORDER_EXECUTE,
  PERMISSIONS.STOCKCHECK_VIEW, PERMISSIONS.STOCKCHECK_UPDATE,
  PERMISSIONS.SALE_ORDER_CREATE, PERMISSIONS.SALE_ORDER_UPDATE,
  PERMISSIONS.SALE_ORDER_RESERVE, PERMISSIONS.SALE_ORDER_RELEASE, PERMISSIONS.SALE_ORDER_SHIP,
  PERMISSIONS.PURCHASE_ORDER_CREATE, PERMISSIONS.PURCHASE_REQUISITION_CREATE,
  PERMISSIONS.PURCHASE_REQUISITION_CONVERT, PERMISSIONS.TRANSFER_ORDER_CREATE,
  PERMISSIONS.INVENTORY_DISPOSAL_CREATE, PERMISSIONS.INVENTORY_ADJUST,
  PERMISSIONS.INVENTORY_CONTAINER_SPLIT,
]
function requireQtyPolicyPermission(req, res, next) {
  loadRolePermissions(req, res, error => {
    if (error) return next(error)
    const permission = QTY_POLICY_PERMISSIONS.find(code => req.user?.permissions?.includes(code))
      || PERMISSIONS.PRODUCT_VIEW
    return requirePermission(permission)(req, res, next)
  })
}

const productBase = z.object({
  code:           z.string().min(1,'编码不能为空').max(50).optional(),
  skuCode:        z.string().max(50).optional(),
  articleNumber:  z.string().max(100).optional(),
  name:           z.string().min(1,'名称不能为空').max(150),
  categoryId:     z.number().int().positive('请选择商品分类'),
  supplierId:     z.number().int().positive('请选择供应商'),
  unit:           z.string().min(1,'单位不能为空').max(20),
  spec:           z.string().min(1,'型号不能为空').max(200),
  color:          z.string().min(1,'颜色不能为空').max(60),
  barcode:        z.string().max(60).optional(),
  costPrice:      z.number().positive('进价必须大于 0'),
  salePriceA:     z.number().positive().optional(),
  salePriceB:     z.number().positive().optional(),
  salePriceC:     z.number().positive().optional(),
  salePriceD:     z.number().positive().optional(),
  remark:         z.string().max(30,'备注最多 30 个字符').optional(),
  batchManaged:   z.boolean().optional(),
  allowDecimalQty: z.boolean().optional(),
  shelfLifeDays:  z.number().int().min(1,'保质期天数必须大于 0').max(3650).nullable().optional(),
  safetyStock:    z.number().nonnegative('安全库存不能为负').refine(value => !hasTooManyDecimals(value), '安全库存最多保留 2 位小数').nullable().optional(),
  reorderPoint:   z.number().nonnegative('补货点不能为负').refine(value => !hasTooManyDecimals(value), '补货点最多保留 2 位小数').nullable().optional(),
  // 辅助计量单位（文档 03，基本单位即 unit 字段）；换算率>1整数等细校验在 service.validateUnits
  units:          z.array(z.object({ unitName: z.string().min(1).max(20), conversionRate: z.number() })).max(10).optional(),
})

const { generateMasterCode } = require('../../utils/codeGenerator')
const { successResponse } = require('../../utils/response')
router.use(authMiddleware)
router.get('/next-code', async (req, res, next) => {
  try {
    const code = await generateMasterCode(pool, 'P', 'product_items')
    return successResponse(res, { code }, '生成成功')
  } catch (e) { next(e) }
})
router.get('/finder', requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.finder)
router.get('/active', requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.listActive)
// 数量小数策略：必须在 '/:id' 之前注册，否则会被当成 id 匹配
router.get('/qty-policies', requireQtyPolicyPermission, ctrl.qtyPolicies)
router.get('/',       requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.list)
router.post('/:id/print-label', requirePermission(PERMISSIONS.PRODUCT_PRINT_LABEL), ctrl.printLabel)
router.get('/:id',    requirePermission(PERMISSIONS.PRODUCT_VIEW), ctrl.detail)
router.post('/',      requirePermission(PERMISSIONS.PRODUCT_CREATE), validateBody(productBase), ctrl.create)
router.put('/:id',    requirePermission(PERMISSIONS.PRODUCT_UPDATE), validateBody(productBase.extend({ isActive: z.boolean() })), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.PRODUCT_DELETE), ctrl.remove)

module.exports = router
