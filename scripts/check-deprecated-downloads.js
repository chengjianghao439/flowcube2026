#!/usr/bin/env node

const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const repoRoot = path.resolve(__dirname, '..')
const allowed = new Set(['backend/downloads/README.md', 'backend/downloads/.gitignore'])

function git(args) {
  return execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

const tracked = git(['ls-files', 'backend/downloads'])
  .split(/\r?\n/)
  .filter(Boolean)

const stagedOrModified = git(['status', '--porcelain', '--', 'backend/downloads'])
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.slice(3))

const violations = [...new Set([...tracked, ...stagedOrModified])]
  .filter((file) => fs.existsSync(path.join(repoRoot, file)))
  .filter((file) => !allowed.has(file))

if (violations.length > 0) {
  console.error('[deprecated-downloads] backend/downloads 已废弃，禁止继续提交或修改发布文件。')
  console.error('[deprecated-downloads] 请改用 /var/www/flowcube-downloads，并通过 scripts/release-desktop.js 发布。')
  for (const file of violations) {
    console.error(` - ${file}`)
  }
  process.exit(1)
}

console.log('[deprecated-downloads] OK: backend/downloads only contains the deprecation marker.')
