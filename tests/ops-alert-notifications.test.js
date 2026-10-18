'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const vm = require('node:vm')
const { spawnSync } = require('node:child_process')
const root = path.resolve(__dirname, '..')
const { createRuntimeLifecycle } = require('../backend/src/utils/runtimeLifecycle')

// 运行真实脚本；替换 Docker/HTTPS 等外部边界，机器人请求只写入本轮临时目录。
function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-alerts-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'bin'))
  fs.mkdirSync(path.join(dir, 'backups'))
  fs.cpSync(path.join(root, 'scripts'), path.join(dir, 'scripts'), {
    recursive: true, filter: file => !file.includes('node_modules'),
  })
  fs.writeFileSync(path.join(dir, 'backups', `flowcube_${new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' }).replaceAll('-', '')}_020000.sql.gz`), Buffer.alloc(2048))
  const commands = path.join(dir, 'requests.jsonl')
  const mock = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), cp = require('node:child_process');
const cmd=path.basename(process.argv[1]), a=process.argv.slice(2), s=JSON.parse(process.env.ALERT_SCENARIO);
if(cmd==='curl'){
 if(a.includes('-d')){
  fs.appendFileSync(process.env.ALERT_CAPTURE, a[a.indexOf('-d')+1]+'\\n');
  console.log(JSON.stringify({errcode:s.replyErrcode ?? (s.sendFails ? 1 : 0)})+'\\n200'); process.exit(0);
 }
 console.log(s.publicDown && a.at(-1).startsWith('https:') ? '503' : '200'); process.exit(0);
}
if(cmd==='df'){console.log('Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 10000 1000 9000 '+(s.disk||10)+'% /'); process.exit(0);}
if(cmd==='flock') process.exit(0);
if(cmd==='timeout'){
 let i=0; while(a[i]?.startsWith('-')) i+=a[i]==='-k'?2:1; i++;
 const r=cp.spawnSync(a[i],a.slice(i+1),{stdio:'inherit'}); process.exit(r.status??1);
}
if(cmd==='openssl'){if(a[0]==='x509')console.log('notAfter=Nov 16 14:56:59 2030 GMT');process.exit(0);}
if(cmd==='docker'){
 const x=a.join(' ');
 if(s.backupMissing && a[0]==='inspect') process.exit(1);
 if(a[0]==='compose') console.log('flowcube-'+a.at(-1));
 else if(a[0]==='inspect') console.log(x.includes('.Name')?'/'+a.at(-1):x.includes('.Id')?(s.containerId||'fixture-id'):x.includes('RestartCount')?String(s.restarts||0):'running');
 else if(x.includes('Threads_connected')) console.log(s.connections||7);
 else if(x.includes('echo present'))console.log('absent');
 process.exit(0);
}
process.exit(0);
`
  for (const cmd of ['docker', 'curl', 'df', 'flock', 'timeout', 'openssl']) {
    fs.writeFileSync(path.join(dir, 'bin', cmd), mock, { mode: 0o755 })
  }
  const stateFile = path.join(dir, 'backups/.monitor.state')
  const env = { ...process.env, PATH: path.join(dir, 'bin') + ':' + process.env.PATH,
    PROJECT_DIR: dir, BACKUP_DIR: path.join(dir, 'backups'), STATE_FILE: stateFile,
    DINGTALK_WEBHOOK: 'https://example.invalid/offline-only',
    DINGTALK_SECRET: '', DINGTALK_KEYWORD: '',
    ALERT_CAPTURE: commands, TZ: 'Asia/Shanghai' }
  return {
    dir, stateFile,
    run(script, scenario = {}, expectedStatus = 0) {
      const before = fs.existsSync(commands) ? fs.readFileSync(commands, 'utf8').trim().split('\n').length : 0
      const result = spawnSync('bash', [path.join(dir, 'scripts', script)], {
        cwd: dir, env: { ...env, ALERT_SCENARIO: JSON.stringify(scenario) },
        encoding: 'utf8', timeout: 20000,
      })
      assert.equal(result.status, expectedStatus, result.stdout + result.stderr)
      const messages = fs.existsSync(commands) ? fs.readFileSync(commands, 'utf8').trim().split('\n').slice(before).map(JSON.parse) : []
      return { ...result, messages, text: messages.map(m => m.text.content).join('\n') }
    },
  }
}

test('真实发送保留换行、引号及反斜杠，消息超过旧500字符不截掉尾部', t => {
  const f = fixture(t)
  const msg = '服务异常\n原因："无法访问" C:\\logs\\server\n' + '详情'.repeat(300) + '\n备份状态'
  const capture = path.join(f.dir, 'encode.json')
  const r = spawnSync('bash', ['-c', `
    . "${root}/scripts/lib/ops-common.sh"
    curl() { while [ "$#" -gt 0 ]; do if [ "$1" = -d ]; then printf '%s' "$2" > "$ALERT_CAPTURE"; break; fi; shift; done; printf '{"errcode":0}\\n200'; }
    dingtalk_send 'https://example.invalid/offline-only' "$ALERT_MESSAGE"
  `], { env: { ...process.env, PROJECT_DIR: f.dir, DINGTALK_SECRET: '', DINGTALK_KEYWORD: '',
    ALERT_CAPTURE: capture, ALERT_MESSAGE: msg }, encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(JSON.parse(fs.readFileSync(capture, 'utf8')).text.content, msg)
})

test('UTF-8超长消息保留合法字符并显式提示截断', () => {
  const { encodeMessage } = require('../scripts/lib/ops-alerts')
  const content = JSON.parse(encodeMessage('报警🙂'.repeat(4000))).text.content
  assert.ok(Buffer.byteLength(content) <= 8000)
  assert.match(content, /消息过长/)
  assert.doesNotMatch(content, /\uFFFD/)
})

test('等级升级立即通知，持续异常按间隔提醒，重启增量到期后解除', t => {
  const f = fixture(t)
  const { prepareMonitor, acknowledgeMonitor } = require('../scripts/lib/ops-alerts')
  const now = Math.floor(Date.now() / 1000), dir = path.join(f.dir, 'backups')
  const input = level => `alert\tfixture\t${level}\t夹具异常\nrestart\tbackend\tid-1\t12\n`
  assert.match(prepareMonitor(f.stateFile, input('warning'), now, 24, 3, dir), /服务器预警/)
  acknowledgeMonitor(f.stateFile, now)
  assert.equal(prepareMonitor(f.stateFile, input('warning'), now + 1, 24, 3, dir), '')
  assert.match(prepareMonitor(f.stateFile, input('critical'), now + 2, 24, 3, dir), /服务异常/)
  acknowledgeMonitor(f.stateFile, now + 2)
  assert.match(prepareMonitor(f.stateFile, input('critical'), now + 86403, 24, 3, dir), /服务异常/)
  prepareMonitor(f.stateFile, 'restart\tbackend\tid-1\t16\n', now + 86404, 24, 3, dir)
  assert.ok(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).observed['restart-backend'])
  prepareMonitor(f.stateFile, 'restart\tbackend\tid-1\t16\n', now + 86404 + 1801, 24, 3, dir)
  assert.ok(!JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).observed['restart-backend'])
})

test('服务器报警按影响、异常、数据安全、服务、资源排序', t => {
  const f = fixture(t)
  const r = f.run('monitor.sh', { disk: 90, publicDown: true })
  assert.match(r.text, /影响：/)
  for (const [a, b] of [['影响：', '异常：'], ['异常：', '数据安全：'], ['数据安全：', '服务：'], ['服务：', '资源：']]) {
    assert.ok(r.text.indexOf(a) < r.text.indexOf(b), r.text)
  }
  assert.ok(r.text.indexOf('公网') < r.text.indexOf('磁盘'), r.text)
})

test('旧bad状态中的新严重故障立即通知', t => {
  const f = fixture(t)
  fs.writeFileSync(f.stateFile, `bad ${Math.floor(Date.now() / 1000)}\n`)
  assert.equal(f.run('monitor.sh', { publicDown: true }).messages.length, 1)
})

test('逐项去重，新增故障及时通知，恢复一项仍显示剩余预警', t => {
  const f = fixture(t)
  assert.equal(f.run('monitor.sh', { disk: 90 }).messages.length, 1)
  assert.equal(f.run('monitor.sh', { disk: 91 }).messages.length, 0)
  assert.equal(f.run('monitor.sh', { disk: 91, publicDown: true }).messages.length, 1)
  const partial = f.run('monitor.sh', { disk: 91 })
  assert.equal(partial.messages.length, 1)
  assert.match(partial.text, /恢复项：.*公网/)
  assert.doesNotMatch(partial.text, /服务已恢复正常/)
  assert.match(f.run('monitor.sh').text, /服务已恢复正常/)
})

test('发送失败下一轮重试，成功后才去重', t => {
  const f = fixture(t)
  f.run('monitor.sh', { publicDown: true, sendFails: true })
  assert.equal(f.run('monitor.sh', { publicDown: true }).messages.length, 1)
  assert.equal(f.run('monitor.sh', { publicDown: true }).messages.length, 0)
})

test('累计历史重启不报警，近期新增重启报警，容器替换重置基线', t => {
  const f = fixture(t)
  assert.equal(f.run('monitor.sh', { restarts: 12 }).messages.length, 0)
  assert.equal(f.run('monitor.sh', { restarts: 16 }).messages.length, 1)
  const rebuilt = f.run('monitor.sh', { restarts: 50, containerId: 'rebuilt-id' })
  assert.match(rebuilt.text, /服务已恢复正常/)
  assert.ok(!Object.keys(JSON.parse(fs.readFileSync(f.stateFile, 'utf8')).observed).some(k => k.startsWith('restart-')))
})

test('作业消息带单号、持续时间及处理位置，失败重试、同项去重、新项及时发送', async () => {
  const filename = path.join(root, 'backend/src/modules/notifications/operation-alerts.service.js')
  assert.ok(fs.existsSync(filename), '缺少作业异常预警实现')
  const { createOperationAlertWorker } = require(filename)
  let items = [{ key: 'print:1', fingerprint: 'failed:1', title: '出库打印失败', documentNo: 'WT-fixture-1', warehouse: '测试仓',
    minutes: 12, action: '设置 → 打印记录 → 出库条码，按任务号查找并补打', path: '/settings/barcode-print-query' }]
  let succeed = false, time = 1000
  const messages = []
  const tick = createOperationAlertWorker({ query: async () => items, send: async (title, text) => { messages.push(text); return succeed },
    now: () => time, publicUrl: () => 'https://example.invalid' })
  await tick()
  succeed = true
  await tick()
  assert.equal(messages.length, 2)
  assert.match(messages[1], /WT-fixture-1/)
  assert.match(messages[1], /12 分钟/)
  assert.match(messages[1], /设置 → 打印记录/)
  await tick()
  assert.equal(messages.length, 2)
  items = [...items, { ...items[0], key: 'print:2', documentNo: 'WT-fixture-2' }]
  await tick()
  assert.equal(messages.length, 3)
  time += 86400
  await tick()
  assert.equal(messages.length, 4)
})

test('作业查询有界且只读，排除已结束任务和被补打替代的历史记录', async () => {
  const filename = path.join(root, 'backend/src/modules/notifications/operation-alerts.service.js')
  assert.ok(fs.existsSync(filename), '缺少作业异常查询')
  const { buildOperationAlerts } = require(filename)
  const sqls = []
  const exec = { query: async (sql, params) => { sqls.push({ sql, params }); return [[]] } }
  assert.deepEqual(await buildOperationAlerts(exec, { printTimeoutMinutes: 10 }), [])
  assert.equal(sqls.length, 2)
  for (const { sql } of sqls) {
    assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE)\b/i)
    assert.match(sql, /LIMIT 50/)
  }
  assert.match(sqls[0].sql, /NOT EXISTS/)
  assert.match(sqls[0].sql, /newer\.id > j\.id/)
  assert.match(sqls[0].sql, /wt\.status IN \(5,6\)/)
  assert.match(sqls[0].sql, /cancel_requested_at IS NULL/)
  assert.match(sqls[1].sql, /MAX\(sl\.scanned_at\)/)
  assert.match(sqls[1].sql, /updated_at/)
})

test('作业查询仅引用现行迁移创建的表', async () => {
  const migrations = path.join(root, 'backend/src/database')
  const createdTables = new Set(fs.readdirSync(migrations).filter(name => name.endsWith('.sql'))
    .flatMap(name => [...fs.readFileSync(path.join(migrations, name), 'utf8')
      .matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([a-z0-9_]+)/gi)].map(match => match[1])))
  const { buildOperationAlerts } = require('../backend/src/modules/notifications/operation-alerts.service')
  let queries = 0
  await buildOperationAlerts({ query: async sql => {
    queries++
    for (const [, table] of sql.matchAll(/\b(?:FROM|JOIN)\s+`?([a-z0-9_]+)/gi)) {
      assert.ok(createdTables.has(table), `作业查询引用了现行迁移未创建的表 ${table}`)
    }
    return [[]]
  } })
  assert.equal(queries, 2)
})

test('正常日报一行，异常日报先写备份问题，不能宣称收到就代表正常', t => {
  const f = fixture(t)
  f.run('monitor.sh')
  const healthy = f.run('daily-report.sh')
  assert.equal(healthy.text.split('\n').length, 1, healthy.text)
  assert.doesNotMatch(healthy.text, /收到本条即说明系统与监控均正常/)
  for (const file of fs.readdirSync(path.join(f.dir, 'backups'))) {
    if (file.endsWith('.sql.gz')) fs.unlinkSync(path.join(f.dir, 'backups', file))
  }
  const bad = f.run('daily-report.sh')
  assert.match(bad.text, /⚠️/)
  assert.ok(bad.text.indexOf('备份') < bad.text.indexOf('服务：'), bad.text)
  assert.match(bad.text, /恢复演练.*未记录/)
})

test('scheduler保留会话family清理与漂移，注册作业异常而非经营预警worker', async () => {
  const names = [], ticks = [], sqls = []
  let familyCleanups = 0
  const noop = () => {}
  const modules = {
    './utils/runtimeLifecycle': { lifecycle: createRuntimeLifecycle({ setIntervalFn: tick => { ticks.push(tick); return { unref: noop } }, clearIntervalFn: noop }) },
    './config/db': { pool: { query: async sql => { sqls.push(sql); return [[]] } } },
    './modules/auth/sessionFamilies': { cleanupSessionFamilies: async () => { familyCleanups++ } },
    './utils/logger': { info: noop, warn: noop, error: noop },
    './utils/requestContext': { runWithRequestContext: async ({ requestId }, fn) => {
      names.push(requestId)
      // Execute the real cleanup closure only; all SQL goes to this local mock.
      if (requestId === 'scheduler:refresh-session-cleanup') await fn()
    } },
  }
  const context = { module: { exports: {} }, process: { env: {} },
    require: name => modules[name] || new Proxy({}, { get: () => noop }),
    setInterval: tick => { ticks.push(tick); return { unref: noop } },
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'backend/src/scheduler.js'), 'utf8'), context)
  context.module.exports.startScheduler()
  for (const tick of ticks) await tick()
  assert.ok(names.includes('scheduler:operation-alert'))
  assert.ok(names.includes('scheduler:stock-drift-check'))
  assert.ok(!names.includes('scheduler:dingtalk-alert'))
  assert.equal(familyCleanups, 1, '三方合并必须保留安全分支的session family清理')
  assert.ok(sqls.some(sql => sql.includes('DELETE FROM refresh_token_sessions')))
})

// Only the real PDA cleanup closure runs; every module, timer and SQL boundary is local.
async function pdaCleanupSql() {
  const ticks = [], sqls = [], noop = () => {}
  const modules = {
    './utils/runtimeLifecycle': { lifecycle: createRuntimeLifecycle({ setIntervalFn: tick => { ticks.push(tick); return { unref: noop } }, clearIntervalFn: noop }) },
    './config/db': { pool: { query: async sql => { sqls.push(sql); return [[]] } } },
    './utils/logger': { info: noop, warn: noop, error: noop },
    './utils/requestContext': { runWithRequestContext: async ({ requestId }, fn) => {
      if (requestId === 'scheduler:pda-session-cleanup') await fn()
    } },
  }
  const context = { module: { exports: {} }, process: { env: {} },
    require: name => modules[name] || new Proxy({}, { get: () => noop }),
    setInterval: tick => { ticks.push(tick); return { unref: noop } },
  }
  vm.runInNewContext(fs.readFileSync(path.join(root, 'backend/src/scheduler.js'), 'utf8'), context)
  context.module.exports.startScheduler()
  for (const tick of ticks) await tick()
  assert.equal(sqls.length, 1)
  return sqls[0]
}

// A finite SQL predicate interpreter, not MySQL execution. Parse the captured WHERE
// rather than copying the intended retention predicate into a passing mock.
function sessionCleanupPredicate(sql, now) {
  const migration = fs.readFileSync(path.join(root, 'backend/src/database/080_create_pda_device_sessions.sql'), 'utf8')
  const table = migration.match(/CREATE TABLE IF NOT EXISTS pda_device_sessions \(([^]*?)\) ENGINE=/)[1]
  const columns = new Set([...table.matchAll(/^\s+([a-z_]+)\s+(?:BIGINT|CHAR|JSON|DATETIME)/gm)].map(m => m[1]))
  const expression = sql.match(/\bWHERE\s+([^]*?)(?:\s+LIMIT\s+\d+)?\s*$/i)[1]
  const tokens = expression.match(/[a-z_][a-z_0-9]*|\d+|[(),<]/gi) || []
  assert.equal(tokens.join(''), expression.replace(/\s+/g, ''), 'unsupported SQL token')
  let cursor = 0
  const peek = value => tokens[cursor]?.toUpperCase() === value
  const take = value => { assert.ok(peek(value), `expected ${value}`); cursor++ }
  function value() {
    if (peek('COALESCE')) {
      take('COALESCE'); take('('); const a = value(); take(','); const b = value(); take(')')
      return row => a(row) ?? b(row)
    }
    if (peek('NOW')) { take('NOW'); take('('); take(')'); return () => now }
    if (peek('DATE_SUB')) {
      take('DATE_SUB'); take('('); take('NOW'); take('('); take(')'); take(','); take('INTERVAL')
      const days = Number(tokens[cursor++]); assert.ok(Number.isInteger(days)); take('DAY'); take(')')
      return () => now - days * 86400000
    }
    const column = tokens[cursor++]
    assert.ok(columns.has(column), `session migration has no column ${column}`)
    return row => row[column] ?? null
  }
  function atom() {
    if (peek('(')) { take('('); const inner = or(); take(')'); return inner }
    const a = value()
    if (peek('<')) {
      take('<'); const b = value()
      return row => a(row) !== null && b(row) !== null && a(row) < b(row)
    }
    take('IS'); take('NOT'); take('NULL'); return row => a(row) !== null
  }
  function and() {
    let left = atom()
    while (peek('AND')) { take('AND'); const a = left, b = atom(); left = row => a(row) && b(row) }
    return left
  }
  function or() {
    let left = and()
    while (peek('OR')) { take('OR'); const a = left, b = and(); left = row => a(row) || b(row) }
    return left
  }
  const result = or(); assert.equal(cursor, tokens.length)
  return result
}

test('PDA清理只引用真实会话列，每轮最多1000条', async () => {
  const sql = await pdaCleanupSql()
  sessionCleanupPredicate(sql, Date.UTC(2026, 9, 17))
  assert.match(sql, /\bLIMIT 1000\s*$/)
})

test('PDA失效后保留30天：有效、刚过期和近期撤销均保留，严格排除边界', async () => {
  const now = Date.UTC(2026, 9, 17), day = 86400000
  const eligible = sessionCleanupPredicate(await pdaCleanupSql(), now)
  const cases = [
    { name: '有效会话即使创建很久仍保留', expires: 1, revoked: null, expected: false },
    { name: '刚过期保留', expires: -1, revoked: null, expected: false },
    { name: '过期恰好30天保留', expires: -30, revoked: null, expected: false },
    { name: '过期超过30天清理', expires: -31, revoked: null, expected: true },
    { name: '撤销恰好30天保留', expires: 1, revoked: -30, expected: false },
    { name: '已撤销超过30天即使到期日在未来也清理', expires: 1, revoked: -31, expected: true },
    { name: '很早过期但最近才撤销仍留审计窗口', expires: -60, revoked: -1, expected: false },
    { name: '近期到期的旧撤销会话按撤销时刻清理', expires: -1, revoked: -31, expected: true },
  ]
  for (const c of cases) {
    const row = { expires_at: now + c.expires * day, revoked_at: c.revoked === null ? null : now + c.revoked * day,
      created_at: now - 100 * day, last_seen_at: now - 100 * day }
    assert.equal(eligible(row), c.expected, c.name)
  }
})

// Real shell wrapper + local curl function: no socket, credential file or real robot.
function offlineSend(t, options = {}) {
  const f = fixture(t), bodyFile = path.join(f.dir, 'sent-body.json'), urlFile = path.join(f.dir, 'sent-url.txt')
  if (options.config) fs.writeFileSync(path.join(f.dir, '.env'), options.config, { mode: 0o600 })
  const env = Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(k => process.env[k]).map(k => [k, process.env[k]]))
  const result = spawnSync('bash', ['-c', `
    . "$ALERT_LIB"
    curl() {
      local last=""
      while [ "$#" -gt 0 ]; do
        if [ "$1" = -d ]; then shift; printf '%s' "$1" > "$ALERT_BODY_FILE"; fi
        last="$1"; shift
      done
      printf '%s' "$last" > "$ALERT_URL_FILE"
      printf '%s\\n%s' "$ALERT_REPLY" "$ALERT_HTTP_STATUS"
      return "$ALERT_CURL_EXIT"
    }
    dingtalk_send "$DINGTALK_WEBHOOK" "$ALERT_MESSAGE"
  `], { cwd: f.dir, env: { ...env, PROJECT_DIR: f.dir,
    ALERT_LIB: path.join(root, 'scripts/lib/ops-common.sh'),
    DINGTALK_WEBHOOK: options.webhook || 'https://example.invalid/robot?access_token=offline-token',
    DINGTALK_SECRET: options.secret || '', DINGTALK_KEYWORD: options.keyword || '',
    DINGTALK_ALERT_SECRET: 'backend-setting-must-not-be-used',
    ALERT_MESSAGE: options.message || '合成告警\n第二行 "详情" C:\\logs',
    ALERT_REPLY: options.reply ?? '{"errcode":0}', ALERT_HTTP_STATUS: options.http || '200',
    ALERT_CURL_EXIT: String(options.exit || 0), ALERT_BODY_FILE: bodyFile, ALERT_URL_FILE: urlFile,
  }, encoding: 'utf8', timeout: 10000 })
  return { ...result, url: fs.existsSync(urlFile) ? fs.readFileSync(urlFile, 'utf8') : '',
    body: fs.existsSync(bodyFile) ? JSON.parse(fs.readFileSync(bodyFile, 'utf8')) : null }
}

test('运维钉钉HTTP200/errcode310000已可见失败，监控不确认去重', t => {
  const r = offlineSend(t, { reply: '{"errcode":310000,"errmsg":"keywords not in content"}' })
  assert.equal(r.status, 1)
  assert.match(r.stderr, /钉钉告警被拒.*310000/)
  const f = fixture(t)
  f.run('monitor.sh', { publicDown: true, replyErrcode: 310000 })
  const state = JSON.parse(fs.readFileSync(f.stateFile, 'utf8'))
  assert.deepEqual(state.notified, {})
  assert.equal(f.run('monitor.sh', { publicDown: true }).messages.length, 1)
})

test('运维钉钉拒绝HTTP错误、无效JSON、缺失/字符串errcode和传输失败', t => {
  for (const options of [{ http: '503' }, { reply: 'not-json' }, { reply: '{}' },
    { reply: '{"errcode":"0"}' }, { exit: 7 }]) {
    const r = offlineSend(t, options)
    assert.equal(r.status, 1, JSON.stringify(options))
    assert.match(r.stderr, /ERROR/)
  }
})

test('运维日报透出通知失败，备份主失败不被通知310000覆盖', t => {
  const f = fixture(t)
  f.run('monitor.sh')
  const daily = f.run('daily-report.sh', { replyErrcode: 310000 }, 1)
  assert.match(daily.stderr, /钉钉告警被拒.*310000/)
  const backup = f.run('backup-db.sh', { backupMissing: true, replyErrcode: 310000 }, 1)
  assert.match(backup.stderr, /MySQL 容器.*不存在或无法访问/)
  assert.match(backup.stderr, /钉钉告警被拒.*310000/)
})

test('运维未配置可选加签/关键词时保留原URL和正文，不借后端密钥', t => {
  const url = 'https://example.invalid/robot?access_token=offline%2Ftoken&flag=1'
  const message = '原消息\n"引号" \\末尾'
  const r = offlineSend(t, { webhook: url, message })
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.url, url)
  assert.equal(r.body.text.content, message)
})

function verifyOfflineSignature(r, secret) {
  assert.equal(r.status, 0, r.stderr)
  const url = new URL(r.url), timestamp = url.searchParams.get('timestamp')
  assert.match(timestamp || '', /^\d{13}$/)
  assert.ok(Math.abs(Date.now() - Number(timestamp)) < 10000)
  const expected = require('node:crypto').createHmac('sha256', secret).update(timestamp + '\n' + secret).digest('base64')
  assert.equal(url.searchParams.get('sign'), expected)
  assert.equal(url.searchParams.getAll('sign').length, 1)
  assert.equal(url.searchParams.getAll('timestamp').length, 1)
  assert.doesNotMatch(r.stdout + r.stderr, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  return url
}

test('运维可选加签按独立HMAC校验并替换旧签名，不打印密钥', t => {
  const secret = 'offline-only-secret'
  const r = offlineSend(t, { secret,
    webhook: 'https://example.invalid/robot?access_token=offline-token&timestamp=1&sign=stale' })
  const url = verifyOfflineSignature(r, secret)
  assert.equal(url.searchParams.get('access_token'), 'offline-token')
})

test('运维可选关键词在UTF8截断后仍保留，原换行和JSON编码不受损', t => {
  const keyword = '合成关键字', message = '内容🙂'.repeat(3000)
  const r = offlineSend(t, { keyword, message })
  assert.equal(r.status, 0, r.stderr)
  assert.ok(r.body.text.content.startsWith(keyword + '\n'))
  assert.ok(Buffer.byteLength(r.body.text.content) <= 8000)
  assert.match(r.body.text.content, /消息过长/)
  assert.doesNotMatch(r.body.text.content, /\uFFFD/)
})

test('运维从专属夹具.env读取可选项，环境变量优先且不执行密钥文本', t => {
  const r = offlineSend(t, { config: 'DINGTALK_SECRET=offline-file-secret\nDINGTALK_KEYWORD=文件关键词\n' })
  verifyOfflineSignature(r, 'offline-file-secret')
  assert.ok(r.body.text.content.startsWith('文件关键词\n'))
  const secret = 'offline-$(printf not-executed)-"env-secret"'
  const override = offlineSend(t, { secret, keyword: '环境关键词',
    config: 'DINGTALK_SECRET=offline-file-secret\nDINGTALK_KEYWORD=文件关键词\n' })
  verifyOfflineSignature(override, secret)
  assert.ok(override.body.text.content.startsWith('环境关键词\n'))
})

test('运维可选安全配置无效时发送前明确失败且不输出密钥', t => {
  const secret = 'offline-invalid-url-secret'
  const invalidUrl = offlineSend(t, { secret, webhook: 'invalid-url' })
  assert.equal(invalidUrl.status, 1)
  assert.match(invalidUrl.stderr, /钉钉加签失败/)
  assert.equal(invalidUrl.url, '')
  assert.ok(!invalidUrl.stderr.includes(secret))
  const oversizedKeyword = offlineSend(t, { keyword: '大'.repeat(3000) })
  assert.equal(oversizedKeyword.status, 1)
  assert.match(oversizedKeyword.stderr, /钉钉消息编码失败/)
  assert.equal(oversizedKeyword.url, '')
})
