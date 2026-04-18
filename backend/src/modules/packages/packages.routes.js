const { Router } = require('express')
const { z }      = require('zod')
const ctrl       = require('./packages.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')

const router = Router()

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({
      success: false,
      message: r.error.errors.map(e => e.message).join('；'),
      data: null,
    })
    req.body = r.data; next()
  }
}

router.use(authMiddleware)

// GET  /api/packages?taskId=:taskId     — 查询任务下所有箱子
router.get('/', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.list)

// GET  /api/packages/barcode/:barcode  — 按条码查询箱子（PDA 扫码出库）
router.get('/barcode/:barcode', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.getByBarcode)

// POST /api/packages                 — 创建箱子
router.post('/',
  requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK),
  vBody(z.object({
    warehouseTaskId: z.number().int().positive('warehouseTaskId 必填'),
    remark:          z.string().max(200).optional(),
  })),
  ctrl.create,
)

// POST /api/packages/:id/add-item    — 向箱子添加商品
router.post('/:id/add-item',
  requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK),
  vBody(z.object({
    productCode: z.string().min(1, '商品条码必填'),
    qty:         z.number().positive('数量必须大于 0'),
  })),
  ctrl.addItem,
)

// PUT  /api/packages/:id/finish      — 完成打包
router.put('/:id/finish', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK), ctrl.finish)

// POST /api/packages/:id/print-label — 补打箱贴
router.post('/:id/print-label', requirePermission(PERMISSIONS.PRINT_JOB_REPRINT), ctrl.printLabel)

module.exports = router
