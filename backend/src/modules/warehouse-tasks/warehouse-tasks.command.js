const { commitFulfillment } = require('../fulfillment/fulfillment.refresh')
const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')
const { assertInScope } = require('../../utils/warehouseScope')
const { releaseByRef } = require('../../engine/reservationEngine')
const { unlockContainersByTask, lockStockDimension, CONTAINER_STATUS } = require('../../engine/containerEngine')
const { lockStatusRow, compareAndSetStatus } = require('../../utils/statusTransition')
const sortingBinSvc = require('../sorting-bins/sorting-bins.service')
const {
  WT_STATUS,
  WT_STATUS_TERMINAL,
  isValidTransition,
  assertWarehouseTaskAction,
} = require('../../constants/warehouseTaskStatus')
const { WT_EVENT, record: recordEvent } = require('./warehouse-task-events.service')
const { genTaskNo, logSideEffectFailure } = require('./warehouse-tasks.helpers')
const { findById } = require('./warehouse-tasks.query')

/**
 * 由销售单确认时自动调用，在事务外部创建任务（使用 pool）
 * 创建后自动为任务分配一个空闲分拣格
 * status=2 拣货中（跳过待拣货，直接可拣）
 */
async function createForSaleOrder({ saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName, items, conn: extConn }) {
  const useConn = extConn || pool
  const taskNo = await genTaskNo(useConn)
  const [r] = await useConn.query(
    `INSERT INTO warehouse_tasks (task_no,sale_order_id,sale_order_no,customer_id,customer_name,warehouse_id,warehouse_name,status,priority) VALUES (?,?,?,?,?,?,?,${WT_STATUS.PICKING},2)`,
    [taskNo, saleOrderId, saleOrderNo, customerId, customerName, warehouseId, warehouseName]
  )
  const taskId = r.insertId
  for (const item of items) {
    await useConn.query(
      `INSERT INTO warehouse_task_items (task_id,product_id,product_code,product_name,unit,article_number,spec,color,required_qty,picked_qty) VALUES (?,?,?,?,?,?,?,?,?,0)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.articleNumber || null, item.spec || null, item.color || null, item.quantity]
    )
  }
  // 自动分配分拣格（无空闲格时忽略，不阻断任务创建）
  // 注意：assignToTask 内部已使用 FOR UPDATE 行锁，保证原子性
  // 若分配部分失败，需回滚分拣格占用，避免孤立锁
  try {
    const bin = await sortingBinSvc.assignToTask(useConn, { warehouseId, taskId })
    if (bin) {
      await useConn.query(
        'UPDATE warehouse_tasks SET sorting_bin_id=?, sorting_bin_code=? WHERE id=?',
        [bin.binId, bin.binCode, taskId]
      )
      try {
        await recordEvent(useConn, { taskId, taskNo, eventType: WT_EVENT.SORTING_BIN_ASSIGNED, detail: { binCode: bin.binCode } })
      } catch (eventErr) {
        logSideEffectFailure('仓库任务事件写入失败：分拣格分配事件', eventErr, {
          taskId,
          taskNo,
          eventType: WT_EVENT.SORTING_BIN_ASSIGNED,
        })
      }
    }
  } catch (binErr) {
    // 分拣格分配失败：尝试释放可能已占用的格，确保不产生孤立锁
    logSideEffectFailure('分拣格自动分配失败，任务继续创建但进入待人工分配降级状态', binErr, {
      taskId,
      taskNo,
      warehouseId,
      degradation: 'sorting_bin_assignment_failed',
    })
    try {
      await sortingBinSvc.releaseByTask(useConn, taskId)
    } catch (releaseErr) {
      logSideEffectFailure('分拣格分配失败后的释放兜底也失败', releaseErr, {
        taskId,
        taskNo,
        degradation: 'sorting_bin_release_after_assignment_failed',
      })
    }
  }
  // 记录任务创建事件
  try {
    await recordEvent(useConn, {
      taskId, taskNo,
      eventType:  WT_EVENT.TASK_CREATED,
      toStatus:   WT_STATUS.PICKING,
      detail:     { itemCount: items.length },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：任务创建事件', eventErr, {
      taskId,
      taskNo,
      eventType: WT_EVENT.TASK_CREATED,
    })
  }
  return { taskId, taskNo }
}

/**
 * 为采购退货创建出库任务（仅拣货→出库，无分拣/复核/打包环节）
 */
async function createForPurchaseReturn({ returnId, returnNo, supplierName, warehouseId, warehouseName, items, conn }) {
  const taskNo = await genTaskNo(conn)
  const [r] = await conn.query(
    `INSERT INTO warehouse_tasks
       (task_no, task_type, return_id, sale_order_id, sale_order_no,
        customer_id, customer_name, warehouse_id, warehouse_name, status, priority)
     VALUES (?, 'purchase_return', ?, NULL, NULL, NULL, ?, ?, ?, ${WT_STATUS.PICKING}, 2)`,
    [taskNo, returnId, supplierName, warehouseId, warehouseName],
  )
  const taskId = r.insertId
  for (const item of items) {
    await conn.query(
      `INSERT INTO warehouse_task_items
         (task_id, product_id, product_code, product_name, unit, article_number, spec, color, required_qty, picked_qty, purchase_return_item_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [taskId, item.productId, item.productCode, item.productName, item.unit, item.articleNumber || null, item.spec || null, item.color || null, item.quantity,
        // 行级关联（迁移 247）：出库要按这一行取单价，否则同一退货单内同商品多行会被 JOIN 放大
        item.returnItemId != null ? Number(item.returnItemId) : null],
    )
  }
  try {
    await recordEvent(conn, {
      taskId, taskNo,
      eventType: WT_EVENT.TASK_CREATED,
      toStatus: WT_STATUS.PICKING,
      detail: { itemCount: items.length, taskType: 'purchase_return', returnId, returnNo },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：退货任务创建事件', eventErr, {
      taskId, taskNo, eventType: WT_EVENT.TASK_CREATED,
    })
  }
  return { taskId, taskNo }
}

/** 返货出库任务锁定的容器来源类型（与 return-tasks.service 上架建容器时写入的一致） */
const SALE_RETURN_CONTAINER_SOURCE = 'sale_return'

/**
 * 为销售退货「返货出库」创建任务：退货单被取消时，把已经入库的那批货退回客户。
 *
 * 与采购退货出库同构（以 PICKING 创建 → 拣货扫码 → 直接待出库）；差异有两点，都是硬约束：
 *
 * 1. `sale_order_id` 恒为 NULL。能取消的销售退货单只到状态 2（已确认），此时应收从未冲减、
 *    退货凭证从未生成（凭证引擎取数条件是 `sr.status = 3`，见
 *    docs/sale-return-reverse-flow-2026-09-26.md §一）——所以返货出库在会计上必须"什么都不做"：
 *    不碰 payment_records、不生成收入/成本。ship.js 里有显式守卫，sale_order_id 非空即 500，
 *    不依赖「NULL 天然不进应收分支」这种隐式安全。
 *
 * 2. 必须精确锁定「这批已入库的容器」，出库只能扣这批。否则出库走 FIFO 会把仓库里别的
 *    同商品批次发出去——库存数量对得上、批次全错，客户收到的不是退回来的那批货。
 *    容器的归属只认 `source_ref_type/source_ref_id`（建容器时写死，扫码改不了），
 *    不能只认 `locked_by_task_id`（那个字段扫码就能写，当白名单用等于没有白名单）。
 */
async function createForSaleReturnReverse({ returnId, returnNo, customerName, warehouseId, warehouseName, items, conn }) {
  // 没有明细就没有可返的货：宁可不建任务，也不要建一张空任务让仓库在 PDA 上打不开。
  if (!items || items.length === 0) {
    throw new AppError('返货出库任务必须有至少一条明细，未创建任务', 500, 'SALE_RETURN_REVERSE_NO_ITEMS')
  }
  const taskNo = await genTaskNo(conn)
  const [r] = await conn.query(
    `INSERT INTO warehouse_tasks
       (task_no, task_type, return_id, sale_order_id, sale_order_no,
        customer_id, customer_name, warehouse_id, warehouse_name, status, priority)
     VALUES (?, 'sale_return_out', ?, NULL, NULL, NULL, ?, ?, ?, ${WT_STATUS.PICKING}, 2)`,
    [taskNo, returnId, customerName, warehouseId, warehouseName],
  )
  const taskId = r.insertId
  // 批量写入（AGENTS.md 红线：明细类写入禁止循环内逐行 INSERT）
  await conn.query(
    `INSERT INTO warehouse_task_items
       (task_id, product_id, product_code, product_name, unit, article_number, spec, color, required_qty, picked_qty, sale_return_item_id)
     VALUES ?`,
    [items.map(item => [
      taskId, item.productId, item.productCode, item.productName, item.unit,
      item.articleNumber || null, item.spec || null, item.color || null, item.quantity, 0,
      // 行级关联：出库按这一行取退货单价，避免同一退货单内同商品多行被 JOIN 放大（同迁移 247）
      item.returnItemId != null ? Number(item.returnItemId) : null,
    ])],
  )

  await lockContainersForSaleReturnReverse(conn, { taskId, returnId })

  try {
    await recordEvent(conn, {
      taskId, taskNo,
      eventType: WT_EVENT.TASK_CREATED,
      toStatus: WT_STATUS.PICKING,
      detail: { itemCount: items.length, taskType: 'sale_return_out', returnId, returnNo },
    })
  } catch (eventErr) {
    logSideEffectFailure('仓库任务事件写入失败：返货出库任务创建事件', eventErr, {
      taskId, taskNo, eventType: WT_EVENT.TASK_CREATED,
    })
  }
  return { taskId, taskNo }
}

/**
 * 把某退货单已入库（ACTIVE）的容器全部预锁给返货任务。
 *
 * 锁序必须与上架/出库侧一致：**先 lockStockDimension（inventory_stock 单行）再锁容器行**，
 * 且容器行按 id 升序。反过来或按容器行先锁，会与并发的上架事务成环死锁
 * （理由见 containerEngine.lockStockDimension 的注释）。
 *
 * 调用方须已把该退货单的 return_tasks 置为 REVERSING——冷冻容器集合，避免锁容器过程中
 * 又有新容器被上架进来（putaway 要求任务状态=4，置 REVERSING 后即被堵住）。
 */
async function lockContainersForSaleReturnReverse(conn, { taskId, returnId }) {
  const [dimensions] = await conn.query(
    `SELECT DISTINCT c.product_id, c.warehouse_id
       FROM inventory_containers c
       JOIN return_tasks rt ON rt.id = c.source_ref_id AND rt.return_type = 'sale'
      WHERE rt.return_id = ? AND c.source_ref_type = ?
        AND c.status = ? AND c.deleted_at IS NULL AND c.remaining_qty > 0
      ORDER BY c.product_id, c.warehouse_id`,
    [returnId, SALE_RETURN_CONTAINER_SOURCE, CONTAINER_STATUS.ACTIVE],
  )
  for (const dim of dimensions) {
    await lockStockDimension(conn, Number(dim.product_id), Number(dim.warehouse_id))
  }

  // remaining_qty > 0 与「建单前的可返量核对」同一口径：0 量的容器扫不动（扫码侧会以
  // 「库存不足」拒绝），锁进来就是给自己埋一个永远拣不完的任务。口径不一致时两道关会打架。
  const [containers] = await conn.query(
    `SELECT c.id, c.locked_by_task_id
       FROM inventory_containers c
       JOIN return_tasks rt ON rt.id = c.source_ref_id AND rt.return_type = 'sale'
      WHERE rt.return_id = ? AND c.source_ref_type = ?
        AND c.status = ? AND c.deleted_at IS NULL AND c.remaining_qty > 0
      ORDER BY c.id
      FOR UPDATE`,
    [returnId, SALE_RETURN_CONTAINER_SOURCE, CONTAINER_STATUS.ACTIVE],
  )
  // 已被别的任务锁走的容器不让返货任务假装拥有：若照锁不误，出库时本任务锁定容器不足会
  // 卡在待出库，而现场那批货其实在别人手里，仓库无从判断该找谁。这里直接拒绝并说明原因。
  const busy = containers.filter(c => c.locked_by_task_id != null)
  if (busy.length > 0) {
    throw new AppError(
      `该退货单有 ${busy.length} 个已入库库存条码正被其它任务占用（如待出库/备货任务），`
      + '现在返货出库会与那个任务争同一批货，请先处理完该任务再取消退货单',
      409,
      'SALE_RETURN_REVERSE_CONTAINER_BUSY',
      { containerIds: busy.map(c => Number(c.id)), count: busy.length },
    )
  }
  if (containers.length === 0) return []
  const ids = containers.map(c => Number(c.id))
  await conn.query(
    'UPDATE inventory_containers SET locked_by_task_id = ?, locked_at = NOW() WHERE id IN (?)',
    [taskId, ids],
  )
  return ids
}

/**
 * 分配操作员
 */
async function assign(id, { userId, userName }, scopeWarehouseIds = null) {
  const task = await findById(id, scopeWarehouseIds)
  assertWarehouseTaskAction('assign', task.status)
  await pool.query('UPDATE warehouse_tasks SET assigned_to=?, assigned_name=? WHERE id=?', [userId, userName, id])
}

/**
 * 修改优先级
 */
async function updatePriority(id, priority, scopeWarehouseIds = null) {
  if (![1,2,3].includes(priority)) throw new AppError('优先级无效', 400)
  const task = await findById(id, scopeWarehouseIds)
  if (WT_STATUS_TERMINAL.includes(Number(task.status))) {
    throw new AppError('已出库或已取消的任务不允许修改优先级', 409, 'WAREHOUSE_TASK_TERMINAL_PRIORITY_FORBIDDEN')
  }
  const [result] = await pool.query(
    `UPDATE warehouse_tasks
     SET priority=?
     WHERE id=? AND deleted_at IS NULL AND status NOT IN (?)`,
    [priority, id, WT_STATUS_TERMINAL],
  )
  if (result.affectedRows !== 1) {
    throw new AppError('任务状态已变化，请刷新后重试', 409, 'WAREHOUSE_TASK_PRIORITY_STATUS_CONFLICT')
  }
}

/**
 * 取消任务（→8）：同步销售单状态 → 5；释放分拣格
 */
async function cancel(id, options = {}) {
  const manageConn = !options.conn
  const conn = options.conn || await pool.getConnection()
  try {
    if (manageConn) await conn.beginTransaction()

    const taskRow = await lockStatusRow(conn, {
      table: 'warehouse_tasks',
      id,
      columns: 'id, task_no, task_type, status, sale_order_id, sorting_bin_id, sorting_bin_code, cancel_requested_at, warehouse_id',
      entityName: '仓库任务',
    })
    // 单据级数据权限（2026-08-21 审计高危）：限仓用户不能取消他人仓库的任务
    assertInScope(options.scopeWarehouseIds, taskRow.warehouse_id, '仓库任务')
    // ── 返货出库单不可单独取消（2026-09-26 一致性审查 · 任务 1 第二期）──────────────
    // 返货出库单不是独立业务单，它是「取消退货单」这一动作的组成部分：取消退货单时，
    // 退货单保持在已确认(2)、其退货任务被置为反向处理中(7)，正是等这张单把货退回客户后
    // 收口（见 returns-sale.service.enterSaleReturnReverse）。
    //
    // 让它走通用取消会留下一个死结，且**通用路径看不出问题在哪**：
    //  - 它没有 sale_order_id，销售单分支不会兜底；
    //  - 它预锁着容器，于是被判为「需要逆向归还」，要求仓库逐个扫码把货放回货架——
    //    可这些货压根没离开过货架（预锁只是数据库字段），扫码归还是纯粹的无效劳动；
    //  - 归还完成后任务变已取消(8)，但**退货单仍是 2、退货任务仍停在 7**：退货任务 7 既不能
    //    再上架（上架要求 4），也不能被收口（7 只有 →6 一条出边），退货单从此既完成不了、
    //    也取消不了；此时再点「取消退货单」还会因为查不到进行中的返货单而**重复建单**。
    //
    // 回滚这条路同样不通：申请时把 4 置 7、把未上架的容器置 VOID（不可逆）、把 1/2/3 的任务
    // 取消（终态无出边）——三处都缺可逆边，硬回滚比禁止更容易把数据撕碎。
    // 所以这里明确禁止，并把唯一通行的出路讲清楚。
    if (taskRow.task_type === 'sale_return_out') {
      throw new AppError(
        '返货出库单不能单独取消：它是「取消退货单」流程的一部分，取消它会让退货单卡在既不能完成、'
        + '也不能取消的状态。如果这批货不再需要退回客户，请先按正常流程完成本单出库（出库完成后退货单会自动取消），'
        + '再按业务需要重新开退货单；其余情况请联系管理员核查',
        409,
        'SALE_RETURN_REVERSE_CANCEL_FORBIDDEN',
      )
    }
    if (taskRow.cancel_requested_at) {
      throw new AppError('任务已在拣货退回中，请等待逆向归还完成', 409)
    }
    const rule = assertWarehouseTaskAction('cancel', taskRow.status)
    if (!isValidTransition(taskRow.status, rule.toStatus)) {
      throw new AppError(`非法状态迁移：${taskRow.status} → ${rule.toStatus}`, 400)
    }
    // 销售订单可能拆成多个仓库任务。直接取消其中一个任务会误释放整单预占并覆盖整单状态，
    // 所以销售关联任务必须由 sale.service.cancel() 统一锁定并取消同单全部任务。
    if (taskRow.sale_order_id && options.syncSaleStatus !== false) {
      throw new AppError(
        '销售出库任务请从销售订单执行取消，系统会统一处理同单全部任务和预占',
        409,
        'SALE_ORDER_CANCEL_REQUIRED',
      )
    }

    // 解锁/清理前先查询所有被锁容器及其库位——用于判断分流路径，也用于归还指引
    const [lockedContainers] = await conn.query(
      `SELECT c.id, c.barcode, c.container_type,
              loc.code AS location_code,
              loc.zone, loc.aisle, loc.rack, loc.level, loc.position
       FROM inventory_containers c
       LEFT JOIN warehouse_locations loc ON loc.id = c.location_id
       WHERE c.locked_by_task_id = ?`,
      [id],
    )
    const containersToReturn = lockedContainers.map(c => ({
      containerId: Number(c.id),
      barcode: c.barcode,
      containerKind: Number(c.container_type) === 2 || /^B/i.test(String(c.barcode || ''))
        ? 'plastic_box' : 'inventory',
      locationCode: c.location_code || null,
      zone: c.zone || null,
      aisle: c.aisle || null,
      rack: c.rack || null,
      level: c.level || null,
      position: c.position || null,
    }))

    // 已经拣出货架、还没归位的容器不能批量后台解锁——货物实际在哪只有人知道，
    // 批量解锁只是清空数据库字段，不会引导任何人把已经拿出来的货放回原位，
    // 容器会立刻"看起来"可用，可能被派发给别的任务却扑空。这种情况改走逆向
    // 归还流程：逐容器扫码确认放回位置，全部归位后才真正完成取消。
    const needsReverseReturn = lockedContainers.length > 0
      && [WT_STATUS.PICKING, WT_STATUS.SORTING, WT_STATUS.CHECKING, WT_STATUS.PACKING, WT_STATUS.SHIPPING]
           .includes(Number(taskRow.status))

    if (needsReverseReturn) {
      const [casResult] = await conn.query(
        `UPDATE warehouse_tasks SET cancel_requested_at = NOW()
         WHERE id = ? AND status = ? AND cancel_requested_at IS NULL`,
        [id, taskRow.status],
      )
      if (casResult.affectedRows !== 1) {
        throw new AppError('任务状态已变化，请刷新后重试', 409)
      }
      // 未拣货的明细行直接撤回：required_qty 下调到当前 picked_qty，防止继续为
      // 已取消的订单拣更多货；已经拣的部分保留原样，等逆向扫码归还。
      await conn.query(
        `UPDATE warehouse_task_items SET required_qty = picked_qty
         WHERE task_id = ? AND picked_qty < required_qty`,
        [id],
      )
      // 打包中(未完成/未打印箱贴)的箱子没有物理实体可供扫码核对，直接由系统作废；
      // 已完成(已打印箱贴)的箱子才需要仓库人工扫码确认拆箱——两者判断依据见
      // warehouse-tasks.cancel-return.js 顶部说明。装箱本身不影响容器库存数字
      // （package_items 与 inventory_containers 无关联），作废箱子不需要任何数量回滚。
      await conn.query(
        `UPDATE packages SET status = 3 WHERE warehouse_task_id = ? AND status = 1`,
        [id],
      )
      const [sealedPackages] = await conn.query(
        `SELECT id, barcode FROM packages WHERE warehouse_task_id = ? AND status = 2`,
        [id],
      )
      const packagesToUnpack = sealedPackages.map(p => ({ packageId: Number(p.id), barcode: p.barcode }))
      if (taskRow.sale_order_id) {
        await releaseByRef(conn, 'sale_order', Number(taskRow.sale_order_id))
        // 销售单业务状态立即变为已取消——不依赖物理归还进度。走 sale.service.cancel()
        // 间接调用时它自己会做这一步（并传 syncSaleStatus:false 跳过这里，避免重复）；
        // 直接调用本接口（PUT /warehouse-tasks/:id/cancel）时没有别人会做，必须在这里做。
        if (options.syncSaleStatus !== false) {
          const saleSvc = require('../sale/sale.service')
          await saleSvc.syncCancelledByWarehouseTaskWithinTransaction(conn, Number(taskRow.sale_order_id), {
            taskId: Number(taskRow.id),
            taskNo: taskRow.task_no,
          })
        }
      }
      try {
        await recordEvent(conn, {
          taskId: id, taskNo: taskRow.task_no,
          eventType: WT_EVENT.CANCEL_REQUESTED,
          operatorId: options.operator?.userId ?? null,
          operatorName: options.operator?.realName ?? null,
          detail: {
            saleOrderId: taskRow.sale_order_id != null ? Number(taskRow.sale_order_id) : null,
            reservationReleased: taskRow.sale_order_id != null,
            containersToReturn,
            packagesToUnpack,
          },
        })
      } catch (eventErr) {
        logSideEffectFailure('仓库任务事件写入失败：拣货退回发起事件', eventErr, {
          taskId: id,
          taskNo: taskRow.task_no,
          eventType: WT_EVENT.CANCEL_REQUESTED,
        })
      }
      if (manageConn) await commitFulfillment(conn, 'warehouse', id)
      return
    }

    await compareAndSetStatus(conn, {
      table: 'warehouse_tasks',
      id,
      fromStatus: taskRow.status,
      toStatus: rule.toStatus,
      entityName: '仓库任务',
      extraSet: {
        sorting_bin_id: null,
        sorting_bin_code: null,
      },
    })

    // 只有任务真实切换到 CANCELLED 后，才执行资源释放与单据同步副作用。

    await unlockContainersByTask(conn, id)
    await sortingBinSvc.releaseByTask(conn, id)

    if (taskRow.sale_order_id) {
      await releaseByRef(conn, 'sale_order', Number(taskRow.sale_order_id))
    }

    // 取消关联的包裹（标记 status=3）并清理包裹打印任务
    const packagesSvc = require('../packages/packages.service')
    const cancelledPkgCount = await packagesSvc.cancelByTaskId(conn, id)
    if (cancelledPkgCount > 0) {
      await conn.query(
        `UPDATE print_jobs SET status = 3, error_message = '仓库任务已取消'
         WHERE ref_type = 'package'
           AND ref_id IN (SELECT id FROM packages WHERE warehouse_task_id = ?)
           AND status IN (0, 1)`,
        [id],
      )
    }

    if (taskRow.sale_order_id && options.syncSaleStatus !== false) {
      const saleSvc = require('../sale/sale.service')
      await saleSvc.syncCancelledByWarehouseTaskWithinTransaction(conn, Number(taskRow.sale_order_id), {
        taskId: Number(taskRow.id),
        taskNo: taskRow.task_no,
      })
    }
    try {
      await recordEvent(conn, {
        taskId: id, taskNo: taskRow.task_no,
        eventType:  WT_EVENT.TASK_CANCELLED,
        fromStatus: taskRow.status,
        toStatus:   rule.toStatus,
        operatorId: options.operator?.userId ?? null,
        operatorName: options.operator?.realName ?? null,
        detail:     {
          saleOrderId: taskRow.sale_order_id != null ? Number(taskRow.sale_order_id) : null,
          reservationReleased: taskRow.sale_order_id != null,
          packagesCancelled: cancelledPkgCount,
          containersToReturn,
        },
      })
    } catch (eventErr) {
      logSideEffectFailure('仓库任务事件写入失败：任务取消事件', eventErr, {
        taskId: id,
        taskNo: taskRow.task_no,
        eventType: WT_EVENT.TASK_CANCELLED,
      })
    }
    if (manageConn) await commitFulfillment(conn, 'warehouse', id)
  } catch (e) {
    if (manageConn) await conn.rollback()
    throw e
  } finally {
    if (manageConn) conn.release()
  }
}

module.exports = {
  createForSaleOrder,
  createForPurchaseReturn,
  createForSaleReturnReverse,
  lockContainersForSaleReturnReverse,
  SALE_RETURN_CONTAINER_SOURCE,
  assign,
  updatePriority,
  cancel,
}
