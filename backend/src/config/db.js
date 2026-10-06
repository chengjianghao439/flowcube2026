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

// mysql2 timezone only controls Date serialization/parsing. NOW()/CURRENT_TIMESTAMP
// and DATE_FORMAT need the same server-session zone, including UTC-hosted MySQL.
const sessionReady = new WeakMap()
pool.on('connection', (connection) => {
  const client = connection.promise()
  const ready = client.query("SET SESSION time_zone = '+08:00', innodb_lock_wait_timeout = 30")
    .then(() => client.query('SET NAMES utf8mb4 COLLATE utf8mb4_unicode_ci'))
  sessionReady.set(connection, ready)
  // Connection events fire before acquisition resolves. Retain the rejection for
  // the borrower while observing it immediately, so setup failure is never unhandled.
  void ready.catch(() => {})
})

const acquire = pool.getConnection.bind(pool)
pool.getConnection = async () => {
  const conn = await acquire()
  try {
    const ready = sessionReady.get(conn.connection)
    if (!ready) throw new Error('数据库连接会话未初始化')
    await ready
    return conn
  } catch (error) { conn.destroy(); throw error }
}
// Apply this last: its query/execute wrappers also borrow through initialization,
// and its budget includes setup. A late initialized connection is returned without SQL.
boundPoolAcquisition(pool, { timeoutMs: env.DB_ACQUIRE_TIMEOUT_MS })

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
