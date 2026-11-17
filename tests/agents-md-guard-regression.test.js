'use strict'

const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const instructions = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8')
const projectBudget = 32 * 1024

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-agents-guard-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  function write(name, content) {
    const target = path.join(dir, name)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, content)
  }

  execFileSync('git', ['init', '--quiet'], { cwd: dir })
  write('AGENTS.md', instructions)
  write('package.json', fs.readFileSync(path.join(root, 'package.json')))
  write('tests/agents-md-injection-guard.test.js',
    fs.readFileSync(path.join(root, 'tests/agents-md-injection-guard.test.js')))
  write('docs/agents-md-archive-2026-09-18.md', '历史说明')
  for (const [, ref] of instructions.matchAll(/(?:^|[\s`(])(docs\/[A-Za-z0-9._/-]+\.md)/g)) {
    write(ref, '主题说明')
  }
  write('docs/verification-commands.md', '# 验证\n\n## 仓库守卫索引\n\n- `npm run test:agents-md-guard`\n')
  write('docs/project-working-guide.md', '# 工作指南\n\n[根规则](../AGENTS.md)\n')
  write('backend/src/example.js', '')
  write('frontend/src/example.ts', '')

  function run() {
    const result = spawnSync(process.execPath, ['tests/agents-md-injection-guard.test.js'], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
    })
    assert.ifError(result.error)
    return { status: result.status, output: result.stdout + result.stderr }
  }
  const baseline = run()
  assert.equal(baseline.status, 0, baseline.output)
  return { run, write }
}

test('拒绝覆盖根规则的 AGENTS.override.md', t => {
  const { run, write } = fixture(t)
  write('AGENTS.override.md', '# 临时替代规则\n')
  const { status, output } = run()
  assert.equal(status, 1, output)
  assert.match(output, /AGENTS\.override\.md/)
})

test('仓库源码目录内被 Git 忽略的覆盖文件也会被拒绝', t => {
  const { run, write } = fixture(t)
  write('.gitignore', 'AGENTS.override.md\nnode_modules/\n')
  write('node_modules/example/AGENTS.override.md', '# 第三方文件\n')
  const baseline = run()
  assert.equal(baseline.status, 0, baseline.output)
  write('backend/src/AGENTS.override.md', '# 临时替代规则\n')
  const { status, output } = run()
  assert.equal(status, 1, output)
  assert.match(output, /backend\/src\/AGENTS\.override\.md/)
})

test('检查根规则与同一路径下级规则的累计大小，兄弟目录分别计量', t => {
  const { run, write } = fixture(t)
  const remaining = projectBudget - Buffer.byteLength(instructions)
  assert.ok(remaining > 100)
  const nested = 'a'.repeat(Math.floor(remaining * 0.65))
  write('backend/AGENTS.md', nested)
  write('frontend/AGENTS.md', nested)
  const baseline = run()
  assert.equal(baseline.status, 0, baseline.output)
  write('backend/src/AGENTS.md', nested)
  const { status, output } = run()
  assert.equal(status, 1, output)
  assert.match(output, /backend\/src\/AGENTS\.md.*32 KiB/)
})

test('检查迁出的现行守卫命令，跳过其他章节的历史命令', t => {
  const { run, write } = fixture(t)
  const good = '# 验证\n\n## 仓库守卫索引\n\n- `npm run test:agents-md-guard`\n'
  const history = '\n## 历史\n\n- `npm run test:retired`\n'
  write('docs/verification-commands.md', good + history)
  const baseline = run()
  assert.equal(baseline.status, 0, baseline.output)
  write('docs/verification-commands.md', good.replace('test:agents-md-guard', 'test:missing') + history)
  const { status, output } = run()
  assert.equal(status, 1, output)
  assert.match(output, /docs\/verification-commands\.md.*npm run test:missing/)
})

test('共享交接指南的相对链接必须能在仓库内读到', t => {
  const { run, write } = fixture(t)
  write('docs/project-working-guide.md', '# 工作指南\n\n[本机历史](local-only.md)\n')
  const { status, output } = run()
  assert.equal(status, 1, output)
  assert.match(output, /docs\/project-working-guide\.md.*local-only\.md/)
})
