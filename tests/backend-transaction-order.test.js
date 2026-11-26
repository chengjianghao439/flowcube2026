'use strict'
const assert = require('node:assert/strict')
const { test } = require('node:test')
const { readFileSync } = require('node:fs')
const path = require('node:path')

// Lock ordering spans multiple SQL calls. Ignore whole-line comments when checking the query sequence.
function body(module, name) {
  const code = readFileSync(path.join(__dirname, '../backend/src/modules', module), 'utf8')
    .split('\n').filter(line => !/^\s*(?:\/\/|\/\*|\*)/.test(line)).join('\n')
  const start = code.indexOf('async function ' + name + '(')
  assert.notEqual(start, -1)
  return code.slice(start).split(/^}\s*$/m)[0]
}
function ordered(code, ...tokens) {
  let index = -1
  for (const token of tokens) {
    const next = code.indexOf(token, index + 1)
    assert.ok(next > index, 'expected in order: ' + tokens.join(' → '))
    index = next
  }
}

for (const name of ['createScanLog', 'createCheckScanLog', 'createCancelReturnScanLog', 'createCancelReturnBoxScanLog']) {
  test(name + ' checks the locked task and device before the receipt', () => {
    const code = body('scan-logs/scan-logs.service.js', name)
    ordered(code, 'FOR UPDATE', 'assertTaskScope(taskRow, { scopeWarehouseIds, pdaWarehouseId })', 'beginResourceOperationRequest')
    assert.doesNotMatch(code.slice(0, code.indexOf('FOR UPDATE')), /FROM warehouse_tasks[^'\x60]*IS NULL['\x60]/)
  })
}

for (const name of ['addItem', 'removeItem', 'voidPackage', 'finishPackage', 'printPackageLabel']) {
  test(name + ' locates package before starting RR and checks locked package before receipt', () => {
    ordered(body('packages/packages.service.js', name), 'SELECT warehouse_task_id FROM packages', 'beginTransaction()', 'FROM warehouse_tasks', 'FOR UPDATE', 'FROM packages', 'FOR UPDATE', 'beginResourceOperationRequest')
  })
}

test('wave finish reads picked quantities after member locks', () => {
  ordered(body('picking-waves/picking-waves.service.js', 'finishPicking'), 'JOIN warehouse_tasks', 'FOR UPDATE', 'refreshWavePickedFromTasks', 'assertTaskPickScanClosure')
})
