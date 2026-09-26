#!/usr/bin/env node
'use strict'

/**
 * 补打中心「作废容器」契约测试（纯离线，无需 DB）。
 *
 * 背景（2026-09-27）：撤回收货会把容器置为 VOID(3) 并回写剩余量为 0，但补打中心
 * 仍把它当「已打印」列出、按钮可点、后端也照建打印任务；作废标签（qty=0）会再次出纸。
 * 根因是**显示层与筛选层不同源**：显示按「容器状态 + 打印状态」派生，筛选只按「打印状态」。
 *
 * 本测试锁死四条不变量：
 *   1. VOID 容器一律派生为 `voided`，不被 print_status 的「已打印/失败」等覆盖；
 *   2. 状态归一化认识 `voided`，否则前端传它会被静默降级成「全部」；
 *   3. `voided` 筛选恰好只收 VOID 容器；
 *   4. **其余每一个状态筛选都必须排除 VOID 容器**——否则按「已打印」筛会把显示为
 *      「已作废」的行一起收进来，与所见不符。
 *
 * 运行：node --test tests/print-barcode-void-guard.test.js
 */

const path = require('path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-for-auth-0123456789'

const statusModule = require(path.resolve(__dirname, '../backend/src/modules/print-jobs/print-jobs.status'))
const queryModule = require(path.resolve(__dirname, '../backend/src/modules/print-jobs/print-jobs.query'))

const { deriveInboundBarcodeStatus, deriveInboundPrintJobResult, normalizeBarcodeRecordStatus } = statusModule

const CONTAINER_ACTIVE = 1
const CONTAINER_EMPTY = 2
const CONTAINER_VOID = 3
const CONTAINER_PENDING_PUTAWAY = 4
const CONTAINER_PENDING_QA = 5
const CONTAINER_REJECTED = 6
const PRINT_DONE = 2
const PRINT_PENDING = 0
const PRINT_PRINTING = 1
const PRINT_FAILED = 3

/** 去掉空白后判断子句是否显式排除 VOID。 */
function excludesVoid(sql) {
  const compact = String(sql || '').replace(/\s+/g, '')
  return compact.includes('c.status') && compact.includes('<>3')
}

const { inboundStatusClause } = queryModule

test('1. 作废容器派生为 voided，不被「已打印」覆盖', () => {
  const derived = deriveInboundBarcodeStatus({
    container_status: CONTAINER_VOID, print_status: PRINT_DONE, inbound_task_status: 1,
  })
  assert.equal(derived.statusKey, 'voided')
  assert.match(String(derived.printStateLabel), /作废/)
})

test('2. 状态归一化认识 voided（否则前端传它会被静默降级为「全部」）', () => {
  assert.equal(normalizeBarcodeRecordStatus('voided'), 'voided')
  assert.equal(normalizeBarcodeRecordStatus('VOIDED'), 'voided')
})

test('3. voided 筛选恰好只收 VOID 容器', () => {
  assert.equal(typeof inboundStatusClause, 'function', 'inboundStatusClause 必须导出以供契约测试')
  const clause = inboundStatusClause('voided', 30)
  const compact = String(clause.sql || '').replace(/\s+/g, '')
  assert.ok(compact.includes('c.status=3'), `voided 筛选必须限定 c.status=3，实际：${clause.sql}`)
})

test('4. 其余状态筛选一律排除 VOID 容器（防「已打印」收进显示为已作废的行）', () => {
  for (const status of ['no_job', 'unassigned', 'timeout', 'success', 'failed', 'printing', 'queued', 'cancelled']) {
    const clause = inboundStatusClause(status, 30)
    assert.ok(
      excludesVoid(clause.sql),
      `筛选「${status}」没有排除作废容器，会把显示为「已作废」的行收进来：${clause.sql}`,
    )
  }
})

test('5. 不扩大限制：仅 VOID 视为不可补打，EMPTY/待上架/待质检/拒收仍按原状态显示', () => {
  for (const containerStatus of [CONTAINER_ACTIVE, CONTAINER_EMPTY, CONTAINER_PENDING_PUTAWAY, CONTAINER_PENDING_QA, CONTAINER_REJECTED]) {
    const derived = deriveInboundBarcodeStatus({
      container_status: containerStatus, print_status: PRINT_DONE, inbound_task_status: 1,
    })
    assert.notEqual(
      derived.statusKey, 'voided',
      `容器状态 ${containerStatus} 不应被判为作废（业务边界：只禁止 VOID）`,
    )
    assert.equal(derived.statusKey, 'success', `容器状态 ${containerStatus} 有打印记录时应仍显示「已打印」`)
  }
})

test('6. 任务结果与条码业务状态分离：作废不吞掉「最近任务」结果', () => {
  // 2026-09-27 GUI 验收：VOID 行原本只剩「条码已作废」，最近任务的实际结果「已打印」整个丢失。
  const row = { container_status: CONTAINER_VOID, print_status: PRINT_DONE, inbound_task_status: 1 }
  assert.equal(deriveInboundBarcodeStatus(row).statusKey, 'voided', '行级业务状态应为作废')
  assert.equal(deriveInboundPrintJobResult(row).statusKey, 'success', '最近任务结果应仍是「已打印」')
  assert.equal(deriveInboundPrintJobResult(row).printStateLabel, '已打印')
})

test('7. 因作废被撤回终结的任务说「未出纸」，不说「打印失败」', () => {
  const aborted = deriveInboundPrintJobResult({
    container_status: CONTAINER_VOID, print_status: PRINT_FAILED, error_message: 'container voided',
  })
  assert.equal(aborted.statusKey, 'voided_job')
  assert.match(String(aborted.printStateLabel), /未出纸/)
})

test('8. 其他原有打印结果语义保持（任务级派生）', () => {
  const base = { container_status: CONTAINER_ACTIVE }
  assert.equal(deriveInboundPrintJobResult({ ...base, print_status: PRINT_DONE }).statusKey, 'success')
  assert.equal(
    deriveInboundPrintJobResult({ ...base, print_status: PRINT_FAILED, error_message: 'render failed' }).statusKey,
    'failed',
  )
  assert.equal(deriveInboundPrintJobResult({ ...base, print_status: PRINT_PENDING }).statusKey, 'queued')
  assert.equal(deriveInboundPrintJobResult({ ...base, print_status: PRINT_PRINTING }).statusKey, 'printing')
  // 无打印任务
  assert.equal(deriveInboundPrintJobResult({ ...base, print_status: null }).statusKey, 'no_job')
})
