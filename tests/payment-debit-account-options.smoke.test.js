#!/usr/bin/env node
'use strict'

/**
 * GET /payments/debit-account-options —— 真实 HTTP 回归（2026-09-26 一致性审查 · 任务 3b 收尾）
 *
 * 为什么单独做这一条：lint 曾发现 `payments.controller.js` 的 `module.exports` **漏了
 * `debitAccountOptions`** —— 路由 `router.get('/debit-account-options', …)` 照旧注册，但
 * 第三段 handler 是 `undefined`。静态检查（lint / tsc）看不见：导出对象少一个键、
 * 导入处多一个引用，两边都各自合法。
 *
 * 【反向验证实测】把 `debitAccountOptions` 从 `module.exports` 摘掉再跑本套件：
 * Express 5 在**路由注册那一刻**就抛 `Route.get() requires a callback function but got a
 * [object Undefined]`，`require('backend/src/app')` 直接失败——症状是**后端整个起不来**，
 * 不是"请求进来才 500"。所以本套件红灯的形式是**在 §A 之前整体崩溃**（rc=1），
 * 恰好证明这条缺口逃不过它。
 *
 * 本套件要证明四件事：
 *   §B 匿名（无令牌）被拒 401；
 *   §C 有令牌但缺 `payment.create` 被拒 403（证明它是被鉴权守卫挡的，不是裸奔）；
 *   §D 有权限 → 200，且确实返回借方科目数组；
 *   §E 返回集合与库内 `acct_accounts` 逐项一致（启用 + 叶子 + 排除应付账款 2202）。
 *
 * 隔离与自洁：**目标接口本身只读**（三个请求都是 GET，不改任何业务数据）；但本套件**不是
 * "零写入"** —— `prepareSmokeContext` 会在**独立测试库**里写入测试夹具：smoke_admin /
 * smoke_limited 两个账号、仓库/库位/商品/供应商/客户各一条兜底行、SMOKE-PRN 打印机、
 * SMOKE-PDA-01 设备与会话（见 `tests/helpers/smokeTestKit.js`）。这些夹具只落在 `_test`
 * 测试库，对生产库与开发库无影响；本套件不额外写业务表，故不需要额外清理。
 * 仍按既有惯例在 finally 显式关掉 backend/src/config/db 的全局单例池（它不 unref，不关会吊住进程）。
 *
 * 运行（必须经守卫入口，禁止直连）：
 *   sh /tmp/run-test.sh node tests/payment-debit-account-options.smoke.test.js
 */

const { createLogger, prepareSmokeContext, dbQuery, login } = require('./helpers/smokeTestKit')

const ADMIN_PW = 'SmokeAdmin123!'
const LIMITED_PW = 'SmokeLimited123!'
const ENDPOINT = '/api/payments/debit-account-options'

async function main() {
  const log = createLogger()
  const ctx = await prepareSmokeContext({ requestTimeoutMs: 15000 })

  try {
    log.section('§A 前置：两个账号都能登录（管理员 / 受限用户）')
    const admin = await login(ctx.http, 'smoke_admin', ADMIN_PW)
    const limited = await login(ctx.http, 'smoke_limited', LIMITED_PW)
    log.assert('管理员登录成功', !!admin.token, `status=${admin.response.status}`)
    log.assert('受限用户登录成功', !!limited.token, `status=${limited.response.status}`)

    // §F 要用的「请求前」快照：在任何端点请求之前取，用来证明这组请求没改动科目表。
    const snapshotSql = `SELECT code, name, is_active, is_leaf, deleted_at FROM acct_accounts WHERE company_id = 1 ORDER BY code`
    const beforeRows = await dbQuery(ctx.pool, snapshotSql)

    log.section('§B 匿名请求（不带令牌）→ 401')
    const anon = await ctx.http.get(ENDPOINT)
    log.assert('匿名被拒 401', anon.status === 401, `实际 ${anon.status} ${JSON.stringify(anon.data)}`)
    log.assert('错误码为 AUTH_TOKEN_MISSING', anon.data?.code === 'AUTH_TOKEN_MISSING', `实际 ${anon.data?.code}`)

    log.section('§C 带令牌但缺 payment.create → 403（证明守卫在拦，而非无人管）')
    const forbidden = await ctx.http.get(ENDPOINT, { token: limited.token })
    log.assert('受限用户被拒 403', forbidden.status === 403, `实际 ${forbidden.status} ${JSON.stringify(forbidden.data)}`)

    log.section('§D 有权限 → 200，handler 确实存在并返回数组')
    // 这一条是"能走到这里"本身即证据：若 controller 未导出，app 在 prepareSmokeContext
    // 里就加载失败，套件根本到不了 §D（反向验证实测，见文件头）。
    const ok = await ctx.http.get(ENDPOINT, { token: admin.token })
    log.assert('返回 200（handler 已正确导出）', ok.status === 200, `实际 ${ok.status} ${JSON.stringify(ok.data).slice(0, 200)}`)
    const options = ok.data?.data
    log.assert('data 是数组', Array.isArray(options), `实际 ${typeof options}`)
    log.assert('至少返回 1 个科目', Array.isArray(options) && options.length > 0, `实际 ${Array.isArray(options) ? options.length : 'N/A'}`)
    log.assert(
      '每项都含 code(string) / name(string) / category(number)',
      Array.isArray(options) && options.every(o => typeof o.code === 'string' && typeof o.name === 'string' && typeof o.category === 'number'),
      JSON.stringify((options || [])[0]),
    )

    log.section('§E 与库内 acct_accounts 逐项交叉核对')
    const rows = await dbQuery(
      ctx.pool,
      `SELECT code FROM acct_accounts
        WHERE company_id = 1 AND deleted_at IS NULL AND is_active = 1 AND is_leaf = 1 AND code <> '2202'
        ORDER BY code`,
    )
    const expected = rows.map(r => String(r.code))
    const actual = (options || []).map(o => String(o.code))
    log.assert(
      '返回集合与库内条件完全一致（数量 + 逐项）',
      JSON.stringify(expected) === JSON.stringify(actual),
      `库内 ${expected.length} 个 / 接口 ${actual.length} 个`,
    )
    log.assert('不含应付账款本身 2202', !actual.includes('2202'))
    log.assert('按 code 升序', JSON.stringify(actual) === JSON.stringify([...actual].sort()))

    log.section('§F 三次 HTTP 请求未改动 acct_accounts（逐行比对）')
    const afterRows = await dbQuery(ctx.pool, snapshotSql)
    log.assert(
      '科目表逐行完全一致（行数 + 每行每列）',
      JSON.stringify(beforeRows) === JSON.stringify(afterRows),
      `请求前 ${beforeRows.length} 行 / 请求后 ${afterRows.length} 行`,
    )

    const counts = log.summary()
    if (counts.failed > 0) process.exitCode = 1
  } catch (e) {
    console.error(e)
    process.exitCode = 1
  } finally {
    await ctx.close()
    // 全局单例池自己收尾（见 smokeTestKit 注释：helper 不关它，由用到的套件显式关）
    await require('../backend/src/config/db').pool.end()
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
