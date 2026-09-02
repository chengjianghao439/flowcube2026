#!/usr/bin/env node
'use strict'

/**
 * 采购订单预计量纳入销售占库（ATP）+ 取消/短装「先解绑」拦截 —— 回归。
 *
 * 覆盖（迁移 228，2026-09-02）：
 *   1. 销售占库判定把「已提交采购单实测预计到货量」算进可用（现货 0 也能占）。
 *   2. 占库超出现货的部分记录 sale_order_expected_bindings（绑定到具体采购单）。
 *   3. 采购单取消 → 409 BINDING_SALE_DEPENDENCY 拦截，需先到销售单解除绑定。
 *   4. 释放销售占库 → 绑定作废。
 *   5. 解除绑定后采购单可正常取消。
 *
 * 依赖真实 MySQL（与其它 smoke 一致），用全新商品实例保证现货=0，测完清理。
 */

const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  const { pool, http } = ctx
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('管理员登录失败')

    // ── 造无现货商品（新插入，无任何容器）＋ 一张已提交采购单（在途 5）──
    const code = `ATP${randomRef('P').replace(/-/g, '').slice(0, 10)}`
    const [prod] = await pool.query(
      "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price) VALUES (?, 'ATP测试商品', '个', 20, 10)",
      [code],
    )
    const productId = Number(prod.insertId)
    const poNo = `POATP${Date.now()}`
    const [po] = await pool.query(
      `INSERT INTO purchase_orders (order_no, supplier_id, supplier_name, warehouse_id, warehouse_name, status, operator_id, operator_name, expected_date)
       VALUES (?, 1, 'Smoke供应商', ?, 'Smoke仓库', 2, 1, 'Smoke管理员', DATE_ADD(CURDATE(), INTERVAL 7 DAY))`,
      [poNo, ctx.warehouse.id],
    )
    const poId = Number(po.insertId)
    await pool.query(
      'INSERT INTO purchase_order_items (order_id, product_id, product_code, product_name, unit, quantity, unit_price, amount) VALUES (?,?,?,?,?,5,10,50)',
      [poId, productId, code, 'ATP测试商品', '个'],
    )

    // ── 建销售单 qty 5（现货 0，必须靠采购单预计量）──
    const saleResp = await http.post('/api/sale', {
      token,
      json: {
        customerId: ctx.customer.id, customerName: ctx.customer.name,
        warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name,
        items: [{ productId, productCode: code, productName: 'ATP测试商品', unit: '个', quantity: 5, unitPrice: 20 }],
      },
    })
    log.assert('★ 在途占库：建销售单成功', saleResp.ok,
      `status=${saleResp.status} ${JSON.stringify(saleResp.data?.message || '')}`)
    const saleId = saleResp.data?.data?.id
    if (!saleId) throw new Error('销售单未创建')
    const [itemRow] = await dbQuery(pool, 'SELECT id FROM sale_order_items WHERE order_id=? AND product_id=?', [saleId, productId])
    const itemId = Number(itemRow.id)

    const rv = await http.post(`/api/sale/${saleId}/reserve`, {
      token,
      json: { items: [{ id: itemId, warehouseId: ctx.warehouse.id, warehouseName: ctx.warehouse.name, qty: 5 }] },
    })
    log.assert('★ 现货 0 也可占库（采购单预计量支撑）', rv.ok,
      `status=${rv.status} ${JSON.stringify(rv.data?.message || '')}`)

    const [bind] = await dbQuery(pool,
      'SELECT COUNT(*) AS n FROM sale_order_expected_bindings WHERE purchase_order_id=? AND released_at IS NULL', [poId])
    log.assert('★ 超出现货部分已记录采购单绑定', Number(bind.n) > 0, `bindings=${bind.n}`)

    const cx = await http.post(`/api/purchase/${poId}/cancel`, { token })
    log.assert('★ 采购单取消被绑定拦截（409 BINDING_SALE_DEPENDENCY）',
      cx.status === 409 && cx.data?.code === 'BINDING_SALE_DEPENDENCY',
      `status=${cx.status} code=${cx.data?.code}`)
    log.assert('拦截信息列出被占用销售单', /SO|销售单/.test(cx.data?.message || ''), cx.data?.message)

    const rl = await http.post(`/api/sale/${saleId}/release`, { token, json: { items: [{ id: itemId, qty: 5 }] } })
    log.assert('释放销售占库', rl.ok, `status=${rl.status}`)

    const [bind2] = await dbQuery(pool,
      'SELECT COUNT(*) AS n FROM sale_order_expected_bindings WHERE purchase_order_id=? AND released_at IS NULL', [poId])
    log.assert('★ 释放后绑定作废', Number(bind2.n) === 0, `bindings=${bind2.n}`)

    const cx2 = await http.post(`/api/purchase/${poId}/cancel`, { token })
    log.assert('★ 解除绑定后采购单可取消', cx2.ok, `status=${cx2.status}`)
  } finally {
    // 清理测试数据（稳妥起见：按唯一 code 定位并清理，失败不阻塞主流程）
    try {
      const products = await dbQuery(pool, "SELECT id FROM product_items WHERE code LIKE 'ATP%' AND deleted_at IS NULL")
      for (const p of products) {
        await pool.query('DELETE FROM sale_order_expected_bindings WHERE product_id=?', [p.id])
        await pool.query('DELETE FROM stock_reservations WHERE product_id=?', [p.id])
        const saleItemPairs = await dbQuery(pool, 'SELECT order_id, id FROM sale_order_items WHERE product_id=?', [p.id])
        for (const si of saleItemPairs) {
          await pool.query('DELETE FROM sale_order_items WHERE id=?', [si.id])
          await pool.query('DELETE FROM sale_orders WHERE id=?', [si.order_id])
        }
        const poItems = await dbQuery(pool, 'SELECT order_id FROM purchase_order_items WHERE product_id=?', [p.id])
        for (const poi of poItems) {
          await pool.query('DELETE FROM purchase_order_items WHERE order_id=?', [poi.order_id])
          await pool.query('DELETE FROM purchase_orders WHERE id=?', [poi.order_id])
        }
        await pool.query('DELETE FROM product_items WHERE id=?', [p.id])
      }
    } catch (e) {
      log.assert('清理失败（不阻断）', false, e.message)
    }
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[ATP] 未捕获异常：', e)
  process.exit(1)
})
