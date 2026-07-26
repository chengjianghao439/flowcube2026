#!/usr/bin/env node
'use strict'

/**
 * 打印调度策略纯函数测试（无需 DB）。
 *   node tests/print-policy.test.js
 *
 * 锁住「标签最终从哪台机器出来」的决策依据：心跳分、设备综合分、探索率、以及探索选择本身。
 * 这一层此前无任何测试覆盖，而它恰恰是打印路由问题的高发区。
 */

const path = require('path')
const assert = require('assert')

const {
  heartbeatScore,
  printerScore,
  computeExplorationRate,
  pickWithExploration,
  defaultDispatchPolicy,
} = require(path.resolve(__dirname, '../backend/src/modules/print-jobs/print-policy'))

const results = []
let failures = 0
function check(desc, fn) {
  try { fn(); results.push(`  ✓ ${desc}`) }
  catch (e) { failures += 1; results.push(`  ✗ ${desc}\n      ${e.message}`) }
}

const policy = defaultDispatchPolicy()
const secondsAgo = (s) => new Date(Date.now() - s * 1000)

// ── 心跳分 ──────────────────────────────────────────────────────────────────
check('心跳缺失 / 非法时间 → 中性分 0.35（不因缺数据被判死）', () => {
  assert.strictEqual(heartbeatScore(null), 0.35)
  assert.strictEqual(heartbeatScore(undefined), 0.35)
  assert.strictEqual(heartbeatScore('not-a-date'), 0.35)
})
check('30s 内心跳 → 满分 1（与后端 clientOnline 判定阈值一致）', () => {
  assert.strictEqual(heartbeatScore(new Date()), 1)
  assert.strictEqual(heartbeatScore(secondsAgo(29)), 1)
})
check('30~90s → 0.82；超过 90s 起指数衰减且不低于 0.15', () => {
  assert.strictEqual(heartbeatScore(secondsAgo(60)), 0.82)
  const long = heartbeatScore(secondsAgo(600))
  assert.ok(long >= 0.15 && long < 0.82, `实得 ${long}`)
  assert.strictEqual(heartbeatScore(secondsAgo(100000)), 0.15)
})

// ── 设备综合分 ──────────────────────────────────────────────────────────────
check('全健康设备（零错误/零延迟/心跳满）→ 权重和 1', () => {
  const s = printerScore({ error_rate: 0, avg_latency_ms: 0 }, 1, policy)
  assert.ok(Math.abs(s - 1) < 1e-9, `实得 ${s}`)
})
check('错误率越高分越低', () => {
  const good = printerScore({ error_rate: 0, avg_latency_ms: 0 }, 1, policy)
  const bad = printerScore({ error_rate: 1, avg_latency_ms: 0 }, 1, policy)
  assert.ok(bad < good, `${bad} 应低于 ${good}`)
})
check('延迟越高分越低', () => {
  const fast = printerScore({ error_rate: 0, avg_latency_ms: 0 }, 1, policy)
  const slow = printerScore({ error_rate: 0, avg_latency_ms: 120000 }, 1, policy)
  assert.ok(slow < fast, `${slow} 应低于 ${fast}`)
})
check('冷启动设备获得加成（同条件下优先被探测）', () => {
  const warm = printerScore({ error_rate: 0, avg_latency_ms: 0 }, 1, policy)
  const cold = printerScore({ error_rate: 0, avg_latency_ms: 0, coldStart: true }, 1, policy)
  assert.ok(cold > warm, `冷启动 ${cold} 应高于 ${warm}`)
})

// ── 探索率 ──────────────────────────────────────────────────────────────────
check('无候选设备 → 落在 [min, max] 区间内的基准值', () => {
  const r = computeExplorationRate(new Map(), [], policy)
  assert.ok(r >= policy.explMin && r <= policy.explMax, `实得 ${r}`)
})
check('fixed 模式直接采用配置值并 clamp 到 [0,1]', () => {
  const fixed = { ...policy, explorationMode: 'fixed', explorationRateFixed: 0.5 }
  assert.strictEqual(computeExplorationRate(new Map(), [1], fixed), 0.5)
  const over = { ...policy, explorationMode: 'fixed', explorationRateFixed: 9 }
  assert.strictEqual(computeExplorationRate(new Map(), [1], over), 1)
})
check('设备错误率上升 → 探索率上升（更愿意尝试其它机器）', () => {
  const healthy = new Map([[1, { error_rate: 0, avg_latency_ms: 0 }]])
  const failing = new Map([[1, { error_rate: 1, avg_latency_ms: 0 }]])
  const rHealthy = computeExplorationRate(healthy, [1], policy)
  const rFailing = computeExplorationRate(failing, [1], policy)
  assert.ok(rFailing > rHealthy, `${rFailing} 应高于 ${rHealthy}`)
})
check('探索率始终被 clamp 在 [min, max]', () => {
  const awful = new Map([[1, { error_rate: 1, avg_latency_ms: 10 ** 9 }]])
  const r = computeExplorationRate(awful, [1], policy)
  assert.ok(r <= policy.explMax, `实得 ${r} 超过上限 ${policy.explMax}`)
})

// ── 探索选择（决定实际出纸的机器）─────────────────────────────────────────────
check('无在线设备 → null', () => {
  assert.strictEqual(pickWithExploration([], 0.5), null)
})
check('只有一台设备时，探索率再高也只会选它（单机部署不受探索机制影响）', () => {
  assert.strictEqual(pickWithExploration([7], 1), 7)
  assert.strictEqual(pickWithExploration([7], 0), 7)
})
check('探索率 0 → 恒选最优（排序后的第一台）', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.strictEqual(pickWithExploration([1, 2, 3], 0), 1)
  }
})
check('探索率 1 → 恒选次优（第二台）；这正是「点 A 机器却从 B 出纸」的来源', () => {
  for (let i = 0; i < 50; i += 1) {
    assert.strictEqual(pickWithExploration([1, 2, 3], 1), 2)
  }
})
check('默认不探索：健康设备恒选最优（多仓库绑多台是物理隔离，不该随机跨机出纸）', () => {
  assert.strictEqual(policy.explBase, 0)
  assert.strictEqual(policy.explMin, 0)
  const healthy = new Map([[1, { error_rate: 0, avg_latency_ms: 0 }], [2, { error_rate: 0, avg_latency_ms: 0 }]])
  assert.strictEqual(computeExplorationRate(healthy, [1, 2], policy), 0)
})
check('设备故障时探索仍会自动抬升（容错未被关掉）', () => {
  const failing = new Map([[1, { error_rate: 1, avg_latency_ms: 0 }], [2, { error_rate: 1, avg_latency_ms: 0 }]])
  const r = computeExplorationRate(failing, [1, 2], policy)
  assert.ok(r > 0, `错误率 100% 时探索率应大于 0，实得 ${r}`)
  assert.ok(r <= policy.explMax, `实得 ${r} 超过上限`)
})
check('环境变量显式设 0 不会被默认值吞掉（|| 陷阱回归测试）', () => {
  const saved = process.env.PRINT_EXPLORATION_BASE
  try {
    process.env.PRINT_EXPLORATION_BASE = '0'
    delete require.cache[require.resolve(
      path.resolve(__dirname, '../backend/src/modules/print-jobs/print-policy'),
    )]
    const reloaded = require(path.resolve(__dirname, '../backend/src/modules/print-jobs/print-policy'))
    assert.strictEqual(reloaded.defaultDispatchPolicy().explBase, 0)
  } finally {
    if (saved === undefined) delete process.env.PRINT_EXPLORATION_BASE
    else process.env.PRINT_EXPLORATION_BASE = saved
  }
})

console.log('打印调度策略测试：')
console.log(results.join('\n'))
if (failures > 0) { console.error(`\n${failures} 个断言失败`); process.exit(1) }
console.log(`\n全部通过（${results.length} 项）`)
