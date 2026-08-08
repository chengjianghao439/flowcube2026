const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./stockcheck.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { pdaOnly } = require('../../middleware/pdaOnly')
const { pdaSessionRequired } = require('../../middleware/pdaSession')
const router = Router()
const vBody = schema => (req,res,next) => { const r=schema.safeParse(req.body); if(!r.success) return res.status(400).json({success:false,message:r.error.errors.map(e=>e.message).join('；'),data:null}); req.body=r.data; next() }
const createSchema = z.object({
  warehouseId:z.number().int().positive('请选择仓库'), warehouseName:z.string(), remark:z.string().optional(),
  checkType:z.number().int().optional(),                                   // 1全盘 2循环抽盘
  scopeType:z.enum(['abc','zone','manual']).nullable().optional(),
  scopeValue:z.string().nullable().optional(),
  productIds:z.array(z.number().int().positive()).optional(),              // 抽盘命中的商品 id
})
const updateSchema = z.object({ items:z.array(z.object({ id:z.number().int().positive(), actualQty:z.number().nonnegative('实盘数量不能为负') })).min(1) })
// PDA 扫码盘点：某行现场扫到的容器集（整行替换语义，天然幂等；允许空数组 = 一个都没扫到 → 全行盘亏）
const scanSchema = z.object({ scans:z.array(z.object({ barcode:z.string().trim().min(1), countedQty:z.number().nonnegative().optional() })).max(20000) })
const cycleRulesSchema = z.object({
  warehouseId:z.number().int().nonnegative().optional(),                    // 0/省略=全局默认；>0=本仓 override
  rules:z.array(z.object({
    abcClass:z.enum(['A','B','C']),
    intervalDays:z.number().int().positive('盘点周期必须大于 0 天'),
    batchLimit:z.number().int().positive('单次上限必须大于 0'),
    enabled:z.boolean().optional(),
  })).min(1),
})
router.use(authMiddleware)
router.get('/',              requirePermission(PERMISSIONS.STOCKCHECK_VIEW), ctrl.list)
// ABC/循环盘与 PDA 扫码盘点接口须在 /:id 之前注册，否则 /abc、/scan 会被 /:id 误匹配
router.get('/scan/pending',     requirePermission(PERMISSIONS.STOCKCHECK_VIEW), ctrl.pendingScanChecks)
router.get('/abc',              requirePermission(PERMISSIONS.STOCKCHECK_ABC_VIEW), ctrl.listAbc)
router.post('/abc/recompute',   requirePermission(PERMISSIONS.STOCKCHECK_ABC_MANAGE), ctrl.recomputeAbc)
router.get('/cycle/candidates', requirePermission(PERMISSIONS.STOCKCHECK_ABC_VIEW), ctrl.cycleCandidates)
router.get('/cycle/rules',      requirePermission(PERMISSIONS.STOCKCHECK_ABC_VIEW), ctrl.cycleRules)
router.put('/cycle/rules',      requirePermission(PERMISSIONS.STOCKCHECK_ABC_MANAGE), vBody(cycleRulesSchema), ctrl.saveCycleRules)
router.get('/:id',           requirePermission(PERMISSIONS.STOCKCHECK_VIEW), ctrl.detail)
router.post('/',             requirePermission(PERMISSIONS.STOCKCHECK_CREATE), vBody(createSchema), ctrl.create)
router.put('/:id/items',     requirePermission(PERMISSIONS.STOCKCHECK_UPDATE), vBody(updateSchema),  ctrl.update)
router.post('/:id/submit',   requirePermission(PERMISSIONS.STOCKCHECK_SUBMIT), ctrl.submit)
router.get('/:id/scan-items', requirePermission(PERMISSIONS.STOCKCHECK_VIEW), ctrl.scanItems)
router.post('/:id/items/:itemId/scan', requirePermission(PERMISSIONS.STOCKCHECK_UPDATE), pdaOnly, pdaSessionRequired(), vBody(scanSchema), ctrl.saveItemScans)
router.post('/:id/items/:itemId/refresh', requirePermission(PERMISSIONS.STOCKCHECK_UPDATE), ctrl.refreshItem)
router.post('/:id/cancel',   requirePermission(PERMISSIONS.STOCKCHECK_CANCEL), ctrl.cancel)
module.exports = router
