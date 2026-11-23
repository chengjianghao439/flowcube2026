'use strict'

const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { test } = require('node:test')
const vm = require('node:vm')

const filename = path.resolve(__dirname, '../backend/scripts/schema-reconcile.js')
const operationIndex = { tbl: 'operation_requests', idx: 'uk_operation_requests_key', nonUnique: 0, cols: 'request_key,action,user_id' }
const projectionColumn = { tbl: 'payment_records', col: 'cash_projection', dataType: 'json', columnType: 'json', isNullable: 'YES', defaultValue: null, extra: '' }
const existingIndexes = [
  ['product_items', 'uk_product_items_code_active', 'code'],
  ['supply_suppliers', 'uk_supply_suppliers_code_active', 'code'],
  ['carriers', 'uk_carrier_code', 'code'],
  ['warehouse_locations', 'uk_location_code', 'code'],
  ['inventory_warehouses', 'uk_inventory_warehouses_code_active', 'code'],
  ['sale_customers', 'uk_sale_customers_code_active', 'code'],
  ['sys_users', 'uk_sys_users_username_active', 'username'],
].map(([tbl, idx, key]) => ({ tbl, idx, nonUnique: 0, cols: key + ',active_unique_guard' }))

const proofTables = ['operation_requests', 'sale_order_events', 'payment_record_events']
const proofColumns = proofTables.map(tbl => ({ tbl, columnType: 'bigint unsigned', isNullable: 'NO', defaultValue: '0', extra: '' }))
const proofTriggers = proofTables.map(tbl => ({ tbl, name: 'trg_' + tbl + '_batch_proof', timing: 'BEFORE', action: 'UPDATE',
  body: 'SET NEW.batch_proof_revision = OLD.batch_proof_revision + IF(NEW.status <> OLD.status, 1, 0)' }))

async function reconcile({ index = operationIndex, column = projectionColumn, through292 = true, through301 = false,
  columns = proofColumns, triggers = proofTriggers } = {}) {
  const diagnostics = []
  const files = ['064_create_operation_requests.sql', '292_cash_cents_execution_proofs.sql', '301_batch_receipt_proof_revision.sql']
  const conn = {
    async query(sql) {
      if (sql.includes('FROM db_migrations')) return [files.slice(0, through301 ? 3 : through292 ? 2 : 1).map(filename => ({ filename }))]
      if (sql.includes('information_schema.tables')) return [[{ table_name: 'operation_requests' }, { table_name: 'payment_records' }]]
      if (sql.includes('information_schema.STATISTICS')) return [[...existingIndexes, ...index ? [index] : []]]
      if (sql.includes('information_schema.COLUMNS')) return [sql.includes('batch_proof_revision') ? columns : column ? [column] : []]
      if (sql.includes('information_schema.TRIGGERS')) return [triggers]
      assert.fail(sql)
    },
    async end() {},
  }
  const code = await new Promise((resolve, reject) => {
    const mocks = {
      dotenv: { config() {} }, fs: {
        readdirSync: () => files,
        readFileSync: name => String(name).includes('064_') ? 'CREATE TABLE operation_requests (id INT);' : '',
      }, path,
      'mysql2/promise': { async createConnection() { return conn } },
      '../src/config/env': { env: {} },
    }
    const consoleStub = { log() {}, warn() {}, error: line => diagnostics.push(line) }
    vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
      require: name => mocks[name], __dirname: path.dirname(filename), console: consoleStub,
      process: { argv: ['node', filename, '--strict'], exit: resolve },
    }, { filename })
    setImmediate(() => reject(new Error('schema checker did not report an exit code')))
  })
  return { code, diagnostics: diagnostics.join('\n') }
}

test('strict schema accepts the exact operation request identity and cash projection shape', async () => {
  assert.equal((await reconcile()).code, 0)
  assert.equal((await reconcile({ through292: false, column: null })).code, 0)
})

test('strict schema rejects the missing, reordered or non-unique operation request identity', async () => {
  for (const index of [null, { ...operationIndex, cols: 'action,request_key,user_id' }, { ...operationIndex, nonUnique: 1 }]) {
    const result = await reconcile({ index })
    assert.equal(result.code, 1)
    assert.match(result.diagnostics, /operation_requests\.uk_operation_requests_key/)
  }
})

test('strict schema rejects a missing, non-JSON or nonnullable cash projection after migration 292', async () => {
  for (const column of [null, { ...projectionColumn, dataType: 'text', columnType: 'text' }, { ...projectionColumn, isNullable: 'NO' }]) {
    const result = await reconcile({ column })
    assert.equal(result.code, 1)
    assert.match(result.diagnostics, /payment_records\.cash_projection/)
  }
})

test('strict schema requires all three batch proof revision columns and before-update triggers after 301', async () => {
  assert.equal((await reconcile({ through301: true })).code, 0)
  const absent = await reconcile({ through301: true, columns: proofColumns.slice(1), triggers: proofTriggers.slice(0, 2) })
  assert.equal(absent.code, 1)
  assert.match(absent.diagnostics, /operation_requests\.batch_proof_revision/)
  assert.match(absent.diagnostics, /trg_payment_record_events_batch_proof/)
  const broken = await reconcile({ through301: true, triggers: proofTriggers.map(row => row.tbl === 'sale_order_events'
    ? { ...row, body: 'SET NEW.batch_proof_revision = OLD.batch_proof_revision' } : row) })
  assert.equal(broken.code, 1)
  assert.match(broken.diagnostics, /trg_sale_order_events_batch_proof/)
})
