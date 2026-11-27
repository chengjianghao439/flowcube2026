'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { validatePositiveIntParam } = require('../backend/src/utils/route')

test('validatePositiveIntParam 拒绝非正整数与溢出值，放行合法安全正整数', () => {
  const mw = validatePositiveIntParam('id', '销售单编号')
  for (const bad of ['', 'abc', 'shipments', '0', '-1', '1.5', '1e2', '01', '+1', '9007199254740992']) {
    let err = null
    mw({ params: { id: bad } }, {}, (e) => { err = e })
    assert.ok(err, `expected error for ${JSON.stringify(bad)}`)
    assert.equal(err.statusCode, 400)
    assert.equal(err.code, 'INVALID_ID')
    assert.equal(err.message, '销售单编号无效')
  }
  for (const good of ['1', '42', '9007199254740991']) {
    let called = false
    let err = null
    mw({ params: { id: good } }, {}, (e) => { called = true; err = e || null })
    assert.equal(called, true)
    assert.equal(err, null, `expected pass for ${good}`)
  }
})

test('核心业务路由的全部 /:id 入口均在 requirePermission 之后挂有正整数校验', () => {
  const files = [
    'backend/src/modules/sale/sale.routes.js',
    'backend/src/modules/purchase/purchase.routes.js',
    'backend/src/modules/customers/customers.routes.js',
    'backend/src/modules/suppliers/suppliers.routes.js',
    'backend/src/modules/products/products.routes.js',
    'backend/src/modules/warehouses/warehouses.routes.js',
    'backend/src/modules/users/users.routes.js',
  ]
  for (const rel of files) {
    const src = fs.readFileSync(path.resolve(__dirname, '..', rel), 'utf8')
    const lines = src.split('\n').filter(l => /router\.(get|post|put|patch|delete)\(\s*['"]\/:id\b/.test(l))
    assert.ok(lines.length > 0, `${rel} should declare /:id routes`)
    for (const line of lines) {
      const permIdx = line.indexOf('requirePermission(')
      const checkIdx = line.indexOf('checkId')
      assert.ok(permIdx >= 0, `${rel} missing requirePermission on: ${line.trim()}`)
      assert.ok(checkIdx > permIdx, `${rel} must validate :id after requirePermission on: ${line.trim()}`)
    }
  }
})
