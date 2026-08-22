const { Router } = require('express')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./portal.controller')

const router = Router()

router.use(authMiddleware)

// 门户只读查询：复用现有权限码中最接近的——
// 客户对账 → 财务对账查看；供应商到货 → 采购查看
router.get('/statements', requirePermission(PERMISSIONS.PAYMENT_VIEW), controller.statements)
router.get('/purchase-status', requirePermission(PERMISSIONS.PURCHASE_ORDER_VIEW), controller.purchaseStatus)

module.exports = router
