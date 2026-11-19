'use strict'

const assert = require('node:assert/strict')
const { execFileSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const read = file => fs.readFileSync(path.join(root, file), 'utf8')

test('repository onboarding links to the working guides and existing commands', () => {
  assert.ok(fs.existsSync(path.join(root, 'README.md')), 'root onboarding README.md')
  const readme = read('README.md')
  for (const file of [
    'AGENTS.md', '.nvmrc', 'package.json', 'docs/project-working-guide.md',
    'docs/local-preview-acceptance.md', 'docs/verification-commands.md', 'docs/DEPLOY.md', 'docs/RELEASE.md',
  ]) {
    assert.ok(readme.includes(`(${file})`), `README.md must link to ${file}`)
    assert.ok(fs.existsSync(path.join(root, file)), `missing ${file}`)
  }
  const { scripts } = JSON.parse(read('package.json'))
  for (const [, command] of readme.matchAll(/npm run ([\w:-]+)/g)) {
    assert.ok(Object.hasOwn(scripts, command), `unknown README command: ${command}`)
  }
})

test('preview guide links to both archived GUI reports', () => {
  const guide = read('docs/local-preview-acceptance.md')
  for (const name of ['GUI-TEST-COVERAGE.md', 'GUI-TEST-ISSUES.md']) {
    const archive = `acceptance/2026-09-17-gui/${name}`
    assert.ok(guide.includes(`(${archive})`), `preview guide must link to ${archive}`)
    assert.ok(fs.existsSync(path.join(root, 'docs', archive)), `missing ${archive}`)
  }
})

test('worktree include patterns leave backend environment files out of the copy list', t => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-worktree-include-'))
  t.after(() => fs.rmSync(sandbox, { recursive: true, force: true }))
  execFileSync('git', ['init', '--quiet', '--template='], { cwd: sandbox })
  fs.writeFileSync(path.join(sandbox, '.gitignore'), read('.worktreeinclude'))
  const result = spawnSync('git', [
    '-c', `core.excludesFile=${path.join(sandbox, 'global-excludes')}`,
    'check-ignore', '--no-index', '--', 'backend/.env', 'backend/.env.local', 'backend/.env.production',
  ], { cwd: sandbox, encoding: 'utf8' })
  assert.ifError(result.error)
  assert.equal(result.status, 1, `worktree include matches an environment file or Git failed: ${result.stdout}${result.stderr}`)
})
