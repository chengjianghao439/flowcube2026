const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const Module = require('node:module')
const crypto = require('node:crypto')
const ROOT = path.resolve(__dirname, '..')
// 离线回归只替换数据库边界，禁止加载本地配置或建立连接。
const dbPath = require.resolve('../backend/src/config/db')
require.cache[dbPath] = { exports: { pool: { query: async () => { throw new Error('UNEXPECTED_SQL') } } } }

function load(relative, stubs = {}) {
  const filename = path.join(ROOT, relative)
  const mod = new Module(filename, module)
  mod.filename = filename
  mod.paths = Module._nodeModulePaths(path.dirname(filename))
  mod.require = name => Object.hasOwn(stubs, name) ? stubs[name] : Module.createRequire(filename)(name)
  mod._compile(fs.readFileSync(filename, 'utf8'), filename)
  return mod.exports
}
const AppError = require('../backend/src/utils/AppError')
const scope = require('../backend/src/utils/warehouseScope')
const dbStub = pool => ({ '../../config/db': { pool }, '../../utils/warehouseScope': scope })

test('公开的工作站ID和打印机编码不能完成任务', async () => {
  const pool = { query: async sql => sql.includes('print_jobs') ? [[{ printer_id: 7, warehouse_id: 1 }]] : [[{ id: 7, client_id: 'desktop:victim' }]] }
  const { validateJobPrinterHeader } = load('backend/src/modules/print-jobs/print-jobs.middleware.js', dbStub(pool))
  for (const headers of [{ 'x-client-id': 'desktop:victim' }, { 'x-printer-code': 'PUBLIC' }]) {
    let error
    await validateJobPrinterHeader({ params: { id: 1 }, headers, user: { warehouseIds: [1] } }, {}, e => { error = e })
    assert.equal(error?.statusCode, 401)
  }
})

test('单份UTF8与展开预算在任何SQL前拒绝', async () => {
  const command = load('backend/src/modules/print-jobs/print-jobs.command.js', {
    ...dbStub({ query: async () => { throw new Error('UNEXPECTED_SQL') } }),
  })
  for (const [content, copies] of [['中'.repeat(400000), 1], ['x'.repeat(100000), 100]]) {
    await assert.rejects(command.create({ title: '预算', contentType: 'zpl', content, copies }), e => e instanceof AppError && e.code === 'PRINT_CONTENT_BUDGET_EXCEEDED')
  }
})

test('业务事务内标签超预算仍降级FAILED记录，沿用调用方连接', async () => {
  const conn = { ownedTransaction: true }
  let recorded
  const labels = load('backend/src/modules/print-jobs/print-jobs.label-command.js', {
    ...dbStub({ query: async () => { throw new Error('UNEXPECTED_SQL') } }),
    '../../utils/logger': { warn: () => {} },
    './print-dispatch': { resolvePrinterForJob: async () => ({ printerId: 7 }) },
    './labelVariables': { containerLabelVariables: () => ({}) },
    './labelZplTemplate': { getLabelZplFromDefaultTemplate: async () => '中'.repeat(400000) },
    './print-jobs.command': { create: async () => { throw new Error('MUST_USE_TRANSACTION') }, createWithinTransaction: async (executor, args) => {
      assert.equal(executor, conn); recorded = args
      return { id: 1, status: 3, printerId: null, errorMessage: args.unprintableReason }
    } },
  })
  const result = await labels.enqueueContainerLabelJob({ conn, warehouseId: 1, data: { container_code: 'I-BUDGET', qty: 1 } })
  assert.equal(result.unprintable, true)
  assert.equal(recorded.unprintableReason, 'label render failed: PRINT_CONTENT_BUDGET_EXCEEDED')
  assert.equal(recorded.content, '')
})

test('单据模板元素和表列在持久化前拒绝', async () => {
  const service = load('backend/src/modules/print-templates/print-templates.service.js', dbStub({ query: async () => { throw new Error('UNEXPECTED_SQL') } }))
  const el = { id: 'a', type: 'table', fieldKey: 'items', label: '', x: 0, y: 0, width: 100, height: 20, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: true }
  for (const layout of [{ elements: Array.from({ length: 129 }, (_, i) => ({ ...el, id: String(i) })) }, { elements: [{ ...el, tableColumns: Array(11).fill('name') }] }]) {
    await assert.rejects(service.create({ name: '越界', type: 1, layout }), e => e instanceof AppError && e.code === 'PRINT_DOCUMENT_LAYOUT_INVALID')
  }
})

test('存量单据模板读取也拒绝超界，标准字段兼容', async () => {
  const el = { id: 'a', type: 'text', fieldKey: 'name', label: '', x: 0, y: 0, width: 100, height: 20, fontSize: 9, fontWeight: 'normal', textAlign: 'left', border: true }
  let row = { id: 1, type: 1, layout_json: JSON.stringify({ elements: [el] }) }
  const service = load('backend/src/modules/print-templates/print-templates.service.js', dbStub({ query: async () => [[row]] }))
  assert.equal((await service.findById(1)).layout.elements.length, 1)
  row = { ...row, layout_json: JSON.stringify({ elements: Array.from({ length: 129 }, (_, i) => ({ ...el, id: String(i) })) }) }
  await assert.rejects(service.findById(1), e => e.code === 'PRINT_DOCUMENT_LAYOUT_INVALID')
})

test('旧工作站打印机仍能停用，但不能更换到未注册工作站', async () => {
  const row = { id: 1, name: 'legacy', type: 1, code: 'L', status: 1, warehouse_id: 1, client_id: 'legacy' }
  let writes = 0
  const conn = { beginTransaction: async () => {}, commit: async () => {}, rollback: async () => {}, release: () => {}, query: async sql => {
    if (sql.includes('FROM printers')) return [[row]]
    if (sql.includes('FROM print_clients')) return [[{ client_id: 'new', warehouse_id: 1, credential_hash: null }]]
    writes++; return [{ affectedRows: 1 }]
  } }
  const service = load('backend/src/modules/printers/printers.service.js', dbStub({ getConnection: async () => conn, query: async () => [[row]] }))
  await service.update(1, { status: 0, clientId: 'legacy', warehouseId: 1 }, [1])
  assert.equal(writes, 1)
  await assert.rejects(service.update(1, { clientId: 'new' }, [1]), e => e.code === 'PRINT_CLIENT_NOT_REGISTERED')
  assert.equal(writes, 1)
})

test('用途绑定锁定打印机仓库直到写入，外仓拒绝且回滚', async () => {
  const events = []
  let warehouse = 1
  const conn = { beginTransaction: async () => events.push('begin'), commit: async () => events.push('commit'), rollback: async () => events.push('rollback'), release: () => events.push('release'), query: async sql => {
    if (sql.includes('SELECT')) { assert.match(sql, /FOR UPDATE/); events.push('lock'); return [[{ id: 1, code: 'P', warehouse_id: warehouse, device_type: 1 }]] }
    events.push('write'); return [{ affectedRows: 1 }]
  } }
  const service = load('backend/src/modules/printer-bindings/printer-bindings.service.js', dbStub({ getConnection: async () => conn }))
  await service.bind('product_label', 1, 1, [1])
  assert.deepEqual(events, ['begin', 'lock', 'write', 'commit', 'release'])
  events.length = 0; warehouse = 2
  await assert.rejects(service.bind('product_label', 1, 1, [1]), e => e.code === 'WAREHOUSE_SCOPE_DENIED')
  assert.deepEqual(events, ['begin', 'lock', 'rollback', 'release'])
})

test('打印机全局资源对限仓用户关闭', async () => {
  const service = load('backend/src/modules/printers/printers.service.js', dbStub({ query: async () => [[{ id: 1, warehouse_id: null, type: 1 }]] }))
  await assert.rejects(service.findById(1, [1]), e => e.code === 'WAREHOUSE_SCOPE_DENIED')
  await assert.rejects(service.create({ name: 'A', code: 'A', type: 1, warehouseId: 2 }, [1]), e => e.code === 'WAREHOUSE_SCOPE_DENIED')
})

test('打印统计和健康SQL携带仓库限制，列表分页有界', async () => {
  const calls = []
  const pool = { query: async (sql, params) => { calls.push({ sql, params }); return sql.includes('COUNT') ? [[{ c: 0, total: 0 }]] : [[]] } }
  const q = load('backend/src/modules/print-jobs/print-jobs.query.js', dbStub(pool))
  await q.getStatsCounts([1])
  await q.listPrinterHealth([1])
  assert.ok(calls.every(c => /warehouse_id IN/.test(c.sql)))
  calls.length = 0
  const result = await q.findAll({ pageSize: 999999, page: 1, scopeWarehouseIds: [] })
  assert.equal(result.pagination.pageSize, 500)
  assert.equal(result.pagination.page, 1)
})

test('任务列表只读取metadata，详情仍能取单份内容', async () => {
  const calls = []
  const pool = { query: async sql => {
    calls.push(sql)
    if (sql.includes('COUNT')) return [[{ total: 1 }]]
    return [[{ id: 1, status: 0, title: 'bounded', content_type: 'zpl', ...(sql.includes('j.*') ? { content: 'x'.repeat(1024 * 1024) } : {}) }]]
  } }
  const q = load('backend/src/modules/print-jobs/print-jobs.query.js', dbStub(pool))
  const result = await q.findAll({ pageSize: 500 })
  assert.ok(!/j\.\*|j\.content\b/.test(calls[0]), '列表不得把500份正文加载进进程')
  assert.ok(!Object.hasOwn(result.list[0], 'content'), 'metadata列表不返回正文')
  assert.equal((await q.findById(1)).content.length, 1024 * 1024)
})

test('打印列表与三类条码分页拒绝非有限整数及不安全offset，不执行SQL', async () => {
  const q = load('backend/src/modules/print-jobs/print-jobs.query.js', dbStub({ query: async () => { throw new Error('UNEXPECTED_SQL') } }))
  for (const paging of [{ pageSize: Infinity }, { page: 'Infinity' }, { page: NaN }, { page: 1.5 }, { pageSize: 1.5 }, { page: 0 }, { pageSize: -1 }, { page: Number.MAX_SAFE_INTEGER, pageSize: 500 }]) {
    for (const list of [options => q.findAll(options), ...['inbound', 'outbound', 'logistics'].map(category => options => q.findBarcodeRecords({ ...options, category }))]) {
      await assert.rejects(list(paging), e => e instanceof AppError && e.statusCode === 400)
    }
  }
})

test('物流条码列表及入出库派生表只取metadata，不读取任何正文', async () => {
  const calls = []
  const pool = { query: async sql => { calls.push(sql); return sql.includes('SELECT COUNT(*) AS total') ? [[{ total: 0 }]] : [[]] } }
  const q = load('backend/src/modules/print-jobs/print-jobs.query.js', {
    ...dbStub(pool), '../../utils/inboundThresholds': { getInboundClosureThresholds: async () => ({ printTimeoutMinutes: 30 }) },
  })
  for (const category of ['logistics', 'inbound', 'outbound']) await q.findBarcodeRecords({ category, pageSize: 500 })
  assert.equal(calls.length, 6)
  assert.ok(calls.every(sql => !/j\.\*|j\.content\b/.test(sql)), '条码列表及计数派生表不得读取500份正文')
})

test('raw ZPL先计UTF8替换预算，超限不构建展开结果，每变量只sanitize一次', () => {
  const { applyZplTemplate } = require('../backend/src/modules/print-jobs/labelZpl')
  const body = '^XA' + '{{product_name}}'.repeat(20000) + '^XZ'
  let reads = 0; let resultReplaces = 0
  const vars = Object.defineProperty({}, 'product_name', { enumerable: true, get: () => { reads++; return '中'.repeat(100) } })
  const originalReplace = String.prototype.replace
  String.prototype.replace = function (...args) {
    if (String(this) === body) resultReplaces++
    return originalReplace.apply(this, args)
  }
  try {
    assert.throws(() => applyZplTemplate(body, vars), e => e.code === 'PRINT_CONTENT_BUDGET_EXCEEDED')
    assert.equal(resultReplaces, 0, '超限不能进入生成替换结果阶段')
    assert.equal(reads, 1, '重复占位符缓存同一sanitize结果')
  } finally { String.prototype.replace = originalReplace }
  assert.equal(Buffer.byteLength(applyZplTemplate('^XA{{x}}^XZ', { x: 'x'.repeat(1024 * 1024 - 6) }), 'utf8'), 1024 * 1024)
})

test('旧raw模板先拒绝原始body预算，不能靠trim或变量收缩绕过', async () => {
  const body = ' '.repeat(1024 * 1024) + '^XA{{name}}^XZ'
  let reads = 0
  const vars = Object.defineProperty({}, 'name', { enumerable: true, get: () => { reads++; return '' } })
  const service = load('backend/src/modules/print-jobs/labelZplTemplate.js', dbStub({ query: async () => [[{ layout_json: { format: 'zpl', body } }]] }))
  await assert.rejects(service.getLabelZplFromDefaultTemplate(8, vars), e => e.code === 'PRINT_CONTENT_BUDGET_EXCEEDED')
  assert.equal(reads, 0)
})

test('Unix RAW使用私有目录并在lp失败后清理，旧可预测路径不触碰', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-print-security-test-'))
  const victim = path.join(tmp, 'victim')
  fs.writeFileSync(victim, 'keep')
  const old = path.join(tmp, `fc_desktop_zpl_${Date.now()}.zpl`)
  fs.symlinkSync(victim, old)
  let observed
  let fileFlags
  const printer = load('desktop/lib/localPrint.js', {
    fs: { ...fs, writeFileSync: (file, content, options) => { fileFlags = options.flag; return fs.writeFileSync(file, content, options) } },
    os: { ...os, tmpdir: () => tmp, platform: () => 'linux' },
    child_process: { execFile: (_cmd, args, cb) => {
      const filename = args.at(-1)
      observed = { filename, dir: path.dirname(filename), fileMode: fs.statSync(filename).mode & 0o777, dirMode: fs.statSync(path.dirname(filename)).mode & 0o777 }
      cb(new Error('controlled lp failure'))
    } },
  })
  try {
    await assert.rejects(printer.printZpl({ printerName: 'test', content: '^XA^FDtest^FS^XZ' }), /controlled lp failure/)
    assert.notEqual(observed.dir, tmp)
    assert.equal(observed.fileMode, 0o600)
    assert.equal(observed.dirMode, 0o700)
    assert.equal(fileFlags, 'wx')
    assert.equal(fs.existsSync(observed.dir), false)
    assert.equal(fs.readFileSync(victim, 'utf8'), 'keep')
  } finally { fs.rmSync(tmp, { recursive: true, force: true }) }
})

test('Electron主进程预算重检，100份只顺序提交单份内容，错误立即停止', async () => {
  const { printBoundedBatch } = require('../desktop/lib/printBudget')
  const content = '^XA^FDTEST^FS^XZ'
  let calls = 0
  await printBoundedBatch({ content, printerName: 'virtual', copies: 100 }, async opts => { assert.equal(opts.content, content); calls++ })
  assert.equal(calls, 100)
  await assert.rejects(printBoundedBatch({ content: '中'.repeat(400000), copies: 1 }, async () => { throw new Error('UNEXPECTED_RAW') }), /1 MiB/)
  await assert.rejects(printBoundedBatch({ content: 'x'.repeat(100000), copies: 100 }, async () => { throw new Error('UNEXPECTED_RAW') }), /8 MiB/)
  calls = 0
  await assert.rejects(printBoundedBatch({ content, copies: 100 }, async () => { calls++; throw new Error('partial') }), /partial/)
  assert.equal(calls, 1)
})

test('工作站身份随机、凭据按服务器加密保存；安全存储不可用仅内存', () => {
  const { createPrintClientIdentity } = require('../desktop/lib/printClientIdentity')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fc-print-identity-test-'))
  const credential = crypto.randomBytes(32).toString('hex')
  const key = crypto.randomBytes(32)
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: text => { const iv = crypto.randomBytes(16); const cipher = crypto.createCipheriv('aes-256-cbc', key, iv); return Buffer.concat([iv, cipher.update(text), cipher.final()]) },
    decryptString: buf => { const decipher = crypto.createDecipheriv('aes-256-cbc', key, buf.subarray(0, 16)); return Buffer.concat([decipher.update(buf.subarray(16)), decipher.final()]).toString() },
  }
  try {
    const first = createPrintClientIdentity({ userDataPath: dir, safeStorage, hostname: 'public-host' })
    assert.match(first.getInfo().clientId, /^desktop:[a-f0-9-]{36}$/)
    assert.ok(!first.getInfo().clientId.includes('public-host'))
    assert.deepEqual(first.setCredential('https://server-a.invalid', credential), { persisted: true })
    const second = createPrintClientIdentity({ userDataPath: dir, safeStorage, hostname: 'public-host' })
    assert.equal(second.getInfo().clientId, first.getInfo().clientId)
    assert.equal(second.getCredential('https://server-a.invalid'), credential)
    assert.equal(second.getCredential('https://server-b.invalid'), null)
    for (const filename of fs.readdirSync(dir)) assert.ok(!fs.readFileSync(path.join(dir, filename)).includes(Buffer.from(credential)))
    const memoryOnly = createPrintClientIdentity({ userDataPath: dir, safeStorage: { isEncryptionAvailable: () => false }, hostname: 'test' })
    const before = fs.readdirSync(dir)
    assert.deepEqual(memoryOnly.setCredential('https://server-b.invalid', credential), { persisted: false })
    assert.equal(memoryOnly.getCredential('https://server-b.invalid'), credential)
    assert.deepEqual(fs.readdirSync(dir), before)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})
