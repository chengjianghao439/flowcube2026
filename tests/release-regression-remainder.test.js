'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const { runRegressions } = require('./helpers/changeRecordsRegressions')
const { commands, originalRemainder, commandArgs } = require('./helpers/releaseRegressionRemainder')

test('all 48 remaining original CI commands and slice environments are preserved, unknown commands rejected', () => {
  assert.equal(originalRemainder().length, 48)
  for (const command of commands) assert.ok(commandArgs(command).args.length > 0)
  assert.throws(() => commandArgs('npm run unknown'), /Only original CI/)
  const source = require('node:fs').readFileSync(require('node:path').resolve(__dirname, '../.github/workflows/test.yml'), 'utf8')
  assert.throws(() => originalRemainder(source.replace('run: npm run smoke:audit-remediation\n', 'run: true\n')), /preserve every original CI/)
  assert.throws(() => originalRemainder(source.replace('      - name: 审计权限、打印与设备并发回归', '      - name: removed')), /boundaries must exist/)
})

test('explicit release collection executes every original command and still fails for any error', async () => {
  const visited = [], proofs = []
  await assert.rejects(runRegressions({ files: ['a', 'b', 'c'], collectFailures: true,
    proveOwnership: async () => proofs.push('owned'),
    runSuite: async file => { visited.push(file); if (file !== 'b') throw new Error(file) },
  }), error => error instanceof AggregateError && error.errors.length === 2)
  assert.deepEqual(visited, ['a', 'b', 'c'])
  assert.equal(proofs.length, 3)
})

test('collection stops immediately if instance ownership can no longer be proved', async () => {
  const visited = []
  await assert.rejects(runRegressions({ files: ['a', 'b'], collectFailures: true,
    proveOwnership: async () => { throw new Error('ownership denied') },
    runSuite: async file => visited.push(file),
  }), /ownership denied/)
  assert.deepEqual(visited, [])
})
