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

const createSchema = z.union([
  z.object({
    poId: z.number().int().positive('请选择采购单'),
  }),
  z.object({
    supplierId: z.number().int().positive('请选择供应商'),
    supplierName: z.string().min(1, '供应商名称不能为空'),
    remark: z.string().optional(),
    items: z.array(
      z.object({
        purchaseItemId: z.number().int().positive('采购明细无效'),
        qty: z.number().positive('收货数量必须大于 0'),
      }),
    ).min(1, '请至少选择一条采购明细'),
  }),
])

/** 收货：兼容旧客户端单包；新版支持同商品多箱录入 { productId, packages:[{ qty }] } */
const receiveSchema = z.union([
  z.object({
    productId: z.number().int().positive('商品无效'),
    qty:       z.number().positive('本包数量必须大于 0'),
  }),
  z.object({
    productId: z.number().int().positive('商品无效'),
    packages: z.array(
      z.object({
        qty: z.number().positive('箱数量必须大于 0'),
      }),
    ).min(1, '请至少填写一箱数量'),
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
        .min(1, '请至少填写一条收货记录'),
    })
    .refine(d => new Set(d.items.map(item => item.productId)).size === 1, {
      message: '同一次收货仅允许提交同一商品',
      path: ['items'],
    })
    .transform(d => {
      return {
        productId: d.items[0].productId,
        packages: d.items.map(item => ({ qty: item.qty })),
      }
    }),
])

const putawaySchema = z.object({
  containerId: z.number().int().positive('请选择容器'),
  locationId:  z.number().int().positive('请选择库位'),
})

const auditSchema = z.object({
  action: z.enum(['approve', 'reject']).default('approve'),
  remark: z.string().trim().max(200, '审核备注不能超过 200 个字').optional(),
}).superRefine((data, ctx) => {
  if (data.action === 'reject' && !String(data.remark || '').trim()) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '审核退回必须填写原因', path: ['remark'] })
  }
})

const reprintSchema = z.object({
  mode: z.enum(['task', 'item', 'barcode']).default('task'),
  itemId: z.number().int().positive('收货明细无效').optional(),
  barcode: z.string().trim().min(1, '库存条码不能为空').optional(),
}).superRefine((data, ctx) => {
  if (data.mode === 'item' && !data.itemId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '请选择收货明细', path: ['itemId'] })
  }
  if (data.mode === 'barcode' && !data.barcode) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: '库存条码不能为空', path: ['barcode'] })
  }
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
router.get('/purchase-items', ctrl.purchaseItems)
router.get('/',              ctrl.list)
router.post('/',             vBody(createSchema), ctrl.create)
router.get('/:id/containers', ctrl.containers)
router.get('/:id',           ctrl.detail)
router.post('/:id/submit',   ctrl.submit)
router.post('/:id/audit',    vBody(auditSchema), ctrl.audit)
router.post('/:id/reprint',  vBody(reprintSchema), ctrl.reprint)
router.post('/:id/receive',  vBody(receiveSchema), ctrl.receive)
router.post('/:id/putaway', pdaOnly, vBody(putawaySchema), ctrl.putaway)
router.post('/:id/cancel',  ctrl.cancel)

module.exports = router
