#!/usr/bin/env node
'use strict'

/**
 * 官网版本摘要守卫（用前端已安装的 TypeScript 编译真实模块，不连数据库）。
 *
 * 背景（2026-09-18 检查发版流程时发现）：`frontend/src/pages/landing/updates.ts`
 * 的文件头自己写着「按发布顺序从新到旧维护」「发布时按 release-flowcube 流程同步此列表」，
 * 但**技能与 docs/RELEASE.md 都没有这一步**——于是从 0.9.16 起连续 7 个版本都没同步，
 * 官网「版本更新」区展示的是 0.9.15 / 0.9.14 / 0.9.13，而线上早已是 0.9.22。
 *
 * 这类「文件里写了该做，但流程里没写」的约定必然腐烂，所以把它变成机械门禁：
 *   1. 列表**必须包含 `desktop/package.json` 的当前版本**——发版时 bump 完却没同步
 *      官网摘要，测试立刻失败，而不是等用户在官网上看到半年前的内容；
 *   2. 版本严格从新到旧、不重复（文件头声明的维护顺序）；
 *   3. 每条字段完整（标题/分类/描述非空，details 是非空字符串数组），
 *      避免同步时只填个版本号占位。
 *
 * 运行：node tests/landing-updates-guard.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const Module = require('node:module')
const ts = require('../frontend/node_modules/typescript')

const ROOT = path.resolve(__dirname, '..')
const SOURCE = path.join(ROOT, 'frontend/src/pages/landing/updates.ts')

function loadUpdates() {
  const compiled = ts.transpileModule(fs.readFileSync(SOURCE, 'utf8'), {
    fileName: SOURCE,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true,
  })
  const errors = (compiled.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error)
  assert.equal(errors.length, 0, `updates.ts 编译失败：${errors.map((e) => e.messageText).join('; ')}`)
  const loaded = new Module(SOURCE, module)
  loaded.filename = SOURCE
  loaded.paths = Module._nodeModulePaths(path.dirname(SOURCE))
  loaded._compile(compiled.outputText, SOURCE)
  return loaded.exports.landingUpdates
}

/** semver 比较：仅用于「从新到旧」的顺序断言，不支持预发布号。 */
function compareSemver(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

function main() {
  const updates = loadUpdates()
  const problems = []

  assert.ok(Array.isArray(updates) && updates.length > 0, 'landingUpdates 不是非空数组')

  const desktopVersion = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'desktop/package.json'), 'utf8'),
  ).version

  // ── 1. 必须覆盖当前发版版本（防「bump 了却没同步官网」） ────────────────────
  const versions = updates.map((u) => u.version)
  if (!versions.includes(desktopVersion)) {
    problems.push(
      `landingUpdates 里没有 desktop/package.json 的版本 ${desktopVersion}：` +
        '发版 bump 版本号后必须同步官网摘要（文档头声明的流程此前从 0.9.16 起连漏 7 版）',
    )
  }

  // ── 2. 版本唯一且严格从新到旧 ──────────────────────────────────────────────
  const seen = new Set()
  for (const v of versions) {
    if (seen.has(v)) problems.push(`landingUpdates 版本重复：${v}`)
    seen.add(v)
    if (!/^\d+\.\d+\.\d+$/.test(v)) problems.push(`版本号不是 x.y.z 形式：${v}`)
  }
  for (let i = 1; i < versions.length; i++) {
    if (compareSemver(versions[i - 1], versions[i]) <= 0) {
      problems.push(`版本未按从新到旧排列：${versions[i - 1]} 之后是 ${versions[i]}`)
    }
  }

  // ── 3. 每条字段完整（禁止只填版本号占位） ──────────────────────────────────
  for (const u of updates) {
    const label = `v${u.version}`
    for (const field of ['category', 'title', 'description']) {
      if (typeof u[field] !== 'string' || !u[field].trim()) {
        problems.push(`${label} 的 ${field} 为空`)
      }
    }
    if (!Array.isArray(u.details) || u.details.length === 0) {
      problems.push(`${label} 缺少 details 明细`)
    } else if (u.details.some((d) => typeof d !== 'string' || !d.trim())) {
      problems.push(`${label} 的 details 含空项`)
    }
  }

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(
    `landing-updates-guard: 共 ${updates.length} 条，最新 v${versions[0]}、` +
      `desktop ${desktopVersion}、失败 ${problems.length}`,
  )
  if (problems.length) process.exit(1)
  console.log('  [OK] 官网版本摘要与发版版本一致')
}

main()
