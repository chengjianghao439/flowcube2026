'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const root = path.join(__dirname, '..')
const manifest = require('../package.json')
const range = '^22.12.0'

test('项目 npm 包及锁文件声明同一 Node 版本范围', () => {
  for (const dir of ['.', 'backend', 'frontend', 'desktop', 'agent', 'scripts/browser-smoke']) {
    const pkg = require(path.join(root, dir, 'package.json'))
    assert.equal(pkg.engines?.node, range, dir)
    const lock = path.join(root, dir, 'package-lock.json')
    if (fs.existsSync(lock)) assert.equal(require(lock).packages[''].engines?.node, range, lock)
  }
  assert.equal(fs.readFileSync(path.join(root, '.nvmrc'), 'utf8').trim(), '22')
})

test('开发与 CI 运行同一个 Node 预检，接受 22.12 及之后的 22.x', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/check-node-version.cjs'), 'utf8')
  for (const [node, exitCode] of [
    ['22.12.0', undefined], ['22.12.1', undefined], ['22.23.2', undefined],
    ['20.19.0', 1], ['22.11.9', 1], ['23.0.0', 1], ['26.0.0', 1],
  ]) {
    const process = { versions: { node } }
    vm.runInNewContext(source, {
      require: specifier => {
        assert.equal(specifier, '../package.json')
        return manifest
      },
      process,
      console: { error: () => {} },
    })
    assert.equal(process.exitCode, exitCode, node)
  }

  for (const script of ['with-dev-env.sh', 'setup-worktree.sh']) {
    assert.match(fs.readFileSync(path.join(root, 'scripts', script), 'utf8'), /node .*check-node-version\.cjs/)
  }
  const workflow = fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8')
  assert.match(workflow, /node-version-file:\s*['"]?\.nvmrc/)
  assert.match(workflow, /npm run test:node-version/)
})
