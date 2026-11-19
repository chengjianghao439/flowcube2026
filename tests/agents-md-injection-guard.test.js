#!/usr/bin/env node
'use strict'

/**
 * 检查 Git 工作区的项目级规则。Codex 默认沿项目根到工作目录读取规则，
 * 同目录优先使用 AGENTS.override.md。仓库使用 AGENTS.md 叠加规则，
 * 保留一个 32 KiB 的项目规则链预算，个人 Codex 配置由个人管理。
 *
 * 反向验证见 agents-md-guard-regression.test.js。
 */

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PROJECT_BUDGET_BYTES = 32 * 1024
const ARCHIVE = 'docs/agents-md-archive-2026-09-18.md'
const WORK_GUIDE = 'docs/project-working-guide.md'
const VERIFY_GUIDE = 'docs/verification-commands.md'
const REQUIRED_SECTIONS = [
  '## 0. 元规则',
  '## 0.1 红线',
  '## 0.2 有守卫的规则',
  '## 1. 协作与操作边界',
  '## 2. 项目、目录与本地环境',
  '## 3. 验证速查',
  '## 4. 主题文档索引',
  '## 5. 历史、审计与发布结果索引',
]
const REQUIRED_RED_LINES = [
  'inventory_containers.remaining_qty',
  'syncStockFromContainers',
  'lockStockDimension',
  'X-Request-Key',
  '北京时间',
  'RESERVE_WAREHOUSE_CHANGE_NOT_ALLOWED',
  'EXPORT_MAX_ROWS',
  'active_unique_guard',
  'ControlMaster',
]

// 只遍历 Git 项目文件所在目录及其父级。直接检查这些目录的规则文件，
// 因此被忽略的本机 override 仍会被发现，第三方依赖和构建产物不会被扫入。
function projectDirectories() {
  const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
  })
  const directories = new Set(['.'])
  for (const file of files.split('\0').filter(Boolean)) {
    const parts = file.split('/').slice(0, -1)
    let parent = '.'
    for (const part of parts) {
      parent = path.posix.join(parent, part)
      directories.add(parent)
    }
  }
  return directories
}

function checkInstructionChains(directories, problems) {
  const cumulative = new Map()
  for (const dir of directories) {
    for (const name of ['AGENTS.override.md', 'CLAUDE.md']) {
      const candidate = path.posix.join(dir, name)
      if (fs.existsSync(path.join(ROOT, candidate))) {
        problems.push(`项目目录存在 ${candidate}，请合并到适用的 AGENTS.md 或归档`)
      }
    }
    const candidate = path.posix.join(dir, 'AGENTS.md')
    const stat = fs.statSync(path.join(ROOT, candidate), { throwIfNoEntry: false })
    const ownBytes = stat?.isFile() ? stat.size : 0
    const inheritedBytes = dir === '.' ? 0 : cumulative.get(path.posix.dirname(dir))
    const total = inheritedBytes + ownBytes
    cumulative.set(dir, total)
    if (ownBytes && total > PROJECT_BUDGET_BYTES) {
      problems.push(`${candidate} 所在项目规则链已达 ${total} 字节，超过 32 KiB（${PROJECT_BUDGET_BYTES} 字节）`)
    }
  }
}

function checkGuideLinks(problems) {
  const guide = path.join(ROOT, WORK_GUIDE)
  if (!fs.existsSync(guide)) return
  const text = fs.readFileSync(guide, 'utf8')
  for (const [, target] of text.matchAll(/\]\(([^#)\s]+)(?:#[^)\s]+)?\)/g)) {
    if (/^https?:\/\//i.test(target)) continue
    const resolved = path.resolve(path.dirname(guide), target)
    const relative = path.relative(ROOT, resolved)
    if (path.isAbsolute(target) || relative === '..' || relative.startsWith('..' + path.sep) ||
        !fs.existsSync(resolved)) {
      problems.push(`${WORK_GUIDE} 的链接在仓库内不可用：${target}`)
    }
  }
}

function readGuardIndex(problems) {
  const file = path.join(ROOT, VERIFY_GUIDE)
  if (!fs.existsSync(file)) return ''
  const index = fs.readFileSync(file, 'utf8')
    .split(/^## /m)
    .find(section => section.split(/\r?\n/, 1)[0].trim() === '仓库守卫索引')
  if (!index) problems.push(`${VERIFY_GUIDE} 缺少「仓库守卫索引」`)
  return index || ''
}

function main() {
  const problems = []
  const text = fs.readFileSync(path.join(ROOT, 'AGENTS.md'), 'utf8')
  for (const required of [...REQUIRED_SECTIONS, ...REQUIRED_RED_LINES]) {
    if (!text.includes(required)) problems.push(`AGENTS.md 缺少必备内容：${required}`)
  }

  const directories = projectDirectories()
  checkInstructionChains(directories, problems)

  const refs = new Set()
  for (const match of text.matchAll(/(?:^|[\s`(])(docs\/[A-Za-z0-9._/-]+\.md)/g)) refs.add(match[1])
  for (const doc of [WORK_GUIDE, VERIFY_GUIDE]) {
    if (!refs.has(doc)) problems.push(`AGENTS.md 缺少工作入口：${doc}`)
  }
  for (const doc of new Set([ARCHIVE, ...refs])) {
    if (!fs.existsSync(path.join(ROOT, doc))) problems.push(`AGENTS.md 引用的文档不存在：${doc}`)
  }
  checkGuideLinks(problems)

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))
  const scripts = new Set(Object.keys(pkg.scripts || {}))
  const runRefs = new Set()
  for (const [source, content] of [['AGENTS.md', text], [VERIFY_GUIDE, readGuardIndex(problems)]]) {
    for (const [, script] of content.matchAll(/npm run ([A-Za-z0-9:_-]+)/g)) {
      runRefs.add(script)
      if (!scripts.has(script)) problems.push(`${source} 引用了不存在的 npm 脚本：npm run ${script}`)
    }
  }

  for (const problem of problems) console.log(`  [FAIL] ${problem}`)
  console.log(
    `agents-md-injection-guard: 项目目录 ${directories.size} 个、docs 引用 ${refs.size} 个、` +
      `npm 脚本引用 ${runRefs.size} 个、根规则 ${Buffer.byteLength(text, 'utf8')} 字节、失败 ${problems.length}`,
  )
  if (problems.length) {
    process.exitCode = 1
  } else {
    console.log('  [OK] AGENTS.md 注入守卫通过')
  }
}

main()
