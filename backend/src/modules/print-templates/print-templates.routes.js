const { Router } = require('express')
const ctrl = require('./print-templates.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const AppError = require('../../utils/AppError')
const { rateLimit } = require('express-rate-limit')

const router = Router()
router.use(authMiddleware)

router.get('/',           requirePermission(PERMISSIONS.PRINT_TEMPLATE_VIEW), ctrl.list)
// Template permission is checked first; preview must also obey its source business permission.
const previewPermissions = {
  1: PERMISSIONS.SALE_ORDER_VIEW, 2: PERMISSIONS.PURCHASE_ORDER_VIEW,
  3: PERMISSIONS.RETURN_ORDER_VIEW, 4: PERMISSIONS.WAREHOUSE_TASK_VIEW,
  5: PERMISSIONS.RACK_VIEW, 6: PERMISSIONS.INVENTORY_VIEW,
  7: PERMISSIONS.WAREHOUSE_TASK_VIEW, 8: PERMISSIONS.PRODUCT_VIEW,
  9: PERMISSIONS.INVENTORY_VIEW, 10: PERMISSIONS.LOCATION_VIEW,
}
router.get('/preview-data', requirePermission(PERMISSIONS.PRINT_TEMPLATE_VIEW), (req, res, next) => {
  if (typeof req.query.type !== 'string' || !/^(?:[1-9]|10)$/.test(req.query.type)) {
    return next(new AppError('模板类型必须为1至10的整数', 400, 'PRINT_TEMPLATE_TYPE_INVALID'))
  }
  return requirePermission(previewPermissions[Number(req.query.type)])(req, res, next)
}, ctrl.previewData)
// This endpoint renders supplied values only; source-record access stays in preview-data.
router.post('/render-label', requirePermission(PERMISSIONS.PRINT_TEMPLATE_VIEW), rateLimit({
  windowMs: 60_000, limit: 120, keyGenerator: req => String(req.user.userId),
  handler: (req, res, next) => next(new AppError('标签预览请求过于频繁，请稍后重试', 429)),
}), ctrl.renderLabel)
router.get('/:id',        requirePermission(PERMISSIONS.PRINT_TEMPLATE_VIEW), ctrl.detail)
router.post('/',          requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.create)
router.put('/:id',        requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.update)
router.post('/:id/default', requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.setDefault)
router.delete('/:id',     requirePermission(PERMISSIONS.PRINT_TEMPLATE_MANAGE), ctrl.remove)

module.exports = router
