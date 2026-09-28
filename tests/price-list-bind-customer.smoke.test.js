#!/usr/bin/env node
'use strict'

/**
 * 价目表「绑定客户」路由可达性回归（2026-09-29）
 *
 * 缺陷：`PUT /api/price-lists/bind-customer` 曾注册在 `PUT /:id` **之后**，被 `/:id`
 * 抢先匹配（把 `bind-customer` 当作 `:id`）⇒ 静默走 `ctrl.update`、返回 200「更新成功」，
 * 而客户 `price_level` **实际未变**；调用方（前端 `bindCustomerApi`）看不出失败。
 *
 * 本套件走**真实 HTTP 路由并核对真实副作用**（不比对源码字符串顺序）：
 *   ① bind-customer 必须到达 `bindCustomer`：文案「绑定成功」且客户等级**真的变化**；
 *   ② 取价接口据此返回该等级价（`salePrice`/`priceLevel` 与商品等级价一致）；
 *   ③ 通用 `PUT /:id` 更新正向仍可用（新注册顺序没有把通用更新挤掉）。
 *
 * 变异验证（人工，一次性）：把 bind-customer 行移回 `/:id` 之后 ⇒ ①② 必红。
 *
 * 运行：node tests/price-list-bind-customer.smoke.test.js（需独立测试库）
 */

const { createLogger, prepareSmokeContext, login } = require('./helpers/smokeTestKit')

const log = createLogger('price-list-bind-customer')

async function main() {
  const ctx = await prepareSmokeContext({})
  const { http, pool, customer, product } = ctx
  let token = null
  let createdListId = null
  try {
    const loginResult = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = loginResult.token
    log.assert('smoke_admin 登录成功', !!token, 'token 为空')

    // 夹具：给基础商品配可区分的等级价（A=10 / B=20），供「取价采用 B」判定
    await pool.query('UPDATE product_items SET sale_price_a=?, sale_price_b=? WHERE id=?', [10, 20, product.id])

    // 起点归位（幂等；该客户可能被历史套件留成别的等级）
    await http.put('/api/price-lists/bind-customer', { token, json: { customerId: customer.id, priceLevel: 'A' } })

    // ① 绑定 B —— 必须真的到达 bindCustomer
    const bind = await http.put('/api/price-lists/bind-customer', { token, json: { customerId: customer.id, priceLevel: 'B' } })
    log.assert(
      'bind-customer 返回 200 且文案为「绑定成功」（而非被 /:id 抢走的「更新成功」）',
      bind.ok && /绑定成功/.test(String(bind.data?.message || '')),
      `status=${bind.status} message=${bind.data?.message}`,
    )
    const [row] = await pool.query('SELECT price_level FROM sale_customers WHERE id=?', [customer.id])
    log.assert(
      '★ 客户 price_level 真的变成 B（不是静默 no-op）',
      String(row?.[0]?.price_level || '').toUpperCase() === 'B',
      `实际=${row?.[0]?.price_level}`,
    )

    // ② 取价接口按 B 级价给出
    const price = await http.get(`/api/price-lists/customer-price?customerId=${customer.id}&productId=${product.id}`, { token })
    const got = price.data?.data
    log.assert(
      '★ 取价采用 B 级价 20 且 priceLevel=B',
      got?.salePrice === 20 && got?.priceLevel === 'B',
      JSON.stringify(got),
    )

    // ③ 通用 PUT /:id 正向仍可用（顺序调整未挤掉通用更新）
    const created = await http.post('/api/price-lists', { token, json: { name: `bind-regression-${Date.now()}` } })
    createdListId = created.data?.data?.id
    log.assert('价格表创建成功', !!createdListId, JSON.stringify(created.data))
    const renamed = `bind-regression-updated-${Date.now()}`
    const upd = await http.put(`/api/price-lists/${createdListId}`, { token, json: { name: renamed } })
    log.assert(
      '通用 PUT /:id 更新正向仍可用（文案「更新成功」）',
      upd.ok && /更新成功/.test(String(upd.data?.message || '')),
      `status=${upd.status} message=${upd.data?.message}`,
    )
    const [chk] = await pool.query('SELECT name FROM price_lists WHERE id=?', [createdListId])
    log.assert('通用更新真实落库', chk?.[0]?.name === renamed, `实际=${chk?.[0]?.name}`)
  } catch (e) {
    log.assert('套件未抛错', false, e.message)
  } finally {
    // 自洁：只还原本套件动过的对象（客户等级、商品等级价、临时价格表）
    try {
      if (token) await http.put('/api/price-lists/bind-customer', { token, json: { customerId: customer.id, priceLevel: 'A' } })
      await pool.query('UPDATE product_items SET sale_price_b=NULL WHERE id=?', [product.id])
      if (createdListId) await http.delete(`/api/price-lists/${createdListId}`, { token })
    } catch (e) {
      log.assert('自洁未抛错', false, e.message)
    }
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[BIND-CUSTOMER] 未捕获异常：', e)
  process.exit(1)
})
