'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { validateTestEnvironment } = require('./helpers/testEnvironment')

test('严格 schema 对账不把迁移创建的视图误判为意外物理表', () => {
  validateTestEnvironment()
  const script = path.resolve(__dirname, '../backend/scripts/schema-reconcile.js')
  const run = spawnSync(process.execPath, [script, '--strict'], { cwd: path.resolve(__dirname, '..'), env: process.env, encoding: 'utf8' })
  assert.equal(run.status, 0, run.stderr)
  assert.doesNotMatch(`${run.stdout}\n${run.stderr}`, /意外表[^\n]*\n\s+- party_identity_names/)
})

test('货架软删允许同仓重建，同一时刻只允许一条活跃记录', async () => {
  const config = validateTestEnvironment()
  const conn = await require('../backend/node_modules/mysql2/promise').createConnection(config)
  try {
    await conn.beginTransaction()
    const code = 'R-' + require('node:crypto').randomUUID().slice(0, 12)
    await conn.query('INSERT INTO warehouse_racks (warehouse_id,code) VALUES (1,?)', [code])
    await conn.query('UPDATE warehouse_racks SET deleted_at=NOW() WHERE warehouse_id=1 AND code=?', [code])
    await conn.query('INSERT INTO warehouse_racks (warehouse_id,code) VALUES (1,?)', [code])
    await assert.rejects(conn.query('INSERT INTO warehouse_racks (warehouse_id,code) VALUES (1,?)', [code]), { code: 'ER_DUP_ENTRY' })
  } finally { await conn.rollback(); await conn.end() }
})

test('货架迁移拒绝前缀和表达式索引，完整三列索引可重复执行', async () => {
  const config = validateTestEnvironment()
  const conn = await require('../backend/node_modules/mysql2/promise').createConnection({ ...config, multipleStatements: true })
  const table = 'rack_shape_' + require('node:crypto').randomBytes(6).toString('hex')
  const sql = require('node:fs').readFileSync(path.resolve(__dirname, '../backend/src/database/302_rack_active_code.sql'), 'utf8').replaceAll('warehouse_racks', table)
  try {
    await conn.query(`CREATE TABLE ${table} LIKE warehouse_racks`)
    for (const columns of ['warehouse_id,code(4),active_unique_guard', 'warehouse_id,code,active_unique_guard,(CHAR_LENGTH(code))']) {
      await conn.query(`ALTER TABLE ${table} DROP INDEX uk_rack_code, ADD UNIQUE KEY uk_rack_code (${columns})`)
      await assert.rejects(conn.query(sql), /__rack_302_unknown_index_shape__/)
    }
    await conn.query(`ALTER TABLE ${table} DROP INDEX uk_rack_code, ADD UNIQUE KEY uk_rack_code (warehouse_id,code,active_unique_guard)`)
    await conn.query(sql)
    await conn.query(sql)
  } finally {
    try { await conn.query(`DROP TABLE IF EXISTS ${table}`) } finally { await conn.end() }
  }
})

test('八张明细快照和改单商品名容得下主档允许的最大宽度', async () => {
  const conn = await require('../backend/node_modules/mysql2/promise').createConnection(validateTestEnvironment())
  try {
    const tables = ['purchase_order_items','sale_order_items','transfer_order_items','inbound_task_items','purchase_return_items','sale_return_items','package_items','warehouse_task_items']
    const widths = { article_number: 100, spec: 200, color: 60 }
    const [rows] = await conn.query('SELECT TABLE_NAME AS tbl, COLUMN_NAME AS col, CHARACTER_MAXIMUM_LENGTH AS width FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name IN (?) AND column_name IN (?)', [tables, Object.keys(widths)])
    assert.equal(rows.length, 24)
    for (const row of rows) assert.ok(Number(row.width) >= widths[row.col], row.tbl + '.' + row.col)
    const [[row]] = await conn.query("SELECT CHARACTER_MAXIMUM_LENGTH AS width FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name='sale_order_adjustment_items' AND column_name='product_name'")
    assert.ok(row.width >= 150)
  } finally { await conn.end() }
})

test('收货、销售组件和拣货波次保留原列空值约束并容纳主档宽度', async () => {
  const conn = await require('../backend/node_modules/mysql2/promise').createConnection(validateTestEnvironment())
  try {
    for (const [table, column, minimum, nullable] of [
      ['inbound_task_items', 'product_name', 150, 'NO'],
      ['sale_commercial_components', 'spec', 200, 'YES'],
      ['picking_wave_items', 'product_name', 150, 'NO'],
      ['picking_wave_routes', 'product_name', 150, 'NO'],
    ]) {
      const [[row]] = await conn.query(`SELECT character_maximum_length AS width, is_nullable AS nullable
        FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, [table, column])
      assert.ok(row.width >= minimum, `${table}.${column} 宽度 ${row.width} 小于 ${minimum}`)
      assert.equal(row.nullable, nullable)
    }
  } finally { await conn.end() }
})

test('管理员引导遇到不存在的目标必须报错', () => {
  validateTestEnvironment()
  const result = spawnSync(process.execPath, ['backend/scripts/bootstrap-admin.js'], { cwd: path.resolve(__dirname, '..'), encoding: 'utf8', env: { ...process.env, ADMIN_USERNAME: require('node:crypto').randomUUID(), ADMIN_PASSWORD: require('node:crypto').randomUUID() } })
  assert.equal(result.status, 1)
  assert.match(result.stderr, /不存在|已删除/)
  assert.doesNotMatch(result.stdout, /已初始化/)
})

test('模板 219 盘点区分可解码字符串、缺失布局和正常模板，保留原始布局', async () => {
  const conn = await require('../backend/node_modules/mysql2/promise').createConnection(validateTestEnvironment())
  const { inspectTemplates } = require('../backend/scripts/audit-template-elements')
  try {
    await conn.beginTransaction()
    const layouts = [{ elements: '[]' }, {}, { elements: [] }, { format: 'zpl' }, { elements: null }, { elements: '[]' }, { format: 'zpl', body: '^XA^XZ' }, { elements: '[截断' }]
    const types = [1, 2, 3, 4, 4, 5, 6, 3]
    const ids = []
    for (const [i, layout] of layouts.entries()) {
      const [row] = await conn.query('INSERT INTO print_templates (type,name,layout_json) VALUES (?,?,?)',
        [types[i], '219 盘点测试', JSON.stringify(layout)])
      ids.push(row.insertId)
    }
    const rows = (await inspectTemplates(conn)).filter(row => ids.includes(row.id))
    assert.deepEqual(rows.map(row => [row.id, row.state]), [
      [ids[0], 'encoded-array'], [ids[1], 'needs-original'], [ids[3], 'needs-original'], [ids[4], 'needs-original'], [ids[5], 'encoded-array'], [ids[7], 'needs-original'],
    ])
    const [original] = await conn.query('SELECT layout_json FROM print_templates WHERE id IN (?) ORDER BY id', [ids])
    assert.deepEqual(original.map(row => row.layout_json), layouts)
  } finally {
    await conn.rollback()
    await conn.end()
  }
})

test('快照迁移预检拒绝生成列，并在两种反斜杠模式下保留原值和列定义', async () => {
  const mysql = require('../backend/node_modules/mysql2/promise')
  const conn = await mysql.createConnection({ ...validateTestEnvironment(), multipleStatements: true })
  const suffix = require('node:crypto').randomBytes(5).toString('hex')
  const tables = ['sale_order_items', 'purchase_order_items', 'transfer_order_items',
    'inbound_task_items', 'purchase_return_items', 'sale_return_items', 'package_items',
    'warehouse_task_items', 'sale_order_adjustment_items', 'picking_wave_items',
    'picking_wave_routes', 'sale_commercial_components']
  const clone = table => table + '_' + suffix
  const migrations = ['303_snapshot_field_widths.sql', '304_complete_snapshot_field_widths.sql']
    .map(file => {
      const sql = require('node:fs').readFileSync(path.resolve(__dirname, '../backend/src/database', file), 'utf8')
      return tables.reduce((result, table) => result.replaceAll("'" + table + "'", "'" + clone(table) + "'"), sql)
    })
  const created = []
  const name = clone('inbound_task_items')
  const color = clone('sale_order_items')
  const spec = clone('sale_commercial_components')
  const wide = clone('picking_wave_routes')
  const value = "合成'默认\\值"
  const comment = "合成'注释\\尾"
  async function shape(table, column) {
    const [[row]] = await conn.execute(`SELECT character_maximum_length AS width, is_nullable AS nullable,
      column_default AS def, column_comment AS comment, character_set_name AS charset, collation_name AS collation
      FROM information_schema.columns WHERE table_schema=DATABASE() AND table_name=? AND column_name=?`, [table, column])
    return row
  }
  try {
    for (const table of tables) {
      await conn.query('CREATE TABLE ?? LIKE ??', [clone(table), table])
      created.push(clone(table))
    }
    for (const mode of ['STRICT_TRANS_TABLES', 'STRICT_TRANS_TABLES,NO_BACKSLASH_ESCAPES']) {
      // mysql2 的文本参数转义使用普通模式。先准备等价的旧元数据，再切换迁移会话模式。
      await conn.query("SET SESSION sql_mode='STRICT_TRANS_TABLES'")
      await conn.query('ALTER TABLE ?? MODIFY product_name VARCHAR(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL DEFAULT ? COMMENT ?', [name, value, comment])
      await conn.query('ALTER TABLE ?? MODIFY color VARCHAR(30) NULL DEFAULT NULL COMMENT ?', [color, comment])
      await conn.query('ALTER TABLE ?? MODIFY product_name VARCHAR(175) NOT NULL COMMENT ?', [wide, comment])
      await conn.query('ALTER TABLE ?? DROP COLUMN spec, ADD spec VARCHAR(200) GENERATED ALWAYS AS (product_name) VIRTUAL', [spec])
      const beforeName = await shape(name, 'product_name')
      const beforeColor = await shape(color, 'color')
      const beforeWide = await shape(wide, 'product_name')
      await conn.execute('SET SESSION sql_mode=?', [mode])
      await conn.query(migrations[0])
      await assert.rejects(conn.query(migrations[1]), /__snapshot_304_unknown_column_shape__/)
      assert.deepEqual(await shape(name, 'product_name'), beforeName)
      assert.deepEqual(await shape(color, 'color'), beforeColor)
      await conn.query('ALTER TABLE ?? DROP COLUMN spec, ADD spec VARCHAR(100) NULL DEFAULT NULL', [spec])
      for (let run = 0; run < 2; run++) {
        for (const migration of migrations) await conn.query(migration)
        assert.deepEqual(await shape(name, 'product_name'), { ...beforeName, width: 150 })
        assert.deepEqual(await shape(color, 'color'), { ...beforeColor, width: 60 })
        assert.deepEqual(await shape(wide, 'product_name'), beforeWide)
        assert.equal((await shape(spec, 'spec')).width, 200)
      }
    }
  } finally {
    try {
      for (const table of created) await conn.query('DROP TABLE ??', [table])
    } finally { await conn.end() }
  }
})
