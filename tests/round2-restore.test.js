'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const { spawnSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function restore({ slow = false, timeout = '30', database = 'flowcube_restore_check', cpus = '1' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-round2-restore-test-'))
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
  const log = path.join(dir, 'docker.jsonl')
  const file = path.join(dir, 'fixture.sql.gz')
  fs.writeFileSync(file, zlib.gzipSync('CREATE TABLE fixture (id INT);\n'))
  fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs=require('node:fs'),args=process.argv.slice(2);
fs.appendFileSync(process.env.PROBE_DOCKER_LOG,JSON.stringify(args)+'\\n');
if(args[0]==='exec'&&args.includes('-i')) {
 process.stdin.resume(); process.stdin.on('end',()=>setTimeout(()=>process.exit(0),process.env.PROBE_SLOW==='1'?1600:0));
} else if(args.some(a=>a.includes('information_schema.tables'))) console.log(5);
else if(args.some(a=>a.includes('COUNT(*) FROM'))) console.log(1);
else if(args[0]==='run') console.log('fixture-container');
`, { mode: 0o755 })
  const result = spawnSync('bash', ['scripts/restore-check.sh', file], { cwd: root, encoding: 'utf8', timeout: 8000,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, PROJECT_DIR: dir, PROBE_DOCKER_LOG: log,
      PROBE_SLOW: slow ? '1' : '0', RESTORE_TIMEOUT_SECONDS: timeout, RESTORE_DB: database, RESTORE_CPUS: cpus,
      MIN_TABLES: '5', MIN_ROWS: '1', FLOWCUBE_RESTORE_DEADLINE_ACTIVE: '', DINGTALK_WEBHOOK: '' } })
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []
  fs.rmSync(dir, { recursive: true, force: true })
  return { ...result, calls }
}
test('恢复临时容器限定资源、禁网络，成功退出删除自有容器及匿名卷', () => {
  const r = restore()
  assert.equal(r.status, 0, r.stderr)
  const run = r.calls.find(c => c[0] === 'run')
  for (const option of ['--memory', '--memory-swap', '--cpus', '--pids-limit', '--network']) assert.ok(run.includes(option), option)
  assert.equal(run[run.indexOf('--network') + 1], 'none')
  assert.ok(r.calls.some(c => c[0] === 'rm' && c.includes('-v')))
})
test('整体恢复时限终止导入并执行自有容器清理', () => {
  const r = restore({ slow: true, timeout: '1' })
  assert.equal(r.status, 124, r.stdout + r.stderr)
  assert.ok(r.calls.some(c => c[0] === 'rm' && c.includes('-v')))
  assert.doesNotMatch(r.stdout, /恢复演练通过/)
})
test('非法恢复库名在Docker动作前拒绝', () => {
  const r = restore({ database: 'unsafe`name' })
  assert.notEqual(r.status, 0)
  assert.equal(r.calls.length, 0)
})
test('CPU配额拒绝所有零表示，小数正配额合法', () => {
  for (const cpus of ['0', '0.0', '00']) {
    const r = restore({ cpus })
    assert.notEqual(r.status, 0, cpus)
    assert.equal(r.calls.length, 0)
  }
  assert.equal(restore({ cpus: '0.5' }).status, 0)
})
test('直接终止调用者PID会立即终止内部恢复并清理容器', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-round2-restore-signal-'))
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
  const log = path.join(dir, 'calls.jsonl'), file = path.join(dir, 'fixture.sql.gz')
  fs.writeFileSync(file, zlib.gzipSync('CREATE TABLE fixture (id INT);\n'))
  fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs=require('fs'),a=process.argv.slice(2);fs.appendFileSync(process.env.PROBE_LOG,JSON.stringify(a)+'\\n');
if(a[0]==='exec'&&a.includes('-i')) {process.stdin.resume();process.stdin.on('end',()=>setTimeout(()=>process.exit(0),1400));}
else if(a.some(x=>x.includes('information_schema.tables'))) console.log(5);
else if(a.some(x=>x.includes('COUNT(*) FROM'))) console.log(1);
`, { mode: 0o755 })
  const child = spawn('bash', ['scripts/restore-check.sh', file], { cwd: root, stdio: 'ignore',
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, PROBE_LOG: log, PROJECT_DIR: dir, MIN_TABLES: '5',
      RESTORE_TIMEOUT_SECONDS: '4', FLOWCUBE_RESTORE_DEADLINE_ACTIVE: '', DINGTALK_WEBHOOK: '' } })
  const exited = new Promise(resolve => child.once('exit', resolve))
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []
  try {
    const deadline = Date.now() + 3000
    while (!calls().some(c => c[0] === 'exec' && c.includes('-i')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    assert.ok(calls().some(c => c.includes('-i')), '导入应已开始')
    child.kill('SIGTERM')
    await exited
    await new Promise(r => setTimeout(r, 150))
    assert.ok(calls().some(c => c[0] === 'rm' && c.includes('-v')), '终止后必须立即清理，不能等原deadline')
  } finally {
    child.kill('SIGTERM')
    // 红测旧包装器可能留下有限时长的子任务，等它自行结束后再移除该测试目录。
    await new Promise(r => setTimeout(r, 1700))
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
