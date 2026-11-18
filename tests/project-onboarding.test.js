'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')

const root = path.resolve(__dirname, '..')
const read = f => fs.readFileSync(path.join(root, f), 'utf8')

test('new-agent onboarding has one root and ships working pointers to rules and isolation', () => {
  assert.ok(fs.existsSync(path.join(root, 'README.md')), 'root onboarding file')
  const readme = read('README.md')
  for (const file of ['AGENTS.md', 'docs/project-working-guide.md', 'docs/verification-commands.md', 'docs/local-preview-acceptance.md']) {
    assert.ok(readme.includes(`(${file})`), file)
    assert.ok(fs.existsSync(path.join(root, file)), file)
  }
})

test('worktree provisioning never inherits a backend environment file', () => {
  const config = read('.worktreeinclude')
  assert.doesNotMatch(config, /^\s*[^#\n].*\.env(?:\s|$)/m)
})
