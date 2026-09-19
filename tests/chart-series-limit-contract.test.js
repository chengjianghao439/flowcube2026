#!/usr/bin/env node
'use strict'

/**
 * 分布类图表系列上限守卫（`npm run test:chart-series-limit`）。
 *
 * 背景：仓库、资金账户这类主数据数量没有上界（开发库 253 个仓库、94 个启用账户），
 * 而饼图配色 `PIE_COLORS` 只有 8 色。财务看板「账户余额分布」饼图此前直接把
 * `data.accounts` 全量喂给 `<Pie>`，94 个账户时颜色重复 12 轮、图例糊成一团；
 * 同页其它图表与 `ChartWidgets` 早就取 Top 8 + 「其他 N 个」，只有这一处漏改——
 * 即 AGENTS §9「分布类图表统一 TOP_SERIES_LIMIT = 8」当时**没有任何机械约束**，
 * 只靠人记得照抄一段 IIFE。所以这里守住三件事：
 *
 *   1. 上限只有一份实现：`const TOP_SERIES_LIMIT = <数字>` 只能出现在
 *      `frontend/src/lib/topSeries.ts`（防止各页面再抄一份常量与切片逻辑）；
 *   2. 每个 `<Pie>` 的 `data` 必须来自 `limitTopSeries(...)` 的返回值（或直接调用它），
 *      并且点名的两个分布卡片（各仓库存价值、账户余额）的 `data` 同样有界；
 *   3. 「其他 N 个仓 / 其他 N 个账户」文案与饼图「其他」切片的中性色必须仍在，
 *      防止有人把聚合项删成静默截断（只显示前 8 个、剩下的凭空消失）。
 *
 * 反向验证（三处都必须让本测试失败）：
 *   - 把 finance dashboard 的 `<Pie data={accounts}>` 改回 `data={data.accounts}`；
 *   - 在任意页面再写一份 `const TOP_SERIES_LIMIT = 8`；
 *   - 删掉 `makeRest` 里的「其他 ${rest.length} 个账户」文案，改成 `slice(0, 8)`。
 */

const fs = require('fs')
const path = require('path')
const test = require('node:test')
const assert = require('node:assert/strict')

const ROOT = path.resolve(__dirname, '..')
const FRONTEND_SRC = path.join(ROOT, 'frontend/src')
const HELPER = 'frontend/src/lib/topSeries.ts'
const CHART_WIDGETS = 'frontend/src/components/dashboard/widgets/ChartWidgets.tsx'
const FINANCE_DASHBOARD = 'frontend/src/pages/finance/dashboard/index.tsx'

// 点名要求「有其他项文案」的分布图表：文件 → 必须出现的文案
const REQUIRED_REST_LABELS = [
  [CHART_WIDGETS, ['其他 ${rest.length} 个仓', '其他 ${rest.length} 个账户']],
  [FINANCE_DASHBOARD, ['其他 ${rest.length} 个账户']],
]

// 点名的分布卡片：必须能找到标题（页面改名即失败，防止守卫静默失效），且其后第一个
// `data={...}` 必须来自有界序列。时序图（按月/按天）不在此列——行数由时间窗口决定。
const TITLED_DISTRIBUTION_CHARTS = [
  [CHART_WIDGETS, '各仓库存价值分布'],
  [CHART_WIDGETS, '账户余额分布'],
]

// 允许「无界系列」的图表：当前为空。若将来确有必要（例如系列数天然很小的枚举），
// 在这里逐条写明文件与理由；表项不被命中同样失败，防止表腐烂成「什么都豁免」。
const UNBOUNDED_CHART_ALLOWLIST = []

/** 只剔注释，不做其他改写：字符串字面量里的内容原样保留。 */
function stripComments(source) {
  let out = ''
  let i = 0
  while (i < source.length) {
    const c = source[i]
    if (c === '/' && source[i + 1] === '/') {
      while (i < source.length && source[i] !== '\n') { out += ' '; i++ }
    } else if (c === '/' && source[i + 1] === '*') {
      while (i < source.length && !(source[i] === '*' && source[i + 1] === '/')) {
        out += source[i] === '\n' ? '\n' : ' '
        i++
      }
      if (i < source.length) { out += '  '; i += 2 }
    } else {
      out += c
      i++
    }
  }
  return out
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue
      walk(p, out)
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      out.push(p)
    }
  }
  return out
}

const sources = new Map(
  walk(FRONTEND_SRC).map(f => [path.relative(ROOT, f), stripComments(fs.readFileSync(f, 'utf8'))]),
)

const read = rel => {
  const src = sources.get(rel)
  assert.ok(src !== undefined, `守卫目标文件不存在或不是 .ts/.tsx：${rel}`)
  return src
}

/** 取出每个 `<Pie ...>` 开标签的文本（按花括号/引号配平，`<PieChart>` 不算）。 */
function pieTags(source) {
  const found = []
  const re = /<Pie(?![A-Za-z0-9_$])/g
  let m
  while ((m = re.exec(source))) {
    let i = m.index
    let depth = 0
    let quote = null
    for (; i < source.length; i++) {
      const c = source[i]
      if (quote) {
        if (c === quote && source[i - 1] !== '\\') quote = null
        continue
      }
      if (c === '"' || c === "'" || c === '`') { quote = c; continue }
      if (c === '{') depth++
      else if (c === '}') depth--
      else if (c === '>' && depth === 0) break
    }
    found.push({ line: source.slice(0, m.index).split('\n').length, text: source.slice(m.index, i + 1) })
  }
  return found
}

/** 取出 JSX 属性 `prop={...}` 的表达式文本（花括号配平）。 */
function propExpression(tagText, prop) {
  const at = tagText.indexOf(`${prop}={`)
  if (at === -1) return null
  let i = at + prop.length + 2
  const start = i
  let depth = 1
  let quote = null
  for (; i < tagText.length; i++) {
    const c = tagText[i]
    if (quote) {
      if (c === quote && tagText[i - 1] !== '\\') quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') { quote = c; continue }
    if (c === '{') depth++
    else if (c === '}') { depth--; if (depth === 0) break }
  }
  return tagText.slice(start, i).trim()
}

/** 文件里 `const x = limitTopSeries(...)` 得到的「有界序列」变量名。 */
function boundedSeriesVars(source) {
  const names = new Set()
  for (const m of source.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*limitTopSeries\s*\(/g)) names.add(m[1])
  return names
}

function isBoundedExpression(expr, boundedVars) {
  if (/\blimitTopSeries\s*\(/.test(expr)) return true
  for (const m of expr.matchAll(/[A-Za-z_$][\w$]*/g)) {
    if (!boundedVars.has(m[0])) continue
    // 必须是独立标识符：`data.accounts` 里的 `accounts` 只是属性名（词法上也是词边界，
    // 早期版本直接 \b 匹配就在这里漏判，把「退回全量 API 数组」放了过去）
    const before = expr.slice(0, m.index).match(/\S\s*$/)
    if (before && before[0] === '.') continue
    return true
  }
  return false
}

function allowlisted(rel, line) {
  return UNBOUNDED_CHART_ALLOWLIST.some(e => e.file === rel && e.line === line)
}

test('系列上限只有一份实现：TOP_SERIES_LIMIT 只能定义在 lib/topSeries.ts', () => {
  const helper = read(HELPER)
  assert.match(helper, /export const TOP_SERIES_LIMIT = 8\b/, `${HELPER} 必须导出 TOP_SERIES_LIMIT = 8`)
  assert.match(helper, /export function limitTopSeries/, `${HELPER} 必须导出 limitTopSeries`)

  const duplicated = []
  for (const [rel, src] of sources) {
    if (rel === HELPER) continue
    if (/const\s+TOP_SERIES_LIMIT\s*=/.test(src)) duplicated.push(rel)
  }
  assert.deepEqual(
    duplicated, [],
    `分布上限必须复用 ${HELPER}，不得在页面/组件里再抄一份常量：\n  ${duplicated.join('\n  ')}`,
  )
})

test('每个 <Pie> 的 data 都来自有界序列，且「其他」切片有独立配色', () => {
  const pies = []
  for (const [rel, src] of sources) {
    for (const tag of pieTags(src)) pies.push({ rel, ...tag, expr: propExpression(tag.text, 'data') })
  }
  assert.ok(pies.length >= 1, '未扫描到任何 <Pie>：页面/组件可能被改名或删除，守卫已失效')

  const violations = []
  for (const pie of pies) {
    const { rel, line, expr } = pie
    if (!expr) { violations.push(`${rel}:${line} <Pie> 缺少 data 属性`); continue }
    if (isBoundedExpression(expr, boundedSeriesVars(read(rel)))) continue
    if (allowlisted(rel, line)) continue
    violations.push(
      `${rel}:${line} <Pie data={${expr}}> 不是有界序列：` +
      `请用 limitTopSeries(...) 取 Top ${'${TOP_SERIES_LIMIT}'} + 「其他 N 个」（调色板只有 8 色）`,
    )
  }
  assert.deepEqual(violations, [], `分布类饼图的系列数必须有界：\n  ${violations.join('\n  ')}`)

  // 「其他」切片若继续用 PIE_COLORS 轮转，会与第 1 个账户同色，读者会误认为同一账户
  const finance = read(FINANCE_DASHBOARD)
  assert.match(
    finance, /OTHER_ACCOUNT_COLOR/,
    `${FINANCE_DASHBOARD} 的「其他 N 个账户」切片必须有独立（中性）配色，不能轮回到 PIE_COLORS[0]`,
  )
})

test('点名的分布卡片仍存在且 data 有界（防止改名后守卫静默失效）', () => {
  for (const [rel, title] of TITLED_DISTRIBUTION_CHARTS) {
    const src = read(rel)
    const at = src.indexOf(`title="${title}"`)
    assert.ok(at !== -1, `${rel} 找不到分布卡片标题「${title}」：页面改名后请同步本守卫`)
    const window = src.slice(at, at + 4000)
    const dataAt = window.indexOf('data={')
    assert.ok(dataAt !== -1, `${rel}「${title}」卡片后 4000 字符内找不到 data={...}`)
    const expr = propExpression(window.slice(dataAt), 'data')
    assert.ok(expr, `${rel}「${title}」的 data 属性解析失败`)
    assert.ok(
      isBoundedExpression(expr, boundedSeriesVars(src)),
      `${rel}「${title}」的 data={${expr}} 不是有界序列，应改用 limitTopSeries(...)`,
    )
  }
})

test('合并项文案仍在：三处分布图表都要出现「其他 ${rest.length} 个…」', () => {
  const missing = []
  let calls = 0
  for (const [rel, src] of sources) {
    if (rel === HELPER) continue // 定义与内部实现不算调用点
    calls += (src.match(/\blimitTopSeries\s*\(/g) ?? []).length
  }
  assert.ok(
    calls >= 3,
    `limitTopSeries 调用点只有 ${calls} 处，少于三处分布图表（各仓库存价值、账户余额、财务看板饼图）`,
  )
  for (const [rel, labels] of REQUIRED_REST_LABELS) {
    const src = read(rel)
    for (const label of labels) {
      if (!src.includes(label)) missing.push(`${rel} 缺少「${label}」`)
    }
  }
  assert.deepEqual(missing, [], `聚合项文案缺失（会被退化成静默截断）：\n  ${missing.join('\n  ')}`)
})

test('豁免表自身有效：表项必须被命中（当前应为空）', () => {
  const pies = []
  for (const [rel, src] of sources) {
    for (const tag of pieTags(src)) pies.push({ rel, line: tag.line })
  }
  const stale = UNBOUNDED_CHART_ALLOWLIST.filter(
    e => !pies.some(pie => pie.rel === e.file && pie.line === e.line),
  )
  assert.deepEqual(
    stale, [],
    `以下豁免已不再命中（检查是否已删掉对应图表，删掉后请从豁免表移除）：\n  ${stale.map(e => `${e.file}:${e.line}`).join('\n  ')}`,
  )
})
