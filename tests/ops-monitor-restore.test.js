'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { gzipSync } = require('node:zlib')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')

// 只替换外部 Docker/网络进程；运行真实运维脚本、gzip、文件时间与状态逻辑。
function runOps(script, scenario, { ageHours = 0, explicit = false, corrupt = false, slowHours = [], previousMonitorState } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-ops-test-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'backups'))
  for (const file of [script, 'lib/ops-common.sh', 'lib/ops-alerts.js']) {
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  }
  fs.copyFileSync(path.join(root, 'scripts/lib/runtime-guards.sh'), path.join(dir, 'scripts/lib/runtime-guards.sh'))
  const backup = path.join(dir, 'backups/flowcube_fixture.sql.gz')
  fs.writeFileSync(backup, corrupt ? Buffer.from('broken gzip') : gzipSync('CREATE TABLE fixture (id INT);\n'))
  const modified = new Date(Date.now() - ageHours * 3600000)
  fs.utimesSync(backup, modified, modified)
  const slowLog = path.join(dir, 'slow.log')
  fs.writeFileSync(slowLog, slowHours.map(hours =>
    `# Time: ${new Date(Date.now() - hours * 3600000).toISOString()}\n`).join(''))
  const volumeState = path.join(dir, 'volume.json')
  if (scenario === 'foreign-volume' || scenario === 'owned-volume') {
    fs.writeFileSync(volumeState, JSON.stringify(scenario === 'owned-volume' ? 'restore-check flowcube-restore-check-777' : 'other-project'))
  }
  const mock = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path'), { spawnSync } = require('node:child_process');
const cmd = path.basename(process.argv[1]), args = process.argv.slice(2), s = process.env.OPS_TEST_SCENARIO;
fs.appendFileSync(process.env.OPS_TEST_LOG, JSON.stringify([cmd, ...args]) + '\\n');
if (cmd === 'flock') process.exit(s === 'busy' ? 1 : 0);
if (cmd === 'timeout') {
 if ((s === 'tls-timeout' && args.some(a => a === 'openssl' || a.endsWith('/openssl'))) || (s === 'docker-timeout' && args.some(a => a.endsWith('/docker')))) process.exit(124);
 // 总体时限内的子命令使用 --foreground；按参数语义定位命令，不依赖固定下标。
 let i=0;
 while(args[i]?.startsWith('-')) { if(args[i]==='-k') i+=2; else i++; }
 i++; // duration
 const r = require('node:child_process').spawnSync(args[i],args.slice(i+1),{stdio:'inherit'});process.exit(r.status??1);
}
if (cmd === 'curl') { if (args.includes('-d')) process.exit(99); console.log('200'); process.exit(0); }
if (cmd === 'openssl') { if (args[0] === 'x509') console.log('notAfter=Nov 16 14:56:59 2030 GMT'); process.exit(0); }
if (cmd === 'df') { console.log('Filesystem 1024-blocks Used Available Capacity Mounted on\\nfixture 10000 1000 9000 10% /'); process.exit(0); }
if (cmd === 'sleep') process.exit(0);
if (cmd === 'docker') {
 const a = args.join(' ');
 if (args[0] === 'compose') console.log('flowcube-' + args.at(-1));
 else if (args[0] === 'volume') {
   const state = process.env.OPS_TEST_VOLUME_STATE;
   if (args[1] === 'inspect') {
     if (!fs.existsSync(state)) process.exit(1);
     console.log(JSON.parse(fs.readFileSync(state, 'utf8')));
   } else if (args[1] === 'create') {
     if (!fs.existsSync(state)) fs.writeFileSync(state, JSON.stringify(args.filter(a => a.startsWith('io.flowcube.')).map(a => a.split('=')[1]).join(' ')));
   } else if (args[1] === 'rm' && fs.existsSync(state)) fs.unlinkSync(state);
 }
 else if (args[0] === 'run') console.log('a'.repeat(64));
 else if (args[0] === 'inspect') console.log(a.includes('.Image') ? 'sha256:' + 'b'.repeat(64) : a.includes('.Name') ? '/' + args.at(-1) : a.includes('RestartCount') ? '0' : 'running');
 else if (args[0] === 'exec') {
   if (args.includes('-i')) { fs.readFileSync(0); process.exit(s === 'import-fails' ? 1 : 0); }
   if (a.includes('Threads_connected')) {
     if (s === 'query-fails' || !a.includes('MYSQL_ROOT_PASSWORD')) { console.error('Access denied'); process.exit(1); }
     console.log(s === 'invalid-metric' ? 'NULL' : s === 'high-connections' ? '130' : '7');
   } else if (a.includes('slow.log')) {
     if (a.includes('echo present')) { console.log(fs.existsSync(process.env.OPS_TEST_SLOW_LOG) ? 'present' : 'absent'); process.exit(0); }
     if (args.includes('awk')) {
       const awkArgs = args.slice(args.indexOf('awk') + 1);
       awkArgs[awkArgs.length - 1] = process.env.OPS_TEST_SLOW_LOG;
       const result = spawnSync('awk', awkArgs, { encoding: 'utf8' });
       process.stdout.write(result.stdout || ''); process.stderr.write(result.stderr || '');
       process.exit(result.status ?? 1);
     }
     console.log((fs.readFileSync(process.env.OPS_TEST_SLOW_LOG, 'utf8').match(/^# Time:/gm) || []).length);
   }
   else if (a.includes('@@server_uuid')) console.log('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee 8.0.46');
   else if (a.includes('TIMESTAMPDIFF')) console.log('668');
   else if (a.includes('information_schema.tables')) console.log(s === 'missing-tables' ? '2' : '135');
   else if (a.includes('COUNT(*)')) console.log('7');
 }
 process.exit(0);
}
process.exit(0);
`
  for (const cmd of ['docker', 'curl', 'openssl', 'df', 'sleep', 'timeout', 'flock']) {
    fs.writeFileSync(path.join(bin, cmd), mock, { mode: 0o755 })
  }
  const log = path.join(dir, 'commands.jsonl')
  const state = path.join(dir, 'backups/.monitor.state')
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, PROJECT_DIR: dir,
    BACKUP_DIR: path.join(dir, 'backups'), STATE_FILE: state, DINGTALK_WEBHOOK: '',
    MIN_TABLES: '130', MIN_ROWS: '1', MIN_BYTES: '1', BACKUP_MAX_AGE_HOURS: '48',
    OPS_TEST_SCENARIO: scenario, OPS_TEST_LOG: log, OPS_TEST_SLOW_LOG: slowLog, OPS_TEST_VOLUME_STATE: volumeState }
  if (previousMonitorState) fs.writeFileSync(state, previousMonitorState)
  try {
    const result = spawnSync('bash', [path.join(dir, 'scripts', script), ...(explicit ? [backup] : [])],
      { cwd: dir, env, encoding: 'utf8', timeout: 15000 })
    const commands = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []
    assert.ok(!commands.some(c => c[0] === 'curl' && c.includes('-d')), '测试不能发送通知')
    const restoreFile = path.join(dir, 'backups/.restore-check.status.json')
    return { ...result, commands, state: fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : '',
      restoreStatus: fs.existsSync(restoreFile) ? JSON.parse(fs.readFileSync(restoreFile, 'utf8')) : null }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('新备份可恢复，即使最近 668 小时没有销售单', () => {
  const r = runOps('restore-check.sh', 'idle')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /备份恢复演练通过/)
  assert.equal(r.restoreStatus.status, 'passed')
})

test('自动演练拒绝超过 48 小时的备份，且不启动演练容器', () => {
  const r = runOps('restore-check.sh', 'idle', { ageHours: 72 })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /备份.*过期/)
  assert.ok(!r.commands.some(c => c[0] === 'docker'))
  assert.equal(r.restoreStatus.status, 'failed')
})

test('显式指定历史备份允许验证恢复能力，但提示文件年龄', () => {
  const r = runOps('restore-check.sh', 'idle', { ageHours: 72, explicit: true })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /历史备份/)
  assert.equal(r.restoreStatus, null, '历史手工演练不得覆盖自动演练结果')
})

for (const [scenario, options] of [['import-fails', {}], ['missing-tables', {}], ['corrupt', { corrupt: true }]]) {
  test(`恢复演练仍拒绝 ${scenario}`, () => {
    const r = runOps('restore-check.sh', scenario, options)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.equal(r.restoreStatus.status, 'failed')
  })
}

for (const scenario of ['query-fails', 'invalid-metric']) {
  test(`连接数 ${scenario} 必须记录异常，不能静默回退为零`, () => {
    const r = runOps('monitor.sh', scenario)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(Object.keys(JSON.parse(r.state).observed).length > 0, r.stdout + r.stderr)
    assert.match(r.stdout, /MySQL.*连接数.*(失败|无效)/)
  })
}

test('认证后的真实连接数触发阈值告警', () => {
  const r = runOps('monitor.sh', 'high-connections')
  assert.ok(JSON.parse(r.state).observed.connections, r.stdout + r.stderr)
  assert.match(r.stdout, /MySQL 活跃连接 130/)
})

test('连接数正常时保留正常状态', () => {
  const r = runOps('monitor.sh', 'healthy')
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.state).observed, {}, r.stdout + r.stderr)
})

test('多日前的慢查询不会持续告警，先前的异常状态应恢复', () => {
  const r = runOps('monitor.sh', 'healthy', {
    slowHours: Array(253).fill(11 * 24),
    previousMonitorState: `bad ${Math.floor(Date.now() / 1000) - 86400}\n`,
  })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.state).observed, {}, r.stdout + r.stderr)
  assert.match(r.stdout, /服务已恢复正常/)
})

test('最近24小时慢查询数量进入性能摘要，数量本身不产生即时告警', () => {
  const r = runOps('monitor.sh', 'healthy', { slowHours: Array(50).fill(1) })
  assert.equal(r.status, 0, r.stderr)
  assert.deepEqual(JSON.parse(r.state).observed, {}, r.stdout + r.stderr)
  assert.equal(JSON.parse(r.state).metrics.slow, '50')
  assert.match(r.stdout, /慢查询.*50 条/)
})

test('上一轮监控未退出时跳过新一轮，避免 cron 累积探针', () => {
  const r = runOps('monitor.sh', 'busy')
  assert.equal(r.status, 0, r.stderr)
  assert.ok(!r.commands.some(c => ['docker', 'openssl', 'curl'].includes(c[0])))
  assert.equal(r.state, '')
})

for (const scenario of ['docker-timeout', 'tls-timeout']) {
  test(`${scenario} 不无限挂起，记录异常而不是正常`, () => {
    const r = runOps('monitor.sh', scenario)
    assert.equal(r.status, 0, r.stderr)
    assert.ok(Object.keys(JSON.parse(r.state).observed).length > 0, r.stdout + r.stderr)
    if (scenario === 'tls-timeout') assert.match(r.stdout, /证书.*(失败|超时)/)
  })
}

// 2026-09-18 审计：旧 dingtalk_send 是 `curl ... >/dev/null 2>&1 || true`——**任何失败都返回 0**，
// webhook 写错/被限流/网络不通对外全都表现为「已发送」。这是「备份连续 12 天失败无人察觉」的同一条路径。
test('钉钉告警失败必须非 0 返回，不得静默吞掉', () => {
  const probe = [
    `source "${path.join(root, 'scripts/lib/ops-common.sh')}"`,
    'dingtalk_send "" "m" >/dev/null 2>&1; echo "EMPTY=$?"',
    'dingtalk_send "http://127.0.0.1:9/nope" "m" >/dev/null 2>&1; echo "UNREACHABLE=$?"',
    `json_escape 'a"b\\c' 100; echo`,
  ].join('\n')
  const r = spawnSync('bash', ['-c', probe], { encoding: 'utf8' })
  assert.equal(r.status, 0, r.stderr)
  const lines = r.stdout.trim().split('\n')
  assert.match(lines[0], /^EMPTY=2$/, '未配置 webhook 应以 2 返回（WARN 而非静默 0）')
  assert.match(lines[1], /^UNREACHABLE=1$/, '不可达 webhook 必须以 1 返回（旧实现恒返回 0）')
  assert.equal(lines[2], 'abc', 'json_escape 必须剥离会破坏 JSON 的引号与反斜杠')
})

test('恢复演练拒绝同名非演练卷，并保留该卷及其挂载', () => {
  const result = runOps('restore-check.sh', 'foreign-volume', { explicit: true })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /归属/)
  assert.ok(!result.commands.some(c => c[0] === 'docker' && (c[1] === 'run' || c[1] === 'rm' ||
    (c[1] === 'volume' && ['rm', 'create'].includes(c[2])))))
})

test('恢复演练只回收本脚本的具名卷并重新创建，结束回收同一卷', () => {
  const result = runOps('restore-check.sh', 'owned-volume', { explicit: true })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const commands = result.commands.filter(c => c[0] === 'docker')
  const volume = 'flowcube_restore_check_tmp'
  const operations = commands.filter(c => c[1] === 'volume' && c.at(-1) === volume).map(c => c[2])
  assert.deepEqual(operations, ['inspect', 'rm', 'create', 'inspect', 'inspect', 'rm'])
  const start = commands.findIndex(c => c[1] === 'run')
  assert.ok(start > commands.findIndex(c => c[1] === 'volume' && c[2] === 'create'))
  assert.ok(commands[start].includes(volume + ':/var/lib/mysql'))
  assert.ok(commands[start].includes('none'))
  assert.ok(commands.some(c => c[1] === 'rm' && c.at(-1) === 'a'.repeat(64)))
  assert.match(result.stdout, /aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee 8\.0\.46/)
})

test('恢复演练遇到同一个具名卷的运行锁时退出，避免改动另一轮演练', () => {
  const result = runOps('restore-check.sh', 'busy', { explicit: true })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stderr, /演练.*进行/)
  assert.ok(!result.commands.some(c => c[0] === 'docker'))
})
