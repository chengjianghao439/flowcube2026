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
 * 夹具策略（**不污染共享测试库**）：本套件复用的是 `prepareSmokeContext` 的共享
 * customer / product，因此**写前快照**会被改动的字段，`finally` 用**测试 SQL 精确还原**
 * （不依赖绑定路由——路由被临时改坏时也要能恢复），逐项独立兜底并断言还原值；
 * 本轮自建的临时价格表按 ID **物理清理**并复查。
 *
 * 资源（审查反馈后收紧）：**快照查询也在受保护范围内**（它失败同样要走到资源关闭）；
 * `ctx.close()` 与 backend 全局 pool 的 `end()` **各自独立 try**（前者失败不得跳过后者）；
 * 用 `process.exitCode` 让进程自然退出（不用 `process.exit()` 掩盖未关闭资源）。
 *
 * 运行：node tests/price-list-bind-customer.smoke.test.js（需独立测试库）
 */

const { createLogger, prepareSmokeContext, login } = require('./helpers/smokeTestKit')

const log = createLogger('price-list-bind-customer')

async function main() {
  let ctx = null
  let token = null
  let customer = null
  let product = null
  let custBefore = null
  let prodBefore = null
  const cleanupListIds = []

  try {
    ctx = await prepareSmokeContext({})
    const { http, pool } = ctx
    customer = ctx.customer
    product = ctx.product

    // ── 写前快照：只快照本套件确实会动的字段（在受保护范围内，失败也会走到资源关闭）──
    const [custRows] = await pool.query(
      'SELECT price_level, price_list_id, price_list_name FROM sale_customers WHERE id=?', [customer.id],
    )
    const [prodRows] = await pool.query('SELECT sale_price_a, sale_price_b FROM product_items WHERE id=?', [product.id])
    custBefore = custRows[0]
    prodBefore = prodRows[0]

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
    const listId = created.data?.data?.id
    if (listId) cleanupListIds.push(listId)   // 拿到即登记，后续失败也能清
    log.assert('价格表创建成功', !!listId, JSON.stringify(created.data))
    const renamed = `bind-regression-updated-${Date.now()}`
    const upd = await http.put(`/api/price-lists/${listId}`, { token, json: { name: renamed } })
    log.assert(
      '通用 PUT /:id 更新正向仍可用（文案「更新成功」）',
      upd.ok && /更新成功/.test(String(upd.data?.message || '')),
      `status=${upd.status} message=${upd.data?.message}`,
    )
    const [chk] = await pool.query('SELECT name FROM price_lists WHERE id=?', [listId])
    log.assert('通用更新真实落库', chk?.[0]?.name === renamed, `实际=${chk?.[0]?.name}`)
  } catch (e) {
    log.assert('套件未抛错', false, e.message)
  } finally {
    // ── 清理：各清理项独立兜底并断言还原值（仅在确有快照时执行）──────────────
    if (ctx && customer && product) {
      const { pool } = ctx
      // 1) 客户价格字段：用测试 SQL 精确还原（不依赖绑定路由——它正是被临时改坏的对象）
      if (custBefore) {
        try {
          await pool.query(
            'UPDATE sale_customers SET price_level=?, price_list_id=?, price_list_name=? WHERE id=?',
            [custBefore.price_level, custBefore.price_list_id, custBefore.price_list_name, customer.id],
          )
          const [after] = await pool.query('SELECT price_level, price_list_id, price_list_name FROM sale_customers WHERE id=?', [customer.id])
          log.assert(
            '客户价格字段精确还原（price_level/price_list_id/price_list_name）',
            JSON.stringify(after?.[0]) === JSON.stringify(custBefore),
            `前=${JSON.stringify(custBefore)} 后=${JSON.stringify(after?.[0])}`,
          )
        } catch (e) { log.assert('客户字段还原未抛错', false, e.message) }
      } else {
        log.assert('客户快照缺失时不再尝试还原（无改动）', true, '')
      }

      // 2) 商品等级价：精确还原（含 sale_price_a，不能只把 b 置 NULL）
      if (prodBefore) {
        try {
          await pool.query(
            'UPDATE product_items SET sale_price_a=?, sale_price_b=? WHERE id=?',
            [prodBefore.sale_price_a, prodBefore.sale_price_b, product.id],
          )
          const [after] = await pool.query('SELECT sale_price_a, sale_price_b FROM product_items WHERE id=?', [product.id])
          const same = String(after?.[0]?.sale_price_a) === String(prodBefore.sale_price_a)
            && String(after?.[0]?.sale_price_b) === String(prodBefore.sale_price_b)
          log.assert('商品等级价精确还原（sale_price_a / sale_price_b）', same, `前=${JSON.stringify(prodBefore)} 后=${JSON.stringify(after?.[0])}`)
        } catch (e) { log.assert('商品等级价还原未抛错', false, e.message) }
      } else {
        log.assert('商品快照缺失时不再尝试还原（无改动）', true, '')
      }

      // 3) 本轮自建价格表：按 ID **物理清理**并复查（不把软删当清理干净）
      for (const id of cleanupListIds) {
        try {
          await pool.query('DELETE FROM price_list_items WHERE list_id=?', [id])
          await pool.query('DELETE FROM price_lists WHERE id=?', [id])
          const [left] = await pool.query('SELECT COUNT(*) AS n FROM price_lists WHERE id=?', [id])
          log.assert(`临时价格表 ${id} 物理清理并复查为 0`, Number(left?.[0]?.n) === 0, `剩余=${left?.[0]?.n}`)
        } catch (e) { log.assert(`临时价格表 ${id} 清理未抛错`, false, e.message) }
      }
    }

    // 4) 资源关闭：两处**各自独立兜底**——ctx.close() 失败不得跳过 backend 全局 pool
    if (ctx) {
      try { await ctx.close() } catch (e) { log.assert('ctx.close() 未抛错', false, e.message) }
    }
    try { await require('../backend/src/config/db').pool.end() } catch (e) { log.assert('backend pool.end() 未抛错', false, e.message) }
  }

  const counts = log.summary()
  process.exitCode = counts.failed > 0 ? 1 : 0   // 不用 process.exit()：避免掩盖未关闭资源
}

main().catch((e) => {
  console.error('[BIND-CUSTOMER] 未捕获异常：', e)
  process.exitCode = 1
})
