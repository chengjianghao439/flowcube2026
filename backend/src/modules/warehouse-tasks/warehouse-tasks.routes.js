const { Router } = require('express')
const { z } = require('zod')
const ctrl = require('./warehouse-tasks.controller')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { validateBody } = require('../../utils/route')
const { pdaSessionRequired } = require('../../middleware/pdaSession')
const { pdaOnly } = require('../../middleware/pdaOnly')

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

// GET /api/warehouse-tasks/:id/pick-suggestions
router.get('/:id/pick-suggestions', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), ctrl.pickSuggestions)

// GET /api/warehouse-tasks/:id/pick-route
router.get('/:id/pick-route', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), ctrl.pickRoute)

// GET /api/warehouse-tasks/:id — 详情
router.get('/:id', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.detail)

// PUT /api/warehouse-tasks/:id/assign — 分配操作员
router.put('/:id/assign', requirePermission(PERMISSIONS.WAREHOUSE_TASK_ASSIGN), vBody(z.object({ userId: z.number().int().positive(), userName: z.string().min(1) })), ctrl.assign)

// PUT /api/warehouse-tasks/:id/start-picking — 开始备货（1→2）
router.put('/:id/start-picking', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), pdaOnly, pdaSessionRequired(), ctrl.startPicking)

// PUT /api/warehouse-tasks/:id/items/:itemId/picked-qty — 已禁用
router.put('/:id/items/:itemId/picked-qty', ctrl.pickedQtyDeprecated)

// PUT /api/warehouse-tasks/:id/ready — 拣货完成，待分拣（2→3）
router.put('/:id/ready', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CHECK), pdaOnly, pdaSessionRequired(), ctrl.readyToShip)

// GET /api/warehouse-tasks/:id/events — 任务事件历史
router.get('/:id/events', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), ctrl.findEvents)

// GET /api/warehouse-tasks/:id/debug — 任务完整数据快照
router.get('/:id/debug', requirePermission(PERMISSIONS.WAREHOUSE_TASK_DEBUG), ctrl.debugSnapshot)

// PUT /api/warehouse-tasks/:id/sort-done — 分拣完成上报
router.put('/:id/sort-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_SORT), pdaOnly, pdaSessionRequired(), ctrl.sortDone)

// PUT /api/warehouse-tasks/:id/check-done — 复核完成，待打包（4→5）
router.put('/:id/check-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CHECK_DONE), pdaOnly, pdaSessionRequired(), ctrl.checkDone)

// PUT /api/warehouse-tasks/:id/pack-done — 打包完成，待出库（5→6）
router.put('/:id/pack-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK_DONE), pdaOnly, pdaSessionRequired(), ctrl.packDone)

// PUT /api/warehouse-tasks/:id/ship — 执行出库（6→7）
router.put('/:id/ship', requirePermission(PERMISSIONS.WAREHOUSE_TASK_SHIP), pdaOnly, pdaSessionRequired(), ctrl.ship)

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
