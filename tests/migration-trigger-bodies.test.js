'use strict'
// 迁移语句切分与触发器体回归。
//
// 背景（2026-09-14 备份恢复演练失败事故）：
// 迁移运行器曾把整个 .sql 文件当成「一条多语句」发给 MySQL
// （mysql2 multipleStatements）。当 `CREATE TRIGGER ... <单语句>;` 后面还有别的
// 语句时，MySQL 会把结尾的分号一起存进 information_schema.triggers.ACTION_STATEMENT。
// mysqldump 随后把这个函数体包进 /*!50003 ... */ 可执行注释，导出成
// `... ); */;;`，导入时该分号提前终止了语句，剩下的 `*/` 触发 1064 语法错误，
// 于是 9/9 起每天的备份都无法按演练脚本恢复。
//
// 因此运行器必须逐条执行语句：每条 CREATE TRIGGER 单独发送时函数体不会吞掉分号。
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const { splitSqlStatements } = require('../backend/src/database/sqlStatements.js')

const migrationDir = path.resolve(__dirname, '..', 'backend/src/database')

test('按分号切分多条语句，丢弃空片段与纯注释片段', () => {
  const statements = splitSqlStatements(`
-- 建表
CREATE TABLE a (id INT);
;
CREATE TABLE b (id INT);
`)
  // 语句内的前置注释保留（对执行无影响，便于排查），但空片段与纯注释片段丢弃。
  assert.deepEqual(statements, ['-- 建表\nCREATE TABLE a (id INT)', 'CREATE TABLE b (id INT)'])
})

test('字符串与反引号标识符里的分号不切分', () => {
  const statements = splitSqlStatements(
    "INSERT INTO t VALUES ('a;b', 'it''s;fine');\n"
    + "SELECT `weird;column` FROM t;\n"
    + 'INSERT INTO t VALUES ("d;e");'
  )
  assert.equal(statements.length, 3)
  assert.ok(statements[0].includes("'a;b'"))
  assert.ok(statements[0].includes("'it''s;fine'"))
  assert.ok(statements[1].includes('`weird;column`'))
  assert.ok(statements[2].includes('"d;e"'))
})

test('行注释与块注释里的分号不切分', () => {
  const statements = splitSqlStatements(
    '-- 说明；带分号\nCREATE TABLE a (id INT);\n'
    + '# 另一种注释；带分号\nCREATE TABLE b (id INT);\n'
    + '/* 块注释；带分号 */\nCREATE TABLE c (id INT);'
  )
  assert.deepEqual(statements, [
    '-- 说明；带分号\nCREATE TABLE a (id INT)',
    '# 另一种注释；带分号\nCREATE TABLE b (id INT)',
    '/* 块注释；带分号 */\nCREATE TABLE c (id INT)',
  ])
})

test('空输入与纯注释输入返回空数组', () => {
  assert.deepEqual(splitSqlStatements(''), [])
  assert.deepEqual(splitSqlStatements('   \n\t '), [])
  assert.deepEqual(splitSqlStatements('-- 只有注释\n'), [])
  assert.deepEqual(splitSqlStatements('/* 只有块注释 */'), [])
})

test('触发器语句切分后不再以分号结尾（避免函数体吞掉分号）', () => {
  const statements = splitSqlStatements(
    'CREATE TRIGGER trg AFTER INSERT ON t FOR EACH ROW INSERT INTO log VALUES (1);\n'
    + 'UPDATE other SET x = 1;'
  )
  assert.equal(statements.length, 2)
  assert.equal(statements[0], 'CREATE TRIGGER trg AFTER INSERT ON t FOR EACH ROW INSERT INTO log VALUES (1)')
  assert.ok(!statements[0].endsWith(';'))
  assert.equal(statements[1], 'UPDATE other SET x = 1')
})

test('仓库里真实的触发器迁移逐条切分后函数体不带结尾分号', () => {
  for (const name of ['238_party_ledger.sql', '239_party_ledger_receipt_identity.sql', '240_party_ledger_explicit_identity.sql']) {
    const sql = fs.readFileSync(path.join(migrationDir, name), 'utf8')
    const statements = splitSqlStatements(sql)
    assert.ok(statements.length > 0, `${name} 应切出语句`)
    for (const statement of statements) {
      assert.ok(!statement.endsWith(';'), `${name} 语句残留分号：${statement.slice(-40)}`)
    }
    const triggers = statements.filter((s) => /CREATE\s+TRIGGER/i.test(s))
    assert.ok(triggers.length > 0, `${name} 应包含触发器语句`)
    for (const trigger of triggers) {
      assert.ok(!trigger.endsWith(';'), `${name} 触发器体带着结尾分号`)
    }
  }
})

test('全部迁移文件都能安全切分，且不遗留空语句', () => {
  const files = fs.readdirSync(migrationDir).filter((f) => f.endsWith('.sql'))
  assert.ok(files.length > 200, '迁移文件数量异常')
  for (const name of files) {
    const sql = fs.readFileSync(path.join(migrationDir, name), 'utf8')
    for (const statement of splitSqlStatements(sql)) {
      assert.ok(statement.trim().length > 0, `${name} 出现空语句`)
      assert.ok(!statement.endsWith(';'), `${name} 语句残留结尾分号`)
    }
  }
})
