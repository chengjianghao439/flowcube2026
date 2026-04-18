const mysql = require('mysql2/promise')
const { env } = require('./env')

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+08:00',
  charset: 'utf8mb4',
})

/** 会话字符集与排序规则，避免极少数环境下连接未按 utf8mb4 解释中文（姓名乱码、排序异常） */
pool.on('connection', (connection) => {
  void connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci')
})

async function testConnection() {
  try {
    const conn = await pool.getConnection()
    await conn.ping()
    conn.release()
    console.log('[DB] 数据库连接成功')
  } catch (err) {
    console.error('[DB] 数据库连接失败:', err.message)
    process.exit(1)
  }
}

module.exports = { pool, testConnection }
