const { Router } = require('express')
const ctrl = require('./printers.controller')
const { authMiddleware, permissionMiddleware } = require('../../middleware/auth')
const { loadRolePermissions } = require('../../middleware/loadRolePermissions')
const {
  validateRegisterIncludesPrinterHeader,
  validateHeartbeatPrinter,
} = require('../print-jobs/print-jobs.middleware')

const router = Router()

const printClientPerm = permissionMiddleware('print:client', { superAdminRoleIds: [1] })

router.post(
  '/register-client',
  authMiddleware,
  loadRolePermissions,
  printClientPerm,
  validateRegisterIncludesPrinterHeader,
  ctrl.registerClient,
)
router.post(
  '/heartbeat',
  authMiddleware,
  loadRolePermissions,
  printClientPerm,
  validateHeartbeatPrinter,
  ctrl.heartbeat,
)

router.use(authMiddleware)
router.get('/online-clients', ctrl.listOnlineClients)
router.get('/all-clients',    ctrl.listAllClients)
router.put('/clients/:clientId/alias', ctrl.updateClientAlias)
router.get('/',     ctrl.list)
router.get('/:id',  ctrl.detail)
router.post('/',    ctrl.create)
router.put('/:id',  ctrl.update)
router.delete('/:id', ctrl.remove)
module.exports = router
