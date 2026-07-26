#!/usr/bin/env node
'use strict'

/**
 * 打印任务状态判定纯函数测试（无需 DB）。
 *   node tests/print-status.test.js
 *
 * 重点锁住两类「停滞」的归一：TTL 到期与打印客户端失联回收，
 * 对用户都应表现为「超时待确认」而不是普通打印失败 —— 后者会诱导人工重打导致重复出纸。
 */

const path = require('path')
const assert = require('assert')

// 纯函数测试：仅为满足 config/env 的启动校验，不参与任何鉴权
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-for-auth-0123456789'

const {
  STATUS,
  EXPIRE_MESSAGE,
  CLIENT_OFFLINE_MESSAGE,
  isStalledErrorMessage,
  parseListStatus,
  parsePriority,
  deriveGenericBarcodeStatus,
  assertCanCompleteLocalDesktop,
  clientOfflineReclaimSeconds,
} = require(path.resolve(__dirname, '../backend/src/modules/print-jobs/print-jobs.status'))

const results = []
let failures = 0
function check(desc, fn) {
  try { fn(); results.push(`  ✓ ${desc}`) }
  catch (e) { failures += 1; results.push(`  ✗ ${desc}\n      ${e.message}`) }
}

// ── 停滞消息归一 ────────────────────────────────────────────────────────────
check('TTL 到期与客户端失联回收都识别为停滞', () => {
  assert.strictEqual(isStalledErrorMessage(EXPIRE_MESSAGE), true)
  assert.strictEqual(isStalledErrorMessage(CLIENT_OFFLINE_MESSAGE), true)
})
check('真实打印错误不算停滞（应显示为打印失败，可人工重试）', () => {
  assert.strictEqual(isStalledErrorMessage('打印机缺纸'), false)
  assert.strictEqual(isStalledErrorMessage(''), false)
  assert.strictEqual(isStalledErrorMessage(null), false)
  assert.strictEqual(isStalledErrorMessage(undefined), false)
})
check('两类停滞消息文本不同，便于排障时分辨原因', () => {
  assert.notStrictEqual(EXPIRE_MESSAGE, CLIENT_OFFLINE_MESSAGE)
})

// ── 条码记录状态派生 ────────────────────────────────────────────────────────
check('客户端失联回收的任务 → 超时待确认（而非打印失败）', () => {
  const d = deriveGenericBarcodeStatus({ status: STATUS.FAILED, error_message: CLIENT_OFFLINE_MESSAGE })
  assert.strictEqual(d.statusKey, 'timeout')
  assert.strictEqual(d.printStateLabel, '超时待确认')
})
check('TTL 到期的任务 → 超时待确认', () => {
  const d = deriveGenericBarcodeStatus({ status: STATUS.FAILED, error_message: EXPIRE_MESSAGE })
  assert.strictEqual(d.statusKey, 'timeout')
})
check('普通失败仍为打印失败', () => {
  const d = deriveGenericBarcodeStatus({ status: STATUS.FAILED, error_message: '打印机缺纸' })
  assert.strictEqual(d.statusKey, 'failed')
})
check('完成 / 打印中 / 排队 各自映射正确', () => {
  assert.strictEqual(deriveGenericBarcodeStatus({ status: STATUS.DONE }).statusKey, 'success')
  assert.strictEqual(deriveGenericBarcodeStatus({ status: STATUS.PRINTING }).statusKey, 'printing')
  assert.strictEqual(deriveGenericBarcodeStatus({ status: STATUS.PENDING }).statusKey, 'queued')
})
check('无打印任务的记录 → no_job（LEFT JOIN 未命中，两种空值形状都不得误判为待派发）', () => {
  // 真实形状：outbound 查询把业务表 status 别名成 package_status，行上只有 print_status=NULL
  assert.strictEqual(deriveGenericBarcodeStatus({ print_status: null }).statusKey, 'no_job')
  assert.strictEqual(deriveGenericBarcodeStatus({ status: null, print_status: null }).statusKey, 'no_job')
  assert.strictEqual(deriveGenericBarcodeStatus({}).statusKey, 'no_job')
})

// ── 回收阈值 ────────────────────────────────────────────────────────────────
check('客户端失联回收阈值须大于 30s 在线判定阈值（避免误伤正在打印的任务）', () => {
  assert.ok(clientOfflineReclaimSeconds() > 30, `实得 ${clientOfflineReclaimSeconds()}`)
})

// ── 本机核销前置校验 ────────────────────────────────────────────────────────
check('已完成任务重复核销直接放行（幂等）', () => {
  assert.doesNotThrow(() => assertCanCompleteLocalDesktop({ status: STATUS.DONE }, false))
})
check('已失败任务不可核销为完成', () => {
  assert.throws(() => assertCanCompleteLocalDesktop({ status: STATUS.FAILED }, false), /已失败/)
})
check('已被工作站领取的任务不可本机核销（防两条路径各打一次）', () => {
  assert.throws(() => assertCanCompleteLocalDesktop({ status: STATUS.PRINTING }, false), /打印工作站/)
})
check('带 ackToken 的待打印任务不可本机核销', () => {
  assert.throws(() => assertCanCompleteLocalDesktop({ status: STATUS.PENDING }, true), /工作站/)
})

// ── 入参归一 ────────────────────────────────────────────────────────────────
check('列表状态筛选支持别名与数字', () => {
  assert.strictEqual(parseListStatus('pending'), STATUS.PENDING)
  assert.strictEqual(parseListStatus('success'), STATUS.DONE)
  assert.strictEqual(parseListStatus('done'), STATUS.DONE)
  assert.strictEqual(parseListStatus('failed'), STATUS.FAILED)
  assert.strictEqual(parseListStatus(2), STATUS.DONE)
  assert.strictEqual(parseListStatus(''), undefined)
  assert.strictEqual(parseListStatus(null), undefined)
})
check('优先级仅 high/1 视为高优，其余归零', () => {
  assert.strictEqual(parsePriority('high'), 1)
  assert.strictEqual(parsePriority(1), 1)
  assert.strictEqual(parsePriority('1'), 1)
  assert.strictEqual(parsePriority('normal'), 0)
  assert.strictEqual(parsePriority(undefined), 0)
})

console.log('打印任务状态判定测试：')
console.log(results.join('\n'))
if (failures > 0) { console.error(`\n${failures} 个断言失败`); process.exit(1) }
console.log(`\n全部通过（${results.length} 项）`)
