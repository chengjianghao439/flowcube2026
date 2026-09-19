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
 *   · 前端：`client.<method>('<path>')` / `` client.<method>(`<path>`) ``（baseURL 已含 `/api`）；
 *   · 比对前把 `${id}` 与 `:id` 统一成 `:p`，并剥离查询串——参数名与查询条件不算差异。
 *
 * 已知边界（要放宽时先看这里）：
 *   · 只识别**字符串字面量**路径；`client.get(someVariable)` 这类动态调用会被跳过（漏报，不误报）；
 *   · 只识别 `router.get/post/put/patch/delete` 的平铺注册。若后端新增了嵌套
 *     `router.use('/:id/sub', subRouter)`，本测试可能误报——那种情况请在此补上嵌套展开，而不是删断言。
 *
 * 运行：node tests/api-route-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const APP_JS = path.join(ROOT, 'backend/src/app.js')
const API_DIR = path.join(ROOT, 'frontend/src/api')

/** 路径归一化：剥离查询串 → 模板参数/Express 参数统一为 `:p` → 去掉尾部斜杠。 */
function normalize(p) {
  const bare = p.split('?')[0].replace(/\/+$/, '')
  return (bare.replace(/\$\{[^}]*\}/g, ':p').replace(/:[A-Za-z0-9_]+/g, ':p') || '/')
}

/** 后端：挂载前缀 + 各 routes 文件的平铺路由。 */
function backendRoutes() {
  const appSrc = fs.readFileSync(APP_JS, 'utf8')
  const routes = new Map()
  let mounts = 0
  for (const m of appSrc.matchAll(/app\.use\('(\/api[^']*)',\s*require\('([^']+)'\)\)/g)) {
    const [, prefix, mod] = m
    const file = path.resolve(path.dirname(APP_JS), mod + '.js')
    if (!fs.existsSync(file)) continue
    mounts++
    const src = fs.readFileSync(file, 'utf8')
    for (const r of src.matchAll(/router\.(get|post|put|patch|delete)\(\s*'([^']*)'/g)) {
      routes.set(`${r[1].toUpperCase()} ${normalize(prefix + r[2])}`, path.basename(file))
    }
  }
  return { routes, mounts }
}

/** 前端：client.<method>('<path>')，baseURL 已含 /api，这里补回前缀。 */
function frontendCalls() {
  const calls = []
  const files = fs
    .readdirSync(API_DIR)
    .filter((f) => f.endsWith('.ts') && !/\.test\.ts$/.test(f))
  for (const f of files) {
    const src = fs.readFileSync(path.join(API_DIR, f), 'utf8')
    // 注意：泛型参数里会嵌套 `>`（如 `Record<string, number>`），用 `<[^>]*>` 会在第一个 `>` 截断、
    // 整条调用被静默跳过——2026-09-19 反向验证发现该假阴性（改错路径居然不报错）。
    // 改为「方法名之后、第一个 `(` 之前的任意内容」，泛型里有括号的写法才会漏（见文件头边界）。
    for (const m of src.matchAll(/client\.(get|post|put|patch|delete)\b[^(]{0,200}?\(\s*([`'"])([^`'"]*)\2/g)) {
      const p = m[3]
      if (!p.startsWith('/')) continue // 动态拼接的路径不在此列（见文件头「已知边界」）
      calls.push({ key: `${m[1].toUpperCase()} ${normalize('/api' + p)}`, raw: `${m[1].toUpperCase()} ${p}`, file: f })
    }
  }
  return { calls, files: files.length }
}

function main() {
  const { routes, mounts } = backendRoutes()
  const { calls, files } = frontendCalls()

  assert.ok(mounts > 40, `只解析到 ${mounts} 个 /api 挂载，扫描逻辑可能失效`)
  assert.ok(routes.size > 300, `只解析到 ${routes.size} 条后端路由，扫描逻辑可能失效`)
  assert.ok(calls.length > 150, `只解析到 ${calls.length} 条前端调用，扫描逻辑可能失效`)

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
