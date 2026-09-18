#!/usr/bin/env node
'use strict'

/**
 * 前端业务日期来源契约（纯静态，无需 DB）。
 *
 * 背景：本仓约定「业务日期唯一时区为北京时间」，唯一入口是 `frontend/src/lib/dateTime.ts`
 * （其文件头第 9 行就写着「新增时间显示一律经这里，不要直接 getFullYear/getHours」）。
 * 但 2026-09-18 审视发现 4 处各写各的：
 *   · `PaymentQueryDialog` 默认窗口用 todayYmd()（北京），「今天」按钮却用自写的 todayStr()
 *     （宿主本地字段）——同一个弹窗里两个「今天」；
 *   · `finance/expenses` 的明细默认发生日期、查询默认窗口；
 *   · `logistics/freight-reconciliation` 的当前年月（非 +08 时区会取到上个月）；
 *   · `lib/dateRange.ts` 的「近 N 天 / 本月」整个用本地字段 + Date.setDate 计算。
 * 在 UTC / 美西等非 +08 环境（容器、系统重装、出差改时区）下这些窗口会偏一天。
 *
 * 已全部收敛到 `lib/dateTime.ts`。本测试守住三件事：
 *   1. 除权威实现外，不允许用 getFullYear/getMonth/getDate 自己拼业务日期；
 *   2. `lib/dateRange.ts` 必须从 `./dateTime` 取北京原语（防止它再退回自实现）；
 *   3. 豁免必须登记理由并能被机械检查（当前只有趣味小工具）。
 *
 * 运行：node tests/frontend-date-source-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'frontend/src')

/** 权威实现自身可以拼日期。 */
const AUTHORITY = 'frontend/src/lib/dateTime.ts'

/**
 * 豁免：趣味小工具（抽签 / 喝水）用 localStorage 的「今天」标记。
 * 它只在自己内部比较（同一天内自洽），不参与任何业务日期、不与后端交换，
 * 因此用宿主本地日期无副作用；登记在此是为了让「为什么它可以」可被审阅。
 */
const ALLOWED = new Set(['frontend/src/components/dashboard/widgets/FunWidgets.tsx'])

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name)) out.push(p)
  }
  return out
}

/** 该位置附近是否在「自己拼业务日期」：同时有年月日字段 + 分隔/补零迹象。 */
function looksLikeYmdConcat(text) {
  if (!/getFullYear\(\)/.test(text)) return false
  if (!/getMonth\(\)|getDate\(\)/.test(text)) return false
  return /\}-\$\{/.test(text) || /join\(['"]-['"]\)/.test(text) || /padStart\(/.test(text)
}

function main() {
  const files = walk(SRC)
  assert.ok(files.length > 200, `扫描到的前端文件太少（${files.length}）`)

  const problems = []
  let scanned = 0

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    if (rel === AUTHORITY || ALLOWED.has(rel)) continue
    const src = fs.readFileSync(file, 'utf8')

    // 按行滑动窗口：同一条拼接可能跨行（数组字面量 + join('-')）
    const lines = src.split('\n')
    for (let i = 0; i < lines.length; i++) {
      const window = lines.slice(i, i + 4).join('\n')
      if (!looksLikeYmdConcat(window)) continue
      scanned++
      problems.push(
        `${rel}:${i + 1} 自己用 getFullYear/getMonth/getDate 拼业务日期——` +
          '请改用 `@/lib/dateTime` 的 todayYmd / beijingYmd / formatDisplayDate，' +
          '或 `@/lib/dateRange` 的窗口函数（非 +08 时区下自实现会偏一天）',
      )
      break // 一个文件报一次即可
    }
  }

  // lib/dateRange.ts 必须复用权威原语，而不是自己实现
  const dateRange = fs.readFileSync(path.join(SRC, 'lib/dateRange.ts'), 'utf8')
  if (!/from '\.\/dateTime'/.test(dateRange) || !/beijingYmd/.test(dateRange)) {
    problems.push(
      'frontend/src/lib/dateRange.ts 未复用 ./dateTime 的北京原语：' +
        '它必须基于 beijingYmd/shiftYmd，否则筛选窗口会退回宿主时区语义',
    )
  }

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(
    `frontend-date-source-contract: 扫描 ${files.length} 个文件、` +
      `命中自拼日期 ${scanned} 处、豁免 ${ALLOWED.size} 个、失败 ${problems.length}`,
  )
  if (problems.length) process.exit(1)
  console.log('  [OK] 业务日期统一走 lib/dateTime')
}

main()
