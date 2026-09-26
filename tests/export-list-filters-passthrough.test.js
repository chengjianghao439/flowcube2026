#!/usr/bin/env node
'use strict'

/**
 * 列表导出「筛选透传」契约测试（纯单元，无需 DB）。
 *
 * 规则：导出必须与页面同口径——**列表接口 findAll 支持的每一个筛选，导出都必须原样透传**。
 * 否则用户在页面上筛选后点导出，会拿到未按条件过滤的全量，与所见不符。
 *
 * 为什么必须机械守：2026-09-18 审计修掉了「账款导出丢筛选」，但同一文件里
 * 对账单（getStatementsExportPayload）与收付款单（getPaymentReceiptsExportPayload）
 * 犯了完全相同的错误，**存活至今**——因为既有测试
 * `prelaunch-scope-export.smoke.test.js` 的循环恰好只断言了 `keyword`，
 * 而 keyword 是全仓唯一被正确透传的参数，其余参数无人验证。
 * 这类「同一防护只装一半」的缺陷在页面/接口/守卫都全绿时完全不可见。
 *
 * 判定口径（刻意不硬编码参数清单）：**从 findAll 的函数签名解析出它支持的筛选键**，
 * 再断言导出把其中每一个都传了下去。这样测的是「列表接口支持什么」，而不是
 * 「导出实现里写了什么」——避免测试跟着实现一起错。
 *
 * 运行：node --test tests/export-list-filters-passthrough.test.js
 */

const path = require('path')
const { test } = require('node:test')
const assert = require('node:assert/strict')

// 纯单元测试：仅为满足 config/env 的启动校验，不参与任何鉴权，也不连接数据库。
process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-only-secret-not-used-for-auth-0123456789'

const exportService = require(path.resolve(__dirname, '../backend/src/modules/export/export.service'))

/**
 * 从 findAll 的签名解析筛选键。
 * 形态固定为 `async function findAll({ a = 1, b = '', ... } = {}) {...}`。
 */
function parseFindAllFilterKeys(fn) {
  const src = fn.toString()
  const matched = src.match(/findAll\s*\(\s*\{([\s\S]*?)\}\s*=\s*\{\s*\}\s*\)/)
  if (!matched) throw new Error('无法解析 findAll 的解构签名，测试口径失效——请检查函数形态是否变化')
  return matched[1]
    .split(',')
    .map(piece => piece.split('=')[0].trim())
    .filter(Boolean)
}

/** 分页由 collectExportRows 注入，不属于「筛选」，不参与断言。 */
const PAGING_KEYS = new Set(['page', 'pageSize'])

/** 每个值都可辨识，便于断言「传下去的是同一个值，没被丢/被改写」。 */
const PROBE_VALUE = 'PROBE'

const CASES = [
  {
    name: '账款列表',
    servicePath: '../backend/src/modules/payments/payments.service',
    exportMethod: 'getPaymentsExportPayload',
  },
  {
    name: '收付款单列表',
    servicePath: '../backend/src/modules/payments/payment-receipts.service',
    exportMethod: 'getPaymentReceiptsExportPayload',
  },
  {
    name: '对账单列表',
    servicePath: '../backend/src/modules/payments/reconciliation-statements.service',
    exportMethod: 'getStatementsExportPayload',
  },
]

for (const testCase of CASES) {
  test(`${testCase.name}导出透传列表接口支持的每一个筛选`, async () => {
    const service = require(path.resolve(__dirname, testCase.servicePath))
    const filterKeys = parseFindAllFilterKeys(service.findAll).filter(key => !PAGING_KEYS.has(key))
    assert.ok(filterKeys.length > 0, `${testCase.name}：未解析出任何筛选键，口径失效`)

    const received = []
    const original = service.findAll
    service.findAll = async (query) => {
      received.push(query)
      return { list: [], pagination: { total: 0 } }
    }

    try {
      const query = {}
      for (const key of filterKeys) query[key] = PROBE_VALUE
      await exportService[testCase.exportMethod](query)
    } finally {
      service.findAll = original
    }

    assert.equal(received.length, 1, `${testCase.name}：导出应恰好调用一次列表接口`)
    const passed = received[0]
    const missing = filterKeys.filter(key => !(key in passed))
    assert.deepEqual(
      missing, [],
      `${testCase.name}导出丢弃了这些筛选（页面筛了、导出却不过滤）：${missing.join(', ')}`,
    )
    for (const key of filterKeys) {
      assert.equal(
        String(passed[key]), String(PROBE_VALUE),
        `${testCase.name}：筛选 ${key} 未被原样透传（收到 ${JSON.stringify(passed[key])}）`,
      )
    }
  })
}

test('空串与 null 的筛选不应被当成非法值导致导出报错', async () => {
  const service = require(path.resolve(__dirname, '../backend/src/modules/payments/reconciliation-statements.service'))
  const original = service.findAll
  const received = []
  service.findAll = async (query) => {
    received.push(query)
    return { list: [], pagination: { total: 0 } }
  }
  try {
    // 前端清除筛选后常发出 `customerId=`/`partyId=` 这类空串；findAll 对它们会
    // `Number('') === 0` 判非法并 400，故导出必须在透传前把空串规范掉。
    await exportService.getStatementsExportPayload({
      type: '2', statementNo: '', partyName: '', customerId: '', partyId: '',
      startDate: '', endDate: '', minAmount: '', maxAmount: '',
    })
  } finally {
    service.findAll = original
  }
  assert.equal(received.length, 1)
  const passed = received[0]
  for (const key of ['customerId', 'partyId']) {
    assert.ok(
      passed[key] === null || passed[key] === undefined,
      `空串 ${key} 必须规范为 null/undefined 后透传，实收 ${JSON.stringify(passed[key])}`,
    )
  }
})
