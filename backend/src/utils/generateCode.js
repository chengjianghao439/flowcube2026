const { pool } = require('../config/db')

/**
 * 自动生成下一个可用编号
 * @param {string} table       - 数据表名
 * @param {string} codeColumn  - 编码字段名（如 'code'）
 * @param {string} prefixKey   - sys_settings 中前缀的 key_name
 * @param {string} defaultPrefix - 无设置时的默认前缀
 * @returns {Promise<string>}  - 下一个可用编号，如 "CUS-0001"
 */
async function generateCode(table, codeColumn, prefixKey, defaultPrefix) {
  // 读取前缀和位数设置
  const [[prefixRow]] = await pool.query('SELECT value FROM sys_settings WHERE key_name=?', [prefixKey]).catch(() => [[null]])
  const [[digitsRow]] = await pool.query("SELECT value FROM sys_settings WHERE key_name='code_digits'").catch(() => [[null]])
  const prefix = prefixRow?.value || defaultPrefix
  const digits = parseInt(digitsRow?.value || '4', 10)

  // 找当前最大编号（仅统计有相同前缀的）
  const like = `${prefix}%`
  const [[{ maxCode }]] = await pool.query(
    `SELECT MAX(\`${codeColumn}\`) AS maxCode FROM \`${table}\` WHERE \`${codeColumn}\` LIKE ? AND deleted_at IS NULL`,
    [like]
  ).catch(() => [[{ maxCode: null }]])

  let nextNum = 1
  if (maxCode) {
    const numPart = maxCode.replace(prefix, '')
    const parsed = parseInt(numPart, 10)
    if (!isNaN(parsed)) nextNum = parsed + 1
  }

  return `${prefix}${String(nextNum).padStart(digits, '0')}`
}

module.exports = generateCode
