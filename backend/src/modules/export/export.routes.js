const { Router } = require('express')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const controller = require('./export.controller')

const router = Router()

router.use(authMiddleware)

router.get('/purchase', requirePermission(PERMISSIONS.PURCHASE_ORDER_VIEW), controller.exportPurchase)
router.get('/sale', requirePermission(PERMISSIONS.SALE_ORDER_VIEW), controller.exportSale)
router.get('/reconciliation', requirePermission(PERMISSIONS.REPORT_VIEW), controller.exportReconciliation)
router.get('/inbound-tasks', requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), controller.exportInboundTasks)
router.get('/stock', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.exportStock)
router.get('/inventory-logs', requirePermission(PERMISSIONS.INVENTORY_VIEW), controller.exportInventoryLogs)
router.get('/transfer', requirePermission(PERMISSIONS.TRANSFER_ORDER_VIEW), controller.exportTransfer)
router.get('/purchase-returns', requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), controller.exportPurchaseReturns)
router.get('/sale-returns', requirePermission(PERMISSIONS.RETURN_ORDER_VIEW), controller.exportSaleReturns)

module.exports = router
