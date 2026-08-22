#!/usr/bin/env node
/**
 * 全局搜索仓库数据权限测试（2026-08-21 审计 A.4 修复的守护测试）。
 *
 * 场景：单仓用户（user_warehouse_scope 只授权仓库 A）搜索时应只命中 A 仓单据，
 * 不能搜到 B 仓单据。此前 search.service 的 warehouseColumn 过滤没有任何测试。
 *
 * 运行：node tests/search-scope.smoke.test.js
 */
'use strict'

const path = require('path')
const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const SCOPED_ROLE_ID = 7 // sys_users.role_id 是 TINYINT（上限 255），复用 smoke 测试角色位
const SCOPED_USER = 'smoke_search_scoped'
const SCOPED_PW = 'SmokeSearchScoped123!'

/** 建一个「只授权某一仓」的用户：权限给足，唯一限制来自 user_warehouse_scope */
async function ensureScopedUser(pool, allowedWarehouseId) {
  const bcrypt = require(path.resolve(__dirname, '../backend/node_modules/bcryptjs'))
  const { PERMISSIONS } = require(path.resolve(__dirname, '../backend/src/constants/permissions'))
  await pool.query(
    `INSERT INTO sys_roles (id, code, name, remark) VALUES (?, 'smoke_search_scoped', 'Smoke搜索单仓角色', '全局搜索仓库过滤测试')
     ON DUPLICATE KEY UPDATE name=VALUES(name), remark=VALUES(remark)`,
    [SCOPED_ROLE_ID],
  )
  const codes = [...new Set(Object.values(PERMISSIONS).filter(v => typeof v === 'string'))]
  for (const code of codes) {
    await pool.query('INSERT IGNORE INTO sys_role_permissions (role_id, permission) VALUES (?, ?)', [SCOPED_ROLE_ID, code])
  }
  await pool.query(
    `INSERT INTO sys_users (username, password, real_name, role_id, role_name, is_active)
       VALUES (?, ?, 'Smoke搜索单仓用户', ?, 'Smoke搜索单仓', 1)
     ON DUPLICATE KEY UPDATE password=VALUES(password), role_id=VALUES(role_id),
       role_name='Smoke搜索单仓', is_active=1, deleted_at=NULL`,
    [SCOPED_USER, bcrypt.hashSync(SCOPED_PW, 10), SCOPED_ROLE_ID],
  )
  const [user] = await dbQuery(pool, 'SELECT id FROM sys_users WHERE username=? LIMIT 1', [SCOPED_USER])
  const userId = Number(user.id)
  await pool.query('DELETE FROM user_warehouse_scope WHERE user_id=?', [userId])
  await pool.query('INSERT INTO user_warehouse_scope (user_id, warehouse_id) VALUES (?, ?)', [userId, allowedWarehouseId])
  return userId
}

async function search(log, http, token, keyword) {
  const res = await http.get(`/api/search?q=${encodeURIComponent(keyword)}&startDate=&endDate=`, { token })
  return res
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http, warehouse, supplier } = ctx

  try {
    const adminLogin = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    const adminToken = adminLogin.token
    log.assert('smoke_admin 登录成功', !!adminToken)

    // ── 造第二仓 ──
    const otherCode = randomRef('WH-OTHER').slice(0, 30)
    const [wr] = await pool.query('INSERT INTO inventory_warehouses (name, code) VALUES (?, ?)', ['Smoke搜索他仓', otherCode])
    const otherWarehouse = { id: wr.insertId, name: 'Smoke搜索他仓' }

    // ── 造单仓用户（只授权主仓） ──
    await ensureScopedUser(pool, warehouse.id)
    const scopedLogin = await login(http, SCOPED_USER, SCOPED_PW)
    const scopedToken = scopedLogin.token
    log.assert('单仓用户登录成功', !!scopedToken)

    // ── 两个仓库各建一张采购单，单号带唯一前缀 ──
    const tag = randomRef('SRCH')
    async function createPo(wh, remark) {
      const res = await http.post('/api/purchase', {
        token: adminToken,
        json: {
          supplierId: supplier.id, supplierName: supplier.name,
          warehouseId: wh.id, warehouseName: wh.name,
          remark,
          items: [{ productId: ctx.product.id, productCode: ctx.product.code, productName: ctx.product.name, unit: ctx.product.unit, quantity: 1, unitPrice: 10 }],
        },
      })
      return res.data?.data?.orderNo || res.data?.data?.id || null
    }
    const mineOrderNo = await createPo(warehouse, `${tag}-MINE`)
    const otherOrderNo = await createPo(otherWarehouse, `${tag}-OTHER`)
    log.assert('主仓采购单已创建', !!mineOrderNo, `mineOrderNo=${mineOrderNo}`)
    log.assert('他仓采购单已创建', !!otherOrderNo, `otherOrderNo=${otherOrderNo}`)

    // ── 场景 1：搜主仓单号 → 单仓用户必须命中 ──
    const mineRes = await search(log, http, scopedToken, mineOrderNo)
    const mineTypes = mineRes.data?.data?.results || mineRes.data?.data || []
    const mineHit = JSON.stringify(mineTypes).includes(mineOrderNo)
    log.assert(`单仓用户搜「${mineOrderNo}」能命中`, mineRes.ok && mineHit, `status=${mineRes.status}`)

    // ── 场景 2：搜他仓单号 → 单仓用户必须搜不到 ──
    const otherRes = await search(log, http, scopedToken, otherOrderNo)
    const otherTypes = otherRes.data?.data?.results || otherRes.data?.data || []
    const otherHit = JSON.stringify(otherTypes).includes(otherOrderNo)
    log.assert(`单仓用户搜「${otherOrderNo}」命中为空（仓库过滤生效）`, otherRes.ok && !otherHit, `status=${otherRes.status} body=${JSON.stringify(otherTypes).slice(0, 300)}`)

    // ── 场景 3：管理员（超管不限仓）搜他仓单号必须能命中 ──
    const adminRes = await search(log, http, adminToken, otherOrderNo)
    const adminTypes = adminRes.data?.data?.results || adminRes.data?.data || []
    const adminHit = JSON.stringify(adminTypes).includes(otherOrderNo)
    log.assert('超管搜他仓单号能命中（不限仓）', adminRes.ok && adminHit, `status=${adminRes.status}`)

    // ── 场景 4：搜通用词（两个单号前缀相同）→ 单仓用户结果里必须不含他仓单号 ──
    const bothRes = await search(log, http, scopedToken, tag)
    const bothTypes = bothRes.data?.data?.results || bothRes.data?.data || []
    const leakedOther = JSON.stringify(bothTypes).includes(otherOrderNo)
    log.assert('通用词搜索不泄漏他仓单号', bothRes.ok && !leakedOther, JSON.stringify(bothTypes).slice(0, 400))
  } finally {
    const summary = log.summary()
    await ctx.close()
    process.exit(summary.failed > 0 ? 1 : 0)
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack || error?.message || String(error)}\n`)
  process.exit(1)
})
