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
// 2026-09-18 审计 P1：complete-local 此前只校验 print.client.consume 权限，**没有 ack_token、
// 也不校验工作站**，任何持该权限的账号都能把别仓/别的工作站打印机上的待打印任务标成「已打印」，
// 等于给「箱贴未打印成功不得进入待出库」开了一个静默旁路。这里补上与 complete-client/fail-client
// 相同的工作站校验（X-Client-Id 必须等于该打印机登记的 client_id，或提供 X-Printer-Code）。
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
