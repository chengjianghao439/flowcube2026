'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { gunzipSync } = require('node:zlib')
const root = path.resolve(__dirname, '..')

test('服务器只读诊断 workflow 必须保持只读，且真的在采集现场信息', () => {
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const file = path.join(root, '.github/workflows/server-diagnostics.yml')
  assert.ok(fs.existsSync(file), '只读诊断 workflow 缺失（本机 IP 被限流时的唯一诊断通道）')
  const wf = yaml.load(fs.readFileSync(file, 'utf8'))
  const steps = Object.values(wf.jobs).flatMap(j => j.steps || [])
  const run = steps.map(s => s.run || '').join('\n')
  // 必须真的采集这些现场信息，否则脚本被清空后守卫会「静默通过」
  for (const needle of ['free -m', 'df -h', 'docker ps', 'docker stats', 'oom', 'du -sh']) {
    assert.ok(run.includes(needle), `诊断脚本必须包含 ${needle}`)
  }
  // 不得含写操作：按命令形态匹配（而非关键词），避免匹配到注释里的中文说明
  const forbidden = [
    /\brm\s+-/, /\brmi\b/, /\bmv\s+/, /\btruncate\b/, /\bdd\s+if=/,
    /docker\s+(prune|system\s+prune|volume\s+rm|container\s+rm|stop|restart|kill)\b/,
    /docker\s+compose\s+(up|down|stop|restart|rm)\b/,
    /journalctl\s+--vacuum/, /\bsystemctl\s+(start|stop|restart|disable|enable)\b/,
    /\bpkill\b/, /\bkillall\b/, /\bcrontab\b/,
  ]
  for (const re of forbidden) {
    assert.ok(!re.test(run), `只读诊断脚本出现写操作命令：${re}`)
  }
})

test('部署总超时穿透内层等待，清理和停止记录必须在强杀前执行', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-nested-timeout-'))
  const log = path.join(dir, 'events'), pids = path.join(dir, 'pids')
  fs.writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PROBE_PIDS, JSON.stringify([process.pid,process.ppid]));setInterval(()=>{},1000);\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gate.sh'), `set -euo pipefail\ntrap 'echo cleanup >> "$PROBE_LOG"' EXIT\ntrap 'exit 143' TERM\n. scripts/lib/runtime-guards.sh\nDOCKER_COMMAND_TIMEOUT=20 docker run\n`)
  fs.writeFileSync(path.join(dir, 'deploy.sh'), `set -Eeuo pipefail\ntrap 'echo stopped >> "$PROBE_LOG"; exit 1' TERM ERR\nbash "$PROBE_DIR/gate.sh"\n`)
  let failure, failed = false
  try {
    const r = spawnSync('bash', ['-c', 't=$(type -P timeout || type -P gtimeout); exec "$t" -k 2 1 bash "$PROBE_DIR/deploy.sh"'], {
      cwd: root, timeout: 7000, stdio: 'ignore', env: { ...process.env, PATH: dir + ':' + process.env.PATH,
        FLOWCUBE_DEPLOY_TIMEOUT_GROUP: '1', PROBE_DIR: dir, PROBE_LOG: log, PROBE_PIDS: pids } })
    assert.equal(r.signal, null, '不应因 Bash 等待内层独立进程组而被强杀')
    assert.equal(r.status, 124)
    const events = fs.readFileSync(log, 'utf8')
    assert.match(events, /cleanup/)
    assert.match(events, /stopped/)
    const [pid] = JSON.parse(fs.readFileSync(pids, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } catch (error) {
    failure = error
    failed = true
  }
  // Preserve the existing priority: cleanup failure wins; otherwise rethrow the assertion failure.
  if (fs.existsSync(pids)) for (const pid of JSON.parse(fs.readFileSync(pids, 'utf8'))) {
    try { process.kill(pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
  }
  fs.rmSync(dir, { recursive: true, force: true })
  if (failed) throw failure
})

test('真实 GNU timeout 会终止挂起的 Docker 客户端进程', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-timeout-test-'))
  fs.writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PROBE_PID, String(process.pid));setInterval(()=>{},1000);\n`, { mode: 0o755 })
  const pidFile = path.join(dir, 'pid')
  try {
    const started = Date.now()
    const r = spawnSync('bash', ['-c', '. scripts/lib/runtime-guards.sh; DOCKER_COMMAND_TIMEOUT=1 docker info'], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: dir + ':' + process.env.PATH, PROBE_PID: pidFile } })
    assert.equal(r.status, 124, r.stdout + r.stderr)
    assert.ok(Date.now() - started < 5000)
    const pid = Number(fs.readFileSync(pidFile, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

function gate(scenario, credentials = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-gate-test-'))
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  fs.mkdirSync(path.join(dir, 'bin'))
  for (const file of ['release-gate.sh', 'lib/runtime-guards.sh']) {
    if (fs.existsSync(path.join(root, 'scripts', file))) fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  }
  fs.writeFileSync(path.join(dir, 'docker-compose.yml'), 'services: {}\n')
  const log = path.join(dir, 'commands.jsonl')
  const mock = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const cmd=path.basename(process.argv[1]),args=process.argv.slice(2),s=process.env.GATE_SCENARIO;
fs.appendFileSync(process.env.GATE_LOG,JSON.stringify([cmd,...args])+'\\n');
if(cmd==='df') console.log('Filesystem 1M-blocks Used Available Use% Mounted on\\nfixture 20000 1000 '+(s==='lowdisk'?100:19000)+' 10% /');
if(cmd==='timeout') {
 if(s==='timeout'&&args[4]==='run') process.exit(124);
 const r=spawnSync(args[3],args.slice(4),{stdio:'inherit'});process.exit(r.status??1);
}
if(cmd==='docker' && args[0]==='run' && s==='failure') process.exit(1);
if(cmd==='docker' && args[0]==='run' && ['SMOKE_LIMITED_USERNAME','SMOKE_LIMITED_PASSWORD'].some(key=>process.env[key]!=='fixture-limited')) process.exit(65);
process.exit(0);
`
  for (const c of ['docker', 'timeout', 'df', 'node', 'flock']) fs.writeFileSync(path.join(dir, 'bin', c), mock, { mode: 0o755 })
  try {
    const result = spawnSync('bash', ['scripts/release-gate.sh'], { cwd: dir, encoding: 'utf8', timeout: 15000,
      env: { ...process.env, PATH: path.join(dir, 'bin') + ':' + process.env.PATH, GATE_SCENARIO: scenario, GATE_LOG: log,
        SMOKE_USERNAME: 'fixture', SMOKE_PASSWORD: 'fixture',
        SMOKE_LIMITED_USERNAME: 'fixture-limited', SMOKE_LIMITED_PASSWORD: 'fixture-limited', ...credentials } })
    return { ...result, commands: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [] }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

test('两轮浏览器验收均有 CPU、内存、交换、进程上限与容器内外时限', () => {
  const r = gate('success')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const runs = r.commands.filter(c => c[0] === 'docker' && c[1] === 'run')
  assert.equal(runs.length, 2)
  for (const c of runs) {
    for (const name of ['SMOKE_USERNAME', 'SMOKE_PASSWORD', 'SMOKE_LIMITED_USERNAME', 'SMOKE_LIMITED_PASSWORD']) assert.equal(c[c.indexOf(name) - 1], '-e', `${name} 必须传给 Docker`)
    for (const [flag, value] of [['--cpus', '1'], ['--memory', '1g'], ['--memory-swap', '1g'], ['--pids-limit', '256']]) assert.equal(c[c.indexOf(flag) + 1], value)
    assert.ok(c.includes('--init') && c.includes('--name') && c.includes('timeout'))
  }
  assert.equal(r.commands.filter(c => c[0] === 'timeout' && c[5] === 'run').length, 2)
})

for (const name of ['SMOKE_LIMITED_USERNAME', 'SMOKE_LIMITED_PASSWORD']) {
  test(`发布门禁缺少 ${name} 时在执行 Docker 前拒绝`, () => {
    const result = gate('success', { [name]: '' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, new RegExp(name))
    assert.equal(result.commands.length, 0)
  })
}

for (const scenario of ['timeout', 'failure']) {
  test(`浏览器 ${scenario} 必须失败并清理专属验收容器`, () => {
    const r = gate(scenario)
    assert.notEqual(r.status, 0, r.stdout + r.stderr)
    assert.ok(r.commands.some(c => c[0] === 'docker' && c[1] === 'rm' && c.includes('-f') && c.some(a => a.startsWith('flowcube-gate-'))))
  })
}

test('低空间门禁直接拒绝，绝不自动 prune 或拉浏览器镜像', () => {
  const r = gate('lowdisk')
  assert.notEqual(r.status, 0)
  assert.ok(!r.commands.some(c => c[0] === 'docker' && (c.includes('prune') || c.includes('run'))))
})

for (const scenario of ['success', 'build-fails', 'save-fails', 'wrong-sha', 'outside-ci']) {
  test(`CI 镜像归档 ${scenario}，失败不能产出半成品`, () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-image-test-'))
    fs.mkdirSync(path.join(dir, 'scripts'))
    fs.mkdirSync(path.join(dir, 'bin'))
    fs.copyFileSync(path.join(root, 'scripts/build-deploy-images.sh'), path.join(dir, 'scripts/build-deploy-images.sh'))
    const archive = path.join(dir, 'images.tar.gz'), log = path.join(dir, 'commands.jsonl')
    const mock = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const cmd=path.basename(process.argv[1]),a=process.argv.slice(2),s=process.env.BUILD_SCENARIO;
fs.appendFileSync(process.env.BUILD_LOG,JSON.stringify([cmd,...a])+'\\n');
if(cmd==='git') console.log((s==='wrong-sha'?'b':'a').repeat(40));
if(cmd==='docker') { if(a[0]==='build'&&s==='build-fails')process.exit(1);if(a[0]==='save'){process.stdout.write('image archive');if(s==='save-fails')process.exit(1);} }
if(cmd==='sha256sum') console.log(crypto.createHash('sha256').update(fs.readFileSync(a[0])).digest('hex')+'  '+a[0]);
`
    for (const c of ['docker', 'git', 'sha256sum']) fs.writeFileSync(path.join(dir, 'bin', c), mock, { mode: 0o755 })
    try {
      const r = spawnSync('bash', ['scripts/build-deploy-images.sh'], { cwd: dir, encoding: 'utf8', timeout: 10000,
        env: { ...process.env, PATH: path.join(dir, 'bin') + ':' + process.env.PATH, GITHUB_SHA: 'a'.repeat(40),
          GITHUB_ACTIONS: scenario === 'outside-ci' ? '' : 'true', DEPLOY_IMAGE_OUTPUT: archive, BUILD_SCENARIO: scenario, BUILD_LOG: log } })
      assert.equal(r.status, scenario === 'success' ? 0 : 1, r.stdout + r.stderr)
      assert.equal(fs.existsSync(archive), scenario === 'success')
      assert.ok(!fs.existsSync(archive + '.partial'))
      const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse)
      if (scenario === 'success') {
        assert.equal(gunzipSync(fs.readFileSync(archive)).toString(), 'image archive')
        const builds = calls.filter(c => c[0] === 'docker' && c[1] === 'build')
        assert.equal(builds.length, 2)
        for (const c of builds) {
          assert.ok(c.includes('linux/amd64') && c.includes('org.opencontainers.image.revision=' + 'a'.repeat(40)))
        }
      } else if (scenario === 'wrong-sha' || scenario === 'outside-ci') assert.ok(!calls.some(c => c[0] === 'docker'))
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
}

test('测试服务端口必须交给 OS 分配并绑定回环 IPv4（禁止自选端口范围）', () => {
  // 契约测试先去注释：说明本问题的注释里就写着那个错误写法，不去掉会自我误报。
  // 只剔除整行注释——按 `//` 全剔会连带砍掉 URL 字面量里的 `//`（如 `http://127.0.0.1`）。
  const code = fs.readFileSync(path.join(root, 'tests/helpers/smokeTestKit.js'), 'utf8')
    .split('\n').filter(line => !/^\s*\/\//.test(line)).join('\n')
  assert.ok(!/3100\s*\+\s*Math\.floor\(/.test(code),
    'smokeTestKit 不得用 3100+random 自选端口：该范围包含 3306（CI 的 MySQL 端口），会随机 EADDRINUSE')
  assert.ok(code.includes("'127.0.0.1'"),
    "smokeTestKit 必须显式绑定 '127.0.0.1'，否则可能只绑 IPv6 而 baseUrl 走 IPv4（fetch failed）")
  assert.ok(code.includes('server.address().port'),
    'baseUrl 的端口必须取自 server.address().port，而不是自己记的常量')
})

// 2026-09-18 结构性修复的守卫：`Build PDA APK` 曾在 workflow 级持有 `flowcube-server-deploy`
// 部署组，而它的 build job 里含「等本提交浏览器部署成功」——浏览器部署要同一个组，
// 于是 **PDA 等浏览器部署、浏览器部署等 PDA 释放组**，形成环状自锁。GitHub 不会报错，
// 只表现为 `Deploy Browser App` 长期 pending（v0.9.23 实操踩到，只能人工 cancel 让路）。
//
// 不变量：**「等待」与「持有部署锁」不得出现在同一个 job 里**，且部署组只能由真正
// 需要 SSH 发布的那一步持有。这条关系适合机械守住——它太容易被下一次"顺手挪个步骤"破坏。
test('PDA 原生扫码单元测试必须在正式 APK 构建前运行', () => {
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-pda-apk.yml'), 'utf8'))
  const steps = workflow.jobs['build-pda'].steps || []
  const testIndex = steps.findIndex(step => String(step.run || '').includes(':app:testDebugUnitTest'))
  const buildIndex = steps.findIndex(step => String(step.run || '').includes('assembleRelease'))
  assert.ok(testIndex >= 0 && testIndex < buildIndex, 'Android 单元测试必须在正式 APK 构建前通过')
})

test('废弃 downloads 守卫必须有 CI 执行入口（防「脚本写了但从没人跑」）', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const command = 'npm run release:check-downloads'
  assert.ok(pkg.scripts && pkg.scripts['release:check-downloads'],
    'package.json 必须保留 release:check-downloads 脚本')

  const scriptPath = path.join(root, 'scripts/check-deprecated-downloads.js')
  assert.ok(fs.existsSync(scriptPath), 'scripts/check-deprecated-downloads.js 必须存在')

  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8'))
  const runners = []
  for (const [jobName, job] of Object.entries(workflow.jobs || {})) {
    for (const step of job.steps || []) {
      if (String(step.run || '').includes(command)) runners.push(`${jobName}/${step.name}`)
    }
  }
  assert.ok(runners.length >= 1,
    `没有任何 CI 步骤执行 \`${command}\`：backend/downloads 的废弃规则会变成无人执行的摆设（已接线位置：${runners.join(', ') || '无'}）`)

  // 反向确认脚本不是空壳：它必须真的检查 git 视角下的该目录，否则接线也只是"跑了个寂寞"。
  const source = fs.readFileSync(scriptPath, 'utf8')
  assert.ok(/git\(\[\s*['"]ls-files['"]/.test(source),
    '废弃 downloads 守卫必须检查 git ls-files（`git add -f` 是 .gitignore 拦不住的唯一危险路径）')
  assert.ok(source.includes('backend/downloads'),
    '废弃 downloads 守卫必须检查 backend/downloads 目录')
})

// 2026-09-19：`smoke:atp` 守的是销售预计库存（ATP）——「采购预计量能否被占库、取消/短装前必须
// 先解绑」这类规则，AGENTS.md §7 明确写着「规则与回归见 expectedStock.js、sale-atp.smoke.test.js」，
// 但该套件从未出现在任何 workflow 里：8 条断言只在有人手工执行时才跑。CI 全绿时看不出任何异常，
// 这正是 2026-09-18 审计记下的那类「写了但没接线」缺陷（同批还有孤儿测试与废弃目录守卫）。
//
// 不变量：**每个 smoke:*/test:* 脚本都必须能在 CI 里被跑到**，除非在下面的豁免表里并写明理由。
// 豁免表双向断言——新出现的未接线脚本会失败，已经接线的旧豁免也会失败，防止表腐烂成"什么都豁免"。
test('每个 smoke/test 脚本必须在 CI 里跑得到（未接线须显式豁免并写明理由）', () => {
  const EXEMPTIONS = {
    'smoke:legacy-receivable-repair': '需已迁移的专用 flowcube_repair20260908_test 库，且必须与采购修复串行执行',
    'test:legacy-receivable-repair': '同上：专用修复库单测，随 smoke 手工串行执行',
    'smoke:purchase-repair': '同上：专用修复库且与应收专项串行，生产只执行已授权的定向修复脚本',
    'smoke:pages': 'CUA 页面验收，需要在线前端与测试账号凭据，不属于离线门禁',
    'smoke:reconciliation': '需要在线 baseUrl、SMOKE_USERNAME/PASSWORD 与 playwright，属实机验收',
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflowDir = path.join(root, '.github/workflows')

  let workflowText = ''
  const matrixSuites = new Set()
  for (const name of fs.readdirSync(workflowDir)) {
    const text = fs.readFileSync(path.join(workflowDir, name), 'utf8')
    workflowText += `\n${text}`
    const parsed = yaml.load(text)
    for (const job of Object.values(parsed.jobs || {})) {
      const suites = job.strategy && job.strategy.matrix && job.strategy.matrix.suite
      if (Array.isArray(suites)) suites.forEach(s => matrixSuites.add(`smoke:${s}`))
    }
  }

  const isReached = (name) => {
    if (workflowText.includes(`npm run ${name}`)) return true
    if (matrixSuites.has(name)) return true
    // The destructive go-live suite runs inside the owned runner, never on a shared CI DB.
    if (name === 'smoke:go-live-runtime' &&
        pkg.scripts['smoke:go-live-owned'] === 'bash scripts/repair-smoke-ephemeral.sh --go-live' &&
        workflowText.includes('npm run smoke:go-live-owned') &&
        fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').includes('run_smoke smoke:go-live-runtime')) return true
    if (name === 'smoke:inbound-edit-runtime' &&
        pkg.scripts['smoke:inbound-edit-owned'] === 'bash scripts/repair-smoke-ephemeral.sh --inbound-edit' &&
        workflowText.includes('npm run smoke:inbound-edit-owned') &&
        fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').includes('run_smoke smoke:inbound-edit-runtime')) return true
    if (name === 'smoke:retention-reprint-runtime' &&
        pkg.scripts['smoke:retention-reprint-owned'] === 'bash scripts/repair-smoke-ephemeral.sh --retention-reprint' &&
        workflowText.includes('npm run smoke:retention-reprint-owned') &&
        fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').includes('run_smoke smoke:retention-reprint-runtime')) return true
    if (['smoke:change-records-runtime', 'smoke:change-records-regressions'].includes(name) &&
        pkg.scripts['smoke:change-records-owned'] === 'bash scripts/repair-smoke-ephemeral.sh --change-records' &&
        workflowText.includes('npm run smoke:change-records-owned') &&
        (name !== 'smoke:change-records-regressions' || /FLOWCUBE_CHANGE_REGRESSIONS:\s*['"]1['"]/.test(workflowText)) &&
        fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').includes(`run_smoke ${name}`)) return true
    if (name === 'smoke:pda-audit-log-api-runtime' &&
        pkg.scripts['smoke:pda-audit-log-api-owned'] === 'bash scripts/repair-smoke-ephemeral.sh --pda-audit-log-api' &&
        workflowText.includes('npm run smoke:pda-audit-log-api-owned') &&
        fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').includes('run_smoke smoke:pda-audit-log-api-runtime')) return true
    if (name === 'smoke:pda-audit-log-migration-runtime' &&
        pkg.scripts['smoke:pda-audit-log-migration-owned'] === 'bash scripts/repair-smoke-ephemeral.sh --pda-audit-log-migration' &&
        workflowText.includes('npm run smoke:pda-audit-log-migration-owned') &&
        fs.readFileSync(path.join(root, 'scripts/repair-smoke-ephemeral.sh'), 'utf8').includes('run_smoke smoke:pda-audit-log-migration-runtime')) return true
    // 有些脚本在 CI 里按文件调用（如 node --test tests/xxx.test.js）
    const files = (pkg.scripts[name].match(/[\w./-]+\.(js|sh|cjs)/g) || [])
    return files.some(f => workflowText.includes(path.basename(f)))
  }

  const testScripts = Object.keys(pkg.scripts).filter(k => /^(smoke|test):/.test(k))
  assert.ok(testScripts.length > 50, `smoke/test 脚本数量异常（${testScripts.length}），检查 package.json 是否被改动`)

  const uncovered = testScripts.filter(name => !isReached(name))
  const unexpected = uncovered.filter(name => !EXEMPTIONS[name])
  const staleExemptions = Object.keys(EXEMPTIONS).filter(name => isReached(name))

  for (const [name, reason] of Object.entries(EXEMPTIONS)) {
    assert.ok(pkg.scripts[name], `豁免表里的 ${name} 已不存在，请删除该条豁免`)
    assert.ok(String(reason).length >= 10, `豁免 ${name} 必须写明可核对的理由`)
  }
  assert.deepEqual(unexpected, [],
    `这些测试脚本没有任何 workflow 会执行，等于只在手工跑时才有意义：${unexpected.join(', ')}。`
    + '请接进 CI，或在豁免表里写明理由')
  assert.deepEqual(staleExemptions, [],
    `这些脚本已经接进 CI，豁免条目必须删除（否则豁免表会腐烂成"什么都豁免"）：${staleExemptions.join(', ')}`)
})

test('AST 文案与数量覆盖守卫须在已安装 TypeScript 的 job 中执行', () => {
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/test.yml'), 'utf8'))
  function verify(jobs) {
    for (const [name, job] of Object.entries(jobs)) {
      let installed = false
      for (const step of job.steps || []) {
        const run = String(step.run || '')
        if (/npm --prefix frontend ci/.test(run)) installed = true
        if (/npm run test:(copy-conventions|qty-precision-coverage)/.test(run)) {
          assert.ok(installed, `${name}: AST 守卫前必须安装 frontend 的 TypeScript 依赖`)
        }
      }
    }
  }
  verify(workflow.jobs)
  const broken = structuredClone(workflow.jobs)
  for (const job of Object.values(broken)) job.steps = (job.steps || []).filter(step => !/npm --prefix frontend ci/.test(String(step.run || '')))
  assert.throws(() => verify(broken), /TypeScript/, '反向验证：删安装步骤必须失败')
})
