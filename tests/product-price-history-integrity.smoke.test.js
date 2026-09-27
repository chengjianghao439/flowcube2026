#!/usr/bin/env node
'use strict'

/**
 * 商品手工改价的一致性回归（2026-09-27）。
 *
 * 命题（全部是业务语义，不是实现细节）：
 *   ① **并发**两次手工改同一商品 ⇒ `product_price_history` 必须是一条**连贯的链**
 *      （同一 price_type 上，每条的 `old_price` = 上一条的 `new_price`），
 *      且商品当前值 = 链上最后一条的 `new_price`。
 *      根因：`products.update` 原先在**事务外**读当前行快照，两个并发请求会各自以同一个旧价写历史。
 *   ② `allowDecimalQty` **未传**时保持原值；其中 `allow_decimal_qty IS NULL` 的既定语义是
 *      **默认允许小数**（迁移 254），不能在读裸列时被当成 0（那会把「允许」误关成「禁止」）。
 *   ③ 对**已软删**商品改价必须明确失败，且**不得**写单位/库存策略/价格历史等任何脏数据。
 *
 * 运行（必须显式隔离库 + 回环）：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-repro-downloads node tests/product-price-history-integrity.smoke.test.js
 */

const { createLogger, prepareSmokeContext, dbQuery, login, randomRef } = require('./helpers/smokeTestKit')

const ROUNDS = Number(process.env.PPH_ROUNDS || 6)

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { http, pool } = ctx
  const created = []          // 本轮自建商品（含软删的），收尾按 ID 全清
  let token = null

  const newProduct = async (label) => {
    const [cat] = await dbQuery(pool, 'SELECT id FROM product_categories ORDER BY id LIMIT 1')
    if (!cat) throw new Error('隔离库无商品分类，无法建商品')
    const code = `PPH-${randomRef('X')}`.slice(0, 40)
    const [r] = await pool.query(
      `INSERT INTO product_items (code,name,unit,sale_price,sale_price_a,cost_price,category_id)
       VALUES (?,?,?,?,?,?,?)`,
      [code, `价格历史回归-${label}`, '件', 110, 110, 100, cat.id],
    )
    created.push(r.insertId)
    return { id: r.insertId, code, categoryId: cat.id }
  }

  // PUT 的 zod 要求 supplierId / spec / color 必填（缺任一项都会被 400 挡下）
  const editPayload = (p, cost) => ({
    name: `价格历史回归-${p.id}`, categoryId: p.categoryId, supplierId: 1,
    spec: '标准', color: '常规', unit: '件', costPrice: cost,
    salePriceA: cost, salePriceB: cost, salePriceC: cost, salePriceD: cost, isActive: true,
  })

  try {
    const loginRes = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = loginRes.token
    if (!token) throw new Error('登录失败')

    // ── ① 并发两次改价：历史必须是连贯链 ──────────────────────────────────
    let broken = 0
    for (let i = 0; i < ROUNDS; i++) {
      const p = await newProduct(`并发${i}`)
      const [ra, rb] = await Promise.all([
        http.put(`/api/products/${p.id}`, { token, json: editPayload(p, 150) }),
        http.put(`/api/products/${p.id}`, { token, json: editPayload(p, 200) }),
      ])
      const h = await dbQuery(
        pool,
        `SELECT old_price, new_price FROM product_price_history
          WHERE product_id=? AND change_source='manual' AND price_type='cost' ORDER BY id`,
        [p.id],
      )
      // 先确认两次改价**都成功**：否则「链为空/不成链」会被误读成并发缺陷
      // （实测踩过：payload 缺必填字段被 400 挡下，两次都没生效）
      const putOk = ra.status === 200 && rb.status === 200
      if (!putOk) console.log(`  #${i} PUT 状态 a=${ra.status}(${ra.message}) b=${rb.status}(${rb.message})`)
      let bad = !putOk || h.length < 2
      for (let k = 1; k < h.length; k++) {
        if (Number(h[k].old_price) !== Number(h[k - 1].new_price)) bad = true
      }
      const [cur] = await dbQuery(pool, 'SELECT cost_price FROM product_items WHERE id=?', [p.id])
      if (h.length && Number(cur.cost_price) !== Number(h[h.length - 1].new_price)) bad = true
      if (bad) { broken += 1; console.log(`  #${i} 链=${JSON.stringify(h.map(x => [Number(x.old_price), Number(x.new_price)]))} 当前=${cur?.cost_price} PUT成功=${putOk}`) }
    }
    log.assert(
      `★ 并发两次改价：${ROUNDS} 轮的历史旧价链全部连贯（每轮 old = 上一条 new，且当前值 = 末条 new）`,
      broken === 0,
      `${broken}/${ROUNDS} 轮断裂`,
    )

    // ── ② allowDecimalQty 未传 ⇒ 保持「锁内」原值 ────────────────────────
    // `allow_decimal_qty` 是 **NOT NULL DEFAULT 1**（迁移 254），**列上造不出 NULL**；
    // 代码里的 `== null ? 1` 是**防御性分支**（读裸列时不能把 NULL 当 0 而关掉小数）。
    // 因此这里测两条**可达**路径：默认（新建 ⇒ 1）与显式关闭（0），不传该字段的编辑后都必须保持。
    const pDefault = await newProduct('默认允许小数')
    const [created1] = await dbQuery(pool, 'SELECT allow_decimal_qty FROM product_items WHERE id=?', [pDefault.id])
    log.assert(
      '前置：新建商品 allow_decimal_qty 默认为 1（允许小数）',
      Number(created1.allow_decimal_qty) === 1,
      `实际 ${created1.allow_decimal_qty}`,
    )
    const putDefault = await http.put(`/api/products/${pDefault.id}`, {
      token, json: { ...editPayload(pDefault, 100), remark: '不带 allowDecimalQty' },
    })
    log.assert('未传 allowDecimalQty 的编辑成功', putDefault.status === 200, `status=${putDefault.status} msg=${putDefault.message}`)
    const [afterDefault] = await dbQuery(pool, 'SELECT allow_decimal_qty FROM product_items WHERE id=?', [pDefault.id])
    log.assert(
      '★ 未传 allowDecimalQty ⇒ 保持「允许小数」= 1（不得被当成 0 关掉）',
      Number(afterDefault.allow_decimal_qty) === 1,
      `实际 allow_decimal_qty=${afterDefault.allow_decimal_qty}`,
    )

    const pOff = await newProduct('关闭小数')
    await pool.query('UPDATE product_items SET allow_decimal_qty=0 WHERE id=?', [pOff.id])
    const putOff = await http.put(`/api/products/${pOff.id}`, {
      token, json: { ...editPayload(pOff, 100), remark: '不带 allowDecimalQty' },
    })
    log.assert('未传 allowDecimalQty 的编辑成功（关闭小数场景）', putOff.status === 200, `status=${putOff.status} msg=${putOff.message}`)
    const [afterOff] = await dbQuery(pool, 'SELECT allow_decimal_qty FROM product_items WHERE id=?', [pOff.id])
    log.assert(
      '★ 原值为 0（禁止小数）时，未传该字段仍保持 0',
      Number(afterOff.allow_decimal_qty) === 0,
      `实际 allow_decimal_qty=${afterOff.allow_decimal_qty}`,
    )

    // ── ③ 已软删商品：改价必须失败，且不留任何脏写 ────────────────────────
    const pDel = await newProduct('已软删')
    await pool.query('UPDATE product_items SET deleted_at=NOW() WHERE id=?', [pDel.id])
    const del = await http.put(`/api/products/${pDel.id}`, { token, json: editPayload(pDel, 999) })
    log.assert('★ 对已软删商品改价被拒（不静默成功）', del.status >= 400, `status=${del.status}`)
    const [histAfterDel] = await dbQuery(
      pool, 'SELECT COUNT(*) n FROM product_price_history WHERE product_id=?', [pDel.id])
    const [unitsAfterDel] = await dbQuery(
      pool, 'SELECT COUNT(*) n FROM product_units WHERE product_id=?', [pDel.id])
    log.assert(
      '★ 被拒后没有写任何价格历史/单位（商品没改就不该留下脏数据）',
      Number(histAfterDel.n) === 0 && Number(unitsAfterDel.n) === 0,
      `历史=${histAfterDel.n} 单位=${unitsAfterDel.n}`,
    )
    const [stillDel] = await dbQuery(pool, 'SELECT cost_price FROM product_items WHERE id=?', [pDel.id])
    log.assert('★ 被拒后商品价格未被改动', Number(stillDel.cost_price) === 100, `cost_price=${stillDel.cost_price}`)
  } finally {
    // 按精确 ID 自洁（依赖顺序：历史/单位/策略 → 商品）
    for (const id of created) {
      for (const t of ['product_price_history', 'product_units', 'product_stock_policies']) {
        try { await pool.query(`DELETE FROM ${t} WHERE product_id=?`, [id]) } catch (e) { console.error(`[清理告警] ${t}: ${e.message}`) }
      }
      try { await pool.query('DELETE FROM product_items WHERE id=?', [id]) } catch (e) { console.error(`[清理告警] product_items: ${e.message}`) }
    }
    // 清理复查：本轮 ID 必须全部为 0，否则记失败（不能只留告警）
    try {
      const left = async (table, col = 'id') => {
        if (!created.length) return 0
        const [r] = await dbQuery(pool, `SELECT COUNT(*) n FROM ${table} WHERE ${col} IN (?)`, [created])
        return Number(r?.n ?? 0)
      }
      const total = (await left('product_items'))
        + (await left('product_price_history', 'product_id'))
        + (await left('product_units', 'product_id'))
        + (await left('product_stock_policies', 'product_id'))
      log.assert('★ 本轮自建商品及其附属行已全部清除（按 ID 复查为 0）', total === 0, `残留=${total}（本轮建 ${created.length} 个）`)
    } catch (e) {
      log.assert('★ 清理复查本身未抛错', false, e.message)
    }
    await ctx.close()
  }

  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[PRODUCT-PRICE-HISTORY] 未捕获异常：', e); process.exit(1) })
