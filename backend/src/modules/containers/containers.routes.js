const { Router } = require('express')
const { authMiddleware } = require('../../middleware/auth')
const ctrl = require('./containers.controller')

const router = Router()
router.use(authMiddleware)
router.get('/overdue', ctrl.overdue)

module.exports = router
