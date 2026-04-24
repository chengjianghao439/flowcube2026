const { Router } = require('express')
const { z } = require('zod')
const svc = require('./warehouse-tasks.service')
const { successResponse } = require('../../utils/response')
const { extractRequestKey } = require('../../utils/requestKey')
const { authMiddleware, requirePermission } = require('../../middleware/auth')
const { PERMISSIONS } = require('../../constants/permissions')
const { getOperatorFromRequest } = require('../../utils/operator')
const AppError = require('../../utils/AppError')
const { asyncRoute, validateBody } = require('../../utils/route')

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return validateBody(schema)
}

// GET /api/warehouse-tasks — 列表（支持 status / warehouseId / keyword / page / pageSize）
router.get('/', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), async (req, res, next) => {
  try {
    const { page=1, pageSize=20, keyword='', status, warehouseId } = req.query
    const data = await svc.findAll({ page:+page, pageSize:+pageSize, keyword, status:status?+status:null, warehouseId:warehouseId?+warehouseId:null })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/my — PDA 任务池（status IN 1,2）
router.get('/my', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), async (req, res, next) => {
  try { return successResponse(res, await svc.findMyTasks(), '查询成功') } catch (e) { next(e) }
})

router.get('/my-sku-summary', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), async (req, res, next) => {
  try { return successResponse(res, await svc.findMyTaskSkuSummary(), '查询成功') } catch (e) { next(e) }
})

router.get('/stats', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), async (req, res, next) => {
  try { return successResponse(res, await svc.getTaskStats(), '查询成功') } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/pick-suggestions — 推荐拣货容器
router.get('/:id/pick-suggestions', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), async (req, res, next) => {
  try { return successResponse(res, await svc.getPickSuggestions(+req.params.id)) } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/pick-route — 最优拣货路线
router.get('/:id/pick-route', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), async (req, res, next) => {
  try { return successResponse(res, await svc.getPickRoute(+req.params.id)) } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id — 详情（含明细）
router.get('/:id', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/assign — 分配操作员
router.put('/:id/assign', requirePermission(PERMISSIONS.WAREHOUSE_TASK_ASSIGN), vBody(z.object({ userId: z.number().int().positive(), userName: z.string().min(1) })), async (req, res, next) => {
  try {
    await svc.assign(+req.params.id, req.body)
    return successResponse(res, null, '已分配')
  } catch (e) { next(e) }
})

// 仅允许 PDA 客户端调用的中间件（通过请求头 X-Client: pda 标识）
function pdaOnly(req, res, next) {
  const client = req.headers['x-client'] || ''
  if (client.toLowerCase() !== 'pda') {
    return next(new AppError('此操作只能由 PDA 执行', 403, 'PDA_ONLY'))
  }
  next()
}

// PUT /api/warehouse-tasks/:id/start-picking — 开始备货（1→2）
router.put('/:id/start-picking', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PICK), pdaOnly, async (req, res, next) => {
  try { await svc.startPicking(+req.params.id); return successResponse(res, null, '备货已开始') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/items/:itemId/picked-qty — 已禁用（已拣数量仅允许由 PDA 拣货扫码累加）
router.put('/:id/items/:itemId/picked-qty', asyncRoute(async (req) => {
  const client = (req.headers['x-client'] || '').toLowerCase()
  if (client !== 'pda') {
    throw new AppError('此操作只能由 PDA 执行', 403, 'PDA_ONLY')
  }
  throw new AppError('已拣数量仅可通过拣货扫码写入，禁止手动修改', 400, 'PICK_QTY_MANUAL_UPDATE_DISABLED')
}))

// PUT /api/warehouse-tasks/:id/ready — 拣货完成，待分拣（2→3）
router.put('/:id/ready', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CHECK), pdaOnly, async (req, res, next) => {
  try {
    const data = await svc.readyToShip(+req.params.id, {
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
    })
    return successResponse(res, data, '已标记为待分拣')
  } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/events — 查询任务事件历史
router.get('/:id/events', requirePermission(PERMISSIONS.WAREHOUSE_TASK_VIEW), async (req, res, next) => {
  try {
    return successResponse(res, await svc.findEvents(+req.params.id), 'ok')
  } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/debug — 任务完整数据快照（调试用）
// 一次返回任务在所有关联表的完整状态，用于快速定位流程问题
router.get('/:id/debug', requirePermission(PERMISSIONS.WAREHOUSE_TASK_DEBUG), async (req, res, next) => {
  try {
    return successResponse(res, await svc.getDebugSnapshot(+req.params.id), '任务数据快照')
  } catch (e) { next(e) }
})


// body 可选：{ items: [{itemId, sortedQty}] } — 逐件上报时传入；不传则视为整任务完成
router.put('/:id/sort-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_SORT), pdaOnly, async (req, res, next) => {
  try {
    const sortedItems = req.body?.items ?? null
    const result = await svc.sortTask(+req.params.id, sortedItems, {
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
    })
    const msg = result.allSorted ? '分拣完成，已进入待复核' : `分拣进度 ${result.progress}，继续操作`
    return successResponse(res, result, msg)
  } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/check-done — 复核完成，待打包（4→5）
router.put('/:id/check-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CHECK_DONE), pdaOnly, async (req, res, next) => {
  try { await svc.checkDone(+req.params.id); return successResponse(res, null, '已标记为待打包') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/pack-done — 打包完成，待出库（5→6）
router.put('/:id/pack-done', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PACK_DONE), pdaOnly, async (req, res, next) => {
  try {
    const data = await svc.packDone(+req.params.id, {
      requestKey: extractRequestKey(req),
      userId: req.user?.userId ?? null,
    })
    return successResponse(res, data, '已标记为待出库')
  } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/ship — 执行出库（6→7）
// 在 route 层获取销售单数据，消除 WMS service → ERP service 循环依赖
router.put('/:id/ship', requirePermission(PERMISSIONS.WAREHOUSE_TASK_SHIP), pdaOnly, async (req, res, next) => {
  try {
    const taskId = +req.params.id
    const data = await svc.ship(taskId, getOperatorFromRequest(req), await svc.getShipContext(taskId), {
      requestKey: extractRequestKey(req),
    })
    return successResponse(res, data, '出库成功')
  } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/check — 已关闭手动复核（须 POST /scan-logs/check）
router.put('/:id/check',
  pdaOnly,
  vBody(z.object({
    items: z.array(z.object({
      itemId:     z.number().int().positive(),
      checkedQty: z.number().nonnegative('复核数量不能为负'),
    })).min(1, '至少提交一条复核明细'),
  })),
  async (req, res, next) => {
    try {
      const result = await svc.checkItems(+req.params.id, req.body.items)
      return successResponse(res, result, result.allChecked ? '复核完成，所有商品已核验' : '复核已保存')
    } catch (e) { next(e) }
  },
)

// PUT /api/warehouse-tasks/:id/cancel — 取消任务（仅 ERP 后台，PDA 不允许调用）
router.put('/:id/cancel', requirePermission(PERMISSIONS.WAREHOUSE_TASK_CANCEL), (req, res, next) => {
  const client = (req.headers['x-client'] || '').toLowerCase()
  if (client === 'pda') {
    return next(new AppError('PDA 不允许取消任务，请在 ERP 后台操作', 403, 'PDA_CANCEL_FORBIDDEN'))
  }
  next()
}, async (req, res, next) => {
  try {
    await svc.cancel(+req.params.id, { operator: getOperatorFromRequest(req) })
    return successResponse(res, null, '任务已取消')
  } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/priority — 修改优先级
router.put('/:id/priority', requirePermission(PERMISSIONS.WAREHOUSE_TASK_PRIORITY), vBody(z.object({ priority: z.number().int().min(1).max(3) })), async (req, res, next) => {
  try { await svc.updatePriority(+req.params.id, req.body.priority); return successResponse(res, null, '优先级已更新') } catch (e) { next(e) }
})

module.exports = router
