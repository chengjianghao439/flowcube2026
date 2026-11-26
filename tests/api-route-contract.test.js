#!/usr/bin/env node
'use strict'

/**
 * 前后端路由契约（纯静态，无需 DB）。
 *
 * 由来（2026-09-19 全仓契约巡检）：项目里已有 `pda-only-client-header` 守「PDA 路由必须带
 * X-Client」，但没有守卫检查**前端调的路径在后端是否真的存在**。这类不一致的失败方式是
 * 运行期 404：页面点下去才报错，构建、lint、类型检查全都不会红——重构改路由名漏改前端、
 * 或前端手滑写错一段路径，都能一路合到主干。
 *
 * 本测试把两侧对齐：
 *   · 后端：`app.use('/api/x', require('...routes'))` 的前缀 + 各 routes 文件里
 *     `router.<method>('<sub>')` 的子路径，拼成完整路径；
 *   · 前端：识别 `api/client` 的默认客户端和 `payloadClient` 导入及别名，再读取方法和路径；
 *     扫描所有前端页面、组件与 API 模块，包含桌面打印回执包装调用（baseURL 已含 `/api`）；
 *   · 比对前把 `${id}` 与 `:id` 统一成 `:p`，并剥离查询串——参数名与查询条件不算差异。
 *
 * 已知边界（要放宽时先看这里）：
 *   · 只识别**字符串字面量**路径；`client.get(someVariable)` 这类动态调用会被跳过（漏报，不误报）；
 *   · `sale-commercial.ts` 按动作分支生成的路径由该前端模块的运行用例校验具体方法和路径。
 *   · 后端识别字面路径及 `router.use('/prefix', 子路由)`，子路由由 `Router()` 或字面 `require` 提供。
 *
 * 运行：node tests/api-route-contract.test.js
 */

const assert = require('node:assert/strict')
const { backendRoutes, frontendCalls, bridge: DESKTOP_PRINT_BRIDGE } = require('./helpers/httpContracts')

function main() {
  const { routes, mounts } = backendRoutes()
  const { calls, files } = frontendCalls()

  assert.ok(mounts > 40, `只解析到 ${mounts} 个 /api 挂载，扫描逻辑可能失效`)
  assert.ok(routes.size > 300, `只解析到 ${routes.size} 条后端路由，扫描逻辑可能失效`)
  assert.ok(calls.length > 150, `只解析到 ${calls.length} 条前端调用，扫描逻辑可能失效`)
  for (const [file, expected] of [
    ['api/kits.ts', ['GET /api/kits', 'POST /api/kits', 'GET /api/kits/:p', 'PUT /api/kits/:p', 'DELETE /api/kits/:p']],
    ['api/sale-commercial.ts', ['POST /api/kits/preview', 'POST /api/sale/:p/commercial-preview']],
    [DESKTOP_PRINT_BRIDGE, ['POST /api/printers/client-heartbeat', 'POST /api/print-jobs/claim-client',
      'POST /api/print-jobs/:p/complete-client', 'POST /api/print-jobs/:p/fail-client']],
  ]) {
    const scanned = new Set(calls.filter((call) => call.file === file).map((call) => call.key))
    for (const key of expected) assert.ok(scanned.has(key), `${file} 未检出 ${key}，请核对调用或扫描逻辑`)
  }

  const problems = []
  for (const c of calls) {
    if (routes.has(c.key)) continue
    problems.push(
      `${c.file} 调用了后端未注册的接口：${c.raw}（结构化为 ${c.key}）——` +
        '运行期会 404。请核对路由名/方法，或若后端改用嵌套 router 则更新本守卫的展开逻辑',
    )
  }

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(
    `api-route-contract: 后端 ${mounts} 个挂载 / ${routes.size} 条路由、前端 ${files} 个文件 / ${calls.length} 条静态调用、失败 ${problems.length}`,
  )
  if (problems.length) process.exit(1)
  console.log('  [OK] 前端调用的每个接口后端都有对应注册')
}

main()
