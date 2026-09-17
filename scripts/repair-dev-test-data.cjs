'use strict'
/**
 * 开发库测试数据整理（2026-09-17 GUI 验收后清理，默认 dry-run）
 *
 * 背景：验收发现开发库被 smoke/回归脚本写入大量测试数据，直接淹没了业务下拉：
 *   仓库 253 个（248 个测试仓）、客户 74 个（69 个测试客户）、商品 2,637 个（2,631 个测试商品）。
 * 处理原则（用户 2026-09-17 确认）：**停用而不是删除** —— 把 is_active 置 0，
 * 不删行、不改引用，随时可用一条 UPDATE 恢复；已产生业务引用（库存容器/单据/任务）的
 * 记录一律跳过，避免制造新的孤儿数据。
 *
 * 另含两类可逆的脏数据修正（同样只在本脚本内定义，不改业务代码）：
 *   A. 盘点单「自动 0 值」还原为未盘：进行中的盘点单里 actual_qty=0 且 diff_qty=-book_qty 的行，
 *      是 G-13 缺陷（空输入当 0）写入的，还原成 NULL（未盘）。
 *   B. 分拣格占用回收：current_task_id 指向已出库(7)/已取消(8)任务的分拣格，置回空闲。
 *
 * 用法：
 *   node scripts/repair-dev-test-data.cjs            # 只读预检，打印将要做的改动
 *   node scripts/repair-dev-test-data.cjs --apply    # 执行（先自行备份数据库）
 * 环境：显式读 backend/.env；拒绝非回环地址与非 development 库名。
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const APPLY = process.argv.includes('--apply')

function loadEnv() {
  const text = fs.readFileSync(path.join(ROOT, 'backend/.env'), 'utf8')
  const env = {}
  for (const line of text.split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

const TEST_WAREHOUSE_PATTERNS = ['集成测试目标仓', 'Scope测试外仓', '设备会话外仓', 'Smoke搜索他仓']
const TEST_CUSTOMER_PATTERNS = ['切换客户-%']
const TEST_PRODUCT_PATTERNS = [
  'P0测试商品-%', 'P1测试商品-%', '集成测试商品', '混合测试商品%', '处置测试商品-%', '出库链测试商品',
  // 第二轮补全（2026-09-17 彻底清理）：这些是 smoke/回归脚本的其他命名族，
  // 与随库导入的演示目录（测试商品1..100 / SKU0001-100）区分开，后者保留。
  '取消测试商品%', '设备会话测试商品%', 'Scope测试商品%', 'Smoke%', '切换商品%',
  'INTEG-%', 'WTSPLIT-%', 'DP--%', 'P0-%', 'P1-%',
]

// 「彻底清理」阶段（用户 2026-09-17 确认）：先把测试主数据名下的库存容器与任务清干净，
// 再停用主数据。顺序不能反：先停用会让"被引用"的保护逻辑把大半个库都跳过。
const TEST_DIM_PRODUCT = `EXISTS (SELECT 1 FROM product_items p WHERE p.id = c.product_id AND (${TEST_PRODUCT_PATTERNS.map(() => 'p.name LIKE ?').join(' OR ')}))`
const TEST_DIM_WAREHOUSE = `EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = c.warehouse_id AND (${TEST_WAREHOUSE_PATTERNS.map(() => 'w.name LIKE ?').join(' OR ')}))`

const like = (patterns) => patterns.map(() => 'name LIKE ?').join(' OR ')
/** 指定列名的 LIKE 组合（账号、设备码等不叫 name 的表） */
const likeCol = (column, patterns) => patterns.map(() => `${column} LIKE ?`).join(' OR ')

async function main() {
  const env = loadEnv()
  if (!['127.0.0.1', 'localhost'].includes(env.DB_HOST)) throw new Error(`拒绝执行：DB_HOST=${env.DB_HOST} 不是回环地址`)
  if (!/^flowcube_dev/.test(env.DB_NAME || '')) throw new Error(`拒绝执行：DB_NAME=${env.DB_NAME} 不是开发库`)
  const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(ROOT, 'backend')] }))
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME, timezone: '+08:00',
  })
  const plan = []
  const run = async (label, countSql, args, applySql) => {
    const [[row]] = await conn.query(countSql, args)
    const n = Number(row.n)
    plan.push({ label, rows: n })
    // 预检也在事务内真正执行（结束回滚），否则"依赖前序步骤"的统计会失真——
    // 例如释放失效预占必须在容器作废之后才能算准。
    if (n > 0) await conn.query(applySql, args)
    return n
  }
  try {
    await conn.beginTransaction()

    // 1) 测试仓库停用（存在库存容器/任务/单据引用则跳过）
    await run('停用测试仓库', `SELECT COUNT(*) n FROM inventory_warehouses w WHERE (${like(TEST_WAREHOUSE_PATTERNS)})
        AND w.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM inventory_containers c WHERE c.warehouse_id = w.id AND c.deleted_at IS NULL AND c.remaining_qty <> 0)
        AND NOT EXISTS (SELECT 1 FROM warehouse_tasks t WHERE t.warehouse_id = w.id AND t.deleted_at IS NULL)`,
      TEST_WAREHOUSE_PATTERNS,
      `UPDATE inventory_warehouses w SET w.is_active = 0 WHERE (${like(TEST_WAREHOUSE_PATTERNS)})
        AND w.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM inventory_containers c WHERE c.warehouse_id = w.id AND c.deleted_at IS NULL AND c.remaining_qty <> 0)
        AND NOT EXISTS (SELECT 1 FROM warehouse_tasks t WHERE t.warehouse_id = w.id AND t.deleted_at IS NULL)`)

    // 2) 测试客户停用（存在未删除销售单引用则跳过）
    await run('停用测试客户', `SELECT COUNT(*) n FROM sale_customers c WHERE (${like(TEST_CUSTOMER_PATTERNS)})
        AND c.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM sale_orders o WHERE o.customer_id = c.id AND o.deleted_at IS NULL)`,
      TEST_CUSTOMER_PATTERNS,
      `UPDATE sale_customers c SET c.is_active = 0 WHERE (${like(TEST_CUSTOMER_PATTERNS)})
        AND c.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM sale_orders o WHERE o.customer_id = c.id AND o.deleted_at IS NULL)`)

    // 3) 测试商品停用（存在 ACTIVE 库存或未删除单据明细则跳过，避免隐藏真实库存）
    await run('停用测试商品', `SELECT COUNT(*) n FROM product_items p WHERE (${like(TEST_PRODUCT_PATTERNS)})
        AND p.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM inventory_containers c WHERE c.product_id = p.id AND c.status = 1 AND c.remaining_qty <> 0)
        AND NOT EXISTS (SELECT 1 FROM sale_order_items i JOIN sale_orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.deleted_at IS NULL)`,
      TEST_PRODUCT_PATTERNS,
      `UPDATE product_items p SET p.is_active = 0 WHERE (${like(TEST_PRODUCT_PATTERNS)})
        AND p.is_active = 1
        AND NOT EXISTS (SELECT 1 FROM inventory_containers c WHERE c.product_id = p.id AND c.status = 1 AND c.remaining_qty <> 0)
        AND NOT EXISTS (SELECT 1 FROM sale_order_items i JOIN sale_orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.deleted_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM purchase_order_items i JOIN purchase_orders o ON o.id = i.order_id WHERE i.product_id = p.id AND o.deleted_at IS NULL)`)

    // 4) 盘点单自动 0 值还原为未盘（仅进行中单据）
    await run('还原盘点自动 0 值', `SELECT COUNT(*) n FROM inventory_check_items ci JOIN inventory_checks c ON c.id = ci.check_id
        WHERE c.status = 1 AND ci.actual_qty = 0 AND ci.diff_qty = -ci.book_qty AND ci.book_qty <> 0`, [],
      `UPDATE inventory_check_items ci JOIN inventory_checks c ON c.id = ci.check_id
        SET ci.actual_qty = NULL, ci.diff_qty = NULL
        WHERE c.status = 1 AND ci.actual_qty = 0 AND ci.diff_qty = -ci.book_qty AND ci.book_qty <> 0`)

    // 5) 分拣格回收（任务已完结却仍占用）
    await run('回收分拣格占用', `SELECT COUNT(*) n FROM sorting_bins b JOIN warehouse_tasks t ON t.id = b.current_task_id
        WHERE b.status = 2 AND t.status IN (7, 8)`, [],
      `UPDATE sorting_bins b JOIN warehouse_tasks t ON t.id = b.current_task_id
        SET b.status = 1, b.current_task_id = NULL
        WHERE b.status = 2 AND t.status IN (7, 8)`)

    // ── 彻底清理阶段（把测试名下的库存与任务一并清掉，之后主数据才没有引用）──────
    const cArgs = [...TEST_PRODUCT_PATTERNS, ...TEST_WAREHOUSE_PATTERNS]

    // 6) 测试商品/仓库名下的库存容器：余量置零 + 软删除（保留行以便回滚追溯）
    await run('作废测试库存容器',
      `SELECT COUNT(*) n FROM inventory_containers c
        WHERE c.deleted_at IS NULL AND c.remaining_qty <> 0 AND (${TEST_DIM_PRODUCT} OR ${TEST_DIM_WAREHOUSE})`,
      cArgs,
      `UPDATE inventory_containers c SET c.remaining_qty = 0, c.locked_by_task_id = NULL, c.locked_at = NULL, c.deleted_at = NOW()
        WHERE c.deleted_at IS NULL AND c.remaining_qty <> 0 AND (${TEST_DIM_PRODUCT} OR ${TEST_DIM_WAREHOUSE})`)

    // 7) 测试任务：软删除并释放容器锁
    await run('作废测试仓库任务',
      `SELECT COUNT(*) n FROM warehouse_tasks t
        WHERE t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = t.warehouse_id AND (${TEST_WAREHOUSE_PATTERNS.map(() => 'w.name LIKE ?').join(' OR ')}))`,
      TEST_WAREHOUSE_PATTERNS,
      `UPDATE warehouse_tasks t SET t.deleted_at = NOW()
        WHERE t.deleted_at IS NULL
          AND EXISTS (SELECT 1 FROM inventory_warehouses w WHERE w.id = t.warehouse_id AND (${TEST_WAREHOUSE_PATTERNS.map(() => 'w.name LIKE ?').join(' OR ')}))`)

    // 8) 指向已作废容器的预占：置为已释放（status=3），避免幽灵预占
    await run('释放失效预占',
      `SELECT COUNT(*) n FROM stock_reservations r
        WHERE r.status = 1
          AND NOT EXISTS (SELECT 1 FROM inventory_containers c WHERE c.product_id = r.product_id AND c.warehouse_id = r.warehouse_id AND c.deleted_at IS NULL AND c.remaining_qty > 0)`,
      [],
      `UPDATE stock_reservations r SET r.status = 3
        WHERE r.status = 1
          AND NOT EXISTS (SELECT 1 FROM inventory_containers c WHERE c.product_id = r.product_id AND c.warehouse_id = r.warehouse_id AND c.deleted_at IS NULL AND c.remaining_qty > 0)`)

    // 9) 分拣格彻底回收：任务已作废/完结的占用一并释放
    await run('彻底回收分拣格',
      `SELECT COUNT(*) n FROM sorting_bins b WHERE b.status = 2
        AND (b.current_task_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM warehouse_tasks t WHERE t.id = b.current_task_id AND t.deleted_at IS NULL AND t.status IN (1,2,3,4,5,6)))`,
      [],
      `UPDATE sorting_bins b SET b.status = 1, b.current_task_id = NULL WHERE b.status = 2
        AND (b.current_task_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM warehouse_tasks t WHERE t.id = b.current_task_id AND t.deleted_at IS NULL AND t.status IN (1,2,3,4,5,6)))`)

    // 10) 停用全部剩余测试主数据（此时引用已清空，不再需要跳过）
    await run('停用全部测试仓库', `SELECT COUNT(*) n FROM inventory_warehouses w WHERE (${like(TEST_WAREHOUSE_PATTERNS)}) AND w.is_active = 1`,
      TEST_WAREHOUSE_PATTERNS,
      `UPDATE inventory_warehouses w SET w.is_active = 0 WHERE (${like(TEST_WAREHOUSE_PATTERNS)}) AND w.is_active = 1`)
    await run('停用全部测试商品', `SELECT COUNT(*) n FROM product_items p WHERE (${like(TEST_PRODUCT_PATTERNS)}) AND p.is_active = 1`,
      TEST_PRODUCT_PATTERNS,
      `UPDATE product_items p SET p.is_active = 0 WHERE (${like(TEST_PRODUCT_PATTERNS)}) AND p.is_active = 1`)
    await run('停用全部测试客户', `SELECT COUNT(*) n FROM sale_customers c WHERE (${like(TEST_CUSTOMER_PATTERNS)}) AND c.is_active = 1`,
      TEST_CUSTOMER_PATTERNS,
      `UPDATE sale_customers c SET c.is_active = 0 WHERE (${like(TEST_CUSTOMER_PATTERNS)}) AND c.is_active = 1`)

    // 11) 僵尸任务清理（G-2）：真实仓里也有 7 月卡住的拣货中任务，占着分拣格与容器锁。
    //     判定：仍在执行态 1..6 且超过 30 天没有更新的任务 → 置为已取消(8)，并释放其占用。
    const STALE_DAYS = 30

    // 12) 验收还发现账号与 PDA 设备列表同样被测试数据淹没（2026-09-17 验收 ISSUE-002）：
    //     sys_users 里 smoke_*/esc_*/pc_* 提权与冒烟账号仍启用；pda_devices 里
    //     SMOKE-PDA-*/PDA-2607*/PDA-2608* 回归机仍是启用中。按同一口径「停用不删除」，
    //     只动明确带测试前缀的行，业务账号（admin/test01/sales01…）不受影响。
    const TEST_USER_PATTERNS = ['smoke_%', 'esc_%', 'pc_%']
    const TEST_DEVICE_PATTERNS = ['SMOKE-PDA-%', 'PDA-2607%', 'PDA-2608%', 'PDA-2609%', 'VERIFY-PDA-%']
    await run('停用冒烟/提权测试账号',
      `SELECT COUNT(*) n FROM sys_users WHERE (${likeCol('username', TEST_USER_PATTERNS)}) AND is_active = 1 AND deleted_at IS NULL`,
      TEST_USER_PATTERNS,
      `UPDATE sys_users SET is_active = 0 WHERE (${likeCol('username', TEST_USER_PATTERNS)}) AND is_active = 1 AND deleted_at IS NULL`)
    await run('停用冒烟/回归 PDA 设备',
      `SELECT COUNT(*) n FROM pda_devices WHERE (${likeCol('device_code', TEST_DEVICE_PATTERNS)}) AND status = 'active'`,
      TEST_DEVICE_PATTERNS,
      `UPDATE pda_devices SET status = 'disabled' WHERE (${likeCol('device_code', TEST_DEVICE_PATTERNS)}) AND status = 'active'`)

    await run(`停掉超 ${STALE_DAYS} 天僵尸任务`,
      `SELECT COUNT(*) n FROM warehouse_tasks t WHERE t.deleted_at IS NULL AND t.status IN (1,2,3,4,5,6)
        AND t.updated_at < DATE_SUB(NOW(), INTERVAL ${STALE_DAYS} DAY)`, [],
      `UPDATE warehouse_tasks SET status = 8 WHERE deleted_at IS NULL AND status IN (1,2,3,4,5,6)
        AND updated_at < DATE_SUB(NOW(), INTERVAL ${STALE_DAYS} DAY)`)
    await run('释放僵尸任务占用的分拣格',
      `SELECT COUNT(*) n FROM sorting_bins b WHERE b.status = 2
        AND (b.current_task_id IS NULL OR NOT EXISTS (SELECT 1 FROM warehouse_tasks t WHERE t.id = b.current_task_id AND t.deleted_at IS NULL AND t.status IN (1,2,3,4,5,6)))`,
      [],
      `UPDATE sorting_bins b SET b.status = 1, b.current_task_id = NULL WHERE b.status = 2
        AND (b.current_task_id IS NULL OR NOT EXISTS (SELECT 1 FROM warehouse_tasks t WHERE t.id = b.current_task_id AND t.deleted_at IS NULL AND t.status IN (1,2,3,4,5,6)))`)
    await run('释放僵尸任务锁定的容器',
      `SELECT COUNT(*) n FROM inventory_containers c JOIN warehouse_tasks t ON t.id = c.locked_by_task_id
        WHERE c.deleted_at IS NULL AND c.locked_by_task_id IS NOT NULL AND t.status IN (7,8)`,
      [],
      `UPDATE inventory_containers c JOIN warehouse_tasks t ON t.id = c.locked_by_task_id
        SET c.locked_by_task_id = NULL, c.locked_at = NULL
        WHERE c.deleted_at IS NULL AND c.locked_by_task_id IS NOT NULL AND t.status IN (7,8)`)

    if (APPLY) await conn.commit()
    else await conn.rollback()
    console.log(APPLY ? '== 已执行 ==' : '== 预检（未改动数据）==')
    for (const p of plan) console.log(`  ${p.label}: ${p.rows} 行`)
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    await conn.end()
  }
}

main().catch((e) => { console.error('执行失败:', e.code || e.message); process.exitCode = 1 })
