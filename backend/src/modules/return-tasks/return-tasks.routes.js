const { Router } = require('express')
const { pool } = require('../../config/db')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { pdaSessionRequired } = require('../../middleware/pdaSession')
const { getOperatorFromRequest } = require('../../utils/operator')
const svc = require('./return-tasks.service')
const { successResponse } = require('../../utils/response')
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
  async (req, res, next) => {
    try {
      const tasks = await svc.findPdaTasks(req.pda.warehouseId)
      return successResponse(res, tasks)
    } catch (e) { next(e) }
  },
)

// 详情
router.get('/:id',
  requirePermission(PERMISSIONS.RETURN_ORDER_VIEW),
  async (req, res, next) => {
    try {
      const task = await svc.findById(+req.params.id)
      return successResponse(res, task)
    } catch (e) { next(e) }
  },
)

// 提交到 PDA（ERP 端）
router.post('/:id/submit',
  requirePermission(PERMISSIONS.RETURN_ORDER_CONFIRM),
  async (req, res, next) => {
    try {
      const op = getOperatorFromRequest(req)
      const task = await svc.submit(+req.params.id, op)
      return successResponse(res, task, '已提交到 PDA')
    } catch (e) { next(e) }
  },
)

// PDA 收货
router.post('/:id/receive',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  async (req, res, next) => {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const { productId, packages } = req.body
      const result = await svc.receive(conn, +req.params.id, {
        productId, packages,
        requestKey: req.headers['x-request-key'],
        userId: req.user?.id,
      })
      await conn.commit()
      return successResponse(res, result)
    } catch (e) { await conn.rollback(); next(e) }
    finally { conn.release() }
  },
)

// PDA 质检
router.post('/:id/check',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  async (req, res, next) => {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const { productId, passedQty } = req.body
      const result = await svc.check(conn, +req.params.id, {
        productId, passedQty,
        requestKey: req.headers['x-request-key'],
        userId: req.user?.id,
      })
      await conn.commit()
      return successResponse(res, result)
    } catch (e) { await conn.rollback(); next(e) }
    finally { conn.release() }
  },
)

// PDA 上架
router.post('/:id/putaway',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  async (req, res, next) => {
    const conn = await pool.getConnection()
    try {
      await conn.beginTransaction()
      const { containerId, locationId } = req.body
      const result = await svc.putaway(conn, +req.params.id, {
        containerId, locationId,
        requestKey: req.headers['x-request-key'],
        userId: req.user?.id,
      })
      await conn.commit()
      return successResponse(res, result)
    } catch (e) { await conn.rollback(); next(e) }
    finally { conn.release() }
  },
)

// 取消
router.post('/:id/cancel',
  requirePermission(PERMISSIONS.RETURN_ORDER_CANCEL),
  async (req, res, next) => {
    try {
      const op = getOperatorFromRequest(req)
      await svc.cancel(+req.params.id, op)
      return successResponse(res, null, '已取消')
    } catch (e) { next(e) }
  },
)

module.exports = router
