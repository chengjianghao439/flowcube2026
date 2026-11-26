#!/usr/bin/env node
'use strict'

/**
 * 路由鉴权契约测试（机械核对，无需 DB）。
 *
 * 背景（2026-09-18 多维度审计）：审计发现多起「同一守卫在某个新增入口漏掉」的问题
 * （库存容器写接口缺仓库范围、scan-logs 写路径缺范围、resync-stock 错挂只读权限……）。
 * 逐轮人工审计会一直漏，因此把**可机械判定**的那一半做成 CI 契约：
 *
 *   **所有写路由（POST/PUT/PATCH/DELETE）必须挂 requirePermission**，除非落在下面显式
 *   声明的例外清单里；每个例外都必须写明理由，且可以用 serviceFile 附加
 *   「该替代守卫确实存在」的校验——豁免不能只靠一句话，否则会悄悄腐烂。
 *
 * 只做「有没有」的机械判定，不试图判断权限码选得对不对——后者需要业务语义，
 * 仍由人工审计与该模块的 smoke 测试负责。宁可判定得窄而准，不要造一个会误报的规则。
 *
 * 运行：node tests/route-permission-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const MODULES_DIR = path.join(ROOT, 'backend/src/modules')

/**
 * 显式例外：允许写路由不挂 requirePermission 中间件的路由文件。
 * - reason：为什么它不需要 requirePermission
 * - serviceFile：可选的「替代守卫存在性」断言，防止豁免腐烂
 */
const ALLOWED_WITHOUT_PERMISSION = {
  'auth.routes.js': {
    routes: ['POST /login', 'POST /refresh', 'POST /logout', 'PUT /change-password', 'PUT /profile'],
    reason: '登录/刷新/登出按设计公开；改密码与改资料是登录者对自己的自助操作，仅需 authMiddleware',
  },
  'app-update.routes.js': {
    routes: [],
    reason: '桌面/PDA 自动更新清单按设计完全公开（不返回任何业务数据），该文件整体不挂 authMiddleware',
  },
  'pda.routes.js': {
    routes: ['POST /sessions', 'POST /sessions/renew'],
    reason: '设备绑定/会话按设备凭据（设备码+密钥）鉴权，走 pdaSession 而非用户权限码',
  },
  'system.routes.js': {
    routes: ['POST /error-report'],
    reason: '幂等回执查询与前端错误上报：挂在 authMiddleware 之后，仅按当前用户读自己的回执/写日志，不含业务数据',
  },
  'fulfillment.routes.js': {
    routes: ['POST /:type/:id/sync', 'PUT /:type/:id/dates', 'POST /:type/:id/issues', 'PATCH /:type/:id/issues/:issueId'],
    reason: '该模块用服务层 authorize() 同时校验权限码（def.view/def.write）与仓库范围（scopeDocument），不经 requirePermission 中间件',
    serviceFile: 'backend/src/modules/fulfillment/fulfillment.service.js',
  },
}

const { ts, parse, visit, callName, owner, functionName } = require('./helpers/contractSource')

function registrations(source) {
  const findings = []
  const tree = parse(source)
  visit(tree, node => {
    const method = callName(node)
    if (!['post', 'put', 'patch', 'delete'].includes(method) || !ts.isPropertyAccessExpression(node.expression)
      || !node.arguments.length || !ts.isStringLiteralLike(node.arguments[0])) return
    findings.push({
      method: method.toUpperCase(),
      line: 1 + tree.getLineAndCharacterOfPosition(node.getStart()).line,
      route: node.arguments[0].text,
      guarded: node.arguments.slice(1, -1).some(arg =>
        ts.isCallExpression(arg) && ts.isIdentifier(arg.expression)
        && ['requirePermission', 'requireAnyPermission'].includes(arg.expression.text)),
      snippet: node.getText().replace(/\s+/g, ' ').slice(0, 110),
    })
  })
  return findings
}

function main() {
  const routeFiles = []
  for (const mod of fs.readdirSync(MODULES_DIR)) {
    const dir = path.join(MODULES_DIR, mod)
    if (!fs.statSync(dir).isDirectory()) continue
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith('.routes.js')) routeFiles.push(path.join(dir, f))
    }
  }
  assert.ok(routeFiles.length > 40, `路由文件数量异常（${routeFiles.length}），目录结构可能变了`)

  // 先校验例外清单自身：文件仍存在、替代守卫仍存在
  for (const [base, rule] of Object.entries(ALLOWED_WITHOUT_PERMISSION)) {
    assert.ok(rule && rule.reason, `例外 ${base} 必须写明 reason`)
    assert.ok(routeFiles.some(f => path.basename(f) === base), `例外清单里的 ${base} 已不存在，请清理该例外`)
    if (rule.serviceFile) {
      const calls = new Map()
      visit(parse(fs.readFileSync(path.join(ROOT, rule.serviceFile), 'utf8')), node => {
        const name = callName(node)
        if (!['authorize', 'transact'].includes(name)) return
        if (name === 'authorize' && node.arguments[4]?.kind !== ts.SyntaxKind.TrueKeyword) return
        calls.set(functionName(owner(node)), name)
      })
      for (const [fn, gate] of Object.entries({ syncDocument: 'authorize', transact: 'authorize',
        setDates: 'transact', createIssue: 'transact', changeIssue: 'transact' })) {
        assert.equal(calls.get(fn), gate, rule.serviceFile + ' ' + fn + ' 缺少写入校验 ' + gate)
      }
    }
  }

  let total = 0
  const violations = []
  let exempted = 0
  for (const file of routeFiles) {
    const rule = ALLOWED_WITHOUT_PERMISSION[path.basename(file)]
    for (const f of registrations(fs.readFileSync(file, 'utf8'))) {
      total++
      if (f.guarded) continue
      const rel = path.relative(ROOT, file)
      if (rule?.routes.includes(f.method + ' ' + f.route)) exempted++
      else violations.push(`${rel}:${f.line} ${f.method} → ${f.snippet}`)
    }
  }

  console.log(`扫描路由文件 ${routeFiles.length} 个，写路由 ${total} 条`)
  console.log(`已登记例外豁免 ${exempted} 条，覆盖 ${Object.keys(ALLOWED_WITHOUT_PERMISSION).length} 个路由文件`)

  if (violations.length) {
    console.error('\n以下写路由缺少 requirePermission，且不在例外清单中：')
    for (const v of violations) console.error('  ✗ ' + v)
    console.error('\n若确属刻意豁免，请在 tests/route-permission-contract.test.js 的 ALLOWED_WITHOUT_PERMISSION 中登记并写明理由。')
  } else {
    console.log('✓ 所有写路由均挂了 requirePermission，或落在已登记且有理由的例外清单内')
  }

  console.log('\n' + '─'.repeat(60))
  console.log(`  路由鉴权契约: ${violations.length === 0 ? 'PASS' : violations.length + ' 处违规'}`)
  console.log('─'.repeat(60))
  process.exit(violations.length ? 1 : 0)
}

module.exports = { registrations }
if (require.main === module) main()
