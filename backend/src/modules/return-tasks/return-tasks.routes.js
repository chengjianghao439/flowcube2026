const { Router } = require('express')
const ctrl = require('./return-tasks.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { pdaSessionRequired } = require('../../middleware/pdaSession')
const { pdaOnly } = require('../../middleware/pdaOnly')
const { z } = require('zod')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) {
      return res.status(400).json({
        success: false,
        message: r.error.errors.map(e => e.message).join('；'),
        data: null,
      })
    }
    req.body = r.data
    next()
  }
}

const zReceive = z.object({
  productId: z.number().int().positive('productId 必填'),
  // serialNos：序列号商品退货逐台扫（文档04 Phase3），每箱 SN 数须与 qty 一致（服务端校验）
  packages: z.array(z.object({
    qty: z.number().positive('数量必须大于 0'),
    serialNos: z.array(z.string().trim().min(1)).optional(),
  }).passthrough()).nonempty('至少一箱'),
})
const zCheck = z.object({
  productId: z.number().int().positive('productId 必填'),
  passedQty: z.number().nonnegative('合格数量不能为负'),
  rejectedQty: z.number().nonnegative('不合格数量不能为负').optional(),
})
const zPutaway = z.object({
  containerId: z.number().int().positive('containerId 必填'),
  locationId: z.number().int().positive('locationId 必填'),
})

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
  vBody(zReceive),
  ctrl.receive,
)

// PDA 质检
router.post('/:id/check',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  vBody(zCheck),
  ctrl.check,
)

// PDA 上架
router.post('/:id/putaway',
  pdaSessionRequired(),
  requirePermission(PERMISSIONS.RETURN_ORDER_EXECUTE),
  pdaOnly,
  vBody(zPutaway),
  ctrl.putaway,
)

// 取消
router.post('/:id/cancel',
  requirePermission(PERMISSIONS.RETURN_ORDER_CANCEL),
  ctrl.cancel,
)

module.exports = router
