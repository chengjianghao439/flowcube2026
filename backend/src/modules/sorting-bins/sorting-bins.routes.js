/**
 * sorting-bins.routes.js
 * 分拣格管理接口
 */
const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./sorting-bins.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

// GET /api/sorting-bins/scan?code=xxx
router.get('/scan', requirePermission(PERMISSIONS.SORTING_BIN_VIEW), ctrl.scan)

// GET /api/sorting-bins?warehouseId=&keyword=&status=
router.get('/', requirePermission(PERMISSIONS.SORTING_BIN_VIEW), ctrl.listAllWarehouses)

// GET /api/sorting-bins/warehouse/:warehouseId
router.get('/warehouse/:warehouseId', requirePermission(PERMISSIONS.SORTING_BIN_VIEW), ctrl.listByWarehouse)

// POST /api/sorting-bins
router.post('/',
  requirePermission(PERMISSIONS.SORTING_BIN_MANAGE),
  vBody(z.object({
    code:        z.string().min(1).max(20),
    warehouseId: z.number().int().positive(),
    remark:      z.string().max(200).optional(),
  })),
  ctrl.create,
)

// POST /api/sorting-bins/batch
router.post('/batch',
  requirePermission(PERMISSIONS.SORTING_BIN_MANAGE),
  vBody(z.object({
    warehouseId: z.number().int().positive(),
    prefix:      z.string().min(1).max(5),
    from:        z.number().int().min(1),
    to:          z.number().int().min(1),
  })),
  ctrl.batchCreate,
)

// PATCH /api/sorting-bins/:id
router.patch('/:id',
  requirePermission(PERMISSIONS.SORTING_BIN_MANAGE),
  vBody(z.object({ remark: z.string().max(200).optional() })),
  ctrl.update,
)

// POST /api/sorting-bins/:id/release
router.post('/:id/release', requirePermission(PERMISSIONS.SORTING_BIN_MANAGE), ctrl.forceRelease)

// DELETE /api/sorting-bins/:id
router.delete('/:id', requirePermission(PERMISSIONS.SORTING_BIN_MANAGE), ctrl.remove)

module.exports = router
