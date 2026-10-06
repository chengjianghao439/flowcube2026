'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const ExcelJS = require('../backend/node_modules/exceljs')
process.env.JWT_SECRET = 'security-import-offline-fixture-secret-only-20261006'
const writes = []
const dbId = require.resolve('../backend/src/config/db')
require.cache[dbId] = { id: dbId, filename: dbId, loaded: true, exports: { pool: { query: async (sql) => { writes.push(sql); return sql.startsWith('SELECT') ? [[]] : [{ insertId: 1, affectedRows: 1 }] }, getConnection: async () => { throw new Error('budget rejection must precede transaction') } } } }
const service = require('../backend/src/modules/import/import.service')
async function rejectedWithoutWrites(fn, code = 'IMPORT_BUDGET_EXCEEDED') { writes.length = 0; await assert.rejects(fn(), e => e.code === code); assert.equal(writes.length, 0, 'budget rejected before any DB query') }
test('CSV row budget rejects the whole customer import before DB work', async () => {
  const csv = 'code,name,contact,phone,settlement,credit\n' + Array.from({ length: 1001 }, (_, i) => `C${i},fixture,,,,`).join('\n')
  await rejectedWithoutWrites(() => service.importCustomers({ fileBuffer: Buffer.from(csv) }))
})
test('entity column budget rejects stock CSV before creating import batch', async () => {
  await rejectedWithoutWrites(() => service.importStock({ fileBuffer: Buffer.from('code,warehouse,qty,extra\nP1,1,1,bad\n') }))
})
test('single-cell string budget rejects CSV before partial masterdata writes', async () => {
  await rejectedWithoutWrites(() => service.importSuppliers({ fileBuffer: Buffer.from(`code,name\nS1,${'x'.repeat(2049)}\n`) }))
})
test('high-ratio XLSX rejects before workbook parsing and DB work', async () => {
  const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('fixture'); sheet.addRow(['code', 'name']); sheet.addRow(['C1', 'x'.repeat(1000000)])
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  await rejectedWithoutWrites(() => service.importCustomers({ fileBuffer: buffer }))
})
test('a huge sparse XLSX coordinate is rejected before DB work', async () => {
  const wb = new ExcelJS.Workbook(); const sheet = wb.addWorksheet('fixture'); sheet.addRow(['code', 'name']); sheet.getCell('XFD1048576').value = 'sparse'
  const buffer = Buffer.from(await wb.xlsx.writeBuffer())
  await rejectedWithoutWrites(() => service.importProducts({ fileBuffer: buffer }))
})
const { parseBudgetedRows, preflightZip, LIMITS, importAdmission } = require('../backend/src/modules/import/importBudget')
const express = require('../backend/node_modules/express')
const JSZip = require('../backend/node_modules/jszip')
test('valid templates and settlement text preserve the existing first-sheet contract', async () => {
  const rows = await parseBudgetedRows(Buffer.from('code,name,contact,phone,settlement,credit\nC1,fixture,,,01,500\n'), { entity: 'customers', preserveSettlementLexeme: true })
  assert.equal(rows[1][4], '01')
  for (const [entity, builder] of [['products', service.buildProductTemplate], ['customers', service.buildCustomerTemplate], ['suppliers', service.buildSupplierTemplate]]) {
    const template = await builder()
    const parsed = await parseBudgetedRows(Buffer.from(template.buffer), { entity, preserveSettlementLexeme: true })
    assert.equal(parsed.length, 2)
  }
})
test('CSV record strings, rows, and columns accept their precise boundaries', async () => {
  const text = 'x'.repeat(2048)
  const csv = 'code,name\n' + Array.from({ length: 1000 }, (_, i) => `C${i},${i ? 'fixture' : text}`).join('\n')
  const rows = await parseBudgetedRows(Buffer.from(csv), { entity: 'customers', preserveSettlementLexeme: true })
  assert.equal(rows.length, 1001); assert.equal(rows[1][1].length, 2048)
})
test('ZIP directory entry count is bounded before launching parser', async () => {
  const zip = new JSZip(); for (let i = 0; i <= LIMITS.zipEntries; i++) zip.file(`x${i}`, 'fixture')
  const packed = await zip.generateAsync({ type: 'nodebuffer' })
  assert.throws(() => preflightZip(packed), e => e.code === 'IMPORT_BUDGET_EXCEEDED')
})
test('declared expanded size cannot hide a larger actual inflation', async () => {
  const wb = new ExcelJS.Workbook(); wb.addWorksheet('fixture').addRows([['code','name'], ['C1','fixture']])
  const packed = Buffer.from(await wb.xlsx.writeBuffer()), entries = preflightZip(packed)
  const target = entries.find(e => e.name === 'xl/sharedStrings.xml')
  let off = packed.readUInt32LE(packed.length - 6)
  // Find the central directory independently of the returned data ranges.
  for (let i = 0; i < packed.length - 46; i++) if (packed.readUInt32LE(i) === 0x02014b50) {
    const n = packed.readUInt16LE(i + 28)
    if (packed.subarray(i + 46, i + 46 + n).toString() === target.name) { off = i; break }
  }
  packed.writeUInt32LE(1, off + 24)
  const local = packed.readUInt32LE(off + 42); packed.writeUInt32LE(1, local + 22)
  await assert.rejects(parseBudgetedRows(packed, { entity: 'customers' }), e => ['IMPORT_BUDGET_EXCEEDED', 'IMPORT_FILE_INVALID'].includes(e.code))
})
test('parser concurrency rejects excess work and releases slots after success and timeout', async () => {
  const data = Buffer.from('code,name\nC1,fixture\n')
  const first = parseBudgetedRows(data, { entity: 'customers' }), second = parseBudgetedRows(data, { entity: 'customers' })
  await assert.rejects(parseBudgetedRows(data, { entity: 'customers' }), e => e.code === 'IMPORT_BUSY')
  await Promise.all([first, second])
  await assert.rejects(parseBudgetedRows(data, { entity: 'customers', timeoutMs: 1 }), e => e.code === 'IMPORT_BUDGET_EXCEEDED')
  assert.equal((await parseBudgetedRows(data, { entity: 'customers' })).length, 2)
})
test('real fork launch failure closes both parser slots and a later valid fork succeeds', async () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm')
  const childProcess = require('node:child_process'), { createRequire } = require('node:module')
  const filename = require.resolve('../backend/src/modules/import/importBudget')
  const localRequire = createRequire(filename), isolated = { exports: {} }
  let failStart = true
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    require: id => id === 'node:child_process' ? { fork: (file, args, options) => childProcess.fork(file, args, {
      ...options, ...(failStart ? { execPath: path.join(__dirname, 'does-not-exist-import-node') } : {}),
    }) } : localRequire(id),
    module: isolated, __dirname: path.dirname(filename), Buffer, process, setTimeout, clearTimeout,
  }, { filename })
  const parse = isolated.exports.parseBudgetedRows
  const data = Buffer.from('code,name\nC1,fixture\n')
  let timer
  const failed = await Promise.race([
    Promise.allSettled([parse(data, { entity: 'customers' }), parse(data, { entity: 'customers' })]),
    new Promise(resolve => { timer = setTimeout(() => resolve('launch error never settled on close'), 500) }),
  ]).finally(() => clearTimeout(timer))
  assert.ok(Array.isArray(failed), String(failed))
  assert.equal(failed.length, 2)
  assert.ok(failed.every(r => r.status === 'rejected' && r.reason.code === 'IMPORT_FILE_INVALID'))
  failStart = false
  assert.equal((await parse(data, { entity: 'customers' })).length, 2, 'neither failed launch consumes a parser slot')
})
test('HTTP admission rejects before allocation and releases both completed and aborted requests', async () => {
  const app = express(); let releases = [], entered = 0
  app.post('/import', importAdmission, (_req, res) => { entered++; releases.push(() => { if (!res.writableEnded && !res.destroyed) res.json({ ok: true }) }) })
  app.use((e, _req, res, _next) => res.status(e.statusCode).json({ code: e.code }))
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)) })
  const url = `http://127.0.0.1:${server.address().port}/import`
  const waitEntered = async n => { for (let i = 0; i < 100 && entered < n; i++) await new Promise(resolve => setTimeout(resolve, 5)); assert.equal(entered, n) }
  const abort = new AbortController()
  try {
    const first = fetch(url, { method: 'POST', signal: abort.signal }).catch(e => e)
    const second = fetch(url, { method: 'POST' })
    await waitEntered(2)
    const rejected = await fetch(url, { method: 'POST' }); assert.equal(rejected.status, 429)
    abort.abort(); await first; await new Promise(resolve => setTimeout(resolve, 20))
    const third = fetch(url, { method: 'POST' }); await waitEntered(3)
    releases[1](); releases[2](); assert.equal((await second).status, 200); assert.equal((await third).status, 200)
  } finally { for (const release of releases) release(); await new Promise(resolve => server.close(resolve)) }
})
