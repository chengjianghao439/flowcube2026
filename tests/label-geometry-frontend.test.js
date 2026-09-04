#!/usr/bin/env node
'use strict'

/**
 * 跨端一致性测试：前端镜像 frontend/src/lib/labelGeometry.ts 必须与后端产出完全一致。
 * 用前端已安装的 TypeScript 编译并加载 .ts，Node 22 也实际执行所有 fixture。
 *   node tests/label-geometry-frontend.test.js
 *
 * fixture 由 tests/label-geometry.test.js（后端）以 UPDATE=1 生成，是「单一事实源」。
 */

const path = require('path')
const fs = require('fs')
const assert = require('assert')
const Module = require('node:module')
const ts = require('../frontend/node_modules/typescript')

const FIXTURE = path.resolve(__dirname, 'fixtures/label-geometry-cases.json')
const FRONTEND = path.resolve(__dirname, '../frontend/src/lib/labelGeometry.ts')

;(async () => {
  let mod
  try {
    const compiled = ts.transpileModule(fs.readFileSync(FRONTEND, 'utf8'), {
      fileName: FRONTEND,
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      reportDiagnostics: true,
    })
    if (compiled.diagnostics?.some(d => d.category === ts.DiagnosticCategory.Error)) throw new Error('TypeScript 编译失败')
    const loaded = new Module(FRONTEND, module)
    loaded.filename = FRONTEND
    loaded.paths = Module._nodeModulePaths(path.dirname(FRONTEND))
    loaded._compile(compiled.outputText, FRONTEND)
    mod = loaded.exports
  } catch (e) {
    console.error('无法加载前端 .ts 镜像：', e.message)
    process.exit(1)
  }
  const { resolveLayout } = mod
  const saved = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))

  console.log('前端镜像 ↔ 后端快照一致性：')
  let failures = 0
  for (const c of saved) {
    try {
      const got = resolveLayout(c.input.layout, c.input.data, c.input.paperSize)
      assert.deepStrictEqual(got, c.expected)
      console.log(`  ✓ ${c.name}`)
    } catch (e) {
      failures += 1
      console.log(`  ✗ ${c.name}\n      ${e.message}`)
    }
  }
  if (failures > 0) {
    console.error(`\n前端镜像与后端快照不一致：${failures} 例`)
    process.exit(1)
  }
  console.log(`\n两端一致（${saved.length} 例）`)
})()
