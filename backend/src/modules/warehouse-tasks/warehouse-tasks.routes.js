const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./warehouse-tasks.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')
const { pdaSessionOptional } = require('../../middleware/pdaSession')
const { pdaOnly } = require('../../middleware/pdaOnly')
const AppError = require('../../utils/AppError')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return validateBody(schema)
}

// GET /api/warehouse-tasks — 列表
router.get('/', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.list)

// GET /api/warehouse-tasks/my — PDA 任务池
router.get('/my', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.myTasks)

router.get('/my-sku-summary', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.myTaskSkuSummary)

router.get('/stats', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.stats)

// GET /api/warehouse-tasks/cancel-returns/pending — PDA「取消清理」任务池（必须在 /:id 之前注册）
router.get('/cancel-returns/pending', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CANCEL_RETURN_VIEW), ctrl.pendingCancelReturns)

// GET /api/warehouse-tasks/adjustments/pending — PDA「改单确认」任务池（必须在 /:id 之前注册）
// 缺货上报：PDA 上报事实，ERP 决策（按实拣改单/驳回）。处理与销售改单同权限。
router.get('/shortages/pending', requirePermission(PERMISSIONS.SALE_ORDER_UPDATE), ctrl.pendingShortages)
router.post('/shortages/:shortageId/resolve', requirePermission(PERMISSIONS.SALE_ORDER_UPDATE), vBody(z.object({ action: z.enum(['adjustToPicked', 'dismiss']) })), ctrl.resolveShortage)

router.get('/adjustments/pending', requirePermission(PERMISSIONS.WAREHOUSE_TASK_ADJUST_VIEW), ctrl.pendingAdjustments)

// GET /api/warehouse-tasks/adjustments/:id — 改单确认详情
router.get('/adjustments/:id', requirePermission(PERMISSIONS.WAREHOUSE_TASK_ADJUST_VIEW), ctrl.adjustmentDetail)

// POST /api/warehouse-tasks/adjustments/package-voids/:voidId/confirm — PDA 扫码确认拆箱
router.post('/adjustments/package-voids/:voidId/confirm', requirePermission(PERMISSIONS.WAREHOUSE_TASK_ADJUST), pdaOnly, pdaSessionOptional(), ctrl.confirmAdjustmentPackageVoid)

// POST /api/warehouse-tasks/adjustments/container-returns/:returnId/confirm — PDA 扫码确认归还库位
router.post('/adjustments/container-returns/:returnId/confirm', requirePermission(PERMISSIONS.WAREHOUSE_TASK_ADJUST), pdaOnly, pdaSessionOptional(), vBody(z.object({ targetLocationId: z.number().int().positive().optional().nullable() })), ctrl.confirmAdjustmentContainerReturn)

// GET /api/warehouse-tasks/:id/pick-suggestions
router.get('/:id/shortages', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.taskShortages)

router.post('/:id/report-shortage', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), pdaOnly, pdaSessionOptional(), vBody(z.object({
  productId: z.number().int().positive('商品无效'),
  missingQty: z.number().positive('缺口数量必须大于 0'),
  reason: z.string().trim().max(200).optional(),
})), ctrl.reportShortage)

router.get('/:id/pick-suggestions', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), ctrl.pickSuggestions)

// GET /api/warehouse-tasks/:id/pick-route
router.get('/:id/pick-route', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), ctrl.pickRoute)

// GET /api/warehouse-tasks/:id/cancel-return-detail — 取消逆向归还详情
router.get('/:id/cancel-return-detail', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CANCEL_RETURN_VIEW), ctrl.cancelReturnDetail)

// GET /api/warehouse-tasks/:id — 详情
router.get('/:id', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.detail)

// PUT /api/warehouse-tasks/:id/assign — 分配操作员
router.put('/:id/assign', requirePermission(PERMISSIONS.WAREHOUSE_TASK_ASSIGN), vBody(z.object({ userId: z.number().int().positive(), userName: z.string().min(1) })), ctrl.assign)

// PUT /api/warehouse-tasks/:id/start-picking — 开始备货（1→2）
router.put('/:id/start-picking', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), pdaOnly, pdaSessionOptional(), ctrl.startPicking)

// PUT /api/warehouse-tasks/:id/items/:itemId/picked-qty — 已禁用
router.put('/:id/items/:itemId/picked-qty', ctrl.pickedQtyDeprecated)

// PUT /api/warehouse-tasks/:id/ready — 拣货完成，待分拣（2→3）
router.put('/:id/ready', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CHECK), pdaOnly, pdaSessionOptional(), ctrl.readyToShip)

// GET /api/warehouse-tasks/:id/events — 任务事件历史
router.get('/:id/events', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.findEvents)

// GET /api/warehouse-tasks/:id/debug — 任务完整数据快照
router.get('/:id/debug', requirePermission(PERMISSIONS.WAREHOUSE_TASK_DEBUG), ctrl.debugSnapshot)

// PUT /api/warehouse-tasks/:id/sort-done — 分拣完成上报
router.put('/:id/sort-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_SORT), pdaOnly, pdaSessionOptional(), ctrl.sortDone)

// PUT /api/warehouse-tasks/:id/check-done — 复核完成，待打包（4→5）
router.put('/:id/check-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CHECK_DONE), pdaOnly, pdaSessionOptional(), ctrl.checkDone)

// PUT /api/warehouse-tasks/:id/pack-done — 打包完成，待出库（5→6）
router.put('/:id/pack-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK_DONE), pdaOnly, pdaSessionOptional(), ctrl.packDone)

// PUT /api/warehouse-tasks/:id/ship — 执行出库（6→7）
router.put('/:id/ship', requirePermission(PERMISSIONS.WAREHOUSE_TASK_SHIP), pdaOnly, pdaSessionOptional(), ctrl.ship)

// PUT /api/warehouse-tasks/:id/check — 已关闭手动复核
router.put('/:id/check', ctrl.manualCheckDeprecated)

// PUT /api/warehouse-tasks/:id/cancel — 取消任务（仅 ERP 后台，PDA 不允许调用）
router.put('/:id/cancel', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CANCEL), (req, res, next) => {
  const client = (req.headers['x-client'] || '').toLowerCase()
  if (client === 'pda') {
    return next(new AppError('请在电脑端 ERP 中取消任务', 403, 'PDA_CANCEL_FORBIDDEN'))
  }
  next()
}, ctrl.cancel)

// PUT /api/warehouse-tasks/:id/priority — 修改优先级
router.put('/:id/priority', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PRIORITY), vBody(z.object({ priority: z.number().int().min(1).max(3) })), ctrl.updatePriority)

module.exports = router
