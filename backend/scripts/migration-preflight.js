'use strict'

// Read-only deployment preflight: never run migrations, start the app, or change grants/config.
async function checkMigrationConditions(conn, { files, read }) {
  const [[table]] = await conn.query("SELECT COUNT(*) AS present FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='db_migrations'")
  if (![0, 1].includes(Number(table?.present))) throw Error('迁移记录状态未知')
  const [rows] = Number(table.present) === 1 ? await conn.query('SELECT filename FROM db_migrations') : [[]]
  const applied = new Set(rows.map(row => row.filename))
  const pending = files.filter(filename => !applied.has(filename))
  // Keep string contents so dynamic DDL is examined too; normalize literal boundaries.
  const required = new Set()
  let unsafeFunctionDeclaration = false
  const sensitive = pending.filter(filename => {
    const sql = read(filename).replace(/\/\*!\d*\s*([\s\S]*?)\*\//g, ' $1 ').replace(/^\s*(?:--[^\n]*|#[^\n]*)$/gm, '').replace(/\/\*(?!!)[\s\S]*?\*\//g, ' ')
    const normalized = sql.replace(/['"`,+]/g, ' ')
    const definitions = [...normalized.matchAll(/\b(CREATE|ALTER)\s+(?:DEFINER\s*=[\s\S]*?\s+)?(TRIGGER|FUNCTION)\b/gi)]
    for (const match of definitions) {
      if (/\bDEFINER\s*=/i.test(match[0])) throw Error('数据库迁移条件未知：显式DEFINER身份未证明')
      required.add(match[2].toUpperCase() === 'TRIGGER' ? 'TRIGGER' : match[1].toUpperCase() === 'ALTER' ? 'ALTER ROUTINE' : 'CREATE ROUTINE')
      if (match[1].toUpperCase() === 'ALTER' && match[2].toUpperCase() === 'FUNCTION') unsafeFunctionDeclaration = true
      if (match[1].toUpperCase() === 'CREATE' && match[2].toUpperCase() === 'FUNCTION') {
        const header = sql.slice(match.index + match[0].length).split(/\b(?:BEGIN|RETURN)\b/i)[0]
        if (/['"]/.test(header) || (!/\b(?:NO\s+SQL|READS\s+SQL\s+DATA)\b/i.test(header) && (!/\bDETERMINISTIC\b/i.test(header) || /\bNOT\s+DETERMINISTIC\b/i.test(header)))) unsafeFunctionDeclaration = true
      }
    }
    return definitions.length > 0
  })
  if (!sensitive.length) return { pending, sensitive }
  const [[identity]] = await conn.query('SELECT DATABASE() AS databaseName')
  if (typeof identity?.databaseName !== 'string' || !identity.databaseName) throw Error('迁移数据库身份未知')
  const [grants] = await conn.query('SHOW GRANTS')
  let superPrivilege = false
  const held = new Set()
  for (const row of grants) {
    const match = /^GRANT\s+(.+?)\s+ON\s+(.+?)\s+TO\s/i.exec(String(Object.values(row)[0]))
    if (!match) continue
    const globalScope = match[2] === '*.*'
    const databaseScope = /^`((?:``|[^`])+)`\.\*$/.exec(match[2])
    const databaseName = databaseScope?.[1].replace(/``/g, '`').replace(/\\([_%\\])/g, '$1')
    if (!globalScope && databaseName !== identity.databaseName) continue
    const privileges = match[1].split(',').map(value => value.trim().toUpperCase())
    if (globalScope && (privileges.includes('SUPER') || privileges.includes('ALL PRIVILEGES'))) superPrivilege = true
    for (const privilege of privileges) held.add(privilege)
  }
  if (!held.has('ALL PRIVILEGES') && [...required].some(privilege => !held.has(privilege))) throw Error('数据库迁移条件不足：实际迁移账户缺少对应数据库的DDL权限')
  const [[flags]] = await conn.query('SELECT @@GLOBAL.log_bin AS binlog,@@GLOBAL.log_bin_trust_function_creators AS trusted')
  if (![0, 1, '0', '1'].includes(flags?.binlog) || ![0, 1, '0', '1'].includes(flags?.trusted)) throw Error('数据库迁移条件未知')
  if (Number(flags.binlog) && !Number(flags.trusted) && unsafeFunctionDeclaration) throw Error('数据库迁移条件不足：函数声明无法证明满足二进制日志条件')
  if (Number(flags.binlog) && !Number(flags.trusted) && !superPrivilege) throw Error('数据库迁移条件不足：待执行触发器或函数缺少已有条件')
  return { pending, sensitive }
}
async function main() {
  let conn
  try {
    const fs = require('node:fs'), path = require('node:path')
    const mysql = require('mysql2/promise')
    const { env } = require('../src/config/env')
    const dir = path.join(__dirname, '../src/database')
    conn = await mysql.createConnection({ host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME, connectTimeout: 5000, multipleStatements: false })
    await conn.query('START TRANSACTION READ ONLY')
    const result = await checkMigrationConditions(conn, { files: fs.readdirSync(dir).filter(file => file.endsWith('.sql')).sort(), read: file => fs.readFileSync(path.join(dir, file), 'utf8') })
    console.log(JSON.stringify({ status: 'migration-preflight-ok', ...result }))
  } catch {
    // Client errors, grants and config may contain credentials; never log them.
    console.error('数据库迁移条件不足、未知或只读查询失败；保持原应用，不修改全局参数，请人工核实')
    process.exitCode = 1
  } finally {
    if (conn) { await conn.rollback().catch(() => {}); await conn.end().catch(() => {}) }
  }
}
if (require.main === module) main()
module.exports = { checkMigrationConditions }
