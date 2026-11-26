'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const root = path.resolve(__dirname, '..')

test('成本报表在加载业务模块之前校验独立测试数据库', () => {
  const source = fs.readFileSync(path.join(root, 'tests/report-cost-basis.smoke.test.js'), 'utf8')
  assert.ok(source.indexOf('configureTestEnvironment()') >= 0)
  assert.ok(source.indexOf('configureTestEnvironment()') < source.indexOf('const reports = require'))
})

test('四个实库入口传播夹具和断言异常', () => {
  for (const name of ['printer-binding-scope', 'sale-return-cancel-guard', 'users-roles', 'search-scope']) {
    const { spawnSync } = require('node:child_process')
    const run = spawnSync(process.execPath, ['--require', path.join(__dirname, 'helpers/smokeFailureFixture.js'),
      path.join(__dirname, name + '.smoke.test.js')], { encoding: 'utf8', timeout: 10000 })
    assert.equal(run.status, 1, name + ' ' + run.stderr)
    assert.match(run.stderr, /W4_SMOKE_FIXTURE_FAILURE/)
    assert.match(run.stdout, /W4_CONTEXT_CLOSED/)
    assert.match(run.stdout, /W4_APP_CLOSED/)
  }
})

test('同一行的异步 map 和相邻函数内的独立写操作各自归属', () => {
  const { findReadOnlyLoopQueries } = require('./query-loop-contract.test')
  const src = "function save() { return db.query('UPDATE products SET name=?') }\nasync function load(ids) { return Promise.all(ids.map(async id => db.query('SELECT name FROM products WHERE id=?', [id]))) }"
  assert.equal(findReadOnlyLoopQueries(src).length, 1)
})

test('库存多列赋值各自核查，嵌套函数不能替外层同步', () => {
  const { stockWrites } = require('./stock-cache-write-contract.test')
  const writes = stockWrites([
    "function save() { const site = 'http://localhost'; db.query('UPDATE inventory_stock SET reserved=?, quantity=?'); }",
    "function update() { db.query('UPDATE inventory_containers SET remaining_qty=?'); function refresh() { syncStockFromContainers() } }",
    "// db.query('UPDATE inventory_stock SET quantity=?')",
  ].join('\n'))
  assert.deepEqual(writes.map(w => [w.name, w.field, w.sync]), [
    ['save', 'reserved', false], ['save', 'quantity', false], ['update', 'remaining_qty', false],
  ])
})

test('MySQL 引号内的标识符与裸标识符等价，字符串内的赋值文字不计入', () => {
  const { stockWrites } = require('./stock-cache-write-contract.test')
  const sql = "UPDATE \x60inventory_stock\x60 SET note='one, quantity=1', \x60reserved\x60=GREATEST(0, ?), \x60quantity\x60=?"
  assert.deepEqual(stockWrites('db.query(' + JSON.stringify(sql) + ')').map(w => w.field), ['reserved', 'quantity'])
})

test('写路由权限检查必须是该路由的中间件参数', () => {
  const { registrations } = require('./route-permission-contract.test')
  const routes = registrations("router.post('/one', requirePermission(P.CREATE), handle)\nrouter.put('/two', /* 待接 requirePermission(P.EDIT) */ handle)")
  assert.deepEqual(routes.map(r => r.guarded), [true, false])
})

test('标识符校验不能从另一个函数或另一个块借用', () => {
  const { identifierPoints } = require('./sql-identifier-contract.test')
  const source = [
    "function one(table) { assertSqlIdentifier(table); return `SELECT id FROM ${table}` }",
    "function two(table) { if (ready) { assertSqlIdentifier(table) } return `SELECT id FROM ${table}` }",
  ].join('\n')
  assert.deepEqual(identifierPoints(source).map(p => !!p.proof), [true, false])
})

test('分别检查各事务入口与 IN 批量加锁', () => {
  const { lockPaths, checkPath } = require('./finance-lock-order-contract.test')
  const account = "db.query('SELECT id FROM finance_accounts WHERE id IN (?) ORDER BY id FOR UPDATE')"
  const record = "db.query('SELECT id FROM payment_records WHERE id=? FOR UPDATE')"
  const paths = lockPaths(
    'function first(){' + account + ';' + record + '} '
    + 'function second(){' + record + ';' + account + '} '
    + 'function afterAlloc(){ accountSvc.recordTransaction({ accountId: accA }); applyAllocations(); accountSvc.recordTransaction({ accountId: accB }) }'
  )
  assert.equal(checkPath(paths.get('first')), true)
  assert.equal(checkPath(paths.get('second')), false)
  assert.equal(checkPath(paths.get('afterAlloc')), false)
})

test('页面目录的相对导入、嵌套泛型与真实接口路径均被收集', () => {
  const { callsInSource } = require('./helpers/httpContracts')
  const src = "import transport from '../../api/client'\n/* transport.get('/example/missing') */\ntransport.get<Page<Array<Row>>>('/example/items')"
  assert.deepEqual(callsInSource('pages/items/view.tsx', src).map(c => c.key), ['GET /api/example/items'])
})
