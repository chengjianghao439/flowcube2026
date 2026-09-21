'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { gunzipSync } = require('node:zlib')
const root = path.resolve(__dirname, '..')

// 2026-09-19：本机为盘点做了 30+ 次独立短 SSH 连接、多次被本地 timeout 强杀，把自己的出口 IP
// 打到服务器 sshd 限流（banner 阶段超时），而同一时刻 CI 出口 IP 完全正常——诊断能力不该绑在
// 单一来源 IP 上，因此新增 `workflow_dispatch` 的只读诊断 workflow（`.github/workflows/server-diagnostics.yml`）。
// **只读是它存在的前提**：一旦有人往里加删除/重启/清理命令，它就变成一个没有回滚预案的生产写入口。
// 反向验证：往远程脚本里加任一写操作命令、或删掉任一必需采集项，本断言都必须失败。
// 2026-09-19 实测：服务器 SSH 层**间歇性**不可用——12:06 部署失败、12:2x rerun 成功、12:49 诊断又失败，
// 全部卡在同一步骤。四个 workflow 原先都是单次 `ssh-keyscan`（默认 5 秒超时、不重试），一次抖动就让
// 部署/诊断整链终止，报「Add SSH known_hosts: failure」，与「网络不通」在日志上无法区分也无法自愈。
// 反向验证：把任一处退回单次无重试的 ssh-keyscan，本断言必须失败。
test('SSH known_hosts 的建立必须带重试（服务器 SSH 间歇不可用时不让整链路终止）', () => {
  for (const f of ['deploy-browser.yml', 'server-diagnostics.yml', 'build-desktop.yml', 'build-pda-apk.yml']) {
    const src = fs.readFileSync(path.join(root, '.github/workflows', f), 'utf8')
    assert.match(src, /for attempt in 1 2 3 4 5; do/, `${f} 的 ssh-keyscan 必须带重试`)
    assert.match(src, /ssh-keyscan -T 10/, `${f} 的 ssh-keyscan 必须显式设置 -T 超时`)
    assert.ok(
      !/^\s*ssh-keyscan\s+-H\s+-p\s+.*>>\s*~\/\.ssh\/known_hosts\s*$/m.test(src),
      `${f} 不得退回单次无重试的 ssh-keyscan（一次抖动即整链失败）`,
    )
  }
})

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

// 2026-09-19 实测：服务器磁盘低于 6 GiB 时，Deploy 步骤的预检 `test "$(df -Pm …)" -ge 6144`
// 只会让 ssh 返回 1、一行输出都没有——与「SSH 连不上/密钥失效」在日志里完全一样。11:04 起连续
// 3 轮部署都以「##[endgroup] 之后 3~4 秒静默 exit 1」失败，只能靠事后逐轮推断才知道是磁盘不足，
// 连「服务器还剩多少空间」都拿不到。所以预检必须先打印实际余量再判定，并让三种失败可区分
//（磁盘不足 / SSH 取不到 / df 返回空）。反向验证：退回 `test … -ge 6144`、或把 awk 的
// NF<2 分支改回 `exit 1`（会被 END 的 exit 覆盖成 0），本断言都必须失败。
test('部署磁盘预检失败必须自解释（打印实际余量，不得静默 exit 1）', () => {
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy-browser.yml'), 'utf8'))
  const step = workflow.jobs.deploy.steps.find(s => s.name === 'Deploy backend and frontend on server')
  assert.ok(step && step.run, '找不到 Deploy 步骤的 run 脚本')
  const run = step.run
  assert.match(run, /DISK_USAGE="\$\(/, '预检必须把 df 结果存进变量，才能打印出来')
  assert.match(run, /echo "服务器可用空间/, '预检必须先打印实际余量')
  assert.match(run, /df -Pm \/tmp/, '预检必须同时检查 /tmp 与 APP_PATH')
  assert.match(run, /低于部署预检下限 6144MB/, '余量不足必须给出指向磁盘的可执行提示')
  assert.match(run, /无法读取服务器磁盘余量/, 'SSH 取不到余量时必须与「磁盘不足」区分开')
  assert.match(run, /没有拿到可用空间/, 'df 返回空或格式异常也必须失败，不能静默放行')
  assert.match(run, /bad = 1; next \}/, 'NF<2 分支必须置 bad 后 next：直接 exit 会被 END 的 exit 覆盖成 0')
  assert.match(run, /END \{ exit bad \? 1 : 0 \}/, '最终退出码必须由统一判定给出')
  assert.ok(!/test \\?\$\(df -Pm/.test(run), '不得退回 `test "$(df -Pm …)" -ge 6144` 的静默形态')
})

// 2026-09-19 实测：桌面发布把中转目录建在服务器 `/tmp/flowcube-desktop-release/${tag}`，却从不清理，
// v0.9.13–v0.9.25 累积到 1.3G；而 /tmp 与 /opt/flowcube 同处根分区，把上传前的 6144MB 余量门禁一点点
// 吃到只剩 24MB（6120MB），连续 4 轮部署在上传任何字节之前被拒绝。中转目录只服务本次上传
//（release-desktop.js 以只读方式挂载它），必须保证**任何退出路径**都清理——包括 scp 或发布中途失败。
// 反向验证：去掉 `trap ... EXIT`、或让 cleanup 不真的 rm，本断言都必须失败。
test('桌面发布必须清理服务器侧中转目录（防 /tmp 长期累积吃掉部署余量）', () => {
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-desktop.yml'), 'utf8'))
  const steps = Object.values(workflow.jobs).flatMap(j => j.steps || [])
  const step = steps.find(s => s.name === 'Publish EXE to canonical download directory')
  assert.ok(step && step.run, '找不到「Publish EXE to canonical download directory」步骤')
  const run = step.run
  assert.match(run, /remote_tmp="\/tmp\/flowcube-desktop-release\/\$\{tag\}"/, '中转目录路径变了，需同步本守卫与清理逻辑')
  assert.match(run, /trap\s+cleanup_remote_tmp\s+EXIT/, '必须用 EXIT trap 保证失败路径也清理中转目录')
  assert.match(run, /rm -rf '\$remote_tmp'/, 'cleanup_remote_tmp 必须真的删除远端中转目录')
  assert.ok(
    run.indexOf('trap cleanup_remote_tmp EXIT') < run.indexOf("mkdir -p '$remote_tmp'"),
    'trap 必须在创建中转目录之前注册，否则创建之后的失败仍会留下残留',
  )
})

// 2026-09-18 发 v0.9.24 实测：Deploy Browser App 只跑了 11.5 分钟就以 exit code 124 失败，
// 线上仍是旧版。根因不是那 40 分钟的外层上限，而是**镜像归档上传仍是 600 秒**，而同一根因
// （服务器慢盘）上的 docker load 早在 v0.9.17 就放宽到 1800 秒——典型「改了一个环节忘了另一个」。
//
// 2026-09-21 二次修正（v0.10.2 发不出去的真实根因）：上传慢**不是**「需要更长时间」，
// 而是**单条 TCP 在丢包链路上的拥塞窗口被压死**。实测同一条中美链路：
//   单流 66 KB/s  →  8 条并行合计 8.4 MB/s（相差 126 倍）
// 所以「把时限从 1800 放宽到 3600」在原理上不可能成功：192MB 归档按 66 KB/s 要 53 分钟，
// 而 3600 秒只够传 97MB，于是连续多轮都卡在 timeout 到点被强杀（exit 137，与 OOM 无关）。
// 判定标准因此从「时限够不够长」改成「并行度够不够高 + 分片是否按字节切」——后者保证
// 服务器端合并后的**字节与 sha256 完全不变**，server-update.sh 的校验一律不动。
// 反向验证：把 UPLOAD_STREAMS 改成 1、删掉 PART_TIMEOUT、把 split -b 换成不切分，
// 或把 UPLOAD_BUDGET 设成小于 PART_TIMEOUT，本断言都必须失败。
test('镜像上传必须分片并行（单连接跨境吞吐塌陷时加时限无用），且步骤/job 预算容得下', () => {
  const yaml = require(path.resolve(root, 'frontend/node_modules/js-yaml'))
  const workflow = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/deploy-browser.yml'), 'utf8'))
  const job = workflow.jobs.deploy
  assert.ok(job, '未找到 deploy job')

  const step = job.steps.find(s => s.name === 'Deploy backend and frontend on server')
  assert.ok(step, '未找到「Deploy backend and frontend on server」步骤')
  const script = String(step.run)

  const outer = script.match(/timeout\s+-k\s+\d+\s+(\d+)\s+bash\s+scripts\/server-update\.sh/)
  assert.ok(outer, '未找到 server-update.sh 的外层超时配置')
  const outerSeconds = Number(outer[1])

  // docker load 仍是慢盘上的关键环节，保留一条下限守护（改动它要显式说明理由）。
  const update = fs.readFileSync(path.join(root, 'scripts/server-update.sh'), 'utf8')
  const load = update.match(/DOCKER_COMMAND_TIMEOUT=(\d+)\s+docker load/)
  assert.ok(load, '未找到 docker load 的 DOCKER_COMMAND_TIMEOUT')
  assert.ok(Number(load[1]) >= 600,
    `docker load 时限 ${load[1]}s 过低：慢盘首次加载新镜像可能超过 10 分钟`)

  const streams = script.match(/UPLOAD_STREAMS=(\d+)/)
  assert.ok(streams, '未找到 UPLOAD_STREAMS：镜像上传必须分片并行（单连接跨境吞吐已被压到 66 KB/s）')
  const streamsCount = Number(streams[1])
  assert.ok(streamsCount >= 4,
    `并行度 ${streamsCount} 过低：实测单流 66 KB/s 而 8 流合计 8.4 MB/s，并行度不足会让 192MB 归档重新变成「传不完」`)

  const partTimeout = script.match(/PART_TIMEOUT=(\d+)/)
  assert.ok(partTimeout, '未找到 PART_TIMEOUT：必须给单个分片显式时限')
  const partSeconds = Number(partTimeout[1])
  assert.ok(partSeconds >= 600,
    `单分片时限 ${partSeconds}s 过低：每个分片约「归档 ÷ 并行度」（当前归档约 192MB），按最差实测速率也要留足余量`)

  const budget = script.match(/UPLOAD_BUDGET=(\d+)/)
  assert.ok(budget, '未找到 UPLOAD_BUDGET：整批上传必须有墙钟上限')
  const budgetSeconds = Number(budget[1])
  assert.ok(budgetSeconds >= partSeconds,
    `整批上限 ${budgetSeconds}s 不得小于单分片上限 ${partSeconds}s：否则批量 xargs 会先被杀，单分片时限形同虚设`)

  const splitBytes = script.match(/split\s+-b\s+"\$PART_BYTES"/)
  assert.ok(splitBytes, '未找到按字节切分（split -b "$PART_BYTES"）：分片不改变归档字节是 sha256 校验不变的前提')
  const merge = script.match(/cat\s+'\$PARTS_DIR'\/part-\*\s*>/)
  assert.ok(merge, '未找到服务器端按序合并（cat "$PARTS_DIR"/part-* > 归档）')

  const stepSeconds = Number(step['timeout-minutes']) * 60
  assert.ok(Number.isFinite(stepSeconds) && stepSeconds > 0, 'Deploy 步骤必须显式声明 timeout-minutes')
  assert.ok(stepSeconds > budgetSeconds + outerSeconds,
    `Deploy 步骤上限 ${stepSeconds}s 必须大于上传批量 ${budgetSeconds}s + server-update ${outerSeconds}s`)

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
