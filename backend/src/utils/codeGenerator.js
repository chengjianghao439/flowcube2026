/**
 * codeGenerator — 极序 Flow 统一编码生成器
 *
 * 三种编码类型：
 *
 *  1. 主数据编码（累计流水）：PREFIX + 6位数字
 *     示例：C000001 / S000001 / P000001 / H000001 / G000001
 *     规则：全局最大值 +1，不重置，软删除记录仍计入序号
 *
 *  2. 业务单据编码（日期流水）：PREFIX + YYYYMMDD + 3位序号
 *     示例：SO20260308001 / PO20260308001 / WT20260308001
 *     规则：每天独立计数，当天 001 起始
 *
 *  3. 容器条码（累计流水）：I/B + 6位数字
 *     示例：I000001 / B000001
 *     规则：全局最大值 +1，不重置
 *
 * 所有函数接受 conn（数据库连接或连接池），
 * 在调用方的事务内执行，由调用方的 UNIQUE 约束兜底防重。
 */

/**
 * 生成主数据编码（累计）。
 *
 * @param {object} conn        - mysql2 连接或连接池
 * @param {string} prefix      - 编码前缀，如 'C'、'P'
 * @param {string} table       - 数据表名，如 'sale_customers'
 * @param {string} [codeField] - 编码列名，默认 'code'
 * @returns {Promise<string>}  - 如 'CUS000001'
 */
async function generateMasterCode(conn, prefix, table, codeField = 'code') {
  const prefixLen = prefix.length
  const [[{ maxNum }]] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(\`${codeField}\`, ?) AS UNSIGNED)), 0) AS maxNum
     FROM \`${table}\`
     WHERE \`${codeField}\` LIKE ?`,
    [prefixLen + 1, `${prefix}%`],
  )
  return `${prefix}${String(maxNum + 1).padStart(6, '0')}`
}

/**
 * 生成业务单据编码（日期流水）。
 *
 * 使用 UPDATE + LAST_INSERT_ID 原子递增，避免 COUNT 并发竞争。
 *
 * @param {object} conn        - mysql2 连接（建议在事务内调用以保证读写一致性）
 * @param {string} prefix      - 单据前缀，如 'SO'、'PO'
 * @param {string} table       - 数据表名
 * @param {string} codeField   - 编码列名，如 'order_no'
 * @returns {Promise<string>}  - 如 'SO20260308001'
 */
async function generateDailyCode(conn, prefix, table, codeField) {
  const d = new Date()
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const todayPrefix = `${prefix}${dateStr}`
  const seqKey = `${table}:${codeField}:${dateStr}`

  // LAST_INSERT_ID 依赖连接一致性；若传入的是 pool 则需要获取专用连接
  const isPool = typeof conn.getConnection === 'function'
  let dedicated = null
  const db = isPool ? (dedicated = await conn.getConnection()) : conn
  try {
    // 先确保行存在（幂等），再用 UPDATE + LAST_INSERT_ID 原子递增
    await db.query(
      `INSERT INTO daily_sequences (seq_key, seq_value) VALUES (?, 0)
       ON DUPLICATE KEY UPDATE seq_key = seq_key`,
      [seqKey],
    )
    await db.query(
      `UPDATE daily_sequences SET seq_value = LAST_INSERT_ID(seq_value + 1) WHERE seq_key = ?`,
      [seqKey],
    )
    const [[{ seq }]] = await db.query('SELECT LAST_INSERT_ID() AS seq')
    return `${todayPrefix}${String(seq).padStart(3, '0')}`
  } finally {
    if (dedicated) dedicated.release()
  }
}

/**
 * 生成容器条码（累计）。
 *
 * @param {object} conn  - mysql2 连接或连接池
 * @param {'I'|'B'} [prefix='I'] - I=库存条码，B=塑料盒条码
 * @returns {Promise<string>}  - 如 'I000001' / 'B000001'
 */
async function generateContainerCode(conn, prefix = 'I') {
  const upper = String(prefix || 'I').toUpperCase()
  if (upper === 'B') {
    const [[{ maxNum }]] = await conn.query(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(barcode, 2) AS UNSIGNED)), 0) AS maxNum
       FROM inventory_containers
       WHERE barcode LIKE 'B%'`,
    )
    return `B${String(maxNum + 1).padStart(6, '0')}`
  }

  const [[{ maxNum }]] = await conn.query(
    `SELECT COALESCE(MAX(CAST(
        CASE
          WHEN barcode LIKE 'I%' THEN SUBSTRING(barcode, 2)
          WHEN barcode LIKE 'CNT%' THEN SUBSTRING(barcode, 4)
          ELSE NULL
        END AS UNSIGNED
      )), 0) AS maxNum
     FROM inventory_containers
     WHERE barcode LIKE 'I%' OR barcode LIKE 'CNT%'`,
  )
  return `I${String(maxNum + 1).padStart(6, '0')}`
}

module.exports = { generateMasterCode, generateDailyCode, generateContainerCode }
