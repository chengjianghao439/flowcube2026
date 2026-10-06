const { Router } = require('express')
const ctrl = require('./print-jobs.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { validateJobPrinterHeader } = require('./print-jobs.middleware')
const { PERMISSIONS } = require('../../constants/permissions')

const { printClientRequired } = require('../printers/print-client-auth')
const router = Router()

router.use(authMiddleware)
router.get('/', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.list)
router.get('/stats', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.stats)
router.get('/printer-health', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.printerHealth)
router.get('/barcodes', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.barcodeRecords)
router.post('/barcodes/reprint', requirePermission(PERMISSIONS.PRINT_JOB_REPRINT), ctrl.reprintBarcode)
router.post('/claim-client', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), printClientRequired, ctrl.claimClientJobs)
router.get('/:id', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.detail)
router.post('/', requirePermission(PERMISSIONS.PRINT_JOB_CREATE), ctrl.create)
// 本机和外部客户端统一使用认证工作站绑定的领取令牌核销。
router.post('/:id/complete-local', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), validateJobPrinterHeader, ctrl.completeLocal)
router.post('/:id/complete-client', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), validateJobPrinterHeader, ctrl.complete)
router.post(
  '/:id/complete',
  requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME),
  validateJobPrinterHeader,
  ctrl.complete,
)
router.post('/:id/fail-client', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), validateJobPrinterHeader, ctrl.fail)
router.post(
  '/:id/fail',
  requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME),
  validateJobPrinterHeader,
  ctrl.fail,
)
router.post('/:id/retry', requirePermission(PERMISSIONS.PRINT_JOB_RETRY), ctrl.retry)

module.exports = router
