const { pool } = require('../../config/db')
const AppError = require('../../utils/AppError')

async function getAll() {
  const [rows] = await pool.query('SELECT key_name, value, label, type, remark FROM sys_settings ORDER BY id ASC')
  const map = {}
  rows.forEach(r => { map[r.key_name] = { value: r.value, label: r.label, type: r.type, remark: r.remark } })
  return { list: rows, map }
}

/**
 * 批量保存设置项。必须在事务里：这是「一个表单一次提交」的语义，
 * 逐条裸更新时中途失败会存下半套设置——用户看到的是保存失败，实际前几项已经生效了。
 *
 * 安全（2026-08-22 加固）：key 白名单——只允许更新系统声明的设置键，
 * 防持 settings.update 权限者塞任意 key_name（如把审批阈值置 0 关闭审批）。
 * 白名单 = 当前 sys_settings 表里已有的键；新增键需走迁移 seed。
 */
async function updateMany(updates) {
  // updates: { key_name: new_value, ... }
  const entries = Object.entries(updates || {})
  if (!entries.length) return
  const [knownRows] = await pool.query('SELECT key_name FROM sys_settings')
  const knownKeys = new Set(knownRows.map(r => r.key_name))
  for (const [key] of entries) {
    if (!knownKeys.has(key)) {
      throw new AppError(`未知设置项：${key}`, 400, 'SETTINGS_KEY_NOT_ALLOWED')
    }
  }
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
