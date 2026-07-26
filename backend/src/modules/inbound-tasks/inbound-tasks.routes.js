const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./inbound-tasks.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { pdaSessionOptional } = require('../../middleware/pdaSession')
const { pdaOnly } = require('../../middleware/pdaOnly')
const { putawaySuggestionHandler } = require('./inbound-tasks.suggestion')

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
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日期格式须为 YYYY-MM-DD')
const receiveSchema = z.union([
  z.object({
    productId: z.number().int().positive('商品无效'),
    qty:       z.number().positive('本包数量必须大于 0'),
    confirmOverReceive: z.boolean().optional(),
    confirmDuplicate: z.boolean().optional(),
    scannedBarcode: z.string().trim().min(1).optional(),
    batchNo: z.string().trim().max(50).optional(),
    mfgDate: dateStr.optional(),
    expDate: dateStr.optional(),
  }),
  z.object({
    productId: z.number().int().positive('商品无效'),
    packages: z.array(
      z.object({
        qty: z.number().positive('箱数量必须大于 0'),
      }),
    ).min(1, '请至少填写一箱数量'),
    confirmOverReceive: z.boolean().optional(),
    confirmDuplicate: z.boolean().optional(),
    scannedBarcode: z.string().trim().min(1).optional(),
    batchNo: z.string().trim().max(50).optional(),
    mfgDate: dateStr.optional(),
    expDate: dateStr.optional(),
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
      confirmOverReceive: z.boolean().optional(),
      confirmDuplicate: z.boolean().optional(),
    })
    .refine(d => new Set(d.items.map(item => item.productId)).size === 1, {
      message: '同一次收货仅允许提交同一商品',
      path: ['items'],
    })
    .transform(d => {
      return {
        productId: d.items[0].productId,
        packages: d.items.map(item => ({ qty: item.qty })),
        confirmOverReceive: d.confirmOverReceive,
        confirmDuplicate: d.confirmDuplicate,
      }
    }),
])

const putawaySchema = z.object({
  containerId: z.number().int().positive('请选择容器'),
  locationId:  z.number().int().positive('请选择库位'),
  // 定向上架偏离留痕：PDA 扫到非推荐库位并确认后带上，仅记录事件不拦截
  deviatedFromSuggestion: z.boolean().optional(),
  suggestedLocationCode: z.string().trim().max(50).optional(),
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

router.get('/pending-containers', requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.pendingContainers)
router.get('/purchase-items', requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.purchaseItems)
router.get('/',              requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.list)
router.post('/',             requirePermission(PERMISSIONS.INBOUND_ORDER_CREATE), vBody(createSchema), ctrl.create)
router.get('/:id/containers', requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.containers)
router.get('/:id',           requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.detail)
router.post('/:id/submit',   requirePermission(PERMISSIONS.INBOUND_ORDER_SUBMIT), ctrl.submit)
router.post('/:id/reprint',  requirePermission(PERMISSIONS.INBOUND_PRINT_REPRINT), vBody(reprintSchema), ctrl.reprint)
router.post('/:id/receive',  requirePermission(PERMISSIONS.INBOUND_RECEIVE_EXECUTE), pdaSessionOptional(), pdaOnly, vBody(receiveSchema), ctrl.receive)
router.get('/:id/putaway-suggestion', requirePermission(PERMISSIONS.INBOUND_PUTAWAY_EXECUTE), putawaySuggestionHandler)
router.post('/:id/putaway', requirePermission(PERMISSIONS.INBOUND_PUTAWAY_EXECUTE), pdaSessionOptional(), pdaOnly, vBody(putawaySchema), ctrl.putaway)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.INBOUND_ORDER_CANCEL), ctrl.cancel)
router.post('/:id/void-receipt', requirePermission(PERMISSIONS.INBOUND_ORDER_CANCEL), ctrl.voidReceipt)
router.post('/:id/close-receiving', requirePermission(PERMISSIONS.INBOUND_ORDER_CANCEL), ctrl.closeReceiving)

module.exports = router
