#!/usr/bin/env node
'use strict'

/**
 * SQL 标识符插值契约测试（纯静态，无需 DB）。
 *
 * 背景：本仓大量使用「表名与列名由代码传入、值一律走 `?` 占位」的动态 SQL
 * （全仓约 390 处模板插值点）。这种写法本身没问题，但**标识符无法参数化**：
 * 值用占位符并不能顺带保护表名与列名，注入面只能靠白名单校验挡住。
 *
 * 2026-09-18 全仓审视发现的真实缺口正好是本仓反复出现的同一病根——
 * 「同类守卫有，新增入口漏一个参数」：
 *   · `statusTransition.lockStatusRow` 的 `columns` 直接插进 SELECT，而同文件的
 *     `table`、`statusColumn`、`extraSet` 的每个键都有校验，唯独漏了 `columns`；
 *   · `codeGenerator.generateMasterCode` 的 `table` / `codeField` 直接插进 FROM
 *     与列引用，当时调用方全是字面量，但没有任何东西阻止后来者传配置值。
 * 两处已收口（`backend/src/utils/sqlIdentifier.js`），本测试守住同类漏法。
 *
 * 判据：SQL 模板里每个**标识符型**插值（变量名像表名/列名/别名），必须在
 * **它所属函数的范围内**有一次 `assertSqlIdentifier` / `assertSqlColumnList`
 * 校验，或命中下面三条**可机械验证**的安全形式之一。
 * 不接受「一句话豁免」——豁免必须能被正则检查，否则它会悄悄腐烂。
 *
 * 运行：node tests/sql-identifier-contract.test.js
 */

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const SRC = path.join(ROOT, 'backend/src')

/** 变量名像标识符才纳入检查（`columns`、`table`、`alias`…）。 */
const IDENTIFIER_LIKE = /^(table|tables|tableName|columns?|cols?|fields?|codeField|statusColumn|orderBy|sortBy|alias)$/

/**
 * 判定「这个模板是 SQL」。刻意不用 `SET` / `ORDER BY` 这类词——它们会命中
 * JS 方法名（`fields.join('')` 的 `join` 就曾被当成 `JOIN`），造成误报。
 */
const SQLISH = /\b(?:FROM|INTO|UPDATE|DELETE)\b|\bJOIN\s+[A-Za-z_]/i

/** 扫描下限：低于这个数说明解析逻辑失效了（而不是代码变干净了）。 */
const MIN_IDENTIFIER_POINTS = 15

const GUARD_RE = (root) =>
  new RegExp(`assertSql(?:Identifier|ColumnList)\\(\\s*${root}\\b`)

/**
 * 可机械验证的安全形式。每条的判据都要能被正则检查：
 *  1. 硬编码三元白名单：`const table = type === 2 ? 'sale_orders' : 'purchase_orders'`
 *  2. 文件内定义的箭头函数参数：`const pendingTask = alias => ...`（调用点也在同文件）
 *  3. for-of 字面量数组：`for (const table of ['sale_orders', ...])`
 * 三种形态的外部输入都进不来；换成任何其它形态都会落回「必须显式校验」。
 */
const SAFE_FORMS = [
  {
    name: '硬编码三元白名单',
    withinFunction: true,
    test: (text, root) =>
      new RegExp(
        `const\\s+${root}\\s*=\\s*[^;\\n]*\\?\\s*'[A-Za-z_][A-Za-z0-9_]*'\\s*:\\s*'[A-Za-z_][A-Za-z0-9_]*'`,
      ).test(text),
  },
  {
    name: 'for-of 字面量数组',
    withinFunction: true,
    test: (text, root) => new RegExp(`for\\s*\\(\\s*const\\s+${root}\\s+of\\s*\\[`).test(text),
  },
  {
    name: '文件内箭头函数参数',
    withinFunction: false,
    test: (text, root) => new RegExp(`[\\s(,;]${root}\\s*=>`).test(text),
  },
]

function listFiles(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listFiles(p, out)
    else if (e.name.endsWith('.js')) out.push(p)
  }
  return out
}

/** 从插值点向上找最近的函数定义行；找不到就退回文件开头。 */
function functionStart(lines, lineIdx) {
  for (let i = lineIdx; i >= 0; i--) {
    const line = lines[i]
    if (/^\s*(async\s+)?function\s+[A-Za-z_$]/.test(line)) return i
    if (/^\s*(module\.exports|exports)\s*\./.test(line)) continue
    // 箭头函数赋值：必须整行就是定义（`const x = (a) => {` / `const x = a => {`），
    // 否则会把 `const p = list.map(() => '?')` 这类表达式误判成函数起点——
    // 本测试第一版就因此漏掉了 compareAndSetStatus 内已有的校验。
    if (
      /^\s*(const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(async\s+)?(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{?\s*$/.test(
        line,
      )
    ) {
      return i
    }
  }
  return 0
}

function main() {
  const files = listFiles(SRC)
  assert.ok(files.length > 200, `扫描到的后端文件太少（${files.length}），目录结构可能变了`)

  const problems = []
  let points = 0
  let guarded = 0
  let exempted = 0

  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8')
    // 源码里转义的反引号（`FROM \`${table}\``）会被 /`[^`]*`/ 当成模板结束符，
    // 把模板切成碎片——碎片里往往没有 SQL 关键字，于是插值被整段漏扫。
    // 本测试第一版就因此看不见 `generateMasterCode` 的 `${table}`。
    // 用等长占位符替换后再扫描（不动行号），提取时还原。
    const src = raw.replace(/\\`/g, '\u0001')
    const lines = src.split('\n')
    const rel = path.relative(ROOT, file)

    for (const tpl of src.matchAll(/`[^`]*`/g)) {
      const tplText = tpl[0].replace(/\u0001/g, '\\`')
      if (!SQLISH.test(tplText)) continue
      for (const im of tpl[0].matchAll(/\$\{([^}]{1,120})\}/g)) {
        const expr = im[1].trim()
        const root = expr.split(/[.[(]/)[0].trim()
        if (!IDENTIFIER_LIKE.test(root)) continue
        points++

        const lineIdx = src.slice(0, tpl.index).split('\n').length - 1 + tpl[0].slice(0, im.index).split('\n').length - 1
        const start = functionStart(lines, lineIdx)
        const scopeText = lines.slice(start, lineIdx + 1).join('\n')

        if (GUARD_RE(root).test(scopeText)) {
          guarded++
          continue
        }
        const form = SAFE_FORMS.find((f) => f.test(f.withinFunction ? scopeText : src, root))
        if (form) {
          exempted++
          continue
        }
        problems.push(
          `${rel}:${lineIdx + 1} 的 \`\${${expr}}\` 是 SQL 标识符插值，但函数内没有 ` +
            `assertSqlIdentifier/assertSqlColumnList(${root}, …)，也不属于已登记的三种安全形式`,
        )
      }
    }
  }

  assert.ok(
    points >= MIN_IDENTIFIER_POINTS,
    `只解析到 ${points} 个标识符插值点（下限 ${MIN_IDENTIFIER_POINTS}），扫描逻辑可能失效`,
  )

  for (const p of problems) console.log(`  [FAIL] ${p}`)
  console.log(
    `sql-identifier-contract: 标识符插值 ${points} 处（已校验 ${guarded} / 可验证安全形式 ${exempted}）、` +
      `扫描文件 ${files.length} 个、失败 ${problems.length}`,
  )
  if (problems.length) process.exit(1)
  console.log('  [OK] SQL 标识符插值都有守卫')
}

main()
