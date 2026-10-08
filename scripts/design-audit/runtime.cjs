'use strict'

// Only invoked inside a copy of the reviewed ephemeral runner. No .env is loaded.
const fs = require('node:fs')
const path = require('node:path')
const { makeGoLiveRuntimeFixture } = require('../../tests/helpers/goLiveRuntimeFixture')
const { PERMISSIONS } = require('../../backend/src/constants/permissions')
const ctx = makeGoLiveRuntimeFixture()
const privateDir = process.env.FLOWCUBE_DESIGN_AUDIT_PRIVATE_DIR
if (!privateDir || !path.isAbsolute(privateDir)) throw new Error('缺少本次私有目录')
let closing = false
async function close() {
  if (closing) return
  closing = true
  await ctx.close()
}
async function main() {
  await ctx.setup() // Live ownership proof precedes every seed write.
  const all = [...new Set(Object.values(PERMISSIONS))]
  for (const name of ['creator', 'approver']) {
    await ctx.pool.query('INSERT IGNORE INTO sys_role_permissions(role_id,permission) VALUES ?', [all.map(p => [ctx.users[name].roleId, p])])
  }
  const login = await ctx.ok('POST', '/auth/login', { username: ctx.users.creator.username, password: process.env.FLOWCUBE_GOLIVE_TEST_PASSWORD }, { user: null }, 'SETUP')
  ctx.users.creator.token = login.token
  const auth = { state: { token: login.token, refreshToken: login.refreshToken, user: login.user, isAuthenticated: true }, version: 0 }
  fs.writeFileSync(path.join(privateDir, 'auth.json'), JSON.stringify(auth), { mode: 0o600 })
  const products = []
  for (let i = 0; i < 8; i++) {
    const product = await ctx.product()
    const name = i === 0 ? '验收合成：加长静音阻尼铰链（嵌入式柜门用）长名称与型号识别检查' : `验收合成五金配件 ${i + 1}`
    await ctx.pool.query('UPDATE product_items SET name=?,spec=?,color=?,article_number=?,remark=? WHERE id=?', [name, `型号-${i + 1}-EXTENDED`, i % 2 ? '拉丝黑' : '银白色', `供应商型号-${i + 1}-LONG`, '验收合成长备注；用于检查换行、滚动和字段边界。'.repeat(5), product.id])
    products.push({ ...product, name })
  }
  const purchase = await ctx.purchase({ product: products[0], quantity: 24, price: 12.3456, packages: [12, 12] })
  const sales = []
  for (let i = 0; i < 4; i++) {
    const sale = await ctx.ok('POST', '/sale', { ...ctx.saleBody(products[0], i + 1), remark: '验收合成备注；检查不同阶段的操作位置。'.repeat(i + 1) }, {}, 'FIXTURE')
    ctx.remember('sales', sale.id)
    if (i === 1) await ctx.ok('POST', `/sale/${sale.id}/reserve`, {}, {}, 'FIXTURE')
    sales.push(sale)
  }
  const returned = await ctx.returnPurchase(purchase, 1)
  const facts = { api: `http://127.0.0.1:${ctx.server.address().port}`, warehouse: ctx.warehouse, customer: ctx.customer, supplier: ctx.supplier, products, purchase, sales, returned, deviceId: ctx.deviceId }
  fs.writeFileSync(path.join(privateDir, 'facts.json'), JSON.stringify(facts, null, 2), { mode: 0o600 })
  console.log('[design-audit] READY ' + facts.api)
  await new Promise(resolve => { process.once('SIGTERM', resolve); process.once('SIGINT', resolve) })
}
main().catch(error => { console.error('[design-audit] ' + error.message); process.exitCode = 1 }).finally(close)
