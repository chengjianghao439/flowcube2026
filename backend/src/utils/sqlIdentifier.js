'use strict'

/**
 * SQL 标识符守卫（表名 / 列名 / 列清单）。
 *
 * 背景：本仓大量使用「表名与列名由代码传入、值一律走 `?` 占位」的动态 SQL
 * （全仓约 390 处模板插值点）。这种写法本身没问题——但**标识符无法参数化**，
 * 只能靠白名单校验挡住注入；值走占位符不能顺带保护标识符。
 *
 * 2026-09-18 全仓审视发现两处真实缺口（属本仓反复出现的同一病根：
 * 「同类守卫有，新增入口漏一个参数」）：
 *   1. `statusTransition.lockStatusRow` 的 `columns` 被直接插进 SELECT，
 *      而同文件的 `table`、`statusColumn` 与 `extraSet` 的每个键都有校验，
 *      **唯独漏了 `columns`**；
 *   2. `codeGenerator.generateMasterCode` 的 `table` / `codeField` 被直接插进
 *      FROM 与列引用，当时调用方全是字面量，但没有任何守卫阻止后来者把配置值
 *      或外部输入传进来（本仓的 `code_prefix_*` 设置项正是「配置驱动」的先例）。
 *
 * 两处已收口，并由 `tests/sql-identifier-contract.test.js` 机械守住同类漏法：
 * 任何 SQL 模板里出现的标识符型插值，都必须在近处有本模块的校验调用，
 * 或在测试的豁免清单里写明理由。
 *
 * 约定：**标识符只允许 `[A-Za-z_][A-Za-z0-9_]*`**。表名与列名在本仓全 ASCII，
 * 反引号包裹与复杂表达式不在此列（确需时应显式走白名单映射，而不是放宽这里的正则）。
 */

const AppError = require('./AppError')

const IDENTIFIER_RE = /^[a-zA-Z_][a-zA-Z0-9_]*$/

/**
 * 校验单个 SQL 标识符（表名、列名、别名）。
 * 属程序员错误（配置/调用缺陷）而非用户输入错误，统一 500 + INTERNAL_CONFIG，
 * 便于日志与 Sentry 归类，也不会把内部结构泄漏成 4xx 提示。
 */
function assertSqlIdentifier(value, label) {
  if (typeof value !== 'string' || !IDENTIFIER_RE.test(value)) {
    throw new AppError(`Invalid SQL identifier for ${label}: ${value}`, 500, 'INTERNAL_CONFIG')
  }
  return value
}

/**
 * 校验 SELECT 列清单：允许 `*`，或逗号分隔的标识符（可带 `表别名.` 前缀）。
 * 供 `lockStatusRow` 这类「列清单由调用方给出」的入口使用——`columns` 默认 `*`，
 * 实际调用方一律传 `id, status, warehouse_id` 形式。
 */
function assertSqlColumnList(value, label) {
  if (value === '*') return value
  if (typeof value !== 'string' || !value.trim()) {
    throw new AppError(`Invalid SQL column list for ${label}: ${value}`, 500, 'INTERNAL_CONFIG')
  }
  for (const raw of value.split(',')) {
    const parts = raw.trim().split('.')
    // 允许 `col` 与 `alias.col` 两种写法；多余的点、空项、表达式一律拒绝。
    const ok =
      (parts.length === 1 && IDENTIFIER_RE.test(parts[0])) ||
      (parts.length === 2 && IDENTIFIER_RE.test(parts[0]) && IDENTIFIER_RE.test(parts[1]))
    if (!ok) {
      throw new AppError(`Invalid SQL column list for ${label}: ${value}`, 500, 'INTERNAL_CONFIG')
    }
  }
  return value
}

module.exports = { assertSqlIdentifier, assertSqlColumnList }
