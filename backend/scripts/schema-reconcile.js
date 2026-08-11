#!/usr/bin/env node
/**
 * 数据库 schema 对账（文档12）：检测「已执行迁移声明建的表」与「实际库结构」的漂移。
 *
 * 背景：生产库曾有「迁移未真正生效导致缺列」的漂移史（CLAUDE.md 第20节）。
 * 本脚本从已执行的迁移文件里提取 CREATE TABLE 的表名，与 information_schema 实际表比对，
 * 报告：缺失的表、意外存在的表。只读检查不写库。
 *
 * 用法：
 *   node scripts/schema-reconcile.js            # 全量对账，缺失/意外表不中断（warn）
 *   node scripts/schema-reconcile.js --strict   # 任一缺失表即 exit 1（可挂 CI 门禁）
 */
require('dotenv').config()
const fs = require('fs')
const path = require('path')
const mysql2 = require('mysql2/promise')
const { env } = require('../src/config/env')

const strict = process.argv.includes('--strict')

/** 运行时自建表（代码里 CREATE TABLE IF NOT EXISTS，非迁移建的表）——对账时豁免 */
const KNOWN_RUNTIME_TABLES = new Set(['db_migrations', 'pda_error_logs', 'pda_undo_logs'])

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
    "SELECT table_name FROM information_schema.tables WHERE table_schema = DATABASE()",
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

  const ok = missing.length === 0
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
  console.log('═'.repeat(60))

  await conn.end()
  if (strict && !ok) process.exit(1)
  process.exit(0)
}

main().catch(e => { console.error('[schema-reconcile] 失败:', e.message); process.exit(1) })
