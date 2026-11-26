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

const { ts, parse, visit, owner, callName, filesUnder } = require('./helpers/contractSource')

function scopeOf(node) {
  while (node && !ts.isBlock(node) && !ts.isSourceFile(node)) node = node.parent
  return node
}

function identifierPoints(source) {
  if (!source.includes('\${')) return []
  const tree = parse(source)
  const points = []
  const proofs = []
  const literalId = node => ts.isStringLiteralLike(node) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(node.text)
  visit(tree, node => {
    if (['assertSqlIdentifier', 'assertSqlColumnList'].includes(callName(node)) && node.arguments.length) {
      proofs.push({ name: node.arguments[0].getText(), node, scope: scopeOf(node), guard: true })
    }
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isConditionalExpression(node.initializer)
      && (node.parent.flags & ts.NodeFlags.Const) && literalId(node.initializer.whenTrue) && literalId(node.initializer.whenFalse)) {
      proofs.push({ name: node.name.getText(), node, scope: scopeOf(node) })
    }
    if (ts.isForOfStatement(node) && ts.isVariableDeclarationList(node.initializer)
      && (node.initializer.flags & ts.NodeFlags.Const) && ts.isArrayLiteralExpression(node.expression)
      && node.expression.elements.every(literalId)) {
      proofs.push({ name: node.initializer.declarations[0].name.getText(), node: node.expression, scope: node.statement })
    }
    if (!ts.isTemplateExpression(node) || !SQLISH.test(node.head.text + ' ' + node.templateSpans.map(s => s.literal.text).join(' '))) return
    for (const span of node.templateSpans) {
      const expr = span.expression.getText()
      const name = expr.split(/[.[(]/)[0].trim()
      if (!IDENTIFIER_LIKE.test(name)) continue
      const proof = proofs.find(p => (p.name === name || p.name === expr) && owner(p.node) === owner(span) && p.node.end <= span.getStart()
        && p.scope && p.scope.pos <= span.pos && p.scope.end >= span.end)
      points.push({ name, line: tree.getLineAndCharacterOfPosition(span.getStart()).line + 1, proof })
    }
  })
  return points
}

function main() {
  const files = filesUnder(SRC, name => name.endsWith('.js'))
  assert.ok(files.length > 200, `扫描到的后端文件太少（${files.length}），目录结构可能变了`)

  const problems = []
  let points = 0
  let guarded = 0
  let exempted = 0

  for (const file of files) {
    const rel = path.relative(ROOT, file)
    for (const point of identifierPoints(fs.readFileSync(file, 'utf8'))) {
      points++
      if (point.proof?.guard) guarded++
      else if (point.proof) exempted++
      else problems.push(rel + ':' + point.line + ' 缺少 SQL 标识符校验 ' + point.name)
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

module.exports = { identifierPoints }
if (require.main === module) main()
