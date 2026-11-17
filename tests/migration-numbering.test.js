'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const migrationDir = path.join(__dirname, '../backend/src/database')
const sourceFile = path.join(migrationDir, 'migrate.js')
const source = fs.readFileSync(sourceFile, 'utf8')
const trackedFiles = fs.readdirSync(migrationDir).filter(file => file.endsWith('.sql'))

function loadMigrator(files) {
  const module = { exports: {} }
  const deps = {
    fs: { readdirSync: () => files },
    path,
    'mysql2/promise': { createConnection: () => assert.fail('编号校验不得创建数据库连接') },
    './sqlStatements': {},
  }
  vm.runInNewContext(source, {
    module, __dirname: migrationDir,
    require: name => {
      assert.ok(Object.hasOwn(deps, name), name)
      return deps[name]
    },
  }, { filename: sourceFile })
  return module.exports
}

test('当前历史重复只提示，编号检查不连接数据库', async () => {
  const result = await loadMigrator(trackedFiles).runMigrations({ checkGapsOnly: true })
  assert.deepEqual(Array.from(result.duplicates), ['057', '064', '089'])
  assert.deepEqual(Array.from(result.newDuplicates), [])
})

test('增添历史同号文件与普通撞号均被识别', async () => {
  const added = ['057_extra_migration.sql', '298_a.sql', '298_b.sql']
  const result = await loadMigrator([...trackedFiles, ...added]).runMigrations({ checkGapsOnly: true })
  assert.deepEqual(Array.from(result.newDuplicates), ['057', '298'])
})

test('普通执行遇新增撞号，在取得连接或使用借入连接前拒绝', async () => {
  const files = [...trackedFiles, '064_extra_migration.sql']
  const { runMigrations } = loadMigrator(files)
  const error = { code: 'MIGRATION_NUMBER_CONFLICT', message: /064_extra_migration\.sql/ }
  await assert.rejects(runMigrations(), error)
  const connection = { query: () => assert.fail('发现迁移撞号后不能执行 SQL') }
  await assert.rejects(runMigrations({ connection, through: '295_role_duties_approval.sql' }), error)
})
