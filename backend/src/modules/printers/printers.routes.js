const { Router } = require('express')
const ctrl = require('./printers.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

router.use(authMiddleware)
router.get('/online-clients', ctrl.listOnlineClients)
router.get('/all-clients', ctrl.listAllClients)
router.put('/clients/:clientId/alias', ctrl.updateClientAlias)
router.get('/', ctrl.list)
router.get('/:id', ctrl.detail)
router.post('/', ctrl.create)
router.put('/:id', ctrl.update)
router.delete('/:id', ctrl.remove)
module.exports = router
