/**
 * 数据库迁移运行器
 * 当前已改为显式执行：由 scripts/migrate.js 或 npm run migrate 触发。
 *
 * 迁移文件按「编号 + 下划线 + 描述」命名（如 194_accounting_period_close.sql）。
 * 历史遗留：057/064/089 有重复编号、缺 008/009/040。编号校验（checkGaps）对这些
 * 只 console.warn 不中断——迁移仍按文件名排序执行，编号不参与执行顺序。
 */
const fs = require('fs')
const path = require('path')
const mysql2 = require('mysql2/promise')
const { env } = require('../config/env')

/** 历史遗留的重复编号（审计 4.10 现状）：这些是既有事实，校验放行不失败。
 *  只有「新增的重复编号」才应让 CI 失败——防止开发者手滑新建与已有迁移撞号的文件。 */
const LEGACY_DUPLICATE_NUMBERS = new Set(['057', '064', '089'])

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
  const numbers = files
    .map(migrationNumber)
    .filter((n) => n !== null)
    .sort((a, b) => a - b)
  const duplicates = []
  const seen = new Set()
  for (const n of numbers) {
    if (seen.has(n)) duplicates.push(String(n).padStart(3, '0'))
    seen.add(n)
  }
  const newDuplicates = duplicates.filter((n) => !LEGACY_DUPLICATE_NUMBERS.has(n))
  const gaps = []
  if (numbers.length) {
    for (let n = numbers[0]; n <= numbers[numbers.length - 1]; n++) {
      if (!seen.has(n)) gaps.push(String(n).padStart(3, '0'))
    }
  }
  return { gaps, duplicates, newDuplicates }
}

async function runMigrations({ checkGapsOnly = false } = {}) {
  const cfg = {
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    multipleStatements: true,
  }

  // 扫描 SQL 文件（排除 migrate.js 自身）
  const dir = path.join(__dirname)
  const files = fs.readdirSync(dir)
    .filter(f => f.endsWith('.sql'))
    .sort()

  // 编号静态检查（--check-gaps 模式只做检查不连库）
  const { gaps, duplicates, newDuplicates } = checkMigrationGaps(files)
  if (newDuplicates.length) {
    console.error(`[Migrate] ✗ 新增重复迁移编号：${newDuplicates.join(', ')}——新迁移文件与已有文件撞号，请改用下一个可用编号（当前最大 ${migrationNumber(files[files.length - 1]) ?? '未知'} + 1）。历史遗留重复 ${duplicates.filter(d => !newDuplicates.includes(d)).join(', ') || '无'} 不受影响。`)
  }
  if (duplicates.length) {
    console.warn(`[Migrate] ⚠ 重复迁移编号：${duplicates.join(', ')}（历史遗留 ${LEGACY_DUPLICATE_NUMBERS.has(duplicates[0]) ? '' : ''}，仅提示不中断）`)
  }
  if (gaps.length) {
    console.warn(`[Migrate] ⚠ 缺迁移编号：${gaps.join(', ')}（历史遗留，不影响执行）`)
  }
  if (checkGapsOnly) {
    console.log(`[Migrate] 编号校验完成：共 ${files.length} 个迁移文件，${newDuplicates.length ? `新增重复 ${newDuplicates.length} 个（将失败）` : '无新增重复'}，${duplicates.length ? `历史重复 ${duplicates.length} 个，` : '无历史重复，'}${gaps.length ? `缺号 ${gaps.length} 个` : '编号连续'}`)
    return { gaps, duplicates, newDuplicates, files: files.length }
  }

  const conn = await mysql2.createConnection(cfg)
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

    // 先执行按编号排序的 SQL 建表迁移，保证基础表存在后再做增量 ALTER
    let ran = 0
    for (const file of files) {
      const [[existing]] = await conn.query(
        'SELECT id FROM db_migrations WHERE filename=?', [file]
      )
      if (existing) continue

      const sql = fs.readFileSync(path.join(dir, file), 'utf8')
      await conn.query(sql)
      await conn.query('INSERT INTO db_migrations (filename) VALUES (?)', [file])
      console.log(`[Migrate] ✓ ${file}`)
      ran++
    }

    if (ran === 0) {
      console.log('[Migrate] 所有迁移均已执行，无需更新')
    } else {
      console.log(`[Migrate] 完成，共执行 ${ran} 个迁移文件`)
    }
  } finally {
    await conn.end()
  }
}

module.exports = { runMigrations, checkMigrationGaps }
