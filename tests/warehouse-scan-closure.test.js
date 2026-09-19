#!/usr/bin/env node
'use strict'

/**
 * 出库前置扫码闭环的行为回归（纯离线，无需 DB）。
 *
 * 为什么需要它：这两条闭环是**出库闸门**，而且 2026-09-19 刚把内部的逐明细聚合
 * 改成了「一次 GROUP BY 批量读取」。批量改写有一个**静默 fail-open 的等价性陷阱**：
 *
 *   原写法 `SELECT COALESCE(SUM(qty),0) AS sq ... WHERE item_id=?` 是聚合查询，
 *   明细没有扫码行时也返回一行 sq=0；改成 `GROUP BY item_id` 后，无扫码行的明细
 *   **在结果里根本不出现**。此时若写成 `byItem.get(id) !== picked_qty`，undefined
 *   与任何数字都不等 → 仍然抛错（安全）；但若有人为了"修"这个比较而写成
 *   `(byItem.get(id) || 0) !== ...` 或干脆跳过缺失项，就会把「完全没扫码」
 *   判成通过——出库闸门形同失效，而且**没有任何测试会红**。
 *
 * 该风险此前只靠人工判断守着：`smoke:*` 套件走的都是有扫码行的正常路径，
 * 没有任何测试覆盖「明细存在但一条扫码记录都没有」这个分支。本文件补上，
 * 顺带把 N+1 修复的行为特征（N 条明细只发 1 次聚合查询）也钉住。
 *
 * 运行：npm run test:warehouse-scan-closure（不需要数据库）
 */

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

// 这两条闭环所在的模块链会加载 backend/src/config/env.js，它强制要求 ≥32 位的 JWT_SECRET。
// 本测试既不起服务也不校验证签，故在 require 之前生成一个随机值占位——
// **不在测试里硬编码任何密钥**（既不写进仓库，也避免被 gitleaks 当成凭据误伤）。
if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 32) {
  process.env.JWT_SECRET = require('node:crypto').randomBytes(32).toString('hex')
}

const {
  assertTaskPickScanClosure,
  assertTaskCheckScanClosure,
} = require(path.join(__dirname, '..', 'backend/src/modules/warehouse-tasks/warehouse-tasks.helpers'))

/**
 * 按 SQL 文本路由的 stub 连接：只实现这两个闭环真正发出的查询。
 * 遇到未预期的 SQL 直接抛错——避免以后新增查询时测试悄悄失真。
 */
function makeConn({ items = [], pickAgg = [], checkAgg = [], locked = [], picked = [] } = {}) {
  const calls = { items: 0, scanAgg: 0 }
  const conn = {
    async query(sql) {
      if (sql.includes('FROM warehouse_task_items')) {
        calls.items++
        return [items]
      }
      if (sql.includes('GROUP BY item_id')) {
        calls.scanAgg++
        return [sql.includes('scan_purpose=2') ? checkAgg : pickAgg]
      }
      if (sql.includes('DISTINCT container_id')) return [picked]
      if (sql.includes('locked_by_task_id')) return [locked]
      throw new Error(`出库闭环发出了未预期的查询：${sql.slice(0, 70)}`)
    },
  }
  return { conn, calls }
}

const pickedItems = (...ids) =>
  ids.map((id) => ({ id, required_qty: 5, picked_qty: 5 }))
const checkedItems = (...ids) =>
  ids.map((id) => ({ id, required_qty: 5, picked_qty: 5, checked_qty: 5 }))

async function expectReject(fn, messagePart) {
  await assert.rejects(fn, (err) => {
    assert.match(String(err.message), new RegExp(messagePart))
    return true
  })
}

test('拣货闭环：明细已拣满但一条扫码记录都没有，必须拒绝（防批量改写 fail-open）', async () => {
  const { conn } = makeConn({
    items: pickedItems(1),
    pickAgg: [],              // 关键：无扫码行 —— 批量版结果里根本没有该明细
    locked: [{ id: 10 }],
    picked: [{ cid: 10 }],
  })
  await expectReject(() => assertTaskPickScanClosure(conn, 1), '拣货扫码合计与明细已拣数量不一致')
})

test('拣货闭环：扫码合计少于已拣数量，必须拒绝', async () => {
  const { conn } = makeConn({
    items: pickedItems(1),
    pickAgg: [{ item_id: 1, sq: 3 }],
    locked: [{ id: 10 }],
    picked: [{ cid: 10 }],
  })
  await expectReject(() => assertTaskPickScanClosure(conn, 1), '拣货扫码合计与明细已拣数量不一致')
})

test('拣货闭环：扫码合计与已拣一致时通过', async () => {
  const { conn } = makeConn({
    items: pickedItems(1),
    pickAgg: [{ item_id: 1, sq: 5 }],
    locked: [{ id: 10 }],
    picked: [{ cid: 10 }],
  })
  await assertTaskPickScanClosure(conn, 1)
})

test('拣货闭环：未拣满明细仍先被拦下', async () => {
  const { conn } = makeConn({
    items: [{ id: 1, required_qty: 5, picked_qty: 2 }],
    pickAgg: [{ item_id: 1, sq: 2 }],
    locked: [{ id: 10 }],
    picked: [{ cid: 10 }],
  })
  await expectReject(() => assertTaskPickScanClosure(conn, 1), '拣货未完成')
})

test('复核闭环：明细已复核但一条扫码记录都没有，必须拒绝（防批量改写 fail-open）', async () => {
  const { conn } = makeConn({ items: checkedItems(1), checkAgg: [] })
  await expectReject(() => assertTaskCheckScanClosure(conn, 1), '复核扫码合计与已核数量不一致')
})

test('复核闭环：复核扫码合计与已核数量一致时通过', async () => {
  const { conn } = makeConn({
    items: checkedItems(1),
    checkAgg: [{ item_id: 1, sq: 5 }],
  })
  await assertTaskCheckScanClosure(conn, 1)
})

test('复核闭环：已核数量小于已拣数量时先被拦下', async () => {
  const { conn } = makeConn({
    items: [{ id: 1, required_qty: 5, picked_qty: 5, checked_qty: 3 }],
    checkAgg: [{ item_id: 1, sq: 3 }],
  })
  await expectReject(() => assertTaskCheckScanClosure(conn, 1), '复核未完成')
})

test('N 条明细只发 1 次扫码聚合查询（N+1 的行为特征）', async () => {
  const items = pickedItems(1, 2, 3, 4, 5)
  const agg = items.map((it) => ({ item_id: it.id, sq: 5 }))

  const pick = makeConn({ items, pickAgg: agg, locked: [{ id: 10 }], picked: [{ cid: 10 }] })
  await assertTaskPickScanClosure(pick.conn, 1)
  assert.equal(pick.calls.scanAgg, 1, '拣货闭环对 5 条明细必须只查 1 次扫码聚合（不得退回逐明细查询）')
  assert.equal(pick.calls.items, 1)

  const check = makeConn({ items: checkedItems(1, 2, 3, 4, 5), checkAgg: agg })
  await assertTaskCheckScanClosure(check.conn, 1)
  assert.equal(check.calls.scanAgg, 1, '复核闭环对 5 条明细必须只查 1 次扫码聚合（不得退回逐明细查询）')
  assert.equal(check.calls.items, 1)
})

test('锁定容器数量与拣货扫码容器数量不一致时拒绝', async () => {
  const { conn } = makeConn({
    items: pickedItems(1),
    pickAgg: [{ item_id: 1, sq: 5 }],
    locked: [{ id: 10 }, { id: 11 }],
    picked: [{ cid: 10 }],
  })
  await expectReject(() => assertTaskPickScanClosure(conn, 1), '锁定的库存条码与拣货扫码的库存条码不一致')
})

test('锁定容器的容器没有拣货扫码时拒绝（数量相同但成员不同）', async () => {
  const { conn } = makeConn({
    items: pickedItems(1),
    pickAgg: [{ item_id: 1, sq: 5 }],
    locked: [{ id: 10 }],
    picked: [{ cid: 11 }],   // 扫码的是另一个容器
  })
  await expectReject(() => assertTaskPickScanClosure(conn, 1), '存在未经拣货扫码的锁定库存条码')
})
