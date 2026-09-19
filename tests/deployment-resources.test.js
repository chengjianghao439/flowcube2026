'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { gunzipSync } = require('node:zlib')
const root = path.resolve(__dirname, '..')

test('部署总超时穿透内层等待，清理和回退必须在强杀前执行', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-nested-timeout-'))
  const log = path.join(dir, 'events'), pids = path.join(dir, 'pids')
  fs.writeFileSync(path.join(dir, 'docker'), `#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.PROBE_PIDS, JSON.stringify([process.pid,process.ppid]));setInterval(()=>{},1000);\n`, { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'gate.sh'), `set -euo pipefail\ntrap 'echo cleanup >> "$PROBE_LOG"' EXIT\ntrap 'exit 143' TERM\n. scripts/lib/runtime-guards.sh\nDOCKER_COMMAND_TIMEOUT=20 docker run\n`)
  fs.writeFileSync(path.join(dir, 'deploy.sh'), `set -Eeuo pipefail\ntrap 'echo rollback >> "$PROBE_LOG"; exit 1' TERM ERR\nbash "$PROBE_DIR/gate.sh"\n`)
  try {
    const r = spawnSync('bash', ['-c', 't=$(type -P timeout || type -P gtimeout); exec "$t" -k 2 1 bash "$PROBE_DIR/deploy.sh"'], {
      cwd: root, timeout: 7000, stdio: 'ignore', env: { ...process.env, PATH: dir + ':' + process.env.PATH,
        FLOWCUBE_DEPLOY_TIMEOUT_GROUP: '1', PROBE_DIR: dir, PROBE_LOG: log, PROBE_PIDS: pids } })
    assert.equal(r.signal, null, '不应因 Bash 等待内层独立进程组而被强杀')
    assert.equal(r.status, 124)
    const events = fs.readFileSync(log, 'utf8')
    assert.match(events, /cleanup/)
    assert.match(events, /rollback/)
    const [pid] = JSON.parse(fs.readFileSync(pids, 'utf8'))
    assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' })
  } finally {
    if (fs.existsSync(pids)) for (const pid of JSON.parse(fs.readFileSync(pids, 'utf8'))) {
      try { process.kill(pid, 'SIGKILL') } catch (e) { if (e.code !== 'ESRCH') throw e }
    }
    fs.rmSync(dir, { recursive: true, force: true })
  }
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

// 2026-09-18 发 v0.9.24 实测：Deploy Browser App 只跑了 11.5 分钟就以 exit code 124 失败，
// 线上仍是旧版。根因不是那 40 分钟的外层上限，而是**镜像归档上传仍是 600 秒**，而同一根因
// （服务器慢盘）上的 docker load 早在 v0.9.17 就放宽到 1800 秒——典型「改了一个环节忘了另一个」，
// 且失败信息（timeout 的 124）指向外层，与真正的内层罪魁对不上。此断言把两个环节钉在一起，
// 并保证 Deploy 步骤与 job 的预算真的容得下它们（只放宽内层、外层先被强杀同样会白跑）。
test('镜像上传时限必须与 docker load 一致，且步骤/job 预算容得下', () => {
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy-browser.yml'), 'utf8'))
  const job = workflow.jobs.deploy
  assert.ok(job, '未找到 deploy job')

  const step = job.steps.find(s => s.name === 'Deploy backend and frontend on server')
  assert.ok(step, '未找到「Deploy backend and frontend on server」步骤')
  const script = String(step.run)

  const upload = script.match(/timeout\s+-k\s+\d+\s+(\d+)\s+scp[^\n]*flowcube-images\.tar\.gz/)
  assert.ok(upload, '未找到镜像归档上传的 scp 超时配置')
  const outer = script.match(/timeout\s+-k\s+\d+\s+(\d+)\s+bash\s+scripts\/server-update\.sh/)
  assert.ok(outer, '未找到 server-update.sh 的外层超时配置')

  const update = fs.readFileSync(path.join(root, 'scripts/server-update.sh'), 'utf8')
  const load = update.match(/DOCKER_COMMAND_TIMEOUT=(\d+)\s+docker load/)
  assert.ok(load, '未找到 docker load 的 DOCKER_COMMAND_TIMEOUT')

  const uploadSeconds = Number(upload[1])
  const outerSeconds = Number(outer[1])
  const loadSeconds = Number(load[1])
  assert.equal(uploadSeconds, loadSeconds,
    `镜像上传时限 ${uploadSeconds}s 与 docker load 时限 ${loadSeconds}s 必须一致：二者是同一慢盘根因的两个环节`)

  const stepSeconds = Number(step['timeout-minutes']) * 60
  assert.ok(Number.isFinite(stepSeconds) && stepSeconds > 0, 'Deploy 步骤必须显式声明 timeout-minutes')
  assert.ok(stepSeconds > uploadSeconds + outerSeconds,
    `Deploy 步骤上限 ${stepSeconds}s 必须大于上传 ${uploadSeconds}s + server-update ${outerSeconds}s`)

  const jobSeconds = Number(job['timeout-minutes']) * 60
  const declared = job.steps.reduce((sum, s) => sum + (Number(s['timeout-minutes']) || 0) * 60, 0)
  assert.ok(jobSeconds > declared,
    `job 上限 ${jobSeconds}s 必须大于各步骤声明上限之和 ${declared}s，否则 job 级会先被强杀`)
})

// 2026-09-18 实测：`smokeTestKit` 用 `3100 + Math.random()*1000` 自选测试服务端口，而该范围
// **包含 3306**——CI 的 MySQL 正好监听 3306，随机命中即 `EADDRINUSE: address already in use :::3306`；
// 它启动时又没指定 host，可能只绑到 IPv6 `::` 而 baseUrl 固定走 127.0.0.1，表现为 `TypeError: fetch failed`。
// 两者都只在 CI 偶发（约 1/1000），且失败步骤每次都不同，极难复现——连续两次发版都被它拦下。
// 其余 10 个 smoke 套件一直是 `app.listen(0, '127.0.0.1')`。此断言钉住正确写法，避免再退回自选端口。
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
test('PDA 工作流不得让「等浏览器部署」与「持有部署组」落在同一个 job（防自锁）', () => {
  const DEPLOY_GROUP = 'flowcube-server-deploy'
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-pda-apk.yml'), 'utf8'))

  // workflow 级 concurrency 会把整条流水线都关进部署组，等待步骤自然也被关进去。
  const topGroup = workflow.concurrency && workflow.concurrency.group
  assert.notEqual(topGroup, DEPLOY_GROUP,
    `build-pda-apk.yml 不得在 workflow 级持有 ${DEPLOY_GROUP}：那会把「等浏览器部署」也关进部署组，重新形成自锁`)

  let holderCount = 0
  const selfLocked = []
  for (const [name, job] of Object.entries(workflow.jobs || {})) {
    const group = job.concurrency && job.concurrency.group
    const holdsDeployLock = group === DEPLOY_GROUP
    if (holdsDeployLock) holderCount += 1
    const waitsForBrowser = (job.steps || []).some(step => /wait-release-checks/.test(String(step.run || '')))
    if (waitsForBrowser && holdsDeployLock) selfLocked.push(name)
  }

  assert.deepEqual(selfLocked, [],
    `这些 job 既等待浏览器部署又持有 ${DEPLOY_GROUP}，会与 Deploy Browser App 互相等待：${selfLocked.join(', ')}`)
  // 部署组必须有且只有一个持有者（真正的发布步骤），否则'等待'可能悄悄挪回持有者身边。
  assert.equal(holderCount, 1,
    `应当恰好有一个 job 持有 ${DEPLOY_GROUP}（发布临界区），实际 ${holderCount} 个`)

  // 反向确认：等待步骤确实存在且不持有部署组，避免上面因为"把等待删了"而恒真。
  const waiter = Object.entries(workflow.jobs || {})
    .find(([, job]) => (job.steps || []).some(step => /wait-release-checks/.test(String(step.run || ''))))
  assert.ok(waiter, '找不到执行 wait-release-checks 的 job：等待门禁不允许被删除，只允许搬家')
  assert.notEqual(waiter[1].concurrency && waiter[1].concurrency.group, DEPLOY_GROUP,
    `等待浏览器部署的 job（${waiter[0]}）不得持有 ${DEPLOY_GROUP}`)
})

// 2026-09-19 发现：`scripts/check-deprecated-downloads.js` 早就存在，package.json 也声明了
// `release:check-downloads`，但**没有任何 workflow 跑过它**——于是「backend/downloads/ 已废弃、
// 不得提交发布文件」这条写在 AGENTS.md 里的规则，实际上没有任何一处会拦。
//
// 这条守卫最容易失效的地方不是脚本逻辑，而是「没人执行」：脚本本身是对的（反向验证过：
// `git add -f` 一个安装包进去，脚本 exit 1），却因为 `.gitignore` 让 git status 看不见普通提交，
// 只有真的跑起来才有意义。同类前车之鉴是那些"写了但没接线"的孤儿测试。故此断言把
// 「脚本存在 + package.json 声明 + 至少一条 CI 步骤真的执行」三者钉在一起。
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
