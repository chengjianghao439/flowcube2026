const { Router } = require('express')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const AppError = require('../../utils/AppError')
const { getDefinition } = require('./document-registry')
const controller = require('./document-activity.controller')
const router = Router()
router.use(authMiddleware)
router.get('/:type/:id', (req, res, next) => {
  const definition = getDefinition(req.params.type)
  if (!definition || !/^[1-9]\d*$/.test(req.params.id) || !Number.isSafeInteger(Number(req.params.id))) return next(new AppError('无效的单据类型或编号', 400))
  return requirePermission(definition[0])(req, res, next)
}, controller.detail)
module.exports = router
