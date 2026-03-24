/**
 * codeGenerator — FlowCube 统一编码生成器
 *
 * 三种编码类型：
 *
 *  1. 主数据编码（累计流水）：PREFIX + 6位数字
 *     示例：CUS000001 / SUP000001 / PRD000001 / WH000001 / CAT000001
 *     规则：全局最大值 +1，不重置，软删除记录仍计入序号
 *
 *  2. 业务单据编码（日期流水）：PREFIX + YYYYMMDD + 3位序号
 *     示例：SO20260308001 / PO20260308001 / WT20260308001
 *     规则：每天独立计数，当天 001 起始
 *
 *  3. 容器条码（累计流水）：CNT + 6位数字
 *     示例：CNT000001 / CNT000002
 *     规则：全局最大值 +1，不重置
 *
 * 所有函数接受 conn（数据库连接或连接池），
 * 在调用方的事务内执行，由调用方的 UNIQUE 约束兜底防重。
 */

/**
 * 生成主数据编码（累计）。
 *
 * @param {object} conn        - mysql2 连接或连接池
 * @param {string} prefix      - 编码前缀，如 'CUS'、'PRD'
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
 * @param {object} conn        - mysql2 连接或连接池
 * @param {string} prefix      - 单据前缀，如 'SO'、'PO'
 * @param {string} table       - 数据表名
 * @param {string} codeField   - 编码列名，如 'order_no'
 * @returns {Promise<string>}  - 如 'SO20260308001'
 */
async function generateDailyCode(conn, prefix, table, codeField) {
  const d = new Date()
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const todayPrefix = `${prefix}${dateStr}`
  const [[{ cnt }]] = await conn.query(
    `SELECT COUNT(*) AS cnt FROM \`${table}\` WHERE \`${codeField}\` LIKE ?`,
    [`${todayPrefix}%`],
  )
  return `${todayPrefix}${String(cnt + 1).padStart(3, '0')}`
}

/**
 * 生成容器条码（累计）。
 *
 * @param {object} conn  - mysql2 连接或连接池
 * @returns {Promise<string>}  - 如 'CNT000001'
 */
async function generateContainerCode(conn) {
  const [[{ maxNum }]] = await conn.query(
    `SELECT COALESCE(MAX(CAST(SUBSTRING(barcode, 4) AS UNSIGNED)), 0) AS maxNum
     FROM inventory_containers
     WHERE barcode LIKE 'CNT%'`,
  )
  return `CNT${String(maxNum + 1).padStart(6, '0')}`
}

module.exports = { generateMasterCode, generateDailyCode, generateContainerCode }
