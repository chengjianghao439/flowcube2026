const { pool } = require('../../config/db')

async function getAll() {
  const [rows] = await pool.query('SELECT key_name, value, label, type, remark FROM sys_settings ORDER BY id ASC')
  const map = {}
  rows.forEach(r => { map[r.key_name] = { value: r.value, label: r.label, type: r.type, remark: r.remark } })
  return { list: rows, map }
}

/**
 * 批量保存设置项。必须在事务里：这是「一个表单一次提交」的语义，
 * 逐条裸更新时中途失败会存下半套设置——用户看到的是保存失败，实际前几项已经生效了。
 */
async function updateMany(updates) {
  // updates: { key_name: new_value, ... }
  const entries = Object.entries(updates || {})
  if (!entries.length) return
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    for (const [key, value] of entries) {
      await conn.query('UPDATE sys_settings SET value=? WHERE key_name=?', [value, key])
    }
    await conn.commit()
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

module.exports = { getAll, updateMany }
