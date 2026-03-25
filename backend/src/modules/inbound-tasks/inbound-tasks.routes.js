const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./inbound-tasks.controller')
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
  poId: z.number().int().positive('请选择采购单'),
})

/** 逐包收货：单次仅一包。兼容旧客户端 { items: [{ productId, qty }] } 且仅允许 1 条 */
const receiveSchema = z.union([
  z.object({
    productId: z.number().int().positive('商品无效'),
    qty:       z.number().positive('本包数量必须大于 0'),
  }),
  z
    .object({
      items: z
        .array(
          z.object({
            productId: z.number().int().positive('商品无效'),
            qty:       z.number().positive('数量必须大于 0'),
          }),
        )
        .length(1, '逐包收货：items 仅允许 1 条，请改用 { productId, qty }'),
    })
    .transform(d => ({ productId: d.items[0].productId, qty: d.items[0].qty })),
])

const putawaySchema = z.object({
  containerId: z.number().int().positive('请选择容器'),
  locationId:  z.number().int().positive('请选择库位'),
})

router.use(authMiddleware)

/** 入库上架仅允许 PDA（请求头 X-Client: pda），与出库 PDA 校验一致 */
function pdaOnly(req, res, next) {
  const client = (req.headers['x-client'] || '').toLowerCase()
  if (client !== 'pda') {
    return res.status(403).json({ success: false, message: '上架仅允许通过 PDA 扫码完成', data: null })
  }
  next()
}

router.get('/pending-containers', ctrl.pendingContainers)
router.get('/',              ctrl.list)
router.post('/',             vBody(createSchema), ctrl.create)
router.get('/:id/containers', ctrl.containers)
router.get('/:id',           ctrl.detail)
router.post('/:id/receive',  vBody(receiveSchema), ctrl.receive)
router.post('/:id/putaway', pdaOnly, vBody(putawaySchema), ctrl.putaway)
router.post('/:id/cancel',  ctrl.cancel)

module.exports = router
