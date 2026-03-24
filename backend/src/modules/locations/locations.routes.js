const { Router } = require('express')
const ctrl = require('./locations.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()
router.use(authMiddleware)

router.get('/code/:code', ctrl.findByCode)  // 按编码查库位（PDA 扫码用）
router.get('/',      ctrl.list)
router.get('/:id',   ctrl.detail)
router.post('/',     ctrl.create)
router.put('/:id',   ctrl.update)
router.delete('/:id', ctrl.remove)

module.exports = router
