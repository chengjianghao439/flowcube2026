const { pool } = require('../../config/db')

async function getAll() {
  const [rows] = await pool.query('SELECT key_name, value, label, type, remark FROM sys_settings ORDER BY id ASC')
  const map = {}
  rows.forEach(r => { map[r.key_name] = { value: r.value, label: r.label, type: r.type, remark: r.remark } })
  return { list: rows, map }
}

async function getValue(key) {
  const [[row]] = await pool.query('SELECT value FROM sys_settings WHERE key_name=?', [key])
  return row?.value ?? null
}

async function updateMany(updates) {
  // updates: { key_name: new_value, ... }
  for (const [key, value] of Object.entries(updates)) {
    await pool.query('UPDATE sys_settings SET value=? WHERE key_name=?', [value, key])
  }
}

module.exports = { getAll, getValue, updateMany }
