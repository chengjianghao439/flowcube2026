#!/usr/bin/env node
'use strict'

/**
 * 呆滞库存处置单回归（P2-9）：建议 → 审批 → 处置。
 *
 * 这条链路直接动库存（FIFO 扣容器 + 刷新缓存），错法和库存的「静默出错」同性质——
 * 界面正常、账悄悄对不上，靠人工点测发现不了。本测试锁死的是几处违反即事故的口径：
 *
 *   1. 执行处置（三种方式）都走容器路径扣减：扣完 ACTIVE 容器合计 = inventory_stock.quantity，
 *      两者必须一致（缓存刷新正确）。
 *   2. 报废除扣库存外，必须落 disposal_scrapped 台账（资产灭失的审计证据）。
 *   3. 状态机：只有已批准(3)能执行处置；待审批驳回后不能执行；取消后不能提交。
 *   4. 处置只能走 ERP 端，超管跳过权限校验（role_id=1）。
 *   5. 明细数量超可用库存时，执行必须在服务端拦截（adjustContainerStock 的可用量校验）。
 *
 * 运行：node tests/disposal.smoke.test.js
 */

const path = require('path')
const {
  createLogger,
  prepareSmokeContext,
  dbQuery,
  login,
  randomRef,
} = require('./helpers/smokeTestKit')

const containerEngine = require('../backend/src/engine/containerEngine')

/** 建一个本场景专用商品（呆滞判定只要求「有库存 + 90 天无出库」，无需真实出库历史） */
async function createTestProduct(pool) {
  const code = randomRef('DP-').slice(0, 40)
  const [r] = await pool.query(
    "INSERT INTO product_items (code, name, unit, sale_price_a, cost_price, avg_cost) VALUES (?, ?, '个', 10, 5, 5)",
    [code, `处置测试商品-${code}`],
  )
  return { id: r.insertId, code, name: `处置测试商品-${code}`, unit: '个' }
}

/** 通过容器引擎注入在库库存（正规两段式：先待上架再转在库） */
async function seedStock(pool, productId, warehouseId, qty) {
  const conn = await pool.getConnection()
  try {
    await conn.beginTransaction()
    const { containerId } = await containerEngine.createContainer(conn, {
      productId,
      warehouseId,
      initialQty: qty,
      sourceType: containerEngine.SOURCE_TYPE.MANUAL,
      sourceRefId: 999998,
      remark: '处置测试铺底库存',
      containerStatus: containerEngine.CONTAINER_STATUS.PENDING_PUTAWAY,
    })
    await containerEngine.promotePendingContainerToActive(conn, containerId, productId, warehouseId)
    await conn.commit()
    return containerId
  } catch (e) {
    await conn.rollback()
    throw e
  } finally {
    conn.release()
  }
}

async function currentOnHand(pool, productId, warehouseId) {
  const rows = await dbQuery(pool,
    'SELECT quantity FROM inventory_stock WHERE product_id=? AND warehouse_id=?',
    [productId, warehouseId],
  )
  return rows[0] ? Number(rows[0].quantity) : 0
}

/** 完整处置链路：创建 → 提交 → 审批 → 执行，验证库存扣减 + 报废台账 */
async function scenarioFullFlow(ctx, log, token) {
  const { http, pool, warehouse, product: baseProduct } = ctx
  const product = await createTestProduct(pool)
  await seedStock(pool, product.id, warehouse.id, 20)

  const before = await currentOnHand(pool, product.id, warehouse.id)
  log.assert('铺底库存 20 已入账', before === 20, `before=${before}`)

  // 1. 建议查询应能看到该商品（有库存、无出库历史 → 呆滞）；用 code 精确过滤，避免被高价值呆滞商品挤出分页
  const sug = await http.get(`/api/disposals/suggestions?warehouseId=${warehouse.id}&keyword=${encodeURIComponent(product.code)}`, { token })
  log.assert('建议接口 200', sug.status === 200, `status=${sug.status}`)
  const sugList = sug.data?.data?.list || []
  const sugHit = sugList.find(s => Number(s.productId) === Number(product.id))
  log.assert('呆滞建议命中测试商品', Boolean(sugHit), JSON.stringify(sugList).slice(0, 300))

  // 2. 创建草稿（降价促销 1）
  const create = await http.post('/api/disposals', {
    token,
    json: {
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      remark: '处置测试',
      items: [{ productId: product.id, quantity: 5, disposeType: 1, remark: '降价清仓' }],
    },
  })
  log.assert('创建处置单 200', create.status === 200, `status=${create.status} msg=${create.message}`)
  const disposalId = create.data?.data?.id
  log.assert('创建返回 id', Number.isInteger(disposalId), JSON.stringify(create.data))

  const detail1 = await http.get(`/api/disposals/${disposalId}`, { token })
  log.assert('草稿状态=1 明细数量=5', detail1.data?.data?.status === 1 && Number(detail1.data?.data?.items?.[0]?.quantity) === 5,
    `status=${detail1.data?.data?.status}`)

  // 3. 提交 → 待审批
  const sub = await http.post(`/api/disposals/${disposalId}/submit`, { token })
  log.assert('提交审批 200', sub.status === 200, `status=${sub.status} msg=${sub.message}`)

  // 4. 审批 → 已批准
  const appr = await http.post(`/api/disposals/${disposalId}/approve`, { token })
  log.assert('审批通过 200', appr.status === 200, `status=${appr.status}`)
  const detail2 = await http.get(`/api/disposals/${disposalId}`, { token })
  log.assert('审批后状态=3', detail2.data?.data?.status === 3, `status=${detail2.data?.data?.status}`)

  // 5. 执行处置 → 已处置，库存扣减 5
  const dis = await http.post(`/api/disposals/${disposalId}/dispose`, { token })
  log.assert('执行处置 200', dis.status === 200, `status=${dis.status} msg=${dis.message}`)
  const after = await currentOnHand(pool, product.id, warehouse.id)
  log.assert('库存扣减 20→15', after === 15, `after=${after}`)

  // 6. 库存缓存与容器一致（不变量 1）
  const [{ cqty }] = await dbQuery(pool,
    `SELECT COALESCE(SUM(remaining_qty),0) AS cqty FROM inventory_containers
      WHERE product_id=? AND warehouse_id=? AND status=1 AND deleted_at IS NULL`,
    [product.id, warehouse.id],
  )
  log.assert('缓存 = ACTIVE 容器合计', Number(cqty) === after, `cqty=${cqty} after=${after}`)

  // 7. 详情最终态
  const detail3 = await http.get(`/api/disposals/${disposalId}`, { token })
  log.assert('处置后状态=4 且已处置时间已写', detail3.data?.data?.status === 4 && Boolean(detail3.data?.data?.disposedAt),
    `status=${detail3.data?.data?.status}`)
}

/** 报废方式：除扣库存外必须落 disposal_scrapped 台账 */
async function scenarioScrapLeavesLedger(ctx, log, token) {
  const { http, pool, warehouse } = ctx
  const product = await createTestProduct(pool)
  await seedStock(pool, product.id, warehouse.id, 8)

  const create = await http.post('/api/disposals', {
    token,
    json: {
      warehouseId: warehouse.id,
      warehouseName: warehouse.name,
      items: [{ productId: product.id, quantity: 3, disposeType: 3 }],
    },
  })
  const disposalId = create.data?.data?.id
  await http.post(`/api/disposals/${disposalId}/submit`, { token })
  await http.post(`/api/disposals/${disposalId}/approve`, { token })
  const dis = await http.post(`/api/disposals/${disposalId}/dispose`, { token })
  log.assert('报废处置 200', dis.status === 200, `status=${dis.status}`)

  const scrapRows = await dbQuery(pool,
    'SELECT product_id, quantity, unit_value FROM disposal_scrapped WHERE disposal_id=?', [disposalId],
  )
  log.assert('报废台账落一条', scrapRows.length === 1, `rows=${scrapRows.length}`)
  log.assert('台账数量=3', Number(scrapRows[0]?.quantity) === 3, JSON.stringify(scrapRows[0]))

  const after = await currentOnHand(pool, product.id, warehouse.id)
  log.assert('报废后库存 8→5', after === 5, `after=${after}`)
}

/** 状态机守门：驳回后不可执行；取消后不可提交；草稿不可执行 */
async function scenarioStatusGuards(ctx, log, token) {
  const { http, pool, warehouse } = ctx
  const product = await createTestProduct(pool)
  await seedStock(pool, product.id, warehouse.id, 10)

  // 草稿直接执行 → 拒绝
  const c1 = await http.post('/api/disposals', {
    token,
    json: {
      warehouseId: warehouse.id, warehouseName: warehouse.name,
      items: [{ productId: product.id, quantity: 2, disposeType: 1 }],
    },
  })
  const d1 = c1.data?.data?.id
  const early = await http.post(`/api/disposals/${d1}/dispose`, { token })
  log.assert('草稿不可执行处置', early.status === 409 || early.status === 400,
    `status=${early.status} msg=${early.message}`)

  // 驳回 → 已驳回(5)，不可执行
  const d2res = await http.post('/api/disposals', {
    token,
    json: {
      warehouseId: warehouse.id, warehouseName: warehouse.name,
      items: [{ productId: product.id, quantity: 2, disposeType: 1 }],
    },
  })
  const d2 = d2res.data?.data?.id
  await http.post(`/api/disposals/${d2}/submit`, { token })
  const rj = await http.post(`/api/disposals/${d2}/reject`, { token, json: { reason: '不需要' } })
  log.assert('驳回 200', rj.status === 200, `status=${rj.status}`)
  const afterReject = await http.get(`/api/disposals/${d2}`, { token })
  log.assert('驳回后状态=5 且理由已写', afterReject.data?.data?.status === 5 && afterReject.data?.data?.rejectReason === '不需要',
    `status=${afterReject.data?.data?.status}`)
  const rejectExec = await http.post(`/api/disposals/${d2}/dispose`, { token })
  log.assert('已驳回不可执行', rejectExec.status === 409 || rejectExec.status === 400,
    `status=${rejectExec.status}`)

  // 取消 → 已取消(6)，不可提交
  const d3res = await http.post('/api/disposals', {
    token,
    json: {
      warehouseId: warehouse.id, warehouseName: warehouse.name,
      items: [{ productId: product.id, quantity: 2, disposeType: 1 }],
    },
  })
  const d3 = d3res.data?.data?.id
  const ccl = await http.post(`/api/disposals/${d3}/cancel`, { token })
  log.assert('取消 200', ccl.status === 200, `status=${ccl.status}`)
  const afterCancel = await http.get(`/api/disposals/${d3}`, { token })
  log.assert('取消后状态=6', afterCancel.data?.data?.status === 6, `status=${afterCancel.data?.data?.status}`)
  const submitCancel = await http.post(`/api/disposals/${d3}/submit`, { token })
  log.assert('已取消不可再提交', submitCancel.status === 409 || submitCancel.status === 400,
    `status=${submitCancel.status}`)

  // 库存未被任何失败的流转动过：仍在 10
  const onhand = await currentOnHand(pool, product.id, warehouse.id)
  log.assert('失败的流转未动库存', onhand === 10, `onhand=${onhand}`)
}

/** 数量超可用库存 → 服务端拦截 */
async function scenarioOverQuantityRejected(ctx, log, token) {
  const { http, pool, warehouse } = ctx
  const product = await createTestProduct(pool)
  await seedStock(pool, product.id, warehouse.id, 4)

  const create = await http.post('/api/disposals', {
    token,
    json: {
      warehouseId: warehouse.id, warehouseName: warehouse.name,
      items: [{ productId: product.id, quantity: 10, disposeType: 1 }],
    },
  })
  const d = create.data?.data?.id
  await http.post(`/api/disposals/${d}/submit`, { token })
  await http.post(`/api/disposals/${d}/approve`, { token })
  const dis = await http.post(`/api/disposals/${d}/dispose`, { token })
  log.assert('处置数量超可用被拒', dis.status === 400 || dis.status === 409,
    `status=${dis.status} msg=${dis.message}`)
  const after = await currentOnHand(pool, product.id, warehouse.id)
  log.assert('超量被拒后库存不变', after === 4, `after=${after}`)
}

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext()
  try {
    const { token } = await login(ctx.http, 'smoke_admin', 'SmokeAdmin123!')
    if (!token) throw new Error('登录失败，无法执行处置单回归')

    await scenarioFullFlow(ctx, log, token)
    await scenarioScrapLeavesLedger(ctx, log, token)
    await scenarioStatusGuards(ctx, log, token)
    await scenarioOverQuantityRejected(ctx, log, token)
  } finally {
    await ctx.close()
  }
  const counts = log.summary()
  process.exit(counts.failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[DISPOSAL-SMOKE] 未捕获异常：', e)
  process.exit(1)
})
