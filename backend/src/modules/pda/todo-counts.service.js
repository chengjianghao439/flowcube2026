/**
 * pda/todo-counts — PDA 工作台「作业待办通知」聚合计数
 *
 * 按当前 PDA 设备绑定的仓库（req.pda.warehouseId）统计各作业的待办数量，
 * 供工作台顶部汇总条 + 图标角标展示。设备未绑仓库（warehouseId null）时返回全部。
 *
 * 口径说明（与各作业列表页保持一致）：
 * - inbound      收货订单：status 1待收货 2收货中 3待上架，且已提交到 PDA（submitted_at 非空）
 *                 —— 计数口径与 PDA 列表页一致：列表前端 filter 掉未提交的，计数也要同样排除，
 *                    否则 ERP 建单未提交的收货会显示「有任务」但列表为空（2026-09 生产事故）。
 * - picking      拣货：warehouse_tasks status IN (1待拣货, 2拣货中) 且未在拣货退回
 * - checking     复核：warehouse_tasks status = 4 待复核
 * - packing      打包：warehouse_tasks status = 5 待打包
 * - shipping     待出库：warehouse_tasks status = 6
 * - saleReturn   销售退货：return_tasks status IN (1,2,3,4) 且已提交
 * - transfer     调拨：transfer_orders status IN (2待出库, 3在途)，设备仓库在 from/to 任一
 * - stockcheck   盘点：inventory_checks status = 1 进行中
 * - cancelReturn 拣货退回：warehouse_tasks cancel_requested_at 非空（逆向归还中）
 * - adjustments  改单确认：warehouse_tasks adjustment_requested_at 非空
 */
const { pool } = require('../../config/db')
const { WT_STATUS_PICK_POOL } = require('../../constants/warehouseTaskStatus')

async function getTodoCounts(warehouseId) {
  const wh = warehouseId ? Number(warehouseId) : null
  // 空数组拼接会报错，用占位符数组统一处理「有仓库过滤」与「不限」两种分支
  const whCond = wh ? 'AND warehouse_id = ?' : ''
  const whParams = wh ? [wh] : []

  const [inboundRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM inbound_tasks
     WHERE status IN (1,2,3) AND deleted_at IS NULL AND submitted_at IS NOT NULL ${whCond}`,
    whParams,
  )

  const [taskRows] = await pool.query(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN (${WT_STATUS_PICK_POOL.join(',')}) AND cancel_requested_at IS NULL THEN 1 ELSE 0 END),0) AS picking,
       COALESCE(SUM(CASE WHEN status = 4 THEN 1 ELSE 0 END),0) AS checking,
       COALESCE(SUM(CASE WHEN status = 5 THEN 1 ELSE 0 END),0) AS packing,
       COALESCE(SUM(CASE WHEN status = 6 THEN 1 ELSE 0 END),0) AS shipping,
       COALESCE(SUM(CASE WHEN cancel_requested_at IS NOT NULL THEN 1 ELSE 0 END),0) AS cancel_return,
       COALESCE(SUM(CASE WHEN adjustment_requested_at IS NOT NULL THEN 1 ELSE 0 END),0) AS adjustments
     FROM warehouse_tasks
     WHERE deleted_at IS NULL ${whCond}`,
    whParams,
  )

  const [returnRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM return_tasks
     WHERE status IN (1,2,3,4) AND deleted_at IS NULL AND submitted_at IS NOT NULL ${whCond}`,
    whParams,
  )

  const [transferRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM transfer_orders
     WHERE status IN (2,3) AND deleted_at IS NULL ${wh
       ? 'AND (from_warehouse_id = ? OR to_warehouse_id = ?)' : ''}`,
    wh ? [wh, wh] : [],
  )

  const [checkRows] = await pool.query(
    `SELECT COUNT(*) AS n FROM inventory_checks
     WHERE status = 1 AND deleted_at IS NULL ${whCond}`,
    whParams,
  )

  return {
    inbound: Number(inboundRows[0].n),
    picking: Number(taskRows[0].picking),
    checking: Number(taskRows[0].checking),
    packing: Number(taskRows[0].packing),
    shipping: Number(taskRows[0].shipping),
    saleReturn: Number(returnRows[0].n),
    transfer: Number(transferRows[0].n),
    stockcheck: Number(checkRows[0].n),
    cancelReturn: Number(taskRows[0].cancel_return),
    adjustments: Number(taskRows[0].adjustments),
  }
}

module.exports = { getTodoCounts }
