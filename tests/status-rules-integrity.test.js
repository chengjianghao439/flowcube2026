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
  sale: [1, 2, 3, 4, 5, 6],
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
  priceChangeRequest: [1, 2, 3, 4], // 1待审批 2已通过 3已驳回 4已取消（2026-08-22 新增）
}
const SELF_LOOP_OK = new Set(['transfer.scanOut', 'inboundTask.receiveComplete'])

console.log('状态机动作表完整性（documentStatusRules）')
const machines = Object.keys(DOCUMENT_STATUS_RULES)
assert('机器数量与已知清单一致（15，warehouseTask 独立）', machines.length === Object.keys(KNOWN_STATES).length, `实际 ${machines.length}: ${machines.join(',')}`)

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

// ── 4. 收满才能上架（2026-09-16 用户确定） ──
// 上架只允许从「待上架(3)」发起。进入 3 有两条路：全部明细行收满后自动推进，
// 或供应商短装时由 ERP 走「短装结案」把剩余未收量作罢。此前 from 含 2，等于把这条
// 业务规则交给前端页面隐藏按钮去守——上架页自 v0.1.2 起就拦着 status<3，而服务端一直
// 放行未收满的单，接口层可以绕过。
console.log('收满才能上架')
const putawayRule = DOCUMENT_STATUS_RULES.inboundTask.actions.putaway
assert(
  '上架只允许从待上架(3)发起',
  Array.isArray(putawayRule.from) && putawayRule.from.length === 1 && putawayRule.from[0] === 3,
  `from=${JSON.stringify(putawayRule.from)}`,
)
try {
  assertStatusAction('inboundTask', 'putaway', 2)
  assert('收货中(2) 不得上架', false)
} catch (e) {
  assert('收货中(2) 上架抛 400', e.statusCode === 400, `status=${e.statusCode}`)
  assert(
    '提示同时给出「继续收货」与「短装结案」两条出路',
    /继续收货/.test(e.message) && /短装结案/.test(e.message),
    `message=${e.message}`,
  )
}
const putawayAtReady = assertStatusAction('inboundTask', 'putaway', 3)
assert('待上架(3) 可以上架（收满或短装结案后）', putawayAtReady.from.includes(3))

// ── 状态**文案**一致性（2026-09-18 审计 [30]） ───────────────────────────────
// 状态码有 documentStatusRules 守着，文案没有——于是同一个状态在不同地方被手写成不同的名字：
//   · 销售列表/查询弹窗写「待占库/执行中」，而后端与生成物是「草稿/拣货中」；
//   · 退货状态 3 在后端 statusName 与导出 SQL 里写「已退货/已退货入库」，而 documentStatusRules
//     的动作、迁移 146 的列注释、前端筛选项都是「已执行」——同一页面筛选写「已执行」、表格写「已退货」。
// 这里做机械核对：文案只能有一个来源，且过时叫法不得再出现在**代码**里（注释里的历史说明除外）。
console.log('状态文案一致性')

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const ROOT = join(__dirname, '..')
const readSrc = rel => readFileSync(join(ROOT, rel), 'utf8')
/** 去掉注释后匹配——注释里会写「旧名叫已退货」这类历史说明，不该被当成违规 */
function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/[^\n]*/g, (m, p1) => p1 + ' '.repeat(m.length - p1.length))
}

const SALE_NAMES = { 1: '草稿', 2: '已占库', 3: '拣货中', 4: '已出库', 5: '已取消', 6: '部分占库' }
const generated = readSrc('frontend/src/generated/status.ts')
for (const [code, name] of Object.entries(SALE_NAMES)) {
  assert(`generated/status.ts：销售状态 ${code} = ${name}`,
    new RegExp(`"${code}":\\s*"${name}"`).test(generated), '请重新运行 npm run generate:status')
}

// ① 销售页不得再手写状态文案：必须从生成物取，且不出现与生成物冲突的字面量
for (const rel of ['frontend/src/pages/sale/index.tsx', 'frontend/src/pages/sale/SaleQueryDialog.tsx']) {
  const code = stripComments(readSrc(rel))
  assert(`${rel} 从 @/generated/status 取状态文案`, /from '@\/generated\/status'/.test(code))
  const conflicts = Object.entries(SALE_NAMES)
    .filter(([c, n]) => new RegExp(`['"\`]${c}['"\`]\\s*[:>]\\s*(?:\\{?)\\s*['"]${n === '草稿' ? '待占库' : '执行中'}['"]`).test(code)
      || new RegExp(`value=["']${c}["'][^>]*>\\s*(?:待占库|执行中)`).test(code))
    .map(([c]) => c)
  assert(`${rel} 不再出现与生成物冲突的销售状态文案`, conflicts.length === 0, `冲突状态码=${conflicts.join(',')}`)
}

// ② 退货状态 3 的文案统一为「已执行」（documentStatusRules / 迁移 146 / 前端筛选项）
const STALE_RETURN_NAMES = ['已退货入库', '已退货']
for (const rel of [
  'backend/src/modules/returns/returns-purchase.service.js',
  'backend/src/modules/returns/returns-sale.service.js',
  'backend/src/modules/export/export.service.js',
  'frontend/src/pages/returns/index.tsx',
  'frontend/src/pages/returns/ReturnQueryDialog.tsx',
]) {
  const code = stripComments(readSrc(rel))
  const stale = STALE_RETURN_NAMES.filter(n => code.includes(n))
  assert(`${rel} 不再使用过时的退货状态名`, stale.length === 0, `残留=${stale.join(',')}`)
}
assert('后端采购退货 statusName 3 = 已执行', /3:\s*'已执行'/.test(readSrc('backend/src/modules/returns/returns-purchase.service.js')))
assert('后端销售退货 statusName 3 = 已执行', /3:\s*'已执行'/.test(readSrc('backend/src/modules/returns/returns-sale.service.js')))
assert('采购退货导出 SQL：3 → 已执行',
  (readSrc('backend/src/modules/export/export.service.js').match(/WHEN 3 THEN '已执行'/g) || []).length === 2,
  '采购退货单与销售退货单两条导出 SQL 都要改')

console.log(`\n${'═'.repeat(60)}`)
console.log(`  ${passed} passed, ${failed} failed`)
process.exit(failed > 0 ? 1 : 0)
