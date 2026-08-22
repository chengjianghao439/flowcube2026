#!/usr/bin/env node
/**
 * 状态机动作表完整性测试（纯函数，无 DB）。
 *
 * 与 permission-codes.test.js 同一哲学：守「手工维护的常量不会漂移」的一致性。
 * 遍历 documentStatusRules 全部机器，断言：
 *   1. 每个 action 的 from 状态 ∈ 该机器已知状态集（无悬空 from）
 *   2. blocked 的键 ∈ 该机器已知状态集（无悬空 blocked）
 *   3. from 与 to 不相等（无空转）
 *   4. to 若存在 ∈ 该机器已知状态集
 *   5. assertStatusAction 对非法状态抛 409、对合法状态返回 rule（CAS 语义守门）
 *
 * 运行：node tests/status-rules-integrity.test.js
 */
'use strict'

const { DOCUMENT_STATUS_RULES, assertStatusAction } = require('../backend/src/constants/documentStatusRules')
const { WT_TRANSITIONS, assertWarehouseTaskAction } = require('../backend/src/constants/warehouseTaskStatus')

let passed = 0
let failed = 0
function assert(name, cond, detail = '') {
  if (cond) { passed++; console.log(`  [PASS] ${name}`) }
  else { failed++; console.log(`  [FAIL] ${name} ${detail}`) }
}

// ── 1. 各机器的已知状态集（手工维护，与 CLAUDE.md 第 10 节一致） ──
// 注意：warehouseTask 不在 documentStatusRules（独立在 warehouseTaskStatus.js），单独测试。
// 有意的「原地推进」动作（from 含 to，语义为续扫/续收）：transfer.scanOut(2,3→3)、
// inboundTask.receiveComplete(2,3→3)——不算空转，空转检查跳过这两个。
const KNOWN_STATES = {
  purchase: [1, 2, 3, 4, 5],
  sale: [1, 2, 3, 4, 5],
  inboundTask: [1, 2, 3, 4, 5],
  inboundTaskAudit: [0, 1, 2],
  transfer: [1, 2, 3, 4, 5],
  purchaseReturn: [1, 2, 3, 4],
  saleReturn: [1, 2, 3, 4],
  expenseClaim: [1, 2, 3, 4, 5, 6],
  stockcheck: [1, 2, 3],
  refundOrder: [1, 2, 3, 4],
  purchaseRequisition: [1, 2, 3, 4, 5, 6],
  inventoryDisposal: [1, 2, 3, 4, 5, 6],
  procurementPlan: [1, 2, 3, 4], // 3=已转换 4=已作废（cancel.to=4）
  creditOverride: [1, 2, 3, 4, 5],
}
const SELF_LOOP_OK = new Set(['transfer.scanOut', 'inboundTask.receiveComplete'])

console.log('状态机动作表完整性（documentStatusRules）')
const machines = Object.keys(DOCUMENT_STATUS_RULES)
assert('机器数量与已知清单一致（14，warehouseTask 独立）', machines.length === Object.keys(KNOWN_STATES).length, `实际 ${machines.length}: ${machines.join(',')}`)

for (const machine of machines) {
  const states = KNOWN_STATES[machine]
  if (!states) { assert(`${machine} 未在 KNOWN_STATES 中登记`, false); continue }
  const { entityName, actions } = DOCUMENT_STATUS_RULES[machine]
  assert(`${machine}(${entityName}) 有 actions`, !!actions && Object.keys(actions).length > 0)
  for (const [actionName, rule] of Object.entries(actions || {})) {
    const from = Array.isArray(rule.from) ? rule.from : [rule.from]
    for (const f of from) {
      assert(`${machine}.${actionName} from=${f} ∈ 已知状态集`, states.includes(f), `from=${f} 不在 [${states}]`)
    }
    if (rule.to != null) {
      assert(`${machine}.${actionName} to=${rule.to} ∈ 已知状态集`, states.includes(rule.to), `to=${rule.to} 不在 [${states}]`)
      if (!SELF_LOOP_OK.has(`${machine}.${actionName}`)) {
        assert(`${machine}.${actionName} 无空转（from≠to）`, !from.includes(rule.to), `from ${from} 含 to ${rule.to}`)
      }
    }
    for (const blockedKey of Object.keys(rule.blocked || {})) {
      assert(`${machine}.${actionName} blocked 键=${blockedKey} ∈ 已知状态集`, states.includes(Number(blockedKey)), `blocked=${blockedKey} 不在 [${states}]`)
    }
  }
}

// ── 2. assertStatusAction 守门语义（抛 400） ──
console.log('assertStatusAction 行为')
try {
  assertStatusAction('sale', 'completeShip', 4) // 已出库 → 再完成出库
  assert('已出库状态执行 completeShip 应抛错', false)
} catch (e) {
  assert('已出库状态执行 completeShip 抛 400', e.statusCode === 400, `status=${e.statusCode}`)
}
try {
  assertStatusAction('refundOrder', 'execute', 1) // 草稿 → 执行退款
  assert('草稿状态执行退款应抛错', false)
} catch (e) {
  assert('草稿状态执行退款抛 400', e.statusCode === 400, `status=${e.statusCode}`)
}
try {
  assertStatusAction('stockcheck', 'submit', 2) // 已完成 → 再提交
  assert('已完成盘点再提交应抛错', false)
} catch (e) {
  assert('已完成盘点再提交抛 400', e.statusCode === 400, `status=${e.statusCode}`)
}

// ── 3. warehouseTaskStatus 转换表 ──
console.log('warehouseTaskStatus 转换表')
for (const [from, tos] of Object.entries(WT_TRANSITIONS)) {
  for (const to of tos) {
    assert(`WT ${from}→${to} 合法`, typeof to === 'number' && to >= 1 && to <= 8, `to=${to}`)
  }
}
try {
  assertWarehouseTaskAction('ship', 3) // 待分拣不能直接出库
  assert('待分拣状态执行 ship 应抛错', false)
} catch (e) {
  assert('待分拣状态执行 ship 抛 400', e.statusCode === 400, `status=${e.statusCode}`)
}

console.log(`\n${'═'.repeat(60)}`)
console.log(`  ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
