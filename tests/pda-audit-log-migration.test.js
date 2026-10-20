'use strict'
// Offline contracts only: real source/SQL parsing and narrow fake SQL transport; no env, app or DB import.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const root = path.resolve(__dirname, '..')
const migration = '293_pda_audit_logs_formal_schema.sql'
const { splitSqlStatements } = require('../backend/src/database/sqlStatements')
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8')
const stripComments = text => text.split('\n').filter(line => !/^\s*(?:-- |\/\/)/.test(line)).join('\n')
function migrationSql() {
  assert.ok(fs.existsSync(path.join(root, 'backend/src/database', migration)), 'PDA 293 must exist')
  return read('backend/src/database/' + migration)
}
function migrationModule() {
  const file = path.join(root, 'backend/src/database/migrate.js'), module = { exports: {} }
  const deps = { fs, path, 'mysql2/promise': { createConnection() { throw new Error('offline DB forbidden') } }, '../config/env': { env: {} }, './sqlStatements': { splitSqlStatements } }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, __dirname: path.dirname(file), console, require(name) { assert.ok(Object.hasOwn(deps, name), 'unexpected migration dependency'); return deps[name] } }, { filename: file })
  return module.exports
}
function auditFixture(fail = false) {
  const queries = [], warnings = [], noop = () => {}
  const pool = { async query(sql, params) { queries.push({ sql, params }); if (fail) throw Object.assign(new Error('synthetic missing audit table'), { code: 'ER_NO_SUCH_TABLE' }); return [{ affectedRows: 1 }] } }
  const deps = {
    '../../utils/qtyPrecision': require('../backend/src/utils/qtyPrecision'),
    '../../utils/unitConversion': require('../backend/src/utils/unitConversion'),
    '../fulfillment/fulfillment.refresh': {}, '../../config/db': { pool },
    '../../utils/AppError': require('../backend/src/utils/AppError'),
    '../../utils/warehouseScope': { scopeFilter: () => ({ sql: '', params: [] }), assertInScope: noop },
    '../../utils/sqlIdentifier': require('../backend/src/utils/sqlIdentifier'),
    '../../engine/containerEngine': {}, '../../constants/warehouseTaskStatus': {},
    '../warehouse-tasks/warehouse-tasks.service': {}, '../warehouse-tasks/warehouse-task-events.service': {},
    '../warehouse-tasks/warehouse-tasks.helpers': {}, '../../utils/operationRequest': {},
    '../../utils/logger': { warn(...args) { warnings.push(args) } },
  }
  const file = path.join(root, 'backend/src/modules/scan-logs/scan-logs.service.js'), module = { exports: {} }
  vm.runInNewContext(fs.readFileSync(file, 'utf8'), { module, require(name) { assert.ok(Object.hasOwn(deps, name), 'unexpected scan-log dependency'); return deps[name] } }, { filename: file })
  return { service: module.exports, queries, warnings }
}

test('293 has its predecessor, no number collision and the original statement executor', () => {
  const files = fs.readdirSync(path.join(root, 'backend/src/database')).filter(f => f.endsWith('.sql')).sort()
  assert.ok(files.includes(migration), 'PDA 293 must exist')
  assert.equal(files.filter(f => /^293_/.test(f)).length, 1)
  assert.equal(files.filter(f => /^292_/.test(f)).length, 1, 'the original predecessor must still exist')
  assert.equal(migrationModule().checkMigrationGaps(files).newDuplicates.length, 0)
  assert.ok(splitSqlStatements(migrationSql()).length > 20)
  assert.doesNotMatch(migrationSql(), /\bDELIMITER\b/i)
})
test('both complete metadata preflights precede every CREATE or ALTER, including prepared SQL', () => {
  const statements = splitSqlStatements(stripComments(migrationSql()))
  const firstDdl = statements.findIndex(s => /\b(?:CREATE|ALTER)\s+TABLE\b/i.test(s))
  assert.ok(firstDdl > 0, 'no DDL may run before both-table preflight')
  const preflight = statements.slice(0, firstDdl).join('\n')
  for (const table of ['pda_error_logs', 'pda_undo_logs']) assert.ok(preflight.includes(table), table + ' must be preflighted before any DDL')
  for (const metadata of ['TABLES', 'COLUMNS', 'STATISTICS', 'TABLE_CONSTRAINTS']) assert.ok(preflight.includes('information_schema.' + metadata))
  for (const field of ['COLUMN_TYPE', 'IS_NULLABLE', 'COLUMN_DEFAULT', 'GENERATION_EXPRESSION', 'ORDINAL_POSITION', 'NON_UNIQUE', 'SEQ_IN_INDEX', 'SUB_PART', 'IS_VISIBLE', 'EXPRESSION']) assert.ok(preflight.includes(field), 'missing metadata contract: ' + field)
  assert.ok(preflight.includes('PRIMARY'))
  assert.equal((preflight.match(/EXECUTE\s+pda293_stmt/g) || []).length, 2, 'both preflight guards execute before mutation')
})
test('fresh schema preserves signed INT, nullable defaults, decimal scale and timestamp type', () => {
  const sql = stripComments(migrationSql())
  for (const table of ['pda_error_logs', 'pda_undo_logs']) {
    const create = sql.match(new RegExp('CREATE TABLE IF NOT EXISTS `' + table + '` \\(([^]*?)\\) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'))
    assert.ok(create, table)
    assert.match(create[1], /`id`\s+INT\s+NOT NULL AUTO_INCREMENT/)
    assert.match(create[1], /`created_at`\s+TIMESTAMP\s+NULL DEFAULT CURRENT_TIMESTAMP/)
    assert.match(create[1], /PRIMARY KEY \(`id`\)/)
    assert.doesNotMatch(create[1], /UNSIGNED|DATETIME|BIGINT/)
  }
  assert.equal((sql.match(/`(?:prev|new)_qty`\s+DECIMAL\(10,2\)\s+DEFAULT NULL/g) || []).length, 2)
  assert.doesNotMatch(sql, /\b(?:DROP\s+TABLE|TRUNCATE|DELETE\s+FROM|UPDATE\s+`?pda_)\b/i)
})
test('audit writes issue only the original INSERT and preserve input fields and two decimals', async () => {
  const f = auditFixture()
  await f.service.logScanError({ taskId: 8, barcode: 'synthetic-码🙂', reason: '夹具', operatorId: 4, operatorName: '合成' })
  await f.service.logUndo({ taskId: 8, itemId: 9, barcode: 'synthetic-码🙂', prevQty: 1.25, newQty: 0.5, operatorId: 4, operatorName: '合成' })
  assert.equal(f.queries.length, 2, 'request-time DDL must be removed')
  assert.match(f.queries[0].sql, /^INSERT INTO pda_error_logs/)
  assert.deepEqual(Array.from(f.queries[0].params), [8, 'synthetic-码🙂', '夹具', 4, '合成'])
  assert.match(f.queries[1].sql, /^INSERT INTO pda_undo_logs/)
  assert.deepEqual(Array.from(f.queries[1].params), [8, 9, 'synthetic-码🙂', 1.25, 0.5, 4, '合成'])
  assert.equal(f.warnings.length, 0)
})
test('invalid undo precision is rejected before optional logging and before any SQL', async () => {
  const f = auditFixture(true)
  await assert.rejects(f.service.logUndo({ taskId: 8, prevQty: 0.001, newQty: 0 }), { code: 'QTY_DECIMALS_EXCEEDED' })
  assert.equal(f.queries.length, 0); assert.equal(f.warnings.length, 0)
})
test('missing tables retain audit/report degradation and never trigger DDL', async () => {
  const f = auditFixture(true)
  await f.service.logScanError({ taskId: 8, reason: '夹具' })
  await f.service.logUndo({ taskId: 8, prevQty: 1.25, newQty: 0.5 })
  const report = await f.service.getAnomalyReport()
  assert.equal(report.summary.totalErrors, 0); assert.equal(report.summary.totalUndos, 0)
  assert.ok(f.warnings.length >= 8)
  assert.ok(f.queries.every(q => /^\s*(?:INSERT INTO pda_(?:error|undo)_logs|SELECT\b)/.test(q.sql)), 'no CREATE/ALTER or unexpected swallowed query')
  assert.ok(f.warnings.slice(0, 2).every(w => w[1].degradation === 'pda_audit_log_failed'))
})
test('schema reconciliation and retention use the migration without changing 180-day policy', () => {
  const service = stripComments(read('backend/src/modules/scan-logs/scan-logs.service.js'))
  assert.doesNotMatch(service, /\b(?:CREATE|ALTER|DROP)\s+TABLE\b/i)
  assert.doesNotMatch(service, /ensurePda(?:Error|Undo)Logs/)
  const reconcile = read('backend/scripts/schema-reconcile.js').match(/KNOWN_RUNTIME_TABLES = new Set\(([^)]*)\)/)[1]
  assert.doesNotMatch(reconcile, /pda_error_logs|pda_undo_logs/)
  assert.match(read('backend/src/scheduler.js'), /for \(const t of \['pda_error_logs', 'pda_undo_logs'\]\)[^]*?INTERVAL 180 DAY/)
})
test('new offline and owned suites are reachable in CI, with no permission-probe entry added', () => {
  const p = JSON.parse(read('package.json')), ci = read('.github/workflows/test.yml'), runner = read('scripts/repair-smoke-ephemeral.sh')
  assert.equal(p.scripts['test:pda-audit-log-migration'], 'node --test tests/pda-audit-log-migration.test.js')
  assert.equal(p.scripts['smoke:pda-audit-log-migration-runtime'], 'node --test tests/pda-audit-log-migration.smoke.test.js')
  assert.equal(p.scripts['smoke:pda-audit-log-migration-owned'], 'bash scripts/repair-smoke-ephemeral.sh --pda-audit-log-migration')
  assert.match(ci, /run: npm run test:pda-audit-log-migration/)
  assert.match(ci, /run: npm run smoke:pda-audit-log-migration-owned/)
  const lane = runner.match(/elif \[\[ "\$SUITE" = '--pda-audit-log-migration' \]\]; then([^]*?)\nelse/)
  assert.ok(lane); assert.match(lane[1], /run_smoke smoke:pda-audit-log-migration-runtime/)
  const pdaBranches = runner.split('\n').filter(line => /^elif /.test(line) && line.includes("'--pda-audit-log-migration'"))
  assert.equal(pdaBranches.length, 1, 'PDA mode must not enter another suite earlier')
  assert.equal(pdaBranches[0], "elif [[ \"$SUITE\" = '--pda-audit-log-migration' ]]; then")
  assert.doesNotMatch(lane[1], /relatedEvents|change-records|go-live|inbound-edit/)
  // Exercise the actual existing CI-reachability predicate, including its
  // negative paths; a local-only substring check cannot prove global CI wiring.
  const policy = read('tests/deployment-resources.test.js')
  const begin = policy.indexOf('  const isReached = (name) => {')
  const end = policy.indexOf('  const testScripts =', begin)
  assert.ok(begin >= 0 && end > begin)
  function reached({ scripts = p.scripts, workflow = ci, source = runner } = {}) {
    const module = { exports: null }
    vm.runInNewContext(policy.slice(begin, end) + "\nmodule.exports = isReached('smoke:pda-audit-log-migration-runtime')", {
      module, pkg: { scripts }, workflowText: workflow, matrixSuites: new Set(), root, path,
      fs: { readFileSync(file) { assert.equal(file, path.join(root, 'scripts/repair-smoke-ephemeral.sh')); return source } },
    })
    return module.exports
  }
  assert.equal(reached(), true, 'the actual global CI guard must recognize this owned runtime')
  assert.equal(reached({ scripts: { ...p.scripts, 'smoke:pda-audit-log-migration-owned': 'bash scripts/repair-smoke-ephemeral.sh --wrong-suite' } }), false)
  assert.equal(reached({ workflow: ci.replaceAll('npm run smoke:pda-audit-log-migration-owned', 'npm run nonexistent-suite') }), false)
  assert.equal(reached({ source: runner.replace('run_smoke smoke:pda-audit-log-migration-runtime', 'run_smoke nonexistent-suite') }), false)
})
