'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// Component/browser tests initialize their own router. This checks the real entry too.
// The negative variants prove removing or moving initialization breaks the guard.
function assertBootstrapOrder(source) {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  const initialized = code.indexOf('initializeWorkspaceHistoryGuard()')
  const rendered = code.indexOf('createRoot(rootEl).render(')
  assert.ok(initialized >= 0 && rendered > initialized, 'workspace history guard must initialize before the application Router subscribes')
  assert.ok(code.includes("import('@/router/workspaceHistoryGuard')"))
}
const source = fs.readFileSync(path.join(__dirname, '../frontend/src/main.tsx'), 'utf8')
test('application initializes history guard before createRoot, including after login', () => assertBootstrapOrder(source))
test('removing initialization or deferring it past rendering is caught', () => {
  const removed = source.replace('    initializeWorkspaceHistoryGuard()', '')
  assert.throws(() => assertBootstrapOrder(removed))
  assert.throws(() => assertBootstrapOrder(removed + '\ninitializeWorkspaceHistoryGuard()'))
})
