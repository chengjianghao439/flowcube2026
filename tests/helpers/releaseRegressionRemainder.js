'use strict'
// Original CI regression job remainder, explicitly requested for bounded release validation.
const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert/strict')
const commands = Object.freeze([
  "npm run smoke:audit-remediation",
  "npm run smoke:user-account-management",
  "npm run smoke:accounting-sale-period",
  "npm run smoke:mainline",
  "npm run smoke:concurrency-guards",
  "npm run smoke:fulfillment-credit",
  "npm run smoke:sale-adjustment",
  "npm run smoke:inbound-progressive-putaway",
  "npm run smoke:kits-foundation",
  "npm run smoke:kits-current-stock",
  "npm run smoke:sale-commercial-lifecycle",
  "npm run smoke:sale-commercial-review",
  "npm run smoke:sale-commercial-partial-cancel",
  "npm run smoke:sale-commercial-readonly",
  "npm run smoke:sale-commercial-source-metadata",
  "npm run smoke:atp",
  "npm run smoke:p0-regression",
  "npm run smoke:p1-regression",
  "npm run smoke:warehouse-scope",
  "npm run smoke:pda-device-session",
  "npm run smoke:security-scan-remediation",
  "npm run smoke:auth-session-remediation",
  "npm run smoke:confirmed-audit",
  "npm run smoke:finance",
  "npm run smoke:disposal",
  "npm run smoke:invoice-quota",
  "npm run smoke:invoice-edit-concurrency",
  "npm run smoke:product-price-version-guard",
  "npm run smoke:refund-orders",
  "npm run smoke:accounting",
  "npm run smoke:accounting-period",
  "npm run smoke:print-template-preview",
  "npm run smoke:print-queue",
  "npm run smoke:print-barcode-void",
  "npm run smoke:print-barcode-void-receipt",
  "npm run test:print-purge",
  "node tests/search-scope.smoke.test.js",
  "node tests/users-roles.smoke.test.js",
  "npm run smoke:reports-values",
  "npm run smoke:report-cost-basis",
  "npm run smoke:price-change-history",
  "npm run smoke:product-price-history-integrity",
  "npm run smoke:warehouse-ops",
  "npm run smoke:credit-outbound",
  "npm run smoke:purchase-approval",
  "npm run smoke:purchase-requisition-removal",
  "npm run smoke:approval-flow",
  "npm run smoke:credit-override",
  "npm run test:integration"
])

function originalRemainder(source = fs.readFileSync(path.resolve(__dirname, '../../.github/workflows/test.yml'), 'utf8')) {
  const start = source.indexOf('      - name: 审计权限、打印与设备并发回归')
  const end = source.indexOf('\n  prelaunch-regression:', start)
  assert.ok(start >= 0 && end > start, 'Original CI remainder boundaries must exist')
  const actual = [...source.slice(start, end).matchAll(/^        run: (.+)$/gm)].map(match => match[1])
  assert.deepEqual(actual, commands, 'Release collection must preserve every original CI command in order')
  return commands
}

function commandArgs(command) {
  assert.ok(commands.includes(command), 'Only original CI remainder commands are allowed')
  if (command.startsWith('npm run ')) return { binary: 'npm', args: ['run', command.slice(8)] }
  assert.match(command, /^node tests\/[a-z0-9-]+\.smoke\.test\.js$/)
  return { binary: process.execPath, args: ['-r', path.join(__dirname, 'retentionReprintIsolation.js'), command.slice(5)] }
}
module.exports = { commands, originalRemainder, commandArgs }
