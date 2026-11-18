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
 *     除 API 目录外，扫描桌面打印桥和其 POST 回执包装调用（baseURL 已含 `/api`）；
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
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP_JS = path.join(ROOT, 'backend/src/app.js')
const FRONTEND_SRC = path.join(ROOT, 'frontend/src')
const DESKTOP_PRINT_BRIDGE = 'components/desktop/DesktopPrintClientBridge.tsx'

/** 路径归一化：剥离查询串 → 模板参数/Express 参数统一为 `:p` → 去掉尾部斜杠。 */
function normalize(p) {
  const bare = p.split('?')[0].replace(/\/+$/, '')
  return (bare.replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z0-9_]+/g, ':p') || '/')
}

function collectRouterRoutes(file, prefix, routes) {
  const src = fs.readFileSync(file, 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const localRouters = new Set(Array.from(src.matchAll(/\bconst\s+(\w+)\s*=\s*Router\(/g), (match) => match[1]))
  const calls = [...src.matchAll(/\b(\w+)\.(get|post|put|patch|delete|use)\(\s*(['"])([^'"]*)\3/g)]
  function visit(router, base) {
    for (const call of calls) {
      const [, receiver, method, , route] = call
      if (receiver !== router) continue
      const fullPath = base + route
      if (method !== 'use') {
        routes.set(`${method.toUpperCase()} ${normalize(fullPath)}`, path.basename(file))
        continue
      }
      const args = src.slice(call.index + call[0].length)
      const child = args.match(/^\s*,\s*(\w+)\s*\)/)?.[1]
      const modulePath = args.match(/^\s*,\s*require\(\s*(['"])([^'"]+)\1\s*\)\s*\)/)?.[2]
      if (localRouters.has(child)) visit(child, fullPath)
      if (modulePath) collectRouterRoutes(path.resolve(path.dirname(file), modulePath + '.js'), fullPath, routes)
    }
  }
  visit('router', prefix)
}

/** 后端：应用挂载前缀及对应的 Express 路由。 */
function backendRoutes() {
  const appSrc = fs.readFileSync(APP_JS, 'utf8').replace(/^\s*\/\/.*$/gm, '')
  const routes = new Map()
  let mounts = 0
  for (const m of appSrc.matchAll(/app\.use\('(\/api[^']*)',\s*require\('([^']+)'\)\)/g)) {
    const [, prefix, mod] = m
    const file = path.resolve(path.dirname(APP_JS), mod + '.js')
    if (!fs.existsSync(file)) continue
    mounts++
    collectRouterRoutes(file, prefix, routes)
  }
  return { routes, mounts }
}

function importedClients(src) {
  const clients = new Set()
  const imports = /\bimport\s+(?!type\s)(?:([\w$]+)\s*,?\s*)?(?:\{([^}]+)\}\s*)?from\s*(['"])(?:\.\/client|@\/api\/client)\3/g
  for (const [, defaultClient, names] of src.matchAll(imports)) {
    if (defaultClient) clients.add(defaultClient)
    const payload = names?.match(/(?:^|,)\s*payloadClient(?:\s+as\s+([\w$]+))?\s*(?=,|$)/)
    if (payload) clients.add(payload[1] ?? 'payloadClient')
  }
  return clients
}

function callsInSource(file, source) {
  const src = source.replace(/^\s*\/\/.*$/gm, '')
  const calls = []
  function add(method, route) {
    if (!route.startsWith('/')) return
    // 动作名不是资源 ID。商品销售模块的运行用例检查每个具体动作的组合。
    if (file === 'api/sale-commercial.ts' && route.includes('${op.action}')) return
    calls.push({ key: `${method} ${normalize('/api' + route)}`, raw: `${method} ${route}`, file })
  }
  for (const client of importedClients(src)) {
    const receiver = client.replace(/\$/g, '\\$')
    // 泛型允许嵌套 >，不能以第一个 > 当作参数结束。
    const pattern = new RegExp(`(?<![\\w$.])${receiver}\\s*\\.\\s*(get|post|put|patch|delete)\\b[^(]{0,200}?\\(\\s*([\x60'"])([^\x60'"]*)\\2`, 'g')
    for (const [, method, , route] of src.matchAll(pattern)) add(method.toUpperCase(), route)
  }
  if (file === DESKTOP_PRINT_BRIDGE) {
    for (const [, , route] of src.matchAll(/\breportPrintOutcomeWithRetry\(\s*([`'"])([^`'"]*)\1/g)) add('POST', route)
  }
  return calls
}

/** 前端：读实际导入的接口客户端，baseURL 已含 /api，这里补回前缀。 */
function frontendCalls() {
  const files = fs.readdirSync(path.join(FRONTEND_SRC, 'api'))
    .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
    .map((file) => `api/${file}`)
  files.push(DESKTOP_PRINT_BRIDGE)
  const calls = files.flatMap((file) => callsInSource(file, fs.readFileSync(path.join(FRONTEND_SRC, file), 'utf8')))
  return { calls, files: files.length }
}

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
