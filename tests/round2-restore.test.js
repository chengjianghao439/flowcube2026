'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const zlib = require('node:zlib')
const { spawnSync, spawn } = require('node:child_process')
const root = path.resolve(__dirname, '..')
function restoreFixture({ slowMs = 0, timeout = '30', database = 'flowcube_restore_check', cpus = '1' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-round2-restore-test-'))
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin)
  const log = path.join(dir, 'docker.jsonl')
  const file = path.join(dir, 'fixture.sql.gz')
  const volume = path.basename(dir)
  const containerId = 'a'.repeat(64)
  fs.writeFileSync(file, zlib.gzipSync('CREATE TABLE fixture (id INT);\n'))
  fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs = require('node:fs'), args = process.argv.slice(2)
const owner = process.env.PROBE_VOLUME_OWNER
fs.appendFileSync(process.env.PROBE_DOCKER_LOG, JSON.stringify(args) + '\\n')
if (args[0] === 'volume') {
  if (args[1] === 'inspect') {
    if (!fs.existsSync(owner)) process.exit(1)
    console.log(fs.readFileSync(owner, 'utf8'))
  } else if (args[1] === 'create') {
    const labels = args.filter(a => a.startsWith('io.flowcube.'))
    fs.writeFileSync(owner, labels.map(a => a.split('=')[1]).join(' '), { flag: 'wx' })
  } else if (args[1] === 'rm') {
    fs.unlinkSync(owner)
  }
} else if (args[0] === 'run') {
  console.log(process.env.PROBE_CONTAINER_ID)
} else if (args[0] === 'inspect') {
  console.log('sha256:' + 'b'.repeat(64))
} else if (args[0] === 'exec' && args.includes('-i')) {
  process.stdin.resume()
  process.stdin.on('end', () => setTimeout(() => process.exit(0), Number(process.env.PROBE_SLOW_MS)))
} else if (args.some(a => a.includes('@@server_uuid'))) {
  console.log('aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee 8.0.46')
} else if (args.some(a => a.includes('information_schema.tables'))) console.log(5)
else if (args.some(a => a.includes('COUNT(*) FROM'))) console.log(1)
`, { mode: 0o755 })
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, PROJECT_DIR: dir,
    PROBE_DOCKER_LOG: log, PROBE_VOLUME_OWNER: path.join(dir, 'owned-volume'), PROBE_CONTAINER_ID: containerId,
    PROBE_SLOW_MS: String(slowMs), RESTORE_TIMEOUT_SECONDS: timeout, RESTORE_DB: database,
    RESTORE_CPUS: cpus, RESTORE_VOLUME: volume, MIN_TABLES: '5', MIN_ROWS: '1',
    FLOWCUBE_RESTORE_DEADLINE_ACTIVE: '', DINGTALK_WEBHOOK: '' }
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : []
  return { dir, file, env, calls, containerId, volume }
}

function restore(options) {
  const f = restoreFixture(options)
  try {
    const result = spawnSync('bash', ['scripts/restore-check.sh', f.file], { cwd: root, encoding: 'utf8', timeout: 8000, env: f.env })
    return { ...result, calls: f.calls(), containerId: f.containerId, volume: f.volume }
  } finally { fs.rmSync(f.dir, { recursive: true, force: true }) }
}

function assertCleanup(calls, containerId, volume) {
  assert.ok(calls.some(args => args[0] === 'rm' && args.includes('-v') && args.at(-1) === containerId))
  assert.ok(calls.some(args => args[0] === 'volume' && args[1] === 'rm' && args.at(-1) === volume))
}

test('恢复临时容器限定资源、禁网络，成功退出清理本轮容器与具名卷', () => {
  const r = restore()
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const run = r.calls.find(c => c[0] === 'run')
  for (const option of ['--memory', '--memory-swap', '--cpus', '--pids-limit', '--network']) assert.ok(run.includes(option), option)
  assert.equal(run[run.indexOf('--network') + 1], 'none')
  assertCleanup(r.calls, r.containerId, r.volume)
})
test('整体恢复时限终止导入并执行自有容器和具名卷清理', () => {
  const r = restore({ slowMs: 4000, timeout: '2' })
  assert.equal(r.status, 124, r.stdout + r.stderr)
  assert.ok(r.calls.some(c => c[0] === 'exec' && c.includes('-i')), '必须已经进入导入阶段')
  assertCleanup(r.calls, r.containerId, r.volume)
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
  const f = restoreFixture({ slowMs: 1400, timeout: '4' })
  const child = spawn('bash', ['scripts/restore-check.sh', f.file], { cwd: root, stdio: 'ignore', env: f.env })
  const exited = new Promise(resolve => child.once('exit', resolve))
  try {
    const deadline = Date.now() + 3000
    while (!f.calls().some(c => c[0] === 'exec' && c.includes('-i')) && Date.now() < deadline) await new Promise(r => setTimeout(r, 10))
    assert.ok(f.calls().some(c => c.includes('-i')), '导入应已开始')
    child.kill('SIGTERM')
    await exited
    await new Promise(r => setTimeout(r, 150))
    assertCleanup(f.calls(), f.containerId, f.volume)
  } finally {
    child.kill('SIGTERM')
    // 红测旧包装器可能留下有限时长的子任务，等它自行结束后再移除该测试目录。
    await new Promise(r => setTimeout(r, 1700))
    fs.rmSync(f.dir, { recursive: true, force: true })
  }
})
