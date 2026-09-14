'use strict'
// PDA-only 契约回归：前端调用后端挂了 `pdaOnly` 守卫的接口时，必须带 `X-Client: pda`。
//
// 背景（2026-09-14 生产事故）：2026-08-09 给 `POST /api/inbound-tasks/:id/receive`
// 加上 `pdaOnly` 守卫后，PDA 收货接口一直 403「此操作仅允许 PDA 扫码完成」——
// 请求来自 PDA App（设备票据有效、pdaSession 已通过），但前端 `receiveInboundApi`
// 没有带 `X-Client: pda`，于是整条 PDA 收货链路从 8/9 起就不可用，且没有任何页面能提示。
//
// `X-Client` 是逐个接口手加的（见 frontend/src/api/client.ts 注释），漏一个就断一条链路，
// 因此用静态契约测试把「后端 pdaOnly 路由 ↔ 前端调用必须带头」钉死。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.resolve(__dirname, '..')
const appFile = path.join(root, 'backend/src/app.js')
const modulesDir = path.join(root, 'backend/src/modules')
const apiDir = path.join(root, 'frontend/src/api')

/** 跳过字符串 / 模板字符串（内容对括号配平不可见） */
function skipString(src, i) {
  const quote = src[i]
  i += 1
  while (i < src.length) {
    if (src[i] === '\\') { i += 2; continue }
    if (src[i] === quote) return i + 1
    i += 1
  }
  return i
}

/** 从 openIdx 处的 `(` 找到配对的 `)` */
function findClose(src, openIdx) {
  let depth = 0
  let i = openIdx
  while (i < src.length) {
    const ch = src[i]
    if (ch === "'" || ch === '"' || ch === '`') { i = skipString(src, i); continue }
    if (ch === '/' && src[i + 1] === '/') {
      const nl = src.indexOf('\n', i)
      i = nl < 0 ? src.length : nl
      continue
    }
    if (ch === '(') depth += 1
    else if (ch === ')') { depth -= 1; if (depth === 0) return i }
    i += 1
  }
  return -1
}

/** 收集所有 `router.<method>('<path>', ...)` 调用块 */
function extractRouteBlocks(src) {
  const out = []
  const re = /router\.(get|post|put|patch|delete)\(\s*'([^']+)'/g
  let m
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index)
    const close = findClose(src, open)
    if (close < 0) continue
    out.push({ method: m[1], routePath: m[2], text: src.slice(m.index, close + 1) })
    re.lastIndex = close
  }
  return out
}

/** 收集所有 `client.<method>('<url>', ...)` 调用块 */
function extractClientCalls(src) {
  const out = []
  const re = /client\.(get|post|put|patch|delete)(?:<[^>]*>)?\(\s*(?:'([^']*)'|"([^"]*)"|`([^`]*)`)/g
  let m
  while ((m = re.exec(src))) {
    const open = src.indexOf('(', m.index)
    const close = findClose(src, open)
    if (close < 0) continue
    out.push({
      method: m[1],
      url: m[2] ?? m[3] ?? m[4] ?? '',
      text: src.slice(m.index, close + 1),
    })
    re.lastIndex = close
  }
  return out
}

/** app.js 里 `app.use('/api/xxx', require('./modules/xxx/xxx.routes'))` → 挂载前缀 */
function routeMounts() {
  const src = fs.readFileSync(appFile, 'utf8')
  const map = new Map()
  const re = /app\.use\(\s*'([^']+)'\s*,\s*require\(\s*'\.\/modules\/([^/']+)\//g
  let m
  while ((m = re.exec(src))) map.set(m[2], m[1])
  return map
}

/** `${id}` / `:id` 统一成 `:param`，并去掉查询串 */
function normalize(urlPath) {
  return urlPath
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, ':param')
    .replace(/:[A-Za-z_][A-Za-z0-9_]*/g, ':param')
    .replace(/\/+$/, '')
}

function collectPdaOnlyRoutes() {
  const mounts = routeMounts()
  const routes = []
  for (const [name, mount] of mounts) {
    const file = path.join(modulesDir, name, `${name}.routes.js`)
    if (!fs.existsSync(file)) continue
    for (const block of extractRouteBlocks(fs.readFileSync(file, 'utf8'))) {
      if (!/\bpdaOnly\b/.test(block.text)) continue
      routes.push({
        method: block.method.toUpperCase(),
        routePath: normalize(mount.replace(/^\/api/, '') + block.routePath),
        source: `${name}.routes.js`,
      })
    }
  }
  return routes
}

function collectClientCalls() {
  const calls = []
  for (const file of fs.readdirSync(apiDir).filter((f) => f.endsWith('.ts'))) {
    const src = fs.readFileSync(path.join(apiDir, file), 'utf8')
    for (const call of extractClientCalls(src)) calls.push({ ...call, file })
  }
  return calls
}

const pdaOnlyRoutes = collectPdaOnlyRoutes()
const clientCalls = collectClientCalls()

function matchingCalls(route) {
  return clientCalls.filter(
    (call) => call.method.toUpperCase() === route.method && normalize(call.url) === route.routePath,
  )
}

test('能识别出后端 pdaOnly 路由与前端调用（防止测试空转）', () => {
  assert.ok(pdaOnlyRoutes.length >= 15, `pdaOnly 路由数量异常：${pdaOnlyRoutes.length}`)
  const receive = pdaOnlyRoutes.find((r) => r.routePath === '/inbound-tasks/:param/receive')
  assert.ok(receive, '应识别到收货路由')
  assert.ok(matchingCalls(receive).length > 0, '应能找到前端收货调用')
})

test('每个 pdaOnly 路由的前端调用都带 X-Client: pda', () => {
  const offenders = []
  for (const route of pdaOnlyRoutes) {
    for (const call of matchingCalls(route)) {
      if (!/['"]X-Client['"]\s*:\s*['"]pda['"]/.test(call.text)) {
        offenders.push(`${route.method} ${route.routePath} ← ${call.file}`)
      }
    }
  }
  assert.deepEqual(offenders, [], `这些 PDA-only 调用缺少 X-Client: pda 头：\n${offenders.join('\n')}`)
})

test('PDA 收货接口明确带 X-Client: pda（2026-08-09 起被漏掉，整条链路口拦死）', () => {
  const src = fs.readFileSync(path.join(apiDir, 'inbound-tasks.ts'), 'utf8')
  const calls = extractClientCalls(src).filter((c) => normalize(c.url) === '/inbound-tasks/:param/receive')
  assert.equal(calls.length, 1, '应恰好找到一处收货调用')
  assert.match(calls[0].text, /['"]X-Client['"]\s*:\s*['"]pda['"]/)
})
