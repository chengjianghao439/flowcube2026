'use strict'
/**
 * 开发库业务单据清理（2026-09-17，默认 dry-run；只允许本地开发库）
 *
 * 用途：把 smoke/回归/验收写入的业务单据与作业记录清掉，只保留主数据（仓库/商品/客户/供应商）、
 * 账号与权限、系统设置。清理前会把受影响表导出成 JSON 逻辑备份（回滚用），再在同一事务里执行。
 *
 * 用法：
 *   node scripts/repair-dev-business-reset.cjs            # 预检 + 打印各表将删除的行数
 *   node scripts/repair-dev-business-reset.cjs --apply    # 先备份到 /tmp/flowcube-dev-backup-<时间戳>，再执行
 */
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')
const APPLY = process.argv.includes('--apply')

// 删除顺序：先子表后父表，避免留下孤儿行（这正是验收里报过的问题类型）
const TABLES = [
  'inventory_check_item_containers', 'inventory_check_items', 'inventory_checks',
  'warehouse_task_events', 'warehouse_task_items', 'warehouse_tasks',
  'picking_wave_items', 'picking_wave_routes', 'picking_wave_tasks', 'picking_waves',
  'stock_reservations',
  'sale_order_adjustment_container_returns', 'sale_order_adjustment_items',
  'sale_order_adjustment_package_voids', 'sale_order_adjustments',
  'sale_order_expected_bindings', 'sale_order_events', 'sale_order_items', 'sale_orders',
  'sale_return_items', 'sale_returns',
  'purchase_return_items', 'purchase_returns',
  'return_order_events', 'return_task_items', 'return_tasks',
  'inbound_task_events', 'inbound_task_items', 'inbound_tasks',
  'purchase_order_items', 'purchase_orders',
  'purchase_requisition_conversations', 'purchase_requisition_items', 'purchase_requisitions',
  'transfer_order_events', 'transfer_order_items', 'transfer_orders',
  'inventory_disposal_items', 'inventory_disposal_orders',
  'refund_orders',
  'payment_entries', 'payment_record_events', 'payment_receipts', 'payment_records',
  'reconciliation_statement_items', 'reconciliation_statements',
  'logistics_tracking_events', 'logistics_waybills', 'package_items', 'packages',
  'print_jobs', 'scan_logs', 'pda_undo_logs', 'inventory_logs', 'inventory_containers',
  // 库存缓存一并清空：否则删掉容器后 inventory_stock 仍留着 quantity/reserved 旧值，
  // 会出现"事实为 0、缓存有量"的漂移（实测库存页显示在库 93,346，实际 0），
  // 而且 reserved 漂移会把可用量算成 0，直接禁用占库。
  'inventory_stock',
  'order_fulfillment_events', 'order_fulfillment_issues', 'order_delivery_commitments',
  'document_operation_events', 'operation_requests',
  // 凭证由上述业务事实派生，单据清空后必须一起清，否则总账会挂着一批无来源的孤儿凭证
  // （验收里 G-7「凭证净额 vs 业务余额 有差异」正是这类漂移的表现）。
  'acct_voucher_entries', 'acct_vouchers',
]

function loadEnv() {
  const env = {}
  for (const line of fs.readFileSync(path.join(ROOT, 'backend/.env'), 'utf8').split('\n')) {
    if (!line.includes('=') || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    env[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '')
  }
  return env
}

async function main() {
  const env = loadEnv()
  if (!['127.0.0.1', 'localhost'].includes(env.DB_HOST)) throw new Error(`拒绝执行：DB_HOST=${env.DB_HOST} 不是回环地址`)
  if (!/^flowcube_dev/.test(env.DB_NAME || '')) throw new Error(`拒绝执行：DB_NAME=${env.DB_NAME} 不是开发库`)
  const mysql = require(require.resolve('mysql2/promise', { paths: [path.join(ROOT, 'backend')] }))
  const conn = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT), user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME, timezone: '+08:00', multipleStatements: false,
  })
  try {
    const counts = []
    const [exists] = await conn.query(
      'SELECT table_name AS t FROM information_schema.tables WHERE table_schema = ?', [env.DB_NAME])
    const present = new Set(exists.map((r) => r.t))
    const missing = TABLES.filter((t) => !present.has(t))
    if (missing.length) console.log(`（跳过不存在的表：${missing.join(', ')}）`)
    for (const t of TABLES.filter((t) => present.has(t))) {
      const [[row]] = await conn.query(`SELECT COUNT(*) n FROM \`${t}\``)
      if (Number(row.n) > 0) counts.push({ table: t, rows: Number(row.n) })
    }
    const total = counts.reduce((a, c) => a + c.rows, 0)
    if (!APPLY) {
      console.log('== 预检（未改动数据）==')
      for (const c of counts) console.log(`  ${c.table}: ${c.rows}`)
      console.log(`合计 ${total} 行`)
      return
    }
    const dir = `/tmp/flowcube-dev-backup-${new Date().toISOString().replace(/[:.]/g, '-')}`
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
    for (const c of counts) {
      const [rows] = await conn.query(`SELECT * FROM \`${c.table}\``)
      fs.writeFileSync(path.join(dir, `${c.table}.json`), JSON.stringify(rows), { mode: 0o600 })
    }
    console.log(`逻辑备份已写入 ${dir}`)
    await conn.beginTransaction()
    for (const c of counts) await conn.query(`DELETE FROM \`${c.table}\``)
    await conn.commit()
    console.log('== 已执行 ==')
    for (const c of counts) console.log(`  删除 ${c.table}: ${c.rows}`)
    console.log(`合计删除 ${total} 行；主数据/账号/权限/设置未改动`)
  } catch (e) {
    try { await conn.rollback() } catch (_) { /* 忽略 */ }
    throw e
  } finally {
    await conn.end()
  }
}

main().catch((e) => { console.error('执行失败:', e.code || e.message); process.exitCode = 1 })
