const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./scan-logs.controller')
const { authMiddleware } = require('../../middleware/auth')

const router = Router()

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

const createSchema = z.object({
  taskId:       z.number().int().positive(),
  itemId:       z.number().int().positive(),
  containerId:  z.number().int().positive(),
  barcode:      z.string().min(1),
  productId:    z.number().int().positive(),
  qty:          z.number().positive(),
  scanMode:     z.enum(['整件', '散件']),
  locationCode: z.string().max(20).optional(),
})

const errorSchema = z.object({
  taskId:  z.number().int().positive().optional(),
  barcode: z.string().min(1),
  reason:  z.string().min(1).max(255),
})

const undoSchema = z.object({
  taskId:  z.number().int().positive(),
  itemId:  z.number().int().positive(),
  barcode: z.string().min(1),
  prevQty: z.number(),
  newQty:  z.number(),
})

router.use(authMiddleware)

// 扫码记录
router.post('/',             vBody(createSchema), ctrl.create)
router.get('/task/:taskId',  ctrl.listByTask)

// 错误日志
router.post('/error',        vBody(errorSchema),  ctrl.logError)

// 撤销日志
router.post('/undo',         vBody(undoSchema),   ctrl.logUndo)

// 统计（仓库管理员 / 主管）
router.get('/stats',         ctrl.getStats)

// 异常分析报表
router.get('/anomaly',       ctrl.getAnomalyReport)

module.exports = router
