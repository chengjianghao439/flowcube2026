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
function runOps(script, scenario, { ageHours = 0, explicit = false, corrupt = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-ops-test-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'backups'))
  for (const file of [script, 'lib/ops-common.sh']) {
    fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  }
  fs.copyFileSync(path.join(root, 'scripts/lib/runtime-guards.sh'), path.join(dir, 'scripts/lib/runtime-guards.sh'))
  const backup = path.join(dir, 'backups/flowcube_fixture.sql.gz')
  fs.writeFileSync(backup, corrupt ? Buffer.from('broken gzip') : gzipSync('CREATE TABLE fixture (id INT);\n'))
  const modified = new Date(Date.now() - ageHours * 3600000)
  fs.utimesSync(backup, modified, modified)
  const mock = `#!${process.execPath}
const fs = require('node:fs'), path = require('node:path');
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
 else if (args[0] === 'inspect') console.log(a.includes('.Name') ? '/' + args.at(-1) : a.includes('RestartCount') ? '0' : 'running');
 else if (args[0] === 'exec') {
   if (args.includes('-i')) { fs.readFileSync(0); process.exit(s === 'import-fails' ? 1 : 0); }
   if (a.includes('Threads_connected')) {
     if (s === 'query-fails' || !a.includes('MYSQL_ROOT_PASSWORD')) { console.error('Access denied'); process.exit(1); }
     console.log(s === 'invalid-metric' ? 'NULL' : s === 'high-connections' ? '130' : '7');
   } else if (a.includes('slow.log')) console.log('0');
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
    MIN_TABLES: '130', MIN_ROWS: '1', BACKUP_MAX_AGE_HOURS: '48',
    OPS_TEST_SCENARIO: scenario, OPS_TEST_LOG: log }
  try {
    const result = spawnSync('bash', [path.join(dir, 'scripts', script), ...(explicit ? [backup] : [])],
      { cwd: dir, env, encoding: 'utf8', timeout: 15000 })
    const commands = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []
    assert.ok(!commands.some(c => c[0] === 'curl' && c.includes('-d')), '测试不能发送通知')
    return { ...result, commands, state: fs.existsSync(state) ? fs.readFileSync(state, 'utf8') : '' }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('新备份可恢复，即使最近 668 小时没有销售单', () => {
  const r = runOps('restore-check.sh', 'idle')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /备份恢复演练通过/)
})

test('自动演练拒绝超过 48 小时的备份，且不启动演练容器', () => {
  const r = runOps('restore-check.sh', 'idle', { ageHours: 72 })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /备份.*过期/)
  assert.ok(!r.commands.some(c => c[0] === 'docker'))
})

test('显式指定历史备份允许验证恢复能力，但提示文件年龄', () => {
  const r = runOps('restore-check.sh', 'idle', { ageHours: 72, explicit: true })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.match(r.stdout, /历史备份/)
})

for (const [scenario, options] of [['import-fails', {}], ['missing-tables', {}], ['corrupt', { corrupt: true }]]) {
  test(`恢复演练仍拒绝 ${scenario}`, () => {
    const r = runOps('restore-check.sh', scenario, options)
    assert.equal(r.status, 1, r.stdout + r.stderr)
  })
}

for (const scenario of ['query-fails', 'invalid-metric']) {
  test(`连接数 ${scenario} 必须记录异常，不能静默回退为零`, () => {
    const r = runOps('monitor.sh', scenario)
    assert.equal(r.status, 0, r.stderr)
    assert.match(r.state, /^bad /, r.stdout + r.stderr)
    assert.match(r.stdout, /MySQL.*连接数.*(失败|无效)/)
  })
}

test('认证后的真实连接数触发阈值告警', () => {
  const r = runOps('monitor.sh', 'high-connections')
  assert.match(r.state, /^bad /, r.stdout + r.stderr)
  assert.match(r.stdout, /MySQL 活跃连接 130/)
})

test('连接数正常时保留正常状态', () => {
  const r = runOps('monitor.sh', 'healthy')
  assert.equal(r.status, 0, r.stderr)
  assert.equal(r.state, 'ok 0\n', r.stdout + r.stderr)
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
    assert.match(r.state, /^bad /, r.stdout + r.stderr)
    if (scenario === 'tls-timeout') assert.match(r.stdout, /证书.*(失败|超时)/)
  })
}
