'use strict'
const fs = require('fs')
const path = require('path')
const mysql2 = require('mysql2/promise')
const { env } = require('../config/env')
const { runMigrations, executeMigrationStatements } = require('./migrate')

// Explicit first-install entry point. Never called by application startup,
// ordinary migrations or upgrades. An interrupted schema is deliberately refused.
async function bootstrapNewDatabase() {
  const conn = await mysql2.createConnection({
    host: env.DB_HOST, port: env.DB_PORT, user: env.DB_USER,
    password: env.DB_PASSWORD, database: env.DB_NAME,
  })
  try {
    const [objects] = await conn.query(`
      SELECT TABLE_TYPE object_type,TABLE_NAME object_name FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE()
      UNION ALL SELECT ROUTINE_TYPE,ROUTINE_NAME FROM information_schema.ROUTINES WHERE ROUTINE_SCHEMA=DATABASE()
      UNION ALL SELECT 'TRIGGER',TRIGGER_NAME FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE()
      UNION ALL SELECT 'EVENT',EVENT_NAME FROM information_schema.EVENTS WHERE EVENT_SCHEMA=DATABASE()
      ORDER BY object_type,object_name
    `)
    if (objects.length) {
      const error = new Error('新库初始化仅接受无任何对象的 schema；已有对象：\n'
        + objects.map(row => `${row.object_type}: ${row.object_name}`).join('\n')
        + '\n请核对目标并新建空库。已有或中断库不得重置、删表、伪造迁移记录或用此入口修复权限；按 docs/DEPLOY.md 处理。')
      error.code = 'NEW_DATABASE_NOT_EMPTY'
      throw error
    }
    await runMigrations({ through: '295_role_duties_approval.sql', connection: conn })
    const file = path.join(__dirname, 'bootstrap/new-install-role-defaults.sql')
    await executeMigrationStatements(conn, fs.readFileSync(file, 'utf8'), 'bootstrap/new-install-role-defaults.sql')
    // No alternate baseline or skip in 296: use the ordinary strict runner.
    await runMigrations({ connection: conn })
    console.log('[Bootstrap] 新库初始化完成；已执行普通严格迁移')
  } catch (error) {
    try { await conn.rollback() } catch (rollbackError) { error.rollbackError = rollbackError }
    throw error
  } finally {
    await conn.end()
  }
}

module.exports = { bootstrapNewDatabase }
