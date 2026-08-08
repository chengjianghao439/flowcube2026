#!/usr/bin/env node
'use strict'

/**
 * opLogger 敏感字段清理纯函数测试（无需 DB）。
 *   node tests/oplogger.test.js
 *
 * 重点锁住三类漏网：snake_case 变体（device_secret）、camelCase（deviceSecret）、
 * 幂等键（idempotency-key）——它们此前会让 PDA 设备密钥明文落库。
 */

const path = require('path')
const assert = require('assert')

// 纯函数测试：仅为满足 config/env 的启动校验，不参与任何鉴权
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-for-auth-0123456789'

const {
  sanitizeBody,
  isSensitiveKey,
  SENSITIVE_FIELDS,
} = require(path.resolve(__dirname, '../backend/src/middleware/opLogger'))

const results = []
let failures = 0
function check(desc, fn) {
  try { fn(); results.push(`  ✓ ${desc}`) }
  catch (e) { failures += 1; results.push(`  ✗ ${desc}\n      ${e.message}`) }
}

// ── snake_case / camelCase 双命名统一清洗 ─────────────────────────────────────
check('PDA 设备密钥 snake_case 与 camelCase 均被清洗', () => {
  const out = sanitizeBody({ device_secret: 'x', deviceSecret: 'y' })
  assert.strictEqual(out.device_secret, '***')
  assert.strictEqual(out.deviceSecret, '***')
})
check('会话令牌 snake_case 与 camelCase 均被清洗', () => {
  const out = sanitizeBody({ session_token: 'a', sessionToken: 'b' })
  assert.strictEqual(out.session_token, '***')
  assert.strictEqual(out.sessionToken, '***')
})
check('幂等键（含连字符形式）被清洗', () => {
  const out = sanitizeBody({ 'idempotency-key': 'k' })
  assert.strictEqual(out['idempotency-key'], '***')
})
check('原始密码族字段继续被清洗', () => {
  const out = sanitizeBody({ password: 'p', oldPassword: 'o', newPassword: 'n' })
  assert.strictEqual(out.password, '***')
  assert.strictEqual(out.oldPassword, '***')
  assert.strictEqual(out.newPassword, '***')
})

// ── 误伤防护：普通业务字段不得被清洗 ──────────────────────────────────────────
check('普通字段原样保留', () => {
  const out = sanitizeBody({ deviceCode: 'DEV001', warehouseId: 3, qty: 12 })
  assert.strictEqual(out.deviceCode, 'DEV001')
  assert.strictEqual(out.warehouseId, 3)
  assert.strictEqual(out.qty, 12)
})
check('含 "secret" 子串的业务字段不受影响（精确键匹配，不做子串匹配）', () => {
  const out = sanitizeBody({ barcode_prefix: 'SECRET-CODE' })
  assert.strictEqual(out.barcode_prefix, 'SECRET-CODE')
})

// ── 结构递归 ──────────────────────────────────────────────────────────────────
check('嵌套对象内敏感键被递归清洗', () => {
  const out = sanitizeBody({ device: { device_secret: 's' }, note: 'hi' })
  assert.strictEqual(out.device.device_secret, '***')
  assert.strictEqual(out.note, 'hi')
})
check('数组元素被递归清洗', () => {
  const out = sanitizeBody([{ password: 'p' }, { session_token: 't' }])
  assert.strictEqual(out[0].password, '***')
  assert.strictEqual(out[1].session_token, '***')
})

// ── 空值防护 ──────────────────────────────────────────────────────────────────
check('null / undefined / 非对象原样返回', () => {
  assert.strictEqual(sanitizeBody(null), null)
  assert.strictEqual(sanitizeBody(undefined), undefined)
  assert.strictEqual(sanitizeBody('plain'), 'plain')
  assert.strictEqual(sanitizeBody(42), 42)
})

// ── isSensitiveKey 直接断言 ───────────────────────────────────────────────────
check('SENSITIVE_FIELDS 集包含全部目标键', () => {
  for (const k of ['password', 'deviceSecret', 'sessionToken', 'idempotencyKey', 'secret', 'token']) {
    assert.ok(SENSITIVE_FIELDS.has(k), `缺少 ${k}`)
  }
})
check('snake_case 归一化判定正确', () => {
  assert.strictEqual(isSensitiveKey('device_secret'), true)
  assert.strictEqual(isSensitiveKey('session_token'), true)
  assert.strictEqual(isSensitiveKey('idempotency_key'), true)
  assert.strictEqual(isSensitiveKey('device_code'), false)
})

console.log('opLogger 敏感字段测试：')
console.log(results.join('\n'))
if (failures > 0) { console.error(`\n${failures} 个断言失败`); process.exit(1) }
console.log(`\n全部通过（${results.length} 项）`)
