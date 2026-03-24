const { Router } = require('express')
const { z } = require('zod')
const svc = require('./warehouse-tasks.service')
const { successResponse } = require('../../utils/response')
const { authMiddleware } = require('../../middleware/auth')
const { pool } = require('../../config/db')

const { WT_STATUS } = require('../../constants/warehouseTaskStatus')

async function getOp(userId) {
  const [[u]] = await pool.query('SELECT id, username, real_name FROM sys_users WHERE id=?', [userId])
  return { userId: u.id, username: u.username, realName: u.real_name }
}

const router = Router()
router.use(authMiddleware)

function vBody(schema) {
  return (req, res, next) => {
    const r = schema.safeParse(req.body)
    if (!r.success) return res.status(400).json({ success: false, message: r.error.errors.map(e => e.message).join('；'), data: null })
    req.body = r.data; next()
  }
}

// GET /api/warehouse-tasks — 列表（支持 status / warehouseId / keyword / page / pageSize）
router.get('/', async (req, res, next) => {
  try {
    const { page=1, pageSize=20, keyword='', status, warehouseId } = req.query
    const data = await svc.findAll({ page:+page, pageSize:+pageSize, keyword, status:status?+status:null, warehouseId:warehouseId?+warehouseId:null })
    return successResponse(res, data, '查询成功')
  } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/my — PDA 任务池（status IN 1,2）
router.get('/my', async (req, res, next) => {
  try { return successResponse(res, await svc.findMyTasks(), '查询成功') } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/pick-suggestions — 推荐拣货容器
router.get('/:id/pick-suggestions', async (req, res, next) => {
  try { return successResponse(res, await svc.getPickSuggestions(+req.params.id)) } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/pick-route — 最优拣货路线
router.get('/:id/pick-route', async (req, res, next) => {
  try { return successResponse(res, await svc.getPickRoute(+req.params.id)) } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id — 详情（含明细）
router.get('/:id', async (req, res, next) => {
  try { return successResponse(res, await svc.findById(+req.params.id), '查询成功') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/assign — 分配操作员
router.put('/:id/assign', vBody(z.object({ userId: z.number().int().positive(), userName: z.string().min(1) })), async (req, res, next) => {
  try {
    await svc.assign(+req.params.id, req.body)
    return successResponse(res, null, '已分配')
  } catch (e) { next(e) }
})

// 仅允许 PDA 客户端调用的中间件（通过请求头 X-Client: pda 标识）
function pdaOnly(req, res, next) {
  const client = req.headers['x-client'] || ''
  if (client.toLowerCase() !== 'pda') {
    return res.status(403).json({ success: false, message: '此操作只能由 PDA 执行', data: null })
  }
  next()
}

// PUT /api/warehouse-tasks/:id/start-picking — 开始备货（1→2）
router.put('/:id/start-picking', pdaOnly, async (req, res, next) => {
  try { await svc.startPicking(+req.params.id); return successResponse(res, null, '备货已开始') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/items/:itemId/picked-qty — 更新已备货数量
router.put('/:id/items/:itemId/picked-qty', vBody(z.object({ pickedQty: z.number().nonnegative() })), async (req, res, next) => {
  try {
    await svc.updatePickedQty(+req.params.id, +req.params.itemId, req.body.pickedQty)
    return successResponse(res, null, '更新成功')
  } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/ready — 拣货完成，待分拣（2→3）
router.put('/:id/ready', pdaOnly, async (req, res, next) => {
  try { await svc.readyToShip(+req.params.id); return successResponse(res, null, '已标记为待分拣') } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/events — 查询任务事件历史
router.get('/:id/events', async (req, res, next) => {
  try {
    const [events] = await pool.query(
      `SELECT id, event_type, from_status, to_status, operator_name, detail, created_at
       FROM warehouse_task_events
       WHERE task_id=?
       ORDER BY created_at ASC`,
      [+req.params.id],
    )
    return successResponse(res, events, 'ok')
  } catch (e) { next(e) }
})

// GET /api/warehouse-tasks/:id/debug — 任务完整数据快照（调试用）
// 一次返回任务在所有关联表的完整状态，用于快速定位流程问题
router.get('/:id/debug', async (req, res, next) => {
  try {
    const taskId = +req.params.id

    // 1. 任务主体
    const [[task]] = await pool.query(
      `SELECT t.*,
              wh.name AS warehouse_name_full,
              sb.code AS sorting_bin_code_live,
              sb.status AS sorting_bin_status_live,
              sb.current_task_id AS sorting_bin_task_id_live
       FROM warehouse_tasks t
       LEFT JOIN inventory_warehouses wh ON wh.id = t.warehouse_id
       LEFT JOIN sorting_bins         sb ON sb.current_task_id = t.id
       WHERE t.id = ?`,
      [taskId],
    )
    if (!task) return res.status(404).json({ success: false, message: '任务不存在', data: null })

    // 2. 任务明细（含 sorted_qty / checked_qty）
    const [items] = await pool.query(
      `SELECT id, product_id, product_code, product_name, unit,
              required_qty, picked_qty, sorted_qty, checked_qty
       FROM warehouse_task_items WHERE task_id=? ORDER BY id`,
      [taskId],
    )

    // 3. 容器锁（被本任务锁定的容器）
    const [lockedContainers] = await pool.query(
      `SELECT ic.id, ic.barcode, ic.remaining_qty, ic.status,
              ic.locked_by_task_id, ic.locked_at,
              p.name AS product_name,
              loc.code AS location_code
       FROM inventory_containers ic
       LEFT JOIN product_items        p   ON p.id   = ic.product_id
       LEFT JOIN warehouse_locations  loc ON loc.id = ic.location_id
       WHERE ic.locked_by_task_id = ?
         AND ic.deleted_at IS NULL`,
      [taskId],
    )

    // 4. 打包信息
    const [packages] = await pool.query(
      `SELECT p.id, p.barcode, p.status,
              COUNT(pi.id) AS item_types,
              SUM(pi.qty)  AS total_qty
       FROM packages p
       LEFT JOIN package_items pi ON pi.package_id = p.id
       WHERE p.warehouse_task_id = ?
       GROUP BY p.id`,
      [taskId],
    )

    // 5. 分拣格实时状态
    const [[sortingBin]] = await pool.query(
      `SELECT id, code, status, current_task_id
       FROM sorting_bins WHERE id = ?`,
      [task.sorting_bin_id || 0],
    ).catch(() => [[null]])

    // 6. 事件历史（最近 20 条）
    const [events] = await pool.query(
      `SELECT id, event_type, from_status, to_status, operator_name, detail, created_at
       FROM warehouse_task_events
       WHERE task_id=?
       ORDER BY created_at DESC LIMIT 20`,
      [taskId],
    ).catch(() => [[]])

    // 7. 扫码日志（最近 10 条）
    const [scanLogs] = await pool.query(
      `SELECT id, barcode, action, result, operator_name, created_at
       FROM scan_logs
       WHERE task_id=?
       ORDER BY created_at DESC LIMIT 10`,
      [taskId],
    ).catch(() => [[]])

    // 8. 数据一致性快速检查
    const checks = []
    if (items.some(i => Number(i.sorted_qty) > Number(i.picked_qty))) {
      checks.push({ level: 'error', msg: 'sorted_qty 超出 picked_qty，数据异常' })
    }
    if (items.some(i => Number(i.checked_qty) > Number(i.required_qty))) {
      checks.push({ level: 'error', msg: 'checked_qty 超出 required_qty，数据异常' })
    }
    if (task.sorting_bin_id && sortingBin && sortingBin.current_task_id !== taskId) {
      checks.push({ level: 'warn', msg: `分拣格 ${sortingBin.code} 的 current_task_id 与任务不一致` })
    }
    if ([2,3,4,5].includes(task.status) && items.length === 0) {
      checks.push({ level: 'error', msg: '进行中任务无明细记录，流程无法推进' })
    }
    const { WT_STATUS_NAME } = require('../../constants/warehouseTaskStatus')
    if (checks.length === 0) checks.push({ level: 'ok', msg: '数据一致性检查通过' })

    return successResponse(res, {
      snapshot: {
        task: {
          id:               task.id,
          taskNo:           task.task_no,
          status:           task.status,
          statusName:       WT_STATUS_NAME[task.status] ?? task.status,
          priority:         task.priority,
          customerName:     task.customer_name,
          warehouseId:      task.warehouse_id,
          warehouseName:    task.warehouse_name_full,
          assignedName:     task.assigned_name,
          sortingBinId:     task.sorting_bin_id,
          sortingBinCode:   task.sorting_bin_code,
          createdAt:        task.created_at,
          updatedAt:        task.updated_at,
          shippedAt:        task.shipped_at,
        },
        items: items.map(i => ({
          id:          i.id,
          productCode: i.product_code,
          productName: i.product_name,
          unit:        i.unit,
          requiredQty: Number(i.required_qty),
          pickedQty:   Number(i.picked_qty),
          sortedQty:   Number(i.sorted_qty ?? 0),
          checkedQty:  Number(i.checked_qty ?? 0),
          pickProgress:  `${i.picked_qty}/${i.required_qty}`,
          sortProgress:  `${i.sorted_qty ?? 0}/${i.picked_qty}`,
          checkProgress: `${i.checked_qty ?? 0}/${i.required_qty}`,
        })),
        sortingBin: sortingBin ? {
          id:            sortingBin.id,
          code:          sortingBin.code,
          status:        sortingBin.status,
          statusName:    sortingBin.status === 1 ? '空闲' : '占用',
          currentTaskId: sortingBin.current_task_id,
          consistent:    sortingBin.current_task_id === taskId,
        } : null,
        lockedContainers: lockedContainers.map(c => ({
          id:           c.id,
          barcode:      c.barcode,
          productName:  c.product_name,
          remainingQty: Number(c.remaining_qty),
          status:       c.status,
          locationCode: c.location_code,
          lockedAt:     c.locked_at,
        })),
        packages: packages.map(p => ({
          id:         p.id,
          barcode:    p.barcode,
          status:     p.status,
          statusName: p.status === 2 ? '已完成' : '打包中',
          itemTypes:  Number(p.item_types ?? 0),
          totalQty:   Number(p.total_qty ?? 0),
        })),
        recentEvents:  events,
        recentScanLogs: scanLogs,
        consistencyChecks: checks,
      },
    }, '任务数据快照')
  } catch (e) { next(e) }
})


// body 可选：{ items: [{itemId, sortedQty}] } — 逐件上报时传入；不传则视为整任务完成
router.put('/:id/sort-done', pdaOnly, async (req, res, next) => {
  try {
    const sortedItems = req.body?.items ?? null
    const result = await svc.sortTask(+req.params.id, sortedItems)
    const msg = result.allSorted ? '分拣完成，已进入待复核' : `分拣进度 ${result.progress}，继续操作`
    return successResponse(res, result, msg)
  } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/check-done — 复核完成，待打包（4→5）
router.put('/:id/check-done', pdaOnly, async (req, res, next) => {
  try { await svc.checkDone(+req.params.id); return successResponse(res, null, '已标记为待打包') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/pack-done — 打包完成，待出库（5→6）
router.put('/:id/pack-done', pdaOnly, async (req, res, next) => {
  try { await svc.packDone(+req.params.id); return successResponse(res, null, '已标记为待出库') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/ship — 执行出库（3→4）
// 在 route 层获取销售单数据，消除 WMS service → ERP service 循环依赖
router.put('/:id/ship', pdaOnly, async (req, res, next) => {
  try {
    const taskId = +req.params.id
    const op     = await getOp(req.user.userId)

    // 读取任务以获取关联销售单ID
    const task = await svc.findById(taskId)
    if (task.status !== WT_STATUS.SHIPPING) return res.status(400).json({ success: false, message: '只有"待出库"状态可以执行出库', data: null })

    // 在 route 层直接查询销售单（避免 WMS service 依赖 ERP service）
    const [[saleOrder]] = await pool.query(
      'SELECT id, order_no, status, warehouse_id, total_amount, customer_name FROM sale_orders WHERE id=?',
      [task.saleOrderId]
    )
    if (!saleOrder)          return res.status(404).json({ success: false, message: '关联销售单不存在', data: null })
    if (saleOrder.status === 4) return res.status(400).json({ success: false, message: '对应销售单已出库', data: null })
    if (saleOrder.status === 5) return res.status(400).json({ success: false, message: '对应销售单已取消', data: null })

    const [saleItems] = await pool.query(
      'SELECT product_id, product_name, product_code, unit, quantity, unit_price FROM sale_order_items WHERE order_id=?',
      [saleOrder.id]
    )

    await svc.ship(taskId, op, {
      saleOrderId:  saleOrder.id,
      warehouseId:  saleOrder.warehouse_id,
      totalAmount:  Number(saleOrder.total_amount),
      customerName: saleOrder.customer_name,
      items: saleItems.map(i => ({
        productId:   i.product_id,
        productName: i.product_name,
        quantity:    Number(i.quantity),
        unitPrice:   Number(i.unit_price),
      })),
    })
    return successResponse(res, null, '出库成功')
  } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/check — 复核明细
router.put('/:id/check',
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
router.put('/:id/cancel', (req, res, next) => {
  const client = (req.headers['x-client'] || '').toLowerCase()
  if (client === 'pda') {
    return res.status(403).json({ success: false, message: 'PDA 不允许取消任务，请在 ERP 后台操作', data: null })
  }
  next()
}, async (req, res, next) => {
  try { await svc.cancel(+req.params.id); return successResponse(res, null, '任务已取消') } catch (e) { next(e) }
})

// PUT /api/warehouse-tasks/:id/priority — 修改优先级
router.put('/:id/priority', vBody(z.object({ priority: z.number().int().min(1).max(3) })), async (req, res, next) => {
  try { await svc.updatePriority(+req.params.id, req.body.priority); return successResponse(res, null, '优先级已更新') } catch (e) { next(e) }
})

module.exports = router
