#!/usr/bin/env node
'use strict'

/**
 * 跨端一致性测试：前端镜像 frontend/src/lib/labelGeometry.ts 必须与后端产出完全一致。
 * 用 Node 类型剥离（Node 23.6+）直接 import .ts，跑同一份快照 fixture 对比 expected。
 *   node tests/label-geometry-frontend.test.js
 *
 * fixture 由 tests/label-geometry.test.js（后端）以 UPDATE=1 生成，是「单一事实源」。
 */

const path = require('path')
const fs = require('fs')
const assert = require('assert')
const { pathToFileURL } = require('url')

const FIXTURE = path.resolve(__dirname, 'fixtures/label-geometry-cases.json')
const FRONTEND = pathToFileURL(path.resolve(__dirname, '../frontend/src/lib/labelGeometry.ts')).href

;(async () => {
  // Node 23.6+ 才默认支持 .ts 类型剥离；旧版（如 CI 的 node 20）跳过，本机用新版真验证。
  const [maj, min] = process.versions.node.split('.').map(Number)
  const supportsStrip = maj > 23 || (maj === 23 && min >= 6)
  if (!supportsStrip) {
    console.log(`  ⓘ 跳过：当前 Node ${process.versions.node} 不支持 .ts 类型剥离（需 23.6+）。请用 node ≥23.6 在本机验证前端镜像一致性。`)
    process.exit(0)
  }
  let mod
  try {
    mod = await import(FRONTEND)
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
