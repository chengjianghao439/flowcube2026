const { Router } = require('express')
const ctrl = require('./print-jobs.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { validateJobPrinterHeader } = require('./print-jobs.middleware')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()

router.use(authMiddleware)
router.get('/', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.list)
router.get('/stats', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.stats)
router.get('/printer-health', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.printerHealth)
router.get('/barcodes', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.barcodeRecords)
router.post('/barcodes/reprint', requirePermission(PERMISSIONS.PRINT_JOB_REPRINT), ctrl.reprintBarcode)
router.post('/claim-client', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), ctrl.claimClientJobs)
router.get('/:id', requirePermission(PERMISSIONS.PRINT_JOB_VIEW), ctrl.detail)
router.post('/', requirePermission(PERMISSIONS.PRINT_JOB_CREATE), ctrl.create)
router.post('/:id/complete-local', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), ctrl.completeLocal)
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
