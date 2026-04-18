const { Router } = require('express')
const ctrl = require('./printers.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()

router.use(authMiddleware)
router.post('/client-heartbeat', requirePermission(PERMISSIONS.PRINT_CLIENT_CONSUME), ctrl.heartbeatClient)
router.get('/online-clients', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.listOnlineClients)
router.get('/all-clients', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.listAllClients)
router.put('/clients/:clientId/alias', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), ctrl.updateClientAlias)
router.get('/', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.list)
router.get('/:id', requirePermission(PERMISSIONS.PRINT_PRINTER_VIEW), ctrl.detail)
router.post('/', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), ctrl.create)
router.put('/:id', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), ctrl.update)
router.delete('/:id', requirePermission(PERMISSIONS.PRINT_PRINTER_MANAGE), ctrl.remove)
module.exports = router
