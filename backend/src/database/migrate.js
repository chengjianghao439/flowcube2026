/**
 * 数据库迁移运行器
 * 当前已改为显式执行：由 scripts/migrate.js 或 npm run migrate 触发。
 *
 * 迁移文件按「编号 + 下划线 + 描述」命名（如 194_accounting_period_close.sql）。
 * 历史重复只豁免已确认的文件，缺号只提示。迁移仍按文件名排序执行。
 */
const fs = require('fs')
const path = require('path')
const mysql2 = require('mysql2/promise')
const { splitSqlStatements } = require('./sqlStatements')

const LEGACY_DUPLICATE_FILES = new Set([
  '057_add_page_inbound_permission.sql',
  '057_inbound_task_multi_purchase.sql',
  '064_create_operation_requests.sql',
  '064_product_cost_price_compat.sql',
  '089_inventory_logs_change_qty_default.sql',
  '089_widen_product_fields.sql',
])

/** 提取文件名开头的编号；非「编号_xxx.sql」格式返回 null */
function migrationNumber(filename) {
  const m = /^(\d{3})_/.exec(filename)
  return m ? Number(m[1]) : null
}

/**
 * 检查迁移文件编号的连续性 + 唯一性（审计 4.10）。
 * 返回 { gaps, duplicates, newDuplicates }：
 *   - gaps        缺的编号（历史缺号 008/009/040 在内，只 warn 不中断）
 *   - duplicates  全部重复编号
 *   - newDuplicates 仅「历史遗留之外」的重复编号（新增撞号 → CI 应失败）
 * 真实执行仍按文件名排序，编号不参与执行顺序。
 */
function checkMigrationGaps(files) {
  const byNumber = new Map()
  for (const file of files) {
    const number = migrationNumber(file)
    if (number === null) continue
    if (!byNumber.has(number)) byNumber.set(number, [])
    byNumber.get(number).push(file)
  }
  const numbers = [...byNumber.keys()].sort((a, b) => a - b)
  const duplicates = []
  const newDuplicates = []
  for (const number of numbers) {
    const group = byNumber.get(number)
    if (group.length < 2) continue
    const label = String(number).padStart(3, '0')
    duplicates.push(label)
    if (group.some(file => !LEGACY_DUPLICATE_FILES.has(file))) newDuplicates.push(label)
  }
  const gaps = []
  if (numbers.length) {
    for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n++) {
      if (!byNumber.has(n)) gaps.push(String(n).padStart(3, '0'))
    }
  }
  return { gaps, duplicates, newDuplicates }
}

// SQL assertions return one untruncated diagnostic per row. MySQL SIGNAL's
// short MESSAGE_TEXT cannot carry a complete multi-role permission difference.
async function executeMigrationStatements(conn, sql, filename, { recordMigration = false } = {}) {
  for (const statement of splitSqlStatements(sql)) {
    const [rows] = await conn.query(statement)
    const errors = Array.isArray(rows) ? rows.filter(row => typeof row?.migration_error === 'string') : []
    if (errors.length) {
      const error = new Error(`[Migrate] ${filename}\n${errors.map(row => row.migration_error).join('\n')}`)
      error.code = 'MIGRATION_PREFLIGHT_FAILED'
      throw error
    }
  }
  // The migration and its success receipt are one sequential write work unit.
  // Raw SQL callers retain the original helper behavior unless explicitly opted in.
  if (recordMigration) await conn.query('INSERT INTO db_migrations (filename) VALUES (?)', [filename])
}

async function runMigrations({ checkGapsOnly = false, through, connection } = {}) {
  // 扫描 SQL 文件（排除 migrate.js 自身）
  const dir = path.join(__dirname)
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  // 编号静态检查（--check-gaps 模式只做检查不连库）
  const { gaps, duplicates, newDuplicates } = checkMigrationGaps(files)
  const historicalDuplicates = duplicates.filter(number => !newDuplicates.includes(number))
  if (newDuplicates.length) {
    const conflicts = files.filter(file => newDuplicates.some(number => file.startsWith(`${number}_`)))
    const message = `新增重复迁移编号：${newDuplicates.join(', ')}（${conflicts.join(', ')}）。请基于当前最大编号分配新文件。`
    if (!checkGapsOnly) throw Object.assign(new Error(message), { code: 'MIGRATION_NUMBER_CONFLICT' })
    console.error(`[Migrate] ✗ ${message}`)
  }
  if (historicalDuplicates.length) {
    console.warn(`[Migrate] ⚠ 历史重复迁移编号：${historicalDuplicates.join(', ')}（既有文件，仅提示）`)
  }
  if (gaps.length) {
    console.warn(`[Migrate] ⚠ 缺迁移编号：${gaps.join(', ')}（历史遗留，不影响执行）`)
  }
  if (checkGapsOnly) {
    console.log(`[Migrate] 编号校验完成：共 ${files.length} 个迁移文件，新增重复 ${newDuplicates.length} 个，历史重复 ${historicalDuplicates.length} 个，缺号 ${gaps.length} 个`)
    return { gaps, duplicates, newDuplicates, files: files.length }
  }
  // Explicit prefix execution for isolated fixture preparation. Default runs
  // every migration, including strict production-baseline assertions.
  if (through !== undefined && !files.includes(through)) throw new Error(`未知迁移终点：${through}`)

  const { env } = require('../config/env')
  const cfg = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true,
  }
  const conn = connection || await mysql2.createConnection(cfg)
  try {
    // 先确保迁移记录表存在
    await conn.query(`
      CREATE TABLE IF NOT EXISTS db_migrations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename VARCHAR(200) NOT NULL,
        executed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id), UNIQUE KEY uk_file (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `)

    // 在结转数据写入前核实触发器创建权限，避免权限不足留下半次初始化。
    const [ledgerMigrations] = await conn.query("SELECT filename FROM db_migrations WHERE filename IN ('238_party_ledger.sql','239_party_ledger_receipt_identity.sql','240_party_ledger_explicit_identity.sql')")
    if (ledgerMigrations.length < 3 && files.includes('238_party_ledger.sql')) {
      const [[flags]] = await conn.query('SELECT @@GLOBAL.log_bin binlog,@@GLOBAL.log_bin_trust_function_creators trusted')
      if (Number(flags.binlog) && !Number(flags.trusted)) {
        const [grants] = await conn.query('SHOW GRANTS')
        const allowed = grants.some(row => /GRANT (?:ALL PRIVILEGES ON \*\.\*|[^\n]*\bSUPER\b)/i.test(String(Object.values(row)[0])))
        if (!allowed) throw new Error('往来明细迁移需要已有的触发器创建条件：当前授权或数据库条件不足，请由管理员核实；部署脚本不会修改全局参数；未写入结转数据')
      }
    }

    // 先执行按编号排序的 SQL 建表迁移，保证基础表存在后再做增量 ALTER
    let ran = 0
    for (const file of files) {
      if (through !== undefined && file > through) break
      const [[existing]] = await conn.query(
        'SELECT id FROM db_migrations WHERE filename=?', [file]
      )
      if (existing) continue

      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      // 逐条执行：整文件当一条多语句发送时，非末条 CREATE TRIGGER 的函数体会把
      // 结尾分号一起写进 ACTION_STATEMENT，导出成无法导入的 `... ); */;;`（见
      // sqlStatements.js 说明与 2026-09-14 备份恢复演练事故）。
      await executeMigrationStatements(conn, sql, file, { recordMigration: true })
      console.log(`[Migrate] ✓ ${file}`)
      ran++
    }

    if (ran === 0) {
      console.log('[Migrate] 所有迁移均已执行，无需更新')
    } else {
      console.log(`[Migrate] 完成，共执行 ${ran} 个迁移文件`)
    }
  } catch (error) {
    // A borrowed connection's caller owns transaction cleanup and lifetime.
    if (!connection) {
      try { await conn.rollback() } catch (rollbackError) { error.rollbackError = rollbackError }
    }
    throw error
  } finally {
    if (!connection) await conn.end()
  }
}

module.exports = { runMigrations, checkMigrationGaps, executeMigrationStatements }
