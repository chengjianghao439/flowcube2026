const { Router } = require('express')
const ctrl = require('./racks.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
router.use(authMiddleware)

router.get('/active', ctrl.listActive)
router.get('/',       ctrl.list)
router.get('/:id',    ctrl.detail)
router.post('/',      ctrl.create)
router.put('/:id',    ctrl.update)
router.delete('/:id', ctrl.remove)

module.exports = router
