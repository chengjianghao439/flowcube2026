const { Router } = require('express')
const ctrl = require('./reports.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const router = Router()
router.use(authMiddleware)

router.get('/purchase',        requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.purchase)
router.get('/sale',            requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.sale)
router.get('/inventory',       requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.inventory)
router.get('/pda-performance', requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.pdaPerformance)
router.get('/wave-performance', requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.wavePerformance)
router.get('/warehouse-ops',   requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.warehouseOps)
router.get('/role-workbench',  requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.roleWorkbench)
router.get('/reconciliation',  requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.reconciliation)
router.get('/profit-analysis', requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.profitAnalysis)

module.exports = router
