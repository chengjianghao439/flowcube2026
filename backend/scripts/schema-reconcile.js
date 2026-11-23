#!/usr/bin/env node
/**
 * 数据库 schema 对账（文档12）：检测「已执行迁移声明建的表」与「实际库结构」的漂移。
 *
 * 背景：生产库曾有「迁移未真正生效导致缺列」的漂移史（docs/claude-md-archive-2026-09-04.md 第20节）。
 * 本脚本从已执行的迁移文件里提取 CREATE TABLE 的表名，与 information_schema 实际表比对，
 * 报告：缺失的表、意外存在的表。只读检查不写库。
 *
 * 2026-09-18 审计 [16]④ 补第二部分：**索引级对账**。只比对表名看不见「表在、索引没建」这类
 * 漂移——而本仓最典型的漏法是 `CREATE TABLE IF NOT EXISTS` 对历史表是空操作（004 就因此
 * 声明了 uk_product_code 却从未生效），于是「活跃期唯一性」在演化库上完全不存在（NULL 互不
 * 相等 → 活跃行零约束）或反过来把软删行的编码永久占住。这里按**名字 + 列序**核对代码真正依赖
 * 的那批活跃期唯一键（REQUIRED_ACTIVE_UNIQUES），并对残留的旧式 `(业务键, deleted_at)` 唯一键
 * 给出提示（它们对活跃行零约束，只在同一秒软删两条同码行时撞车，已由 075/248/252 逐步移除）。
 *
 * 用法：
 *   node scripts/schema-reconcile.js            # 全量对账，缺失/意外表不中断（warn）
 *   node scripts/schema-reconcile.js --strict   # 缺表或关键索引、列定义错误即 exit 1
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mysql2 = require('mysql2/promise')
const { env } = require('../src/config/env')

const strict = process.argv.includes('--strict')

/** 运行时自建表（代码里 CREATE TABLE IF NOT EXISTS，非迁移建的表）——对账时豁免。
 *  pda_error_logs / pda_undo_logs 已由迁移 293 正式声明，不再豁免。 */
const KNOWN_RUNTIME_TABLES = new Set(['db_migrations', 'db_migration_attempts'])

/**
 * 「活跃期唯一键」契约：代码与业务真正依赖的唯一性，靠 active_unique_guard 生成列实现
 * （软删行该列自动为 NULL，MySQL 唯一键把 NULL 视为互不相同 → 活跃行唯一、软删行可复用编码）。
 * 列序必须完全一致（列序决定最左前缀能否服务 `WHERE code = ?` 的查询）。
 */
const REQUIRED_ACTIVE_UNIQUES = [
  { table: 'product_items', index: 'uk_product_items_code_active', columns: ['code', 'active_unique_guard'] },
  { table: 'supply_suppliers', index: 'uk_supply_suppliers_code_active', columns: ['code', 'active_unique_guard'] },
  { table: 'carriers', index: 'uk_carrier_code', columns: ['code', 'active_unique_guard'] },
  { table: 'warehouse_locations', index: 'uk_location_code', columns: ['code', 'active_unique_guard'] },
  { table: 'inventory_warehouses', index: 'uk_inventory_warehouses_code_active', columns: ['code', 'active_unique_guard'] },
  { table: 'sale_customers', index: 'uk_sale_customers_code_active', columns: ['code', 'active_unique_guard'] },
  { table: 'sys_users', index: 'uk_sys_users_username_active', columns: ['username', 'active_unique_guard'] },
]
const OPERATION_REQUEST_IDENTITY = {
  table: 'operation_requests',
  index: 'uk_operation_requests_key',
  columns: ['request_key', 'action', 'user_id'],
}

/** 从 SQL 文本提取 CREATE TABLE 的表名 */
function extractTableNames(sql) {
  const names = []
  const re = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?\s*\(/gi
  let m
  while ((m = re.exec(sql))) names.push(m[1].toLowerCase())
  return [...new Set(names)]
}

/** 从 SQL 文本提取 DROP TABLE 的表名（被后续迁移删除的表不应计入 expected） */
function extractDroppedTables(sql) {
  const names = []
  const re = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?`?([a-zA-Z0-9_]+)`?/gi
  let m
  while ((m = re.exec(sql))) names.push(m[1].toLowerCase())
  return [...new Set(names)]
}

async function main() {
  const dir = path.join(__dirname, '../src/database')
  const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()

  const conn = await mysql2.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
  })

  // 已执行的迁移文件名
  const [executedRows] = await conn.query('SELECT filename FROM db_migrations')
  const executedSet = new Set(executedRows.map(r => r.filename))

  // 所有迁移文件声明的表
  const declaredTables = new Set()
  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const t of extractTableNames(sql)) declaredTables.add(t)
  }

  // 实际库中的表
  const [tables] = await conn.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE() AND table_type = 'BASE TABLE'",
  )
  const actualTables = new Set(tables.map(r => (r.table_name || r.TABLE_NAME || '').toLowerCase()))

  // 已执行迁移声明的表（排除未执行迁移的，未执行迁移缺表是正常的）
  // 也排除「被后续迁移 DROP 掉」的表（如序列号融合、单租户收编时删除的旧表）——这些缺失是预期的
  const expectedTables = new Set()
  const droppedTables = new Set()
  for (const f of files) {
    if (!executedSet.has(f)) continue
    const sql = fs.readFileSync(path.join(dir, f), 'utf8')
    for (const t of extractTableNames(sql)) expectedTables.add(t)
    for (const t of extractDroppedTables(sql)) droppedTables.add(t)
  }
  for (const t of droppedTables) expectedTables.delete(t)

  const missing = [...expectedTables].filter(t => !actualTables.has(t)).sort()
  // 意外表：实际存在、但不在任何迁移声明里且非运行时自建表
  const unexpected = [...actualTables].filter(t => !declaredTables.has(t) && !KNOWN_RUNTIME_TABLES.has(t)).sort()

  // ── ② 索引级对账：活跃主数据与操作回执唯一键 ──────────────────────────────
  const [indexRows] = await conn.query(
    `SELECT TABLE_NAME AS tbl, INDEX_NAME AS idx, NON_UNIQUE AS nonUnique,
            GROUP_CONCAT(IF(SUB_PART IS NULL, COLUMN_NAME, CONCAT(COLUMN_NAME, '(', SUB_PART, ')')) ORDER BY SEQ_IN_INDEX) AS cols
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      GROUP BY TABLE_NAME, INDEX_NAME, NON_UNIQUE`,
  )
  const indexMap = new Map(indexRows.map(r => [
    `${String(r.tbl).toLowerCase()}.${String(r.idx).toLowerCase()}`,
    { unique: Number(r.nonUnique) === 0, columns: String(r.cols || '').split(',') },
  ]))
  const requiredUniques = [...REQUIRED_ACTIVE_UNIQUES]
  if (executedSet.has('064_create_operation_requests.sql')) requiredUniques.push(OPERATION_REQUEST_IDENTITY)
  if (executedSet.has('298_stock_import_receipts.sql')) {
    requiredUniques.push(
      { table: 'inventory_stock_import_runs', index: 'primary', columns: ['user_id', 'request_key'] },
      { table: 'inventory_stock_import_runs', index: 'uk_stock_import_run_batch', columns: ['batch_id'] },
      { table: 'inventory_stock_import_rows', index: 'primary', columns: ['batch_id', 'row_index'] },
    )
  }
  if (executedSet.has('299_inventory_cycle_runs.sql')) {
    requiredUniques.push(
      { table: 'inventory_cycle_runs', index: 'primary', columns: ['planned_date', 'warehouse_id', 'abc_class'] },
      { table: 'inventory_cycle_runs', index: 'uk_inventory_cycle_runs_stockcheck', columns: ['stockcheck_id'] },
    )
  }
  const uniqueProblems = []
  for (const req of requiredUniques) {
    const found = indexMap.get(`${req.table}.${req.index}`)
    const want = req.columns.join(',')
    if (!found) uniqueProblems.push(`${req.table}.${req.index} 不存在（期望 UNIQUE(${want})）`)
    else if (!found.unique) uniqueProblems.push(`${req.table}.${req.index} 不是唯一键（期望 UNIQUE(${want})）`)
    else if (found.columns.join(',') !== want) uniqueProblems.push(`${req.table}.${req.index} 列序不符：实际 (${found.columns.join(',')})，期望 (${want})`)
  }
  // 旧式 (业务键, deleted_at) 唯一键：只提示，不判失败——演化库上它们大多是历史遗留噪音
  const legacyPairUniques = indexRows
    .filter(r => Number(r.nonUnique) === 0 && String(r.cols || '').endsWith(',deleted_at'))
    .map(r => `${String(r.tbl).toLowerCase()}.${String(r.idx).toLowerCase()}(${r.cols})`)
    .sort()

  const columnProblems = []
  if (executedSet.has('292_cash_cents_execution_proofs.sql')) {
    const [[column]] = await conn.query(
      `SELECT DATA_TYPE AS dataType, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable,
              COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
         FROM information_schema.COLUMNS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'payment_records' AND COLUMN_NAME = 'cash_projection'`,
    )
    if (!column) columnProblems.push('payment_records.cash_projection 不存在（期望 JSON NULL）')
    else if (column.dataType !== 'json' || column.columnType !== 'json' || column.isNullable !== 'YES'
      || column.defaultValue !== null || column.extra !== '') {
      columnProblems.push('payment_records.cash_projection 列定义不符（期望 JSON NULL，默认 NULL，无额外属性）')
    }
  }
  if (executedSet.has('301_batch_receipt_proof_revision.sql')) {
    const proofTables = ['operation_requests', 'sale_order_events', 'payment_record_events']
    const [columns] = await conn.query(
      `SELECT TABLE_NAME AS tbl, COLUMN_TYPE AS columnType, IS_NULLABLE AS isNullable, COLUMN_DEFAULT AS defaultValue, EXTRA AS extra
         FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE()
          AND TABLE_NAME IN (?) AND COLUMN_NAME='batch_proof_revision'`, [proofTables],
    )
    const [triggers] = await conn.query(
      `SELECT TRIGGER_NAME AS name, EVENT_OBJECT_TABLE AS tbl, ACTION_TIMING AS timing,
              EVENT_MANIPULATION AS action, ACTION_STATEMENT AS body
         FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE IN (?)`, [proofTables],
    )
    for (const table of proofTables) {
      const column = columns.find(row => row.tbl === table)
      const trigger = triggers.find(row => row.tbl === table && row.name === 'trg_' + table + '_batch_proof')
      if (!column || column.columnType !== 'bigint unsigned' || column.isNullable !== 'NO'
          || column.defaultValue == null || Number(column.defaultValue) !== 0 || column.extra !== '') {
        columnProblems.push(`${table}.batch_proof_revision 列定义不符（期望 BIGINT UNSIGNED NOT NULL DEFAULT 0）`)
      }
      if (!trigger || trigger.timing !== 'BEFORE' || trigger.action !== 'UPDATE'
          || !/setnew\.batch_proof_revision=old\.batch_proof_revision\+if\(/.test(String(trigger.body).toLowerCase().replace(/[\s`]/g, ''))) {
        columnProblems.push(`trg_${table}_batch_proof 触发器不符合回执证据版本约定`)
      }
    }
  }
  const ok = missing.length === 0 && uniqueProblems.length === 0 && columnProblems.length === 0
  console.log('═'.repeat(60))
  console.log('  Schema 对账')
  console.log('═'.repeat(60))
  console.log(`  已执行迁移: ${executedSet.size} 个，声明表 ${expectedTables.size} 个，库中实际表 ${actualTables.size} 个`)
  if (missing.length) {
    console.error(`  ✗ 缺失表 ${missing.length} 个（已执行迁移声明但库中不存在）：`)
    for (const t of missing) console.error(`    - ${t}`)
  } else {
    console.log('  [PASS] 已执行迁移声明的表全部存在')
  }
  if (unexpected.length) {
    console.warn(`  ⚠ 意外表 ${unexpected.length} 个（库中存在但不在任何迁移声明里）：`)
    for (const t of unexpected.slice(0, 20)) console.warn(`    - ${t}`)
    if (unexpected.length > 20) console.warn(`    ... 等 ${unexpected.length} 个`)
  }
  if (uniqueProblems.length) {
    console.error(`  ✗ 关键唯一键不达标 ${uniqueProblems.length} 处：`)
    for (const p of uniqueProblems) console.error(`    - ${p}`)
  } else {
    console.log(`  [PASS] ${requiredUniques.length} 个关键唯一键全部存在且列序正确`)
  }
  for (const p of columnProblems) console.error(`  ✗ ${p}`)
  if (legacyPairUniques.length) {
    console.warn(`  ⚠ 仍在使用旧式 (业务键, deleted_at) 唯一键 ${legacyPairUniques.length} 处——`
      + '对活跃行零约束（MySQL 里 NULL 互不相等），只会在同一秒软删两条同码行时撞车，建议按 075/248/252 的模板换成 active_unique_guard：')
    for (const p of legacyPairUniques.slice(0, 12)) console.warn(`    - ${p}`)
    if (legacyPairUniques.length > 12) console.warn(`    ... 等 ${legacyPairUniques.length} 个`)
  }
  console.log('═'.repeat(60))

  await conn.end()
  if (strict && !ok) process.exit(1)
  process.exit(0)
}

main().catch(e => { console.error('[schema-reconcile] 失败:', e.message); process.exit(1) })
