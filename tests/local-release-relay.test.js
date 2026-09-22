'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { spawnSync } = require('node:child_process')
const path = require('node:path')
test('本地中转：来源绑定、短签名刷新、并发分片、摘要与 ZIP 边界', () => {
  const result = spawnSync('python3', ['tests/local_release_relay_test.py'], {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', timeout: 30000,
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
})
