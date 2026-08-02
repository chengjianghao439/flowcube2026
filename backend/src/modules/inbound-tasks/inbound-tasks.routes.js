const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./inbound-tasks.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { pdaSessionRequired } = require('../../middleware/pdaSession')
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

function vParams(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.params)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.params = r.data; next()
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
// 超收原因码：确认超收时必须说明为什么多收，写进 over_receive 事件供财务追溯
const overReceiveReason = z.enum(['supplier_over_delivery', 'previous_short_makeup', 'scan_mistake', 'other'])
const receiveSchema = z.union([
  z.object({
    productId: z.number().int().positive('商品无效'),
    qty:       z.number().positive('本包数量必须大于 0'),
    serialNos: z.array(z.string().trim().min(1)).optional(),
    confirmOverReceive: z.boolean().optional(),
    confirmDuplicate: z.boolean().optional(),
    overReceiveReason: overReceiveReason.optional(),
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
        serialNos: z.array(z.string().trim().min(1)).optional(),
      }),
    ).min(1, '请至少填写一箱数量'),
    confirmOverReceive: z.boolean().optional(),
    confirmDuplicate: z.boolean().optional(),
    overReceiveReason: overReceiveReason.optional(),
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

// 来料质检（文档 07）：合格量(含让步接收) + 拒收量，至少一项 > 0；concessionQty 是合格量的子集（旁路统计）
const qaCheckSchema = z.object({
  productId: z.number().int().positive('请选择商品'),
  passedQty: z.number().nonnegative('合格量不能为负').default(0),
  rejectedQty: z.number().nonnegative('拒收量不能为负').default(0),
  concessionQty: z.number().nonnegative('让步接收量不能为负').default(0),
  reason: z.string().trim().max(100).optional(),
}).refine(v => (v.passedQty + v.rejectedQty) > 0, { message: '合格量与拒收量至少一项大于 0' })
  .refine(v => v.concessionQty <= v.passedQty, { message: '让步接收量不能超过合格量' })

// 质检拒收处置（文档 07 · Phase 2）：退供应商(1)/报废(2)，可选按商品过滤。ERP 侧后台决策。
const qaDisposeSchema = z.object({
  dispositionType: z.number().int().refine(v => v === 1 || v === 2, '请选择处置方式（1退供应商 / 2报废）'),
  productIds: z.array(z.number().int().positive()).optional(),
  reason: z.string().trim().max(200).optional(),
  remark: z.string().trim().max(200).optional(),
})

// 拒收处置 PDA 物理扫出（文档 07 · Phase 3）：扫一个 REJECTED 容器码确认出场
const disposeScanSchema = z.object({ barcode: z.string().trim().min(1, '请扫描容器条码') })
const dispositionIdParam = z.object({ dispositionId: z.coerce.number().int().positive('处置单 id 必须为正整数') })

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
// 供应商来料质检合格率报表（文档07 Phase3，只读聚合）
router.get('/qa-supplier-report', requirePermission(PERMISSIONS.REPORT_VIEW), ctrl.qaSupplierReport)
// 拒收处置 PDA 物理扫出（文档07 Phase3）：待扫出列表 / 扫出详情（只读）/ 扫一个容器码确认出场（PDA-only+设备会话）
// 注意：静态 /qa-dispositions/* 必须注册在 /:id 动态路由之前，否则被 /:id 吞掉
router.get('/qa-dispositions/pending', requirePermission(PERMISSIONS.INBOUND_QA_DISPOSE), ctrl.qaDisposePending)
router.get('/qa-dispositions/:dispositionId/scan-detail', requirePermission(PERMISSIONS.INBOUND_QA_DISPOSE), vParams(dispositionIdParam), ctrl.qaDisposeScanDetail)
router.post('/qa-dispositions/:dispositionId/scan-out', requirePermission(PERMISSIONS.INBOUND_QA_DISPOSE), pdaSessionRequired(), pdaOnly, vParams(dispositionIdParam), vBody(disposeScanSchema), ctrl.qaDisposeScanOut)
router.get('/',              requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.list)
router.post('/',             requirePermission(PERMISSIONS.INBOUND_ORDER_CREATE), vBody(createSchema), ctrl.create)
router.get('/:id/containers', requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.containers)
router.get('/:id',           requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.detail)
router.post('/:id/submit',   requirePermission(PERMISSIONS.INBOUND_ORDER_SUBMIT), ctrl.submit)
router.post('/:id/reprint',  requirePermission(PERMISSIONS.INBOUND_PRINT_REPRINT), vBody(reprintSchema), ctrl.reprint)
router.post('/:id/receive',  requirePermission(PERMISSIONS.INBOUND_RECEIVE_EXECUTE), pdaSessionRequired(), pdaOnly, vBody(receiveSchema), ctrl.receive)
router.get('/:id/putaway-suggestion', requirePermission(PERMISSIONS.INBOUND_PUTAWAY_EXECUTE), putawaySuggestionHandler)
router.post('/:id/putaway', requirePermission(PERMISSIONS.INBOUND_PUTAWAY_EXECUTE), pdaSessionRequired(), pdaOnly, vBody(putawaySchema), ctrl.putaway)
// 来料质检（文档 07 · 方案A）：复用收货执行权限（收货员即初检员），PDA-only + 设备会话
router.post('/:id/check', requirePermission(PERMISSIONS.INBOUND_RECEIVE_EXECUTE), pdaSessionRequired(), pdaOnly, vBody(qaCheckSchema), ctrl.qaCheck)
// 拒收处置（文档 07 · Phase 2）：退供应商/报废，只消费 REJECTED 容器、零 GL。后台管理决策，
// 非 PDA 现场作业，故 ERP 侧（不挂 pdaOnly），与 voidReceipt 一样属"管理动作而非扫码作业"。
router.post('/:id/qa-dispose', requirePermission(PERMISSIONS.INBOUND_QA_DISPOSE), vBody(qaDisposeSchema), ctrl.qaDispose)
router.get('/:id/qa-dispositions', requirePermission(PERMISSIONS.INBOUND_ORDER_VIEW), ctrl.qaDispositions)
router.post('/:id/cancel',  requirePermission(PERMISSIONS.INBOUND_ORDER_CANCEL), ctrl.cancel)
router.post('/:id/void-receipt', requirePermission(PERMISSIONS.INBOUND_ORDER_CANCEL), ctrl.voidReceipt)
router.post('/:id/close-receiving', requirePermission(PERMISSIONS.INBOUND_ORDER_CANCEL), ctrl.closeReceiving)

module.exports = router
