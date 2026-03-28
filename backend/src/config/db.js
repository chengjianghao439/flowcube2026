const mysql = require('mysql2/promise')

const pool = mysql.createPool({
  host: process.env.DB_HOST || '127.0.0.1',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'flowcube',
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
