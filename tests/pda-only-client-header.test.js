'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { ts, callName } = require('./helpers/contractSource')
const { frontendCalls, backendRoutes, callsInSource } = require('./helpers/httpContracts')

// 返回指定键最终的值。未证明的 spread 可能覆盖前面的值。
function propertyValue(node, key) {
  if (!node) return undefined
  if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node)) return propertyValue(node.expression, key)
  if (ts.isConditionalExpression(node)) {
    const a = propertyValue(node.whenTrue, key)
    const b = propertyValue(node.whenFalse, key)
    return a === b ? a : undefined
  }
  if (callName(node) === 'withRequestKeyHeaders') {
    return node.arguments[1] ? propertyValue(node.arguments[1], key) : null
  }
  if (!ts.isObjectLiteralExpression(node)) return undefined
  let value = null
  for (const item of node.properties) {
    if (ts.isSpreadAssignment(item)) {
      const from = propertyValue(item.expression, key)
      if (from !== null) value = from
    } else if (ts.isPropertyAssignment(item) && item.name.text === key) {
      value = key === 'headers' ? propertyValue(item.initializer, 'X-Client')
        : ts.isStringLiteralLike(item.initializer) ? item.initializer.text : undefined
    }
  }
  return value
}

const serverOnly = new Set([
  // PDA 完成复核的扫码回执在服务事务内调用 checkDoneWithinTransaction。
  // 保留给 API 客户端的显式完成入口继续受服务端守卫约束。
  'PUT /api/warehouse-tasks/:p/check-done',
])

test('所有在用 PDA-only 路由至少有一处客户端，每条调用的请求头均已验证', () => {
  const { calls } = frontendCalls()
  const restricted = [...backendRoutes().routes].filter(([, value]) => value.pdaOnly)
  assert.ok(restricted.length >= 20)
  const missing = []
  const unused = new Set(serverOnly)
  for (const [key] of restricted) {
    const matches = calls.filter(call => call.key === key)
    if (!matches.length && serverOnly.has(key)) { unused.delete(key); continue }
    if (!matches.length) missing.push(key + ' 缺少客户端')
    for (const call of matches) if (propertyValue(call.config, 'headers') !== 'pda') missing.push(key + ' ' + call.file)
  }
  assert.deepEqual([...unused], [])
  assert.deepEqual(missing, [])
})

test('PDA 标识必须来自实际配置，所有条件分支均需覆盖', () => {
  const source = "import client from '@/api/client'\nclient.post<T<R>>('/example', {}, enabled ? {headers:{'X-Client':'pda'}} : {})"
  const [call] = callsInSource('hooks/example.ts', source)
  assert.ok(call)
  assert.notEqual(propertyValue(call.config, 'headers'), 'pda')
  const [ok] = callsInSource('hooks/example.ts', source.replace(': {})', ": {headers:{'X-Client':'pda'}})"))
  assert.equal(propertyValue(ok.config, 'headers'), 'pda')
})
