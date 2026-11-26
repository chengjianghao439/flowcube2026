#!/usr/bin/env node
'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { ts, parse, visit, owner, functionName, literals, callName } = require('./helpers/contractSource')
const order = ['finance_accounts', 'reconciliation_statements', 'payment_records']

function lockPaths(source) {
  const tree = parse(source)
  const paths = new Map()
  visit(tree, node => {
    if (!ts.isCallExpression(node)) return
    const method = callName(node)
    const sql = node.arguments[0] && literals(node.arguments[0])
    let identity
    let stage
    if (['query', 'execute'].includes(method) && sql && /\bFOR\s+UPDATE\b/i.test(sql)) {
      stage = /\bFROM\s+(finance_accounts|reconciliation_statements|payment_records)\b/i.exec(sql)?.[1]
    }
    if (stage === 'finance_accounts' && node.arguments[1] && ts.isArrayLiteralExpression(node.arguments[1])) {
      identity = node.arguments[1].elements[0]?.getText()
    }
    if (method === 'recordTransaction' && node.expression.getText() === 'accountSvc.recordTransaction') {
      stage = 'finance_accounts'
      const account = node.arguments[1]?.properties?.find(prop => prop.name?.text === 'accountId')
      identity = account?.initializer?.getText() ?? account?.name?.getText()
    }
    if (method === 'applyAllocations') stage = 'applyAllocations'
    if (!stage) return
    let fn = owner(node)
    // 服务的事务回调归入其注册函数。具名函数分别校验。
    while (fn && !ts.isSourceFile(fn) && !fn.name && !fn.parent?.name) fn = owner(fn)
    if (!fn) return
    const key = functionName(fn)
    if (!paths.has(key)) paths.set(key, [])
    paths.get(key).push({ stage, identity, line: tree.getLineAndCharacterOfPosition(node.getStart()).line + 1 })
  })
  return paths
}

const stageSteps = stage => (stage === 'applyAllocations' ? ['reconciliation_statements', 'payment_records'] : [stage])

function checkPath(points) {
  let previous = -1
  const accounts = new Set()
  for (const { stage, identity } of points) {
    for (const step of stageSteps(stage)) {
      const rank = order.indexOf(step)
      if (rank < 0) continue
      if (step === 'finance_accounts' && identity) {
        if (accounts.has(identity)) continue
        accounts.add(identity)
      }
      if (rank < previous) return false
      previous = rank
    }
  }
  return true
}

function main() {
  const modules = path.join(__dirname, '../backend/src/modules')
  for (const [file, expected] of [
    ['payments/payments.service.js', { recordPayment: order }],
    ['refunds/refund-orders.service.js', { execute: order }],
    ['payments/payment-receipts.service.js', {
      applyAllocations: order.slice(1),
      create: ['finance_accounts', 'applyAllocations'],
    }],
    ['finance/finance-accounts.service.js', { recordTransaction: ['finance_accounts'] }],
  ]) {
    const paths = lockPaths(fs.readFileSync(path.join(modules, file), 'utf8'))
    for (const [name, points] of paths) {
      assert.ok(checkPath(points), file + ' ' + name + ' 取锁顺序 ' + JSON.stringify(points))
    }
    for (const [name, required] of Object.entries(expected)) {
      const stages = [...new Set((paths.get(name) || []).map(point => point.stage))]
      assert.deepEqual(stages, required, file + ' ' + name)
    }
    console.log(file + ' ' + paths.size + ' 条函数路径通过')
  }
}

module.exports = { lockPaths, checkPath }
if (require.main === module) main()
