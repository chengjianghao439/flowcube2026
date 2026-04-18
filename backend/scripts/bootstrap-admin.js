#!/usr/bin/env node
require('dotenv').config()

const bcrypt = require('bcryptjs')
const { pool } = require('../src/config/db')

async function main() {
  const username = String(process.env.ADMIN_USERNAME || 'admin').trim()
  const password = String(process.env.ADMIN_PASSWORD || '').trim()
  const realName = String(process.env.ADMIN_REAL_NAME || '系统管理员').trim()

  if (!password) {
    throw new Error('缺少 ADMIN_PASSWORD。用法：ADMIN_PASSWORD=your-secret npm run bootstrap:admin')
  }
  if (password.length < 8) {
    throw new Error('ADMIN_PASSWORD 长度至少 8 位')
  }

  const passwordHash = await bcrypt.hash(password, 10)
  await pool.query(
    `UPDATE sys_users
        SET password = ?, real_name = ?, role_id = 1, role_name = '管理员', is_active = 1, deleted_at = NULL
      WHERE username = ?`,
    [passwordHash, realName, username],
  )

  console.log(`管理员账号 ${username} 已初始化，请妥善保管凭据。`)
}

main()
  .catch((error) => {
    console.error(error.message || error)
    process.exit(1)
  })
  .finally(async () => {
    try {
      await pool.end()
    } catch {
      // ignore
    }
  })
