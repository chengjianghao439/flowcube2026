const { Router } = require('express')
const ctrl = require('./print-templates.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
router.use(authMiddleware)

router.get('/',           ctrl.list)
router.get('/:id',        ctrl.detail)
router.post('/',          ctrl.create)
router.put('/:id',        ctrl.update)
router.post('/:id/default', ctrl.setDefault)
router.delete('/:id',     ctrl.remove)

module.exports = router
