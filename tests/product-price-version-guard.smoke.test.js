#!/usr/bin/env node
'use strict'

/**
 * 商品价格列的并发覆盖保护（2026-09-27，迁移 264）。
 *
 * 命题（业务语义）：
 *   ① 一个**较早打开**的商品编辑页保存时，**不得**把别处已生效的**等级价/成本价**回退：
 *      它携带的 `revision` 已过期 ⇒ **409**，且**价格列与价格历史都不被写**。
 *   ② 覆盖 `sale_price_a`、`cost_price` 与 **B/C/D 同路径**（同一 payload/同一 UPDATE）。
 *   ③ **正常连续编辑**（每次带最新 revision）不受影响。
 *   ④ **缺 revision** ⇒ 明确拒绝（不静默放过）。
 *   ⑤ `sale_price` 列仍保持 §18.4 方案三的既有保护（普通编辑不写它）。
 *   ⑥ 改价审批**真正写商品价**时递增 revision ⇒ 旧编辑页随后保存必被 409 拦下。
 *
 * 注意：这是**服务端版本冲突校验**（行锁 + SQL CAS），**不是**请求键幂等——
 * 本测试不断言 `X-Request-Key` 的重放语义。
 *
 * 运行（显式隔离库）：
 *   set -a; source ~/.config/flowcube/operations20260912-test.env; set +a
 *   APP_UPDATE_DOWNLOADS_DIR=/tmp/fc-repro-downloads node tests/product-price-version-guard.smoke.test.js
 */

const { createLogger, prepareSmokeContext, dbQuery, login, randomRef } = require('./helpers/smokeTestKit')

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { http, pool } = ctx
  const created = []
  let token = null
  let categoryId = null
  let supplierSeq = 0
  let lastSupplierId = null

  const mkProduct = async ({ a = 100, cost = 100 } = {}) => {
    supplierSeq += 1
    const [sp] = await pool.query(
      `INSERT INTO supply_suppliers (code, name, contact, phone, settlement_type) VALUES (?,?,?,?,?)`,
      [`PGS-${randomRef('S')}`, `版本保护供应商${supplierSeq}`, '', '', 1],
    )
    created.push({ kind: 'supplier', id: sp.insertId })
    const res = await http.post('/api/products', {
      token,
      json: {
        name: `版本保护商品-${randomRef('P')}`, categoryId, supplierId: sp.insertId,
        unit: '件', spec: '标准', color: '常规', costPrice: cost, salePriceA: a,
      },
    })
    const id = Number(res.data?.data?.id)
    if (!Number.isInteger(id)) throw new Error(`建商品失败: ${JSON.stringify(res.data)}`)
    created.push({ kind: 'product', id })
    // PUT 的 zod 要求 supplierId 必填，故把本商品使用的供应商带出，供后续编辑 payload 复用
    lastSupplierId = sp.insertId
    return id
  }
  const revOf = async (id) => {
    const [r] = await dbQuery(pool, 'SELECT revision FROM product_items WHERE id=?', [id])
    return Number(r?.revision)
  }
  const priceOf = async (id) => {
    const [r] = await dbQuery(pool,
      'SELECT sale_price, sale_price_a, sale_price_b, sale_price_c, sale_price_d, cost_price, revision FROM product_items WHERE id=?', [id])
    return r
  }
  const put = (id, json) => http.put(`/api/products/${id}`, { token, json })
  const base = (name) => ({ name, categoryId, supplierId: lastSupplierId, unit: '件', spec: '标准', color: '常规', isActive: true })

  try {
    const loginRes = await login(http, 'smoke_admin', 'SmokeAdmin123!')
    token = loginRes.token
    if (!token) throw new Error('登录失败')
    // 分类：优先复用库中已有；**零分类的新隔离库**则自建一个并登记，finally 按 ID 删除（保留他人数据）
    const [cat] = await dbQuery(pool, 'SELECT id FROM product_categories ORDER BY id LIMIT 1')
    if (cat) {
      categoryId = cat.id
    } else {
      const [ins] = await pool.query(
        'INSERT INTO product_categories (code, name, level, path, status) VALUES (?,?,1,?,1)',
        [`CAT-${randomRef('C')}`, '价格版本保护-自建分类', ''],
      )
      categoryId = ins.insertId
      created.push({ kind: 'category', id: ins.insertId })
    }

    // ① 审批 a 生效后，旧编辑页（旧 revision）保存 ⇒ 409 且**价格与历史都不被写**
    {
      const id = await mkProduct({ a: 100 })
      const revBefore = await revOf(id)
      await pool.query('UPDATE product_items SET sale_price_a=200, revision=revision+1 WHERE id=?', [id]) // 模拟审批 a（含递增）
      const revAfterApprove = await revOf(id)

      const stale = await put(id, { ...base(`旧编辑页-${randomRef('X')}`), salePriceA: 100, costPrice: 100, revision: revBefore })
      log.assert(
        '★ 旧版本保存被 409 拦下（不再静默回退已审批的等级价）',
        stale.status === 409, `status=${stale.status} code=${stale.data?.code} msg=${stale.message}`,
      )
      log.assert(
        '★ 冲突错误码明确',
        stale.data?.code === 'PRODUCT_VERSION_CONFLICT', String(stale.data?.code),
      )
      const p = await priceOf(id)
      log.assert('★ 冲突后 sale_price_a 仍为审批值 200（未被回退）', Number(p.sale_price_a) === 200, `A=${p.sale_price_a}`)
      log.assert('★ 冲突后 revision 未被改动', Number(p.revision) === revAfterApprove, `revision=${p.revision}`)
      const [hist] = await dbQuery(pool,
        `SELECT COUNT(*) n FROM product_price_history WHERE product_id=? AND change_source='manual'`, [id])
      log.assert('★ 冲突未写任何手工价格历史', Number(hist.n) === 0, `${hist.n} 条`)
    }

    // ② cost 与 B/C/D 同路径：审批 cost 后旧编辑页同样被拦
    {
      const id = await mkProduct({ cost: 100 })
      const revBefore = await revOf(id)
      await pool.query('UPDATE product_items SET cost_price=150, sale_price_b=221, revision=revision+1 WHERE id=?', [id])
      const stale = await put(id, {
        ...base(`旧编辑页cost-${randomRef('Y')}`),
        costPrice: 100, salePriceA: 100, salePriceB: 121, salePriceC: 132, salePriceD: 143, revision: revBefore,
      })
      log.assert(
        '★ 旧版本保存（cost/B 路径）被 409 拦下',
        stale.status === 409, `status=${stale.status} code=${stale.data?.code}`,
      )
      const p = await priceOf(id)
      log.assert(
        '★ 冲突后 cost_price 仍为审批值 150、B 仍为 221',
        Number(p.cost_price) === 150 && Number(p.sale_price_b) === 221,
        `cost=${p.cost_price} B=${p.sale_price_b}`,
      )
    }

    // ③ 正常连续编辑：每次带最新 revision ⇒ 两次都成功且 revision 累加
    {
      const id = await mkProduct({ a: 100 })
      const r1 = await put(id, { ...base(`连续1-${randomRef('Z')}`), salePriceA: 110, costPrice: 100, revision: await revOf(id) })
      const r2 = await put(id, { ...base(`连续2-${randomRef('W')}`), salePriceA: 120, costPrice: 100, revision: await revOf(id) })
      log.assert('★ 正常连续编辑两次都成功', r1.status === 200 && r2.status === 200, `status=${r1.status}/${r2.status}`)
      const p = await priceOf(id)
      log.assert('★ 连续编辑后 A=120 且 revision 已累加', Number(p.sale_price_a) === 120 && Number(p.revision) >= 3, `A=${p.sale_price_a} rev=${p.revision}`)
      const [hist] = await dbQuery(pool,
        `SELECT COUNT(*) n FROM product_price_history WHERE product_id=? AND change_source='manual' AND price_type='a'`, [id])
      log.assert('★ 连续编辑按预期记录手工历史', Number(hist.n) >= 2, `${hist.n} 条`)
    }

    // ④ 缺 revision ⇒ 明确拒绝（旧客户端不得静默通过）
    {
      const id = await mkProduct({ a: 100 })
      const noRev = await put(id, { ...base(`缺版本-${randomRef('V')}`), salePriceA: 130, costPrice: 100 })
      log.assert(
        '★ 缺 revision 的普通更新被明确拒绝（400）',
        noRev.status === 400 && noRev.data?.code === 'PRODUCT_REVISION_REQUIRED',
        `status=${noRev.status} code=${noRev.data?.code}`,
      )
      const p = await priceOf(id)
      log.assert('★ 被拒后价格未被改动', Number(p.sale_price_a) === 100, `A=${p.sale_price_a}`)
    }

    // ④' 详情 API 的 revision 读契约（前端拿版本所依赖）
    {
      const id = await mkProduct({ a: 100 })
      const det = await http.get(`/api/products/${id}`, { token })
      const rev = det.data?.data?.revision
      log.assert('★ GET 商品详情返回 revision（编辑页读版本所依赖的契约）', Number.isInteger(Number(rev)), `revision=${rev}`)
      const okPut = await put(id, { ...base(`读契约-${randomRef('R')}`), salePriceA: 100, costPrice: 100, revision: Number(rev) })
      log.assert('★ 用详情返回的 revision 原样提交可成功', okPut.status === 200, `status=${okPut.status} msg=${okPut.message}`)
    }

    // ⑤ sale 列仍保持既有保护（§18.4 方案三）：普通编辑不写 sale_price
    {
      const id = await mkProduct({ a: 100 })
      await pool.query('UPDATE product_items SET sale_price=200, revision=revision+1 WHERE id=?', [id])
      const r = await put(id, { ...base(`sale保护-${randomRef('U')}`), salePriceA: 100, costPrice: 100, revision: await revOf(id) })
      log.assert('带最新版本的正常编辑成功', r.status === 200, `status=${r.status} msg=${r.message}`)
      const p = await priceOf(id)
      log.assert('★ sale_price 仍为 200（普通编辑不写 sale 列的既有保护不变）', Number(p.sale_price) === 200, `sale=${p.sale_price}`)
    }

    // ⑥ 审批写价递增 revision ⇒ 旧编辑页随后保存必被拦（顺序旧版本）
    {
      const id = await mkProduct({ a: 100 })
      const revBefore = await revOf(id)
      await pool.query('UPDATE product_items SET sale_price_a=300, revision=revision+1 WHERE id=?', [id]) // 模拟审批（递增）
      const stale = await put(id, { ...base(`审批后旧页-${randomRef('T')}`), salePriceA: 100, costPrice: 100, revision: revBefore })
      log.assert('★ 审批递增 revision 后，旧编辑页保存被 409', stale.status === 409, `status=${stale.status}`)
      // **必须用「刷新后」的 A=300**（而不是旧草稿的 100）——否则"重试"本身会再次回退审批价，
      // 让这条用例从"可恢复"退化成"换个姿势复现缺陷"。
      const ok = await put(id, { ...base(`审批后新页-${randomRef('Q')}`), salePriceA: 300, costPrice: 100, revision: await revOf(id) })
      log.assert('★ 用刷新后的最新 revision 且带刷新后的价（A=300）重试可成功', ok.status === 200, `status=${ok.status} msg=${ok.message}`)
      const pOk = await priceOf(id)
      log.assert('★ 重试后 A 仍为 300（旧草稿的值未被带回来）', Number(pOk.sale_price_a) === 300, `A=${pOk.sale_price_a}`)
    }
  } finally {
    for (const c of created.filter(x => x.kind === 'product')) {
      for (const t of ['product_price_history', 'product_units', 'product_stock_policies']) {
        try { await pool.query(`DELETE FROM ${t} WHERE product_id=?`, [c.id]) } catch (e) { console.error(`[清理告警] ${t}: ${e.message}`) }
      }
      try { await pool.query('DELETE FROM product_items WHERE id=?', [c.id]) } catch (e) { console.error(`[清理告警] product_items: ${e.message}`) }
    }
    for (const c of created.filter(x => x.kind === 'supplier')) {
      try { await pool.query('DELETE FROM supply_suppliers WHERE id=?', [c.id]) } catch (e) { console.error(`[清理告警] supplier: ${e.message}`) }
    }
    for (const c of created.filter(x => x.kind === 'category')) {
      try { await pool.query('DELETE FROM product_categories WHERE id=?', [c.id]) } catch (e) { console.error(`[清理告警] category: ${e.message}`) }
    }
    try {
      const pids = created.filter(x => x.kind === 'product').map(x => x.id)
      const cids = created.filter(x => x.kind === 'category').map(x => x.id)
      const [left] = pids.length
        ? await dbQuery(pool, 'SELECT COUNT(*) n FROM product_items WHERE id IN (?)', [pids])
        : [{ n: 0 }]
      const [cleft] = cids.length
        ? await dbQuery(pool, 'SELECT COUNT(*) n FROM product_categories WHERE id IN (?)', [cids])
        : [{ n: 0 }]
      log.assert('★ 本轮自建商品已全部清除（按 ID 复查为 0）', Number(left.n) === 0, `残留=${left.n}`)
      log.assert('★ 本轮自建分类已清除（按 ID 复查为 0）', Number(cleft.n) === 0, `残留=${cleft.n}`)
    } catch (e) { log.assert('★ 清理复查本身未抛错', false, e.message) }
    await ctx.close()
  }

  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => { console.error('[PRODUCT-PRICE-VERSION] 未捕获异常：', e); process.exit(1) })
