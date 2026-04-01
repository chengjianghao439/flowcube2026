const { Router } = require('express')
const ctrl = require('./print-jobs.controller')
const { authMiddleware, permissionMiddleware } = require('../../middleware/auth')
const { loadRolePermissions } = require('../../middleware/loadRolePermissions')
const { validateJobPrinterHeader } = require('./print-jobs.middleware')

const router = Router()
const printClientPerm = permissionMiddleware('print:client', { superAdminRoleIds: [1] })

router.use(authMiddleware)
router.get('/', ctrl.list)
router.get('/stats', ctrl.stats)
router.get('/printer-health', ctrl.printerHealth)
router.post('/claim-client', ctrl.claimClientJobs)
router.get('/:id', ctrl.detail)
router.post('/', ctrl.create)
router.post('/:id/complete-local', ctrl.completeLocal)
router.post('/:id/complete-client', validateJobPrinterHeader, ctrl.complete)
router.post(
  '/:id/complete',
  loadRolePermissions,
  printClientPerm,
  validateJobPrinterHeader,
  ctrl.complete,
)
router.post('/:id/fail-client', validateJobPrinterHeader, ctrl.fail)
router.post(
  '/:id/fail',
  loadRolePermissions,
  printClientPerm,
  validateJobPrinterHeader,
  ctrl.fail,
)
router.post('/:id/retry', ctrl.retry)

module.exports = router
