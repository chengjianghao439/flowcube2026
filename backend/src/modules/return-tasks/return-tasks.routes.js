const { Router } = require('express')
const ctrl = require('./return-tasks.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { pdaSessionRequired } = require('../../middleware/pdaSession')
const AppError = require('../../utils/AppError')

const router = Router()
router.use(authMiddleware)

function pdaOnly(req, res, next) {
  const client = (req.headers['x-client'] || '').toLowerCase()
  if (client !== 'pda') return next(new AppError('此操作仅允许 PDA 扫码完成', 403))
  next()
}

// PDA 列表
router.get('/pda',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_VIEW),
  ctrl.pdaList,
)

// 详情
router.get('/:id',
  requirePermission(PERMISSIONS.RETURN_ORDER_VIEW),
  ctrl.detail,
)

// 提交到 PDA（ERP 端）
router.post('/:id/submit',
  requirePermission(PERMISSIONS.RETURN_ORDER_CONFIRM),
  ctrl.submit,
)

// PDA 收货
router.post('/:id/receive',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  ctrl.receive,
)

// PDA 质检
router.post('/:id/check',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  ctrl.check,
)

// PDA 上架
router.post('/:id/putaway',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  ctrl.putaway,
)

// 取消
router.post('/:id/cancel',
  requirePermission(PERMISSIONS.RETURN_ORDER_CANCEL),
  ctrl.cancel,
)

module.exports = router
