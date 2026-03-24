/**
 * healthCheck.autoFix.js
 * 仓库流程异常自动修复服务
 *
 * 设计原则：
 *  1. 只修复「数据孤立」类异常（资源未释放），不自动改变业务状态
 *  2. 每次修复生成独立的 fix_id，记录到 system_health_logs
 *  3. 单项修复失败不阻断其他项（catch 独立处理）
 *  4. 所有修复在事务中执行，失败自动回滚
 *  5. 不可自动修复的异常只记录，不操作数据
 *
 * 可自动修复的异常类型：
 *  ✓ ORPHANED_SORTING_BIN      — 分拣格孤立占用（关联任务已终结）
 *  ✓ ORPHANED_CONTAINER_LOCK   — 容器锁孤立（关联任务已终结）
 *  ✓ ORPHANED_RESERVATION      — 幽灵预占（关联销售单已取消/不存在）
 *  ✓ SORTED_QTY_OVERFLOW       — sorted_qty > picked_qty（修正为 picked_qty）
 *
 * 不可自动修复的异常类型（需人工处理）：
 *  ✗ NEGATIVE_ON_HAND          — 负库存，需人工盘点核查
 *  ✗ NEGATIVE_RESERVED         — 负预占，预占引擎 BUG，需人工修复
 *  ✗ RESERVED_EXCEEDS_ON_HAND  — 库存漂移，需人工对账
 *  ✗ CONFIRMED_SALE_NO_RESERVATION — 销售单无预占，需人工补录
 *  ✗ SHIPPED_TASK_UNSYNCED_SALE — 出库与销售单状态不同步，需人工核查
 *  ✗ LONG_PENDING_RESERVATION   — 长期预占，业务判断，不宜自动处理
 *  ✗ HIGH_PRIORITY_TASK_DELAY   — 紧急任务延迟，需人工介入
 *  ✗ STALE_PICKING_TASK         — 拣货卡住，需联系操作员
 *  ✗ STALE_SORTING_TASK         — 分拣卡住，需联系操作员
 *  ✗ TASK_ITEMS_EMPTY           — 任务无明细，数据损坏，需人工处理
 */

const { pool } = require('../../config/db')
const { v4: uuidv4 } = require('uuid')

// ─── 可自动修复项 ─────────────────────────────────────────────────────────────

/**
 * FIX-01  释放孤立分拣格
 * 条件：sorting_bins.status=2 但关联任务状态为已出库(7)或已取消(8)，或 current_task_id 为空
 * 操作：UPDATE sorting_bins SET status=1, current_task_id=NULL
 */
async function fixOrphanedSortingBins(conn, fixes) {
  const [rows] = await conn.query(`
    SELECT sb.id, sb.code, sb.warehouse_id, sb.current_task_id,
           t.task_no, t.status AS task_status
    FROM sorting_bins sb
    LEFT JOIN warehouse_tasks t ON t.id = sb.current_task_id
    WHERE sb.status = 2
      AND (
        sb.current_task_id IS NULL
        OR t.status IN (7, 8)
      )
  `)
  if (!rows.length) return

  const ids = rows.map(r => r.id)
  const [result] = await conn.query(
    'UPDATE sorting_bins SET status=1, current_task_id=NULL WHERE id IN (?)',
    [ids],
  )
  for (const r of rows) {
    fixes.push({
      fixType:      'ORPHANED_SORTING_BIN',
      relatedId:    r.id,
      relatedTable: 'sorting_bins',
      action:       `释放分拣格「${r.code}」（原关联任务：${r.task_no ?? '无'}）`,
      success:      true,
    })
  }
  return result.affectedRows
}

/**
 * FIX-02  释放孤立容器锁
 * 条件：inventory_containers.locked_by_task_id 不为空，但关联任务已终结(7/8)或不存在
 * 操作：UPDATE inventory_containers SET locked_by_task_id=NULL, locked_at=NULL
 */
async function fixOrphanedContainerLocks(conn, fixes) {
  const [rows] = await conn.query(`
    SELECT ic.id, ic.barcode, ic.locked_by_task_id,
           t.task_no, t.status AS task_status
    FROM inventory_containers ic
    LEFT JOIN warehouse_tasks t ON t.id = ic.locked_by_task_id
    WHERE ic.locked_by_task_id IS NOT NULL
      AND (
        t.id IS NULL
        OR t.status IN (7, 8)
      )
      AND ic.deleted_at IS NULL
  `)
  if (!rows.length) return

  const ids = rows.map(r => r.id)
  const [result] = await conn.query(
    'UPDATE inventory_containers SET locked_by_task_id=NULL, locked_at=NULL WHERE id IN (?)',
    [ids],
  )
  for (const r of rows) {
    fixes.push({
      fixType:      'ORPHANED_CONTAINER_LOCK',
      relatedId:    r.id,
      relatedTable: 'inventory_containers',
      action:       `释放容器「${r.barcode}」的锁定（原关联任务：${r.task_no ?? '不存在'}）`,
      success:      true,
    })
  }
  return result.affectedRows
}

/**
 * FIX-03  释放幽灵预占
 * 条件：stock_reservations.status=1 但关联销售单已取消(status=5)或不存在
 * 操作：UPDATE stock_reservations SET status=2（释放）
 *       同时更新 inventory_stock.reserved 减去对应数量
 */
async function fixOrphanedReservations(conn, fixes) {
  const [rows] = await conn.query(`
    SELECT sr.id, sr.ref_id, sr.ref_no, sr.product_id, sr.warehouse_id, sr.qty
    FROM stock_reservations sr
    LEFT JOIN sale_orders o ON o.id = sr.ref_id
    WHERE sr.ref_type = 'sale_order'
      AND sr.status   = 1
      AND (o.id IS NULL OR o.status = 5)
  `)
  if (!rows.length) return

  for (const r of rows) {
    try {
      // 标记预占为已释放
      await conn.query('UPDATE stock_reservations SET status=2 WHERE id=?', [r.id])
      // 减少 inventory_stock.reserved（不允许低于 0）
      await conn.query(
        'UPDATE inventory_stock SET reserved = GREATEST(0, reserved - ?) WHERE product_id=? AND warehouse_id=?',
        [r.qty, r.product_id, r.warehouse_id],
      )
      fixes.push({
        fixType:      'ORPHANED_RESERVATION',
        relatedId:    r.id,
        relatedTable: 'stock_reservations',
        action:       `释放幽灵预占 #${r.id}（销售单 ${r.ref_no}，数量 ${r.qty}）`,
        success:      true,
      })
    } catch (err) {
      fixes.push({
        fixType:      'ORPHANED_RESERVATION',
        relatedId:    r.id,
        relatedTable: 'stock_reservations',
        action:       `释放幽灵预占 #${r.id} 失败：${err.message}`,
        success:      false,
      })
    }
  }
}

/**
 * FIX-04  修正 sorted_qty 溢出
 * 条件：warehouse_task_items.sorted_qty > picked_qty
 * 操作：SET sorted_qty = picked_qty（截断为合法值）
 */
async function fixSortedQtyOverflow(conn, fixes) {
  const [rows] = await conn.query(`
    SELECT wti.id, wti.task_id, wti.product_name, wti.picked_qty, wti.sorted_qty,
           t.task_no
    FROM warehouse_task_items wti
    JOIN warehouse_tasks t ON t.id = wti.task_id
    WHERE wti.sorted_qty > wti.picked_qty
      AND t.deleted_at IS NULL
  `)
  if (!rows.length) return

  const ids = rows.map(r => r.id)
  await conn.query(
    'UPDATE warehouse_task_items SET sorted_qty=picked_qty WHERE id IN (?)',
    [ids],
  )
  for (const r of rows) {
    fixes.push({
      fixType:      'SORTED_QTY_OVERFLOW',
      relatedId:    r.id,
      relatedTable: 'warehouse_task_items',
      action:       `修正任务「${r.task_no}」商品「${r.product_name}」sorted_qty：${r.sorted_qty} → ${r.picked_qty}`,
      success:      true,
    })
  }
}

// ─── 写入修复日志 ─────────────────────────────────────────────────────────────

async function saveFixLogs(conn, fixId, fixes) {
  if (!fixes.length) return
  const values = fixes.map(f => [
    fixId,
    f.fixType,
    f.success ? 'fixed' : 'fix_failed',
    f.relatedId    ?? null,
    f.relatedTable ?? null,
    f.action,
  ])
  await conn.query(
    `INSERT INTO system_health_logs
       (run_id, check_type, severity, related_id, related_table, message)
     VALUES ?`,
    [values],
  )
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 执行所有可自动修复项
 * @param {'manual'|'scheduler'} triggeredBy
 * @returns {{ fixId, fixedCount, failedCount, fixes[] }}
 */
async function runAutoFix(triggeredBy = 'manual') {
  const fixId  = uuidv4()
  const fixes  = []
  const errors = []

  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()

    const tasks = [
      { name: 'ORPHANED_SORTING_BIN',    fn: fixOrphanedSortingBins },
      { name: 'ORPHANED_CONTAINER_LOCK', fn: fixOrphanedContainerLocks },
      { name: 'ORPHANED_RESERVATION',    fn: fixOrphanedReservations },
      { name: 'SORTED_QTY_OVERFLOW',     fn: fixSortedQtyOverflow },
    ]

    for (const { name, fn } of tasks) {
      try {
        await fn(conn, fixes)
      } catch (err) {
        errors.push({ fixType: name, error: err.message })
      }
    }

    await saveFixLogs(conn, fixId, fixes)
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }

  const fixedCount  = fixes.filter(f => f.success).length
  const failedCount = fixes.filter(f => !f.success).length

  return {
    fixId,
    triggeredBy,
    fixedAt:    new Date().toISOString(),
    fixedCount,
    failedCount,
    totalFixes: fixes.length,
    fixes,
    errors,
  }
}

/**
 * 可自动修复的异常类型说明（供 API 文档使用）
 */
const AUTO_FIXABLE_CHECK_TYPES = [
  {
    checkType:   'ORPHANED_SORTING_BIN',
    description: '分拣格孤立占用（关联任务已终结），自动释放分拣格',
    risk:        'low',
  },
  {
    checkType:   'ORPHANED_CONTAINER_LOCK',
    description: '容器锁孤立（关联任务已终结），自动释放容器锁',
    risk:        'low',
  },
  {
    checkType:   'ORPHANED_RESERVATION',
    description: '幽灵预占（关联销售单已取消/不存在），自动释放预占并修正库存',
    risk:        'medium',
  },
  {
    checkType:   'SORTED_QTY_OVERFLOW',
    description: 'sorted_qty 超出 picked_qty，自动截断为合法值',
    risk:        'low',
  },
]

module.exports = { runAutoFix, AUTO_FIXABLE_CHECK_TYPES }
