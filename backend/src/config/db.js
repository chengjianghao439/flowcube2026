const mysql = require('mysql2/promise')
const { env } = require('./env')
const { boundPoolAcquisition } = require('../utils/boundedPool')

const pool = mysql.createPool({
  host: env.DB_HOST,
  port: env.DB_PORT,
  user: env.DB_USER,
  password: env.DB_PASSWORD,
  database: env.DB_NAME,
  waitForConnections: true,
  connectionLimit: env.DB_POOL_SIZE,
  // queueLimit 有上限而非 0（无限排队）：连接池打满后无限排队会让请求一直挂着，
  // 既没有超时也没有错误，最终演变成整站无响应。200 远高于正常并发量，
  // 只有在真正雪崩时才会触发，此时快速失败比静默堆积更容易定位问题。
  queueLimit: 200,
  timezone: '+08:00',
  charset: 'utf8mb4',
  // 注意：mysql2 不支持 acquireTimeout（那是旧 mysql 库的选项），传了会被忽略并打印
  // "Ignoring invalid configuration option" 警告。获取连接的等待由 waitForConnections
  // + queueLimit 控制数量；boundPoolAcquisition 另限制排队时长。
  connectTimeout: 10000,
})

boundPoolAcquisition(pool, { timeoutMs: env.DB_ACQUIRE_TIMEOUT_MS })

/** 会话字符集与排序规则，避免极少数环境下连接未按 utf8mb4 解释中文（姓名乱码、排序异常） */
pool.on('connection', (connection) => {
  void connection.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci')
  // 事务锁等待超时：极端死锁时快速失败，防止连接挂满 wait_timeout（默认8小时）。
  // InnoDB lock_wait_timeout 默认 50 秒，设为 30 秒让死锁更快暴露。
  void connection.query('SET SESSION innodb_lock_wait_timeout = 30')
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
