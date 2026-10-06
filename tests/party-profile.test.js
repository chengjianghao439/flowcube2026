'use strict'

// Real routes, services and ExcelJS parsing; only database/auth/stock dependencies
// are stubbed in ordinary CI. The explicit owned-MySQL branch below additionally
// proves migration DDL; it never reads an environment file or uses the app pool.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const { createRequire } = require('node:module')
const root = path.resolve(__dirname, '..')

function load(relative, stubs) {
  const filename = path.join(root, relative)
  const localRequire = createRequire(filename)
  const module_ = { exports: {} }
  // ExcelJS checks Array identity while building templates, so execute in the
  // current realm and inject require without evaluating database dependencies.
  const execute = vm.runInThisContext(`(function(require, module) { ${fs.readFileSync(filename, 'utf8')}\n})`, { filename })
  execute(id => Object.hasOwn(stubs, id) ? stubs[id] : localRequire(id), module_)
  return module_.exports
}

const noop = () => {}
const permission = value => Object.assign(noop.bind(null), { permission: value })
function routes(kind) {
  return load(`backend/src/modules/${kind}/${kind}.routes.js`, {
    [`./${kind}.controller`]: new Proxy({}, { get: () => noop }),
    '../../middleware/auth': { authMiddleware: noop, requirePermission: permission },
    '../../config/db': { pool: {} },
    '../../utils/codeGenerator': { generateMasterCode: noop },
  })
}
function parse(router, method, body) {
  const route = router.stack.find(l => l.route?.path === (method === 'post' ? '/' : '/:id') && l.route.methods[method]).route
  const req = { body }; let error
  route.stack[1].handle(req, {}, e => { error = e })
  if (error) throw error
  return req.body
}

const astral = '𠮷'
const full = { name: astral.repeat(100), contact: astral.repeat(50), phone: '+86 (010) 1234-5678', address: astral.repeat(200), remark: astral.repeat(500) }
for (const kind of ['customers', 'suppliers']) {
  const router = routes(kind)
  for (const method of ['post', 'put']) {
    test(`${kind} ${method}: accepts and trims full Unicode profile without changing finance fields`, () => {
      const input = Object.fromEntries(Object.entries(full).map(([k, v]) => [k, `  ${v}  `]))
      const parsed = parse(router, method, { ...input, settlementType: 2, paymentTermsDays: 60, creditLimit: 0, leadTimeDays: 7, isActive: false })
      for (const [field, value] of Object.entries(full)) assert.equal(parsed[field], value)
      assert.equal(parsed.settlementType, 2); assert.equal(parsed.paymentTermsDays, 60)
      if (method === 'put') assert.equal(parsed.isActive, false)
      if (kind === 'customers') assert.equal(parsed.creditLimit, 0)
      else assert.equal(parsed.leadTimeDays, 7)
    })
    test(`${kind} ${method}: rejects one character over each limit and whitespace-only name`, () => {
      for (const [field, limit] of Object.entries({ name: 100, contact: 50, phone: 30, address: 200, remark: 500 })) {
        assert.throws(() => parse(router, method, { name: '测试企业', [field]: (field === 'phone' ? '1' : astral).repeat(limit + 1), isActive: true }),
          error => error.issues?.some(i => i.path[0] === field && i.message.includes(String(limit))))
      }
      assert.throws(() => parse(router, method, { name: '  \t  ', isActive: true }), error => error.issues?.some(i => i.path[0] === 'name'))
    })
    test(`${kind} ${method}: accepts landline/30 digits/blank and rejects unapproved telephone symbols`, () => {
      for (const phone of ['', '   ', '010-12345678', '1'.repeat(30), '+86 (010) 1234-5678']) {
        assert.equal(parse(router, method, { name: '测试企业', phone, isActive: true }).phone, phone.trim())
      }
      for (const phone of ['01012345678转2', '01012345678x2', '123/456', '123\t456', '１２３']) {
        assert.throws(() => parse(router, method, { name: '测试企业', phone, isActive: true }), error => error.issues?.some(i => i.path[0] === 'phone'))
      }
      assert.throws(() => parse(router, method, { name: '企业\ud800', isActive: true }), error => error.issues?.some(i => i.path[0] === 'name'))
    })
  }
  test(`${kind}: original create/update/delete permissions remain attached`, () => {
    const localRequire = createRequire(path.join(root, `backend/src/modules/${kind}/${kind}.routes.js`))
    const { PERMISSIONS } = localRequire('../../constants/permissions')
    const prefix = kind === 'customers' ? 'CUSTOMER' : 'SUPPLIER'
    for (const [method, action] of [['post', 'CREATE'], ['put', 'UPDATE'], ['delete', 'DELETE']]) {
      const route = router.stack.find(l => l.route?.methods[method]).route
      assert.equal(route.stack[0].handle.permission, PERMISSIONS[`${prefix}_${action}`])
    }
  })
  test(`${kind} service: rejects profile before DB access; stores full normalized identity and preserves duplicate/soft-delete rules`, async () => {
    const calls = []; let duplicate = false
    const pool = { query: async (sql, values) => {
      calls.push({ sql, values })
      if (sql.startsWith('SELECT *')) return [[{ id: 1, name: '旧名', is_active: 1, settlement_type: 2, credit_limit: null }]]
      if (sql.startsWith('SELECT id')) return [duplicate ? [{ id: 2 }] : []]
      return [{ insertId: 9 }]
    } }
    const service = load(`backend/src/modules/${kind}/${kind}.service.js`, {
      '../../config/db': { pool }, '../../utils/codeGenerator': { generateMasterCode: async () => 'AUTOCODE' },
      '../../utils/creditExposure': { getCustomerCreditUsed: noop },
    })
    for (const write of [data => service.create(data), data => service.update(1, data)]) {
      await assert.rejects(write({ name: '名'.repeat(101) }), error => error.statusCode === 400 && error.message.includes('100'))
      assert.equal(calls.length, 0)
    }
    await service.create({ ...full, name: ` ${full.name} `, phone: ` ${full.phone} `, settlementType: 1, creditLimit: 0, paymentTermsDays: 60, leadTimeDays: 7 })
    const inserted = calls.find(c => c.sql.includes('INSERT INTO'))
    assert.equal(inserted.values[1], full.name); assert.equal(inserted.values[2], full.contact)
    assert.equal(inserted.values[3], full.phone); assert.equal(inserted.values[5], full.address); assert.equal(inserted.values[6], full.remark)
    const identity = calls.find(c => c.sql.startsWith('SELECT id'))
    assert.match(identity.sql, /deleted_at IS NULL/); assert.equal(identity.values[0], full.name)
    duplicate = true
    await assert.rejects(service.create({ name: full.name }), /名称已存在/)
    assert.equal(calls.filter(c => c.sql.includes('INSERT INTO')).length, 1)
  })
}

function importer() {
  const calls = []; const names = new Set(); const generatedCodes = []
  const pool = { query: async (sql, values) => {
    calls.push({ sql, values })
    if (sql.startsWith('SELECT id')) return [sql.includes('name=?') && names.has(values[0]) ? [{ id: 1 }] : []]
    if (sql.includes('INSERT INTO')) names.add(values[1])
    return [{ insertId: calls.length }]
  } }
  return { calls, generatedCodes, service: load('backend/src/modules/import/import.service.js', {
    '../../config/db': { pool }, '../../utils/codeGenerator': { generateMasterCode: async () => { generatedCodes.push('AUTOCODE'); return 'AUTOCODE' } },
    '../../engine/inventoryEngine': {}, '../../engine/containerEngine': {},
  }) }
}
const csv = rows => Buffer.from(rows.map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\n'))
async function xlsx(rows) {
  const localRequire = createRequire(path.join(root, 'backend/src/modules/import/import.service.js'))
  const ExcelJS = localRequire('exceljs')
  const workbook = new ExcelJS.Workbook()
  workbook.addWorksheet('资料导入').addRows(rows)
  return Buffer.from(await workbook.xlsx.writeBuffer())
}
for (const kind of ['Customers', 'Suppliers']) {
  const supplier = kind === 'Suppliers'
  const header = supplier ? ['编码', '名称', '联系人', '电话', '结算方式', '账期', '提前期', '地址'] : ['编码', '名称', '联系人', '电话', '结算方式', '授信额度']
  const row = (name, contact = full.contact, phone = full.phone, address = full.address) => supplier
    ? ['', name, contact, phone, '1', 60, 7, address]
    : ['', name, contact, phone, '1', 0, address]
  for (const [format, encode] of [['CSV', csv], ['XLSX', xlsx]]) {
    test(`import${kind} ${format}: validates every nonempty row and keeps source row numbers after true blanks`, async () => {
      const only = (column, value) => {
        const cells = Array(supplier ? 8 : 7).fill('')
        cells[column] = value
        return cells
      }
      const incomplete = [only(2, '仅联系人'), only(3, '010-12345678'), only(supplier ? 7 : 6, '仅地址'), only(4, '2'), only(5, 0), only(0, 0)]
      const blank = Array(supplier ? 8 : 7).fill(' \t ')
      const invalid = importer()
      const invalidResult = await invalid.service[`import${kind}`]({ fileBuffer: await encode([header, [], blank, ...incomplete]) })
      assert.equal(invalidResult.data.success, 0)
      assert.equal(invalidResult.data.errors.length, 6, 'each partial/zero-valued row must report missing name')
      for (let i = 0; i < 6; i++) assert.match(invalidResult.data.errors[i], new RegExp(`^第${i + 4}行：.*名称.*不能为空`))
      assert.equal(invalid.calls.length, 0, 'invalid rows do not reach duplicate queries or INSERT')
      assert.equal(invalid.generatedCodes.length, 0, 'invalid rows are never numbered')

      const mixed = importer()
      const legal = row('空行后的合法企业', '', '')
      const result = await mixed.service[`import${kind}`]({ fileBuffer: await encode([header, [], blank, ...incomplete, legal, [], legal]) })
      assert.equal(result.data.success, 1)
      assert.equal(result.data.errors.length, 7)
      for (let i = 0; i < 6; i++) assert.match(result.data.errors[i], new RegExp(`^第${i + 4}行：.*名称.*不能为空`))
      assert.match(result.data.errors[6], /^第12行：.*名称.*已存在/)
      assert.equal(mixed.calls.filter(c => c.sql.includes('INSERT INTO')).length, 1)
      assert.ok(mixed.calls.filter(c => c.sql.startsWith('SELECT id')).every(c => c.values[0] === '空行后的合法企业'))
      assert.equal(mixed.generatedCodes.length, 1)
    })
  }
  test(`import${kind}: retains complete identity, contact, phone and address; old columns stay compatible`, async () => {
    const { calls, service } = importer()
    const result = await service[`import${kind}`]({ fileBuffer: csv([header, row(` ${full.name} `), row(`${'企业'.repeat(15)}甲`), row(`${'企业'.repeat(15)}乙`), row('旧模板客户', '', '').slice(0, header.length)]) })
    assert.equal(result.data.success, 4); assert.equal(result.data.errors.length, 0)
    const writes = calls.filter(c => c.sql.includes('INSERT INTO'))
    const write = writes[0]
    assert.equal(write.values[1], full.name); assert.equal(write.values[2], full.contact); assert.equal(write.values[3], full.phone)
    const columns = write.sql.slice(write.sql.indexOf('(') + 1, write.sql.indexOf(')')).split(',').map(s => s.trim())
    assert.equal(write.values[columns.indexOf('address')], full.address)
    assert.equal(writes[1].values[1], '企业'.repeat(15) + '甲'); assert.equal(writes[2].values[1], '企业'.repeat(15) + '乙')
    assert.ok(calls.filter(c => c.sql.startsWith('SELECT id')).every(c => c.sql.includes('deleted_at IS NULL')))
  })
  test(`import${kind}: reports original row and field; invalid rows are never truncated, queried or numbered`, async () => {
    const { calls, service } = importer()
    const result = await service[`import${kind}`]({ fileBuffer: csv([header, [], row('名'.repeat(101)), row('联系人超长', '人'.repeat(51)), row('电话超长', '', '1'.repeat(31)), row('电话非法', '', '123x456'), row('地址超长', '', '', '址'.repeat(201))]) })
    assert.equal(result.data.success, 0); assert.equal(calls.length, 0)
    for (const [i, field] of ['名称', '联系人', '电话', '电话', '地址'].entries()) assert.match(result.data.errors[i], new RegExp(`第${i + 3}行：.*${field}`))
  })
  test(`import${kind}: identical full identity stays duplicate and invalid settlement remains strict`, async () => {
    const { calls, service } = importer()
    const invalid = row('结算错误'); invalid[4] = '01'
    const result = await service[`import${kind}`]({ fileBuffer: csv([header, row(full.name), row(full.name), invalid]) })
    assert.equal(result.data.success, 1); assert.match(result.data.errors[0], /第3行：.*名称.*已存在/)
    assert.match(result.data.errors[1], /第4行：.*结算方式/)
    assert.equal(calls.filter(c => c.sql.includes('INSERT INTO')).length, 1)
  })
}

test('customer template appends optional address after the original six columns', async () => {
  const { service } = importer()
  const localRequire = createRequire(path.join(root, 'backend/src/modules/import/import.service.js'))
  const ExcelJS = localRequire('exceljs')
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load((await service.buildCustomerTemplate()).buffer)
  assert.deepEqual(workbook.worksheets[0].getRow(1).values.slice(1), ['客户编码', '客户名称*', '联系人', '电话', '结算方式(现结/1/月结/2；空=月结)', '授信额度', '地址（选填）'])
})

test('migration widens only known profile bottlenecks and is conditional/idempotent', () => {
  const filename = path.join(root, 'backend/src/database/278_party_profile_capacity.sql')
  assert.ok(fs.existsSync(filename), 'original capacity migration 278 remains present')
  const source = fs.readFileSync(filename, 'utf8').replace(/^\s*--.*$/gm, '')
  assert.match(source, /information_schema\.COLUMNS/i)
  for (const table of ['sale_customers', 'supply_suppliers', 'sale_credit_overrides']) assert.ok(source.includes(table))
  assert.match(source, /CHARACTER_MAXIMUM_LENGTH\s*=\s*20/i)
  assert.match(source, /CHARACTER_MAXIMUM_LENGTH\s*=\s*80/i)
  assert.match(source, /MODIFY COLUMN `phone` VARCHAR\(30\)/i)
  assert.match(source, /MODIFY COLUMN `customer_name` VARCHAR\(100\)/i)
  assert.doesNotMatch(source, /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i)
  const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
  const statements = splitSqlStatements(source)
  assert.equal(statements.length, 12, 'each conditional DDL has SET/PREPARE/EXECUTE/DEALLOCATE')
  // A metadata plan stub verifies the emitted known-shape condition and replay.
  // This does not execute SQL or stand in for MySQL migration acceptance.
  const run = columns => {
    const altered = []
    for (let i = 0; i < statements.length; i += 4) {
      const condition = statements[i]
      assert.match(condition, /TABLE_SCHEMA = DATABASE\(\)/)
      const table = condition.match(/TABLE_NAME = '([^']+)'/)[1]
      const column = condition.match(/COLUMN_NAME = '([^']+)'/)[1]
      const expected = Number(condition.match(/CHARACTER_MAXIMUM_LENGTH = (\d+)/)[1])
      const ddl = condition.match(/, '((?:[^']|'')*)', 'SELECT 1'\)$/)[1].replaceAll("''", "'")
      const length = Number(ddl.match(/VARCHAR\((\d+)\)/)[1])
      const key = `${table}.${column}`
      assert.match(statements[i + 1], /^PREPARE party_profile_stmt FROM @party_profile_sql$/)
      assert.equal(statements[i + 2], 'EXECUTE party_profile_stmt')
      assert.equal(statements[i + 3], 'DEALLOCATE PREPARE party_profile_stmt')
      if (columns[key] === expected) { columns[key] = length; altered.push(key) }
    }
    return altered
  }
  const known = { 'sale_customers.phone': 20, 'supply_suppliers.phone': 20, 'sale_credit_overrides.customer_name': 80 }
  assert.equal(run(known).length, 3)
  assert.deepEqual(Object.values(known), [30, 30, 100])
  assert.equal(run(known).length, 0, 'replay emits no DDL')
  assert.equal(run({ 'sale_customers.phone': 40, 'supply_suppliers.phone': 10, 'sale_credit_overrides.customer_name': 150 }).length, 0, 'unknown shapes are not shrunk or rewritten')
})

const phone281File = path.join(root, 'backend/src/database/281_party_phone_capacity_known_legacy.sql')
function assertPhone281Contract(source) {
  const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
  const statements = splitSqlStatements(source.replace(/^\s*--.*$/gm, ''))
  assert.equal(statements.length, 8)
  const targets = []
  for (let i = 0; i < statements.length; i += 4) {
    const sql = statements[i]
    targets.push(sql.match(/TABLE_NAME = '([^']+)'/)?.[1])
    for (const pattern of [/TABLE_SCHEMA = DATABASE\(\)/, /COLUMN_NAME = 'phone'/, /DATA_TYPE = 'varchar'/,
      /CHARACTER_MAXIMUM_LENGTH = 11/, /IS_NULLABLE = 'YES'/, /COLUMN_DEFAULT IS NULL/,
      /EXTRA = ''/, /GENERATION_EXPRESSION = ''/, /CHARACTER_SET_NAME REGEXP '\^\[A-Za-z_\]\[A-Za-z0-9_\]\*\$'/,
      /COLLATION_NAME REGEXP '\^\[A-Za-z_\]\[A-Za-z0-9_\]\*\$'/,
      /VARCHAR\(30\) CHARACTER SET `/, /CHARACTER_SET_NAME/, /COLLATION_NAME/, /QUOTE\(COLUMN_COMMENT\)/,
      /NO_BACKSLASH_ESCAPES/, /REPLACE\(COLUMN_COMMENT, CHAR\(39\), CONCAT\(CHAR\(39\), CHAR\(39\)\)\)/]) assert.match(sql, pattern)
    assert.match(sql, /'SELECT 1'\)$/)
    assert.equal(statements[i + 1], 'PREPARE party_phone_281_stmt FROM @party_phone_281_sql')
    assert.equal(statements[i + 2], 'EXECUTE party_phone_281_stmt')
    assert.equal(statements[i + 3], 'DEALLOCATE PREPARE party_phone_281_stmt')
  }
  assert.deepEqual(targets, ['sale_customers', 'supply_suppliers'])
  assert.doesNotMatch(source, /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/i)
  return statements
}
test('281 repairs exactly the verified nullable 11-character phone shapes and preserves metadata', () => {
  assert.ok(fs.existsSync(phone281File), 'add 281 after verified maximum 280; do not change executed 278')
  assertPhone281Contract(fs.readFileSync(phone281File, 'utf8'))
})
test('281 contract rejects removing shape, metadata or SQL-mode guards', () => {
  const source = fs.readFileSync(phone281File, 'utf8')
  for (const change of [s => s.replace('CHARACTER_MAXIMUM_LENGTH = 11', 'CHARACTER_MAXIMUM_LENGTH = 20'),
    s => s.replace("AND IS_NULLABLE = 'YES'", ''), s => s.replace('AND COLUMN_DEFAULT IS NULL', ''),
    s => s.replace("AND EXTRA = ''", ''), s => s.replace('QUOTE(COLUMN_COMMENT)', "QUOTE('fixed comment')"),
    s => s.replace('NO_BACKSLASH_ESCAPES', 'OTHER_MODE'), s => s.replace('COLLATION_NAME REGEXP', 'COLLATION_NAME LIKE')]) {
    const changed = change(source)
    assert.notEqual(changed, source)
    assert.throws(() => assertPhone281Contract(changed))
  }
})

// The existing --go-live runner enables this branch in CI and locally. Positive
// live-runner/UUID/container/volume/port ownership is mandatory before scratch
// creation, every fixture rebuild and exact scratch deletion. Ordinary tests
// remain offline; a caller-supplied test database name alone cannot enable DDL.
if (process.env.FLOWCUBE_PARTY_PROFILE_MYSQL_PROOF === '1') test('owned MySQL executes real 278/281, preserving data and all non-capacity metadata', async t => {
  const { randomBytes } = require('node:crypto')
  const backendRequire = createRequire(path.join(root, 'backend/package.json'))
  const mysql = backendRequire('mysql2/promise')
  const { assertOwnedRepairInstance } = require('./helpers/repairInstanceOwnership')
  const { assertSqlIdentifier } = require('../backend/src/utils/sqlIdentifier')
  const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
  const config = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME, charset: 'utf8mb4' }
  assert.equal(process.env.NODE_ENV, 'test')
  assert.equal(config.host, '127.0.0.1')
  assert.ok(Number.isSafeInteger(config.port) && config.port > 0 && ![3306, 3307].includes(config.port))
  assert.match(config.database || '', /^flowcube_[a-zA-Z0-9_]+_test$/)
  const admin = await mysql.createConnection(config)
  const scratch = assertSqlIdentifier('flowcube_phone281_' + randomBytes(12).toString('hex') + '_test', 'owned scratch schema')
  let fixture, created = false
  const guard = () => assertOwnedRepairInstance(admin, { config })
  try {
    const owner = await guard()
    const [present] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [scratch])
    assert.equal(present.length, 0, 'fresh random scratch schema must not exist')
    await admin.query(`CREATE DATABASE \`${scratch}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`)
    created = true
    fixture = await mysql.createConnection({ ...config, database: scratch })
    const [[identity]] = await fixture.query('SELECT @@server_uuid AS serverUuid')
    assert.equal(identity.serverUuid, owner.serverUuid)
    const [[initialMode]] = await fixture.query('SELECT @@SESSION.sql_mode AS sqlMode')
    const source281 = fs.readFileSync(phone281File, 'utf8')
    const source278 = fs.readFileSync(path.join(root, 'backend/src/database/278_party_profile_capacity.sql'), 'utf8')
    const execute = async source => { for (const sql of splitSqlStatements(source)) await fixture.query(sql) }
    const metadata = async () => (await fixture.query("SELECT TABLE_NAME AS tableName,COLUMN_NAME AS name,COLUMN_TYPE AS type,IS_NULLABLE AS nullable,COLUMN_DEFAULT AS defaultValue,CHARACTER_SET_NAME AS charset,COLLATION_NAME AS collation,COLUMN_COMMENT AS comment,EXTRA AS extra,GENERATION_EXPRESSION AS generation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND COLUMN_NAME IN ('phone','customer_name') ORDER BY TABLE_NAME,COLUMN_NAME"))[0].map(r => ({ ...r }))
    const tables = ['sale_customers', 'supply_suppliers']
    const cases = [
      { name: 'known 11 default mode', definition: 'VARCHAR(11) NULL DEFAULT NULL', expected: 30, narrow: true },
      { name: 'known 11 NO_BACKSLASH_ESCAPES', definition: 'VARCHAR(11) NULL DEFAULT NULL', expected: 30, narrow: true, noBackslash: true },
      { name: 'known 11 retains different column charset', definition: 'VARCHAR(11) NULL DEFAULT NULL', expected: 30, narrow: true, charset: 'latin1', collation: 'latin1_bin' },
      { name: 'original 20 uses 278 then 281 no-op', definition: 'VARCHAR(20) NULL DEFAULT NULL', expected: 30, old: true },
      { name: 'already 30 remains exact', definition: 'VARCHAR(30) NULL DEFAULT NULL', expected: 30 },
      { name: 'unknown 40 remains exact', definition: 'VARCHAR(40) NULL DEFAULT NULL', expected: 40 },
      { name: 'unknown 10 remains exact', definition: 'VARCHAR(10) NULL DEFAULT NULL', expected: 10 },
      { name: 'unknown nonnullable 11 remains exact', definition: 'VARCHAR(11) NOT NULL', expected: 11 },
      { name: 'unknown non-NULL default remains exact', definition: "VARCHAR(11) NULL DEFAULT '123'", expected: 11 },
      { name: 'unknown CHAR remains exact', definition: 'CHAR(11) NULL DEFAULT NULL', expected: 11 },
      { name: 'unknown generated 11 remains exact', definition: "VARCHAR(11) GENERATED ALWAYS AS ('12345678901') VIRTUAL", expected: 11, generated: true },
    ]
    for (const scenario of cases) await t.test(scenario.name, async () => {
      await guard()
      await fixture.query('SET SESSION sql_mode=?', [initialMode.sqlMode])
      for (const table of [...tables, 'sale_credit_overrides', 'unrelated_parties']) {
        assertSqlIdentifier(table, 'owned fixture table')
        await fixture.query(`DROP TABLE IF EXISTS \`${table}\``)
      }
      for (const table of tables) {
        const comment = scenario.old ? (table === 'supply_suppliers' ? '联系电话' : '') : "仅本批'电话\\Unicode联系𠮷"
        const collation = scenario.collation || (scenario.old ? 'utf8mb4_unicode_ci' : 'utf8mb4_bin')
        const charset = scenario.charset || 'utf8mb4'
        assertSqlIdentifier(charset, 'owned fixture charset')
        assertSqlIdentifier(collation, 'owned fixture collation')
        const definition = scenario.definition.replace(/^(VARCHAR|CHAR)\(\d+\)/, '$& CHARACTER SET ' + charset + ' COLLATE ' + collation)
        await fixture.query(`CREATE TABLE \`${table}\` (id INT PRIMARY KEY, phone ${definition} COMMENT ${fixture.escape(comment)}) DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`)
        if (scenario.generated) await fixture.query(`INSERT INTO \`${table}\` (id) VALUES (1)`)
        else await fixture.query(`INSERT INTO \`${table}\` (id,phone) VALUES (1,?)`, ['1234567890'])
      }
      await fixture.query('CREATE TABLE sale_credit_overrides (customer_name VARCHAR(80) NOT NULL) DEFAULT CHARSET=utf8mb4')
      await fixture.query('CREATE TABLE unrelated_parties (phone VARCHAR(11) NULL DEFAULT NULL) DEFAULT CHARSET=utf8mb4')
      if (scenario.noBackslash) await fixture.query('SET SESSION sql_mode=?', [initialMode.sqlMode + ',NO_BACKSLASH_ESCAPES'])
      if (scenario.old) await execute(source278)
      const before = await metadata()
      if (scenario.narrow) {
        await execute(source278)
        assert.deepEqual((await metadata()).filter(r => tables.includes(r.tableName)), before.filter(r => tables.includes(r.tableName)), '278 does not repair the observed 11-character phone shape')
        for (const table of tables) await assert.rejects(fixture.query(`INSERT INTO \`${table}\` (id,phone) VALUES (99,?)`, ['1'.repeat(30)]), e => e.code === 'ER_DATA_TOO_LONG')
      }
      const baseline = await metadata()
      await execute(source281)
      const after = await metadata()
      const expected = baseline.map(row => tables.includes(row.tableName) && scenario.narrow ? { ...row, type: 'varchar(30)' } : row)
      assert.deepEqual(after, expected, '281 changes only known 11 capacity; charset/default/comment/extra and other tables remain exact')
      await execute(source281)
      assert.deepEqual(await metadata(), after, 'replay changes no metadata')
      for (const table of tables) {
        const [rows] = await fixture.query(`SELECT phone FROM \`${table}\` WHERE id=1`)
        assert.equal(rows[0].phone, scenario.generated ? '12345678901' : '1234567890')
        if (scenario.expected === 30) {
          await fixture.query(`INSERT INTO \`${table}\` (id,phone) VALUES (99,?)`, ['1'.repeat(30)])
          const [[saved]] = await fixture.query(`SELECT phone FROM \`${table}\` WHERE id=99`)
          assert.equal(saved.phone, '1'.repeat(30))
        }
      }
    })
  } finally {
    try {
      if (fixture) await fixture.end()
      if (created) {
        await guard()
        await admin.query(`DROP DATABASE \`${scratch}\``)
        const [remaining] = await admin.query('SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?', [scratch])
        assert.equal(remaining.length, 0, 'only this exact owned scratch schema is deleted')
        t.diagnostic('Owned scratch schema removed and absence verified; container/volume teardown belongs to the live runner')
      }
    } finally { await admin.end() }
  }
})

test('master/order/credit/party exports preserve full names and opt into wrapping without changing row values', async () => {
  const filename = 'backend/src/modules/export/export.service.js'
  const source = fs.readFileSync(path.join(root, filename), 'utf8')
  const profile = { id: 1, code: 'TEST', ...full, customerName: full.name, partyName: full.name, totalAmount: 7, settlementTypeName: '月结', paymentTermsDays: 60, leadTimeDays: 7, isActive: true, creditLimit: 0 }
  const stubs = {
    '../../config/db': { pool: { query: async () => [[{ customer_name: full.name, supplier_name: full.name, party_name: full.name }]] } },
    '../../utils/warehouseScope': { scopeFilter: () => ({ sql: '', params: [] }), transferScopeFilter: noop },
  }
  for (const match of source.matchAll(/require\('([^']+)'\)/g)) {
    if (match[1].startsWith('../') && !match[1].startsWith('../../')) stubs[match[1]] = { findAll: async () => ({ list: [profile], pagination: { total: 1 } }) }
  }
  stubs['../reports/reports.service'] = { reconciliationReport: async () => ({ type: 2, list: [profile], pagination: { total: 1 } }) }
  const side = { buckets: [], topParties: [{ ...profile, amount: 7, overdueAmount: 3 }] }
  stubs['../payments/payment-aging.service'] = { aging: async () => ({ receivable: side, payable: side }) }
  const service = load(filename, stubs)
  for (const name of ['getCustomersExportPayload', 'getSuppliersExportPayload']) {
    const payload = await service[name]()
    assert.equal(payload.rows[0].name, full.name); assert.equal(payload.rows[0].address, full.address)
    for (const key of ['name', 'contact', 'phone', 'address']) assert.equal(payload.columns.find(c => c.key === key).wrapText, true)
  }
  for (const name of ['getSaleExportPayload', 'getPurchaseExportPayload']) {
    const payload = await service[name]({})
    const key = name === 'getSaleExportPayload' ? 'customer_name' : 'supplier_name'
    assert.equal(payload.rows[0][key], full.name); assert.equal(payload.columns.find(c => c.key === key).wrapText, true)
  }
  const credit = await service.getCreditOverridesExportPayload({})
  assert.equal(credit.rows[0].customer_name, full.name)
  assert.equal(credit.columns.find(c => c.key === 'customer_name').wrapText, true)
  const transactions = await service.getFinanceTransactionsExportPayload({})
  assert.equal(transactions.rows[0].party_name, full.name)
  assert.equal(transactions.columns.find(c => c.key === 'party_name').wrapText, true)
  for (const name of ['getReconciliationExportPayload', 'getPaymentsExportPayload', 'getPaymentReceiptsExportPayload', 'getStatementsExportPayload']) {
    const payload = await service[name]({ type: 2 })
    assert.equal(payload.rows[0].partyName, full.name)
    assert.equal(payload.columns.find(c => c.key === 'partyName').wrapText, true, `${name} must wrap the complete party name`)
    if (name !== 'getPaymentReceiptsExportPayload') assert.equal(payload.rows[0].totalAmount, 7)
  }
  const aging = await service.getAgingExportPayload()
  for (const sheet of aging.sheets.slice(1)) {
    assert.equal(sheet.rows[0].partyName, full.name)
    assert.equal(sheet.columns.find(c => c.key === 'partyName').wrapText, true)
    assert.equal(sheet.rows[0].amount, '7.00')
  }
})

test('financial party-name carriers accept 100 Unicode characters while retaining original payload and permissions', async t => {
  const router = load('backend/src/modules/payments/payments.routes.js', {
    './payments.controller': new Proxy({}, { get: () => noop }),
    '../../middleware/auth': { authMiddleware: noop, requirePermission: permission },
  })
  for (const [url, fields] of [
    ['/receipts', { type: 2, amount: 1, paymentDate: '2031-01-01', accountId: 1, partyId: 7 }],
    ['/statements', { type: 2, recordIds: [1] }],
    ['/', { type: 2, orderNo: 'MANUAL', totalAmount: 1 }],
  ]) {
    await t.test(url, () => {
    const route = router.stack.find(l => l.route?.path === url && l.route.methods.post).route
    const req = { body: { ...fields, partyName: full.name } }; let error
    route.stack[1].handle(req, {}, e => { error = e })
    assert.equal(error, undefined, `${url} must carry the valid full enterprise name`)
    assert.equal(req.body.partyName, full.name)
    assert.ok(route.stack[0].handle.permission.startsWith('payment.'))
    route.stack[1].handle({ body: { ...fields, partyName: astral.repeat(101) } }, {}, e => { error = e })
    assert.ok(error?.issues?.some(i => i.path[0] === 'partyName'))
    })
  }
  await t.test('invoices', () => {
  const accounting = load('backend/src/modules/accounting/accounting.routes.js', {
    './accounting.controller': new Proxy({}, { get: () => noop }),
    '../../middleware/auth': { authMiddleware: noop, requirePermission: permission },
    '../../middleware/companyScope': { companyScope: noop },
    './finance-backfills.routes': noop,
  })
  const invoices = accounting.stack.find(l => l.regexp?.test('/invoices/') && l.handle?.stack?.some(s => s.route?.methods.put)).handle
  const route = invoices.stack.find(l => l.route?.methods.put).route
  const req = { body: { partyName: full.name } }; let error
  route.stack[1].handle(req, {}, e => { error = e })
  assert.equal(error, undefined); assert.equal(req.body.partyName, full.name)
  route.stack[1].handle({ body: { partyName: astral.repeat(101) } }, {}, e => { error = e })
  assert.ok(error?.issues?.some(i => i.path[0] === 'partyName'))
  })
})
