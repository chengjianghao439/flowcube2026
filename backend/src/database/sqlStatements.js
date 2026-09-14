'use strict'

/**
 * 把迁移 SQL 文件切分成单条语句。
 *
 * 为什么必须逐条执行（2026-09-14 备份恢复演练失败事故）：
 * 迁移运行器原先用 mysql2 的 `multipleStatements: true` 把整个文件当成一条
 * 多语句发给 MySQL。此时 `CREATE TRIGGER ... <单语句>;` 后面还有别的语句时，
 * MySQL 会把结尾的分号一起写进 information_schema.triggers.ACTION_STATEMENT；
 * mysqldump 又把函数体包进 `/*!50003 ... *\/` 可执行注释，导出成 `... ); *\/;;`。
 * 该分号在导入时会提前结束语句，剩下的 `*\/` 触发 1064 语法错误，导致 9/9 起
 * 的每日备份无法按演练脚本恢复。逐条发送后每条 CREATE TRIGGER 都是「末条」，
 * 函数体不再吞掉分号。
 *
 * 语义约束：
 *   - 依据 MySQL 词法识别字符串、反引号标识符、`-- ` / `#` / `/* *\/` 注释中的分号；
 *   - 返回的语句已去掉结尾分号和首尾空白，空片段与纯注释片段不返回；
 *   - 语句内部的注释保留原样。
 *
 * 已知边界：不支持客户端指令 `DELIMITER`。现有迁移全部是标准 `;` 分隔的语句，
 * 且服务器并不认识 DELIMITER，历史运行器同样无法执行它，因此这里不引入回归。
 */

/** 判断语句去掉注释与空白后是否还有实际内容（用于丢弃空片段/纯注释片段） */
function hasExecutableContent(statement) {
  let i = 0
  const len = statement.length
  let state = 'normal'
  while (i < len) {
    const ch = statement[i]
    const next = statement[i + 1]
    if (state === 'normal') {
      if (ch === "'") state = 'single'
      else if (ch === '"') state = 'double'
      else if (ch === '`') state = 'backtick'
      else if (ch === '-' && next === '-') {
        const after = statement[i + 2]
        if (after === undefined || after === ' ' || after === '\t' || after === '\n' || after === '\r') state = 'line'
        else return true
      } else if (ch === '#') state = 'line'
      else if (ch === '/' && next === '*') { state = 'block'; i++ }
      else if (ch === ';') { /* 不含分号的片段里不应出现，忽略 */ }
      else if (!/\s/.test(ch)) return true
    } else if (state === 'single') {
      if (ch === '\\') i++
      else if (ch === "'") {
        if (next === "'") i++
        else state = 'normal'
      }
    } else if (state === 'double') {
      if (ch === '\\') i++
      else if (ch === '"') {
        if (next === '"') i++
        else state = 'normal'
      }
    } else if (state === 'backtick') {
      if (ch === '`') {
        if (next === '`') i++
        else state = 'normal'
      }
    } else if (state === 'line') {
      if (ch === '\n') state = 'normal'
    } else if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'normal'; i++ }
    }
    i++
  }
  return false
}

/**
 * @param {string} sql 迁移文件内容
 * @returns {string[]} 单条语句（已去结尾分号与首尾空白）
 */
function splitSqlStatements(sql) {
  if (typeof sql !== 'string' || sql.length === 0) return []
  const statements = []
  let start = 0
  let i = 0
  const len = sql.length
  let state = 'normal'
  const push = (slice) => {
    const statement = slice.trim()
    if (statement && hasExecutableContent(statement)) statements.push(statement)
  }
  while (i < len) {
    const ch = sql[i]
    const next = sql[i + 1]
    if (state === 'normal') {
      if (ch === "'") state = 'single'
      else if (ch === '"') state = 'double'
      else if (ch === '`') state = 'backtick'
      else if (ch === '-' && next === '-') {
        const after = sql[i + 2]
        // MySQL 要求 `--` 后紧跟空白或行尾，否则只是减号连写。
        if (after === undefined || after === ' ' || after === '\t' || after === '\n' || after === '\r') state = 'line'
      } else if (ch === '#') state = 'line'
      else if (ch === '/' && next === '*') { state = 'block'; i++ }
      else if (ch === ';') {
        push(sql.slice(start, i))
        start = i + 1
      }
    } else if (state === 'single') {
      if (ch === '\\') i++
      else if (ch === "'") {
        if (next === "'") i++
        else state = 'normal'
      }
    } else if (state === 'double') {
      if (ch === '\\') i++
      else if (ch === '"') {
        if (next === '"') i++
        else state = 'normal'
      }
    } else if (state === 'backtick') {
      if (ch === '`') {
        if (next === '`') i++
        else state = 'normal'
      }
    } else if (state === 'line') {
      if (ch === '\n') state = 'normal'
    } else if (state === 'block') {
      if (ch === '*' && next === '/') { state = 'normal'; i++ }
    }
    i++
  }
  push(sql.slice(start))
  return statements
}

module.exports = { splitSqlStatements }
