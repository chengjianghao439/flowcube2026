'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const yaml = require('../frontend/node_modules/js-yaml')

const sha = 'a'.repeat(40)
const root = path.resolve(__dirname, '..')
const workflow = name => yaml.load(fs.readFileSync(path.join(root, '.github/workflows', name), 'utf8'))

test('合并仅验证，网页和 PDA 正式工作流必须显式提交完整 SHA', () => {
  for (const name of ['deploy-browser.yml', 'build-pda-apk.yml']) {
    const wf = workflow(name)
    assert.deepEqual(Object.keys(wf.on), ['workflow_dispatch'])
    assert.equal(wf.on.workflow_dispatch.inputs.checkout_ref.required, true)
  }
  const desktop = workflow('build-desktop.yml')
  assert.deepEqual(desktop.on.push.branches, ['main'])
  assert.match(desktop.jobs.publish.if, /github\.ref_type == 'tag' \|\| github\.event_name == 'workflow_dispatch'/)
  for (const name of ['test.yml', 'security-scan.yml']) {
    const wf = workflow(name)
    assert.deepEqual(wf.on.pull_request.branches, ['main'])
    assert.deepEqual(wf.on.push.branches, ['main'])
  }
})

test('发布和只读探针使用同一套隧道入口与对应的受保护环境', () => {
  const entries = [
    ['deploy-browser.yml', 'deploy', 'web'],
    ['build-pda-apk.yml', 'publish-pda', 'pda'],
    ['build-desktop.yml', 'publish', 'desktop'],
    ['server-diagnostics.yml', 'diagnose', 'web'],
    ['probe-release-ssh.yml', 'probe', '${{ matrix.channel }}'],
  ]
  for (const [file, jobId, channel] of entries) {
    const job = workflow(file).jobs[jobId]
    assert.equal(job.environment, `flowcube-release-${channel}`, file)
    const action = job.steps.find(step => step.uses === './.github/actions/release-ssh')
    assert.ok(action, file)
    assert.equal(action.with['wireguard-private-key'], '${{ secrets.FLOWCUBE_WG_PRIVATE_KEY }}')
    assert.equal(action.with['wireguard-client-ip'], '${{ vars.FLOWCUBE_WG_CLIENT_IP }}')
  }
  const probe = workflow('probe-release-ssh.yml')
  assert.deepEqual(Object.keys(probe.on), ['workflow_dispatch'])
  assert.deepEqual(probe.permissions, { contents: 'read' })
  assert.deepEqual(probe.jobs.probe.strategy.matrix.channel, ['web', 'pda', 'desktop'])
  assert.match(probe.jobs.probe.steps.at(-1).run, /bash scripts\/probe-release-ssh\.sh/)
})

test('CI SSH 将公有目标固定到隧道，继续匹配原 SSH 主机键及非默认端口', t => {
  const sshDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-ci-tunnel-'))
  t.after(() => fs.rmSync(sshDir, { recursive: true, force: true }))
  const key = path.join(sshDir, 'fixture')
  const generated = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  const publicKey = fs.readFileSync(key + '.pub', 'utf8').trim().split(' ').slice(0, 2).join(' ')
  const host = 'deploy.example.test'
  const port = '2222'
  const env = {
    ...process.env,
    FLOWCUBE_SSH_HOST: host,
    FLOWCUBE_SSH_PORT: port,
    FLOWCUBE_SSH_KNOWN_HOSTS: `[${host}]:${port} ${publicKey}`,
    FLOWCUBE_WG_SERVER_IP: '10.203.85.1',
  }
  const configure = () => spawnSync('bash', ['scripts/setup-ci-ssh-trust.sh', sshDir], { cwd: root, env, encoding: 'utf8' })
  const result = configure()
  assert.equal(result.status, 0, result.stderr)
  const effective = spawnSync('ssh', ['-F', path.join(sshDir, 'config'), '-G', '-p', port, host], { encoding: 'utf8' })
  assert.equal(effective.status, 0, effective.stderr)
  assert.match(effective.stdout, /^hostname 10\.203\.85\.1$/m)
  assert.match(effective.stdout, /^hostkeyalias \[deploy\.example\.test\]:2222$/m)
  assert.match(effective.stdout, /^stricthostkeychecking (?:yes|true)$/m)
  env.FLOWCUBE_WG_SERVER_IP = '10.203.85.1\nProxyCommand false'
  assert.notEqual(configure().status, 0)
})

test('隔离的 wg 只从 /etc/wireguard 读取私钥，命令结束后删除临时密钥', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-wg-key-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.writeFileSync(path.join(dir, 'wg'), '#!/bin/sh\nexit 99\n', { mode: 0o755 })
  fs.writeFileSync(path.join(dir, 'sudo'), `#!/usr/bin/env bash
set -euo pipefail
fixture_key="$FLOWCUBE_WG_TEST_DIR/key"
case "$1" in
  mkdir) [[ "$*" == 'mkdir -p -m 0700 -- /etc/wireguard' ]] ;;
  mktemp)
    [[ "$2" == /etc/wireguard/.flowcube-ci-key.XXXXXX ]]
    : > "$fixture_key"
    printf '/etc/wireguard/.flowcube-ci-key.test\\n'
    ;;
  tee)
    [[ "$2" == /etc/wireguard/.flowcube-ci-key.test ]]
    cat > "$fixture_key"
    ;;
  wg)
    if [[ "$5" != /etc/wireguard/.flowcube-ci-key.test ]]; then
      echo 'fopen: Permission denied' >&2
      exit 1
    fi
    test -s "$fixture_key"
    test "$FLOWCUBE_WG_TEST_RESULT" = ok
    ;;
  rm) unlink "$fixture_key" ;;
  ip) printf '%s\\n' "$*" >> "$FLOWCUBE_WG_TEST_DIR/ip-log" ;;
  *) exit 98 ;;
esac
`, { mode: 0o755 })

  const privateKey = 'A'.repeat(43) + '='
  for (const scenario of ['ok', 'fail']) {
    const run = spawnSync('bash', ['scripts/setup-release-tunnel.sh'], {
      cwd: root,
      env: {
        ...process.env,
        PATH: dir + path.delimiter + process.env.PATH,
        FLOWCUBE_WG_TEST_DIR: dir,
        FLOWCUBE_WG_TEST_RESULT: scenario,
        FLOWCUBE_WG_PRIVATE_KEY: privateKey,
        FLOWCUBE_WG_SERVER_PUBLIC_KEY: 'B'.repeat(43) + '=',
        FLOWCUBE_WG_SERVER_IP: '10.203.85.1',
        FLOWCUBE_WG_CLIENT_IP: '10.203.85.11',
        FLOWCUBE_WG_ENDPOINT: 'server.example.test:51820',
      },
      encoding: 'utf8',
    })
    assert.equal(run.status, scenario === 'ok' ? 0 : 1, run.stderr)
    assert.ok(!(run.stdout + run.stderr).includes(privateKey))
    assert.ok(!fs.existsSync(path.join(dir, 'key')))
  }
  assert.match(fs.readFileSync(path.join(dir, 'ip-log'), 'utf8'), /^ip link delete dev flowcube-wg$/m)
})

for (const [name, gateName] of [['test.yml', 'Tests PR Gate'], ['security-scan.yml', 'Security Scan PR Gate']]) {
  test(`${gateName} 覆盖所有作业，失败、取消、跳过或缺结果均失败`, () => {
    const jobs = workflow(name).jobs
    const gate = jobs['pr-gate']
    assert.ok(gate, gateName)
    assert.equal(gate.name, gateName)
    assert.match(gate.if, /always\(\).*pull_request/)
    assert.deepEqual([...gate.needs].sort(), Object.keys(jobs).filter(id => id !== 'pr-gate').sort())
    assert.notEqual(gate['continue-on-error'], true)
    const step = gate.steps[0]
    assert.equal(step.env.REQUIRED_RESULTS, '${{ toJSON(needs.*.result) }}')
    const success = gate.needs.map(() => 'success')
    for (const results of [success, [], ...['failure', 'cancelled', 'skipped'].map(state => [state, ...success.slice(1)])]) {
      const result = spawnSync('bash', ['-eo', 'pipefail', '-c', step.run], {
        env: { ...process.env, REQUIRED_RESULTS: JSON.stringify(results) }, encoding: 'utf8',
      })
      assert.ifError(result.error)
      assert.equal(result.status, results === success ? 0 : 1, result.stdout + result.stderr)
    }
  })
}

for (const [name, job] of [['deploy-browser.yml', 'deploy'], ['build-pda-apk.yml', 'resolve-release-target']]) {
  test(`${name} 拒绝自动事件、错误分支以及普通发布中的 SHA 漂移`, () => {
    const step = workflow(name).jobs[job].steps[0]
    assert.equal(step.name, 'Validate authorized dispatch')
    for (const [overrides, expected] of [
      [{}, 0],
      [{ GITHUB_EVENT_NAME: 'push' }, 1],
      [{ GITHUB_REF: 'refs/heads/topic' }, 1],
      [{ RELEASE_CHECKOUT_REF: '' }, 1],
      [{ RELEASE_CHECKOUT_REF: 'main' }, 1],
      [{ GITHUB_SHA: 'b'.repeat(40) }, 1],
    ]) {
      const result = spawnSync('bash', ['-c', step.run], {
        env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
          GITHUB_SHA: sha, RELEASE_CHECKOUT_REF: sha, BROWSER_RELEASE_RUN_ID: '101', ...overrides },
        encoding: 'utf8',
      })
      assert.ifError(result.error)
      assert.equal(result.status, expected, result.stdout + result.stderr)
    }
  })
}

function releaseEntry(t, remoteSha = sha, { proxy = 'http://fixture.test', pdaRunId = '102' } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-release-dispatch-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const bin = path.join(dir, 'bin'), log = path.join(dir, 'commands')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(dir, 'scripts'))
  fs.copyFileSync(path.join(root, 'scripts/release-prod.sh'), path.join(dir, 'scripts/release-prod.sh'))
  fs.writeFileSync(path.join(dir, 'scripts/check-release-ssh-trust.sh'), 'echo ssh-preflight >> "$RELEASE_TEST_LOG"\n')
  function stub(name, body) {
    fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body, { mode: 0o755 })
  }
  stub('git', `case "$1 $2" in
    "rev-parse --abbrev-ref") echo main;;
    "rev-parse HEAD") echo "$FIXTURE_SHA";;
    "status --porcelain") :;;
    *) echo "git $*" >> "$RELEASE_TEST_LOG"; exit 3;;
  esac
`)
  stub('node', `case "$1" in
    -p) echo 1.2.3;;
    scripts/complete-release.js) echo "complete $BROWSER_RELEASE_RUN_ID $PDA_RELEASE_RUN_ID" >> "$RELEASE_TEST_LOG";;
    *) echo fixture;;
  esac
`)
  stub('gh', `case "$1 $2" in
    "repo view") echo fixture/repo;;
    "api repos/fixture/repo/git/ref/heads/main") echo "$FIXTURE_REMOTE_SHA";;
    api" "*)
      echo "gh $*" >> "$RELEASE_TEST_LOG"
      case "$2" in
        */deploy-browser.yml/dispatches) echo 101;;
        */build-pda-apk.yml/dispatches) echo "$FIXTURE_PDA_RUN_ID";;
        *) exit 4;;
      esac;;
    *) exit 4;;
  esac
`)
  stub('python3', `if [ "$FLOWCUBE_RELAY_PREFLIGHT_ONLY" = 1 ]; then
    echo relay-preflight
  else
    echo "relay $BROWSER_RELEASE_RUN_ID $PDA_RELEASE_RUN_ID"
  fi >> "$RELEASE_TEST_LOG"
`)
  stub('caffeinate', 'exit 0\n')
  const result = spawnSync('bash', ['scripts/release-prod.sh'], {
    cwd: dir, timeout: 5000, encoding: 'utf8',
    env: { PATH: bin + ':' + process.env.PATH, GITHUB_TOKEN: 'fixture-token', FLOWCUBE_RELAY_PROXY: proxy,
      FIXTURE_SHA: sha, FIXTURE_REMOTE_SHA: remoteSha, FIXTURE_PDA_RUN_ID: pdaRunId, RELEASE_TEST_LOG: log },
  })
  assert.ifError(result.error)
  return { ...result, commands: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [] }
}

test('正式入口显式触发两个工作流，传递同 SHA 和本次运行编号', t => {
  const result = releaseEntry(t)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.deepEqual(result.commands.slice(0, 2), ['ssh-preflight', 'relay-preflight'])
  assert.match(result.commands[2], new RegExp('deploy-browser.yml/dispatches.*checkout_ref.*' + sha))
  assert.match(result.commands[3], new RegExp('build-pda-apk.yml/dispatches.*checkout_ref.*' + sha + '.*browser_run_id.*101'))
  for (const command of result.commands.slice(2, 4)) {
    assert.match(command, /--method POST .*--raw-field ref=main --field return_run_details=true/)
  }
  assert.ok(result.commands.includes('relay 101 102'))
  assert.ok(result.commands.includes('complete 101 102'))
  assert.ok(!result.commands.some(command => command.startsWith('git ')))
})

test('本地与 GitHub 主线不一致时不触发任何正式工作流', t => {
  const result = releaseEntry(t, 'b'.repeat(40))
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, /GitHub main/)
  assert.deepEqual(result.commands, [])
})

test('任一触发未返回有效运行编号时停止中转与后续发布', t => {
  const result = releaseEntry(t, sha, { pdaRunId: '' })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, /运行编号/)
  assert.ok(!result.commands.some(command => /^(relay |complete )/.test(command)))
})

test('正式入口缺少本机代理时在触发前拒绝发布', t => {
  const result = releaseEntry(t, sha, { proxy: '' })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.match(result.stdout + result.stderr, /缺少本机代理地址/)
  assert.deepEqual(result.commands, [])
})

test('发布前用 CI 实际域名校验可信主机键，只有 IP 时拒绝', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { spawnSync } = require('node:child_process')
  const root = path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-ssh-preflight-'))
  const bin = path.join(temp, 'bin'), hosts = path.join(temp, 'hosts'), key = path.join(temp, 'hostkey')
  fs.mkdirSync(bin)
  const generated = spawnSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-f', key], { encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
  fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\ncase "$2" in server.host) echo deploy.example.test;; server.sshPort) echo 22;; esac\n', { mode: 0o755 })
  fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\n[ "$1" = variable ] && [ "$2" = get ] && [ "$3" = FLOWCUBE_SSH_KNOWN_HOSTS ] || exit 1\ncat "$RELEASE_TEST_HOSTS"\n', { mode: 0o755 })
  const pubkey = fs.readFileSync(key + '.pub', 'utf8').trim().split(' ').slice(0, 2).join(' ')
  const run = () => spawnSync('bash', ['scripts/check-release-ssh-trust.sh'], { cwd: root, encoding: 'utf8', timeout: 5000,
    env: { ...process.env, PATH: bin + ':' + process.env.PATH, GITHUB_REPOSITORY: 'fixture/repo', RELEASE_TEST_HOSTS: hosts } })
  try {
    fs.writeFileSync(hosts, `192.0.2.10 ${pubkey}\n`)
    const mismatch = run()
    assert.notEqual(mismatch.status, 0, mismatch.stdout + mismatch.stderr)
    assert.match(mismatch.stdout + mismatch.stderr, /可信主机键|目标主机/)
    fs.writeFileSync(hosts, `deploy.example.test,192.0.2.10 ${pubkey}\n`)
    const matched = run()
    assert.equal(matched.status, 0, matched.stdout + matched.stderr)
    assert.equal((matched.stdout + matched.stderr).includes(pubkey.split(' ')[1]), false, '预检输出不得包含完整公钥')
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
})

for (const scenario of ['changed-head', 'changed-version', 'same']) {
  test(`等待期间源码变化不能导致给另一提交打 tag：${scenario}`, () => {
    const { publishTagForCommit } = require('../scripts/complete-release')
    const calls = []
    const runner = (cmd, args) => {
      calls.push([cmd, args])
      if (cmd === 'git' && args[0] === 'rev-parse') return scenario === 'changed-head' ? 'b'.repeat(40) : sha
      if (cmd === 'git' && args[0] === 'show') return JSON.stringify({ version: scenario === 'changed-version' ? '1.2.4' : '1.2.3' })
    }
    const run = () => publishTagForCommit({ sha, tag: 'v1.2.3', runner })
    if (scenario === 'same') run()
    else assert.throws(run, /发布目标/)
    assert.equal(calls.some(([cmd]) => cmd === 'bash'), scenario === 'same')
  })
}

test('桌面发布不可绕过门禁，恢复从指定原运行取得实际产物', () => {
  const fs = require('node:fs'), path = require('node:path')
  const root = path.resolve(__dirname, '..')
  const yaml = require(path.join(root, 'frontend/node_modules/js-yaml'))
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-desktop.yml'), 'utf8'))
  const verify = workflow => {
    const steps = workflow.jobs.publish.steps
    const gate = steps.findIndex(step => step.name === 'Wait for checks before publishing installer')
    const publish = steps.findIndex(step => /bash scripts\/publish-desktop-workflow\.sh/.test(step.run || ''))
    assert.ok(gate >= 0 && gate < publish)
    assert.notEqual(workflow.jobs.publish['continue-on-error'], true)
    assert.equal(steps[publish].if, undefined)
    for (const i of [gate, publish]) assert.notEqual(steps[i]['continue-on-error'], true)
    const recover = steps.find(step => step.name === 'Download exact original installer for recovery')
    assert.match(recover.with['artifact-ids'], /outputs\.recovery_artifact/)
    assert.match(recover.with['run-id'], /outputs\.recovery_run/)
    assert.match(workflow.jobs.build.if, /recovery_run == ''/)
    assert.ok(workflow.jobs.publish.needs.includes('build'))
    assert.equal(workflow.jobs.build.permissions.contents, 'read')
  }
  verify(wf)
  const broken = structuredClone(wf)
  broken.jobs.publish.steps.find(step => /bash scripts\/publish-desktop-workflow\.sh/.test(step.run || ''))['continue-on-error'] = true
  assert.throws(() => verify(broken))
})

test('桌面发布两侧均预检，阶段失败只保留原包并收尾本次中转', t => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os')
  const { spawnSync } = require('node:child_process')
  const root = path.resolve(__dirname, '..')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-desktop-order-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  fs.mkdirSync(path.join(dir, 'scripts'))
  const log = path.join(dir, 'stages')
  const stub = (name, body) => fs.writeFileSync(path.join(dir, name), '#!/bin/bash\n' + body, { mode: 0o755 })
  const event = 'printf "%s\\n" "$stage" >> "$EVENT_LOG"\n[ "$stage" != "$FAIL_AT" ]\n'
  stub('timeout', 'shift 3\nexec "$@"\n')
  stub('node', 'case "$*" in *--check-only*) stage=github-check;; *--prepare-only*) stage=draft;; *) stage=public-github;; esac\n' + event)
  stub('scp', 'stage=scp\n' + event)
  stub('scripts/transfer-release-asset.sh', 'stage=transfer\n' + event)
  stub('ssh', [
    'if [[ "$*" == *"docker run"* ]]; then',
    '  [[ "$*" == *"--user node:node --entrypoint node"* ]] || exit 34',
    '  [[ "$*" == *"target=/tmp/release-desktop.js"*readonly* && "$*" == *"target=/tmp/fixture.exe"*readonly* ]] || exit 35',
    'fi',
    'case "$*" in',
    '  *"rm -rf"*) stage=cleanup;;',
    '  *"-O exit"*|*"chmod 0644"*) exit 0;;',
    '  *"--dry-run"*) [[ "$*" == *"--check-write-access"* && "$*" != *"target=/isolated/downloads,readonly"* ]] || exit 36; stage=server-check;;',
    '  *"docker run"*) stage=public-server;;',
    '  *"mktemp -d"*) echo /tmp/flowcube-desktop-release.Abc123def0; stage=mkdir;;',
    '  *) exit 33;;',
    'esac',
    event,
  ].join('\n'))
  const order = ['github-check', 'mkdir', 'scp', 'transfer', 'server-check', 'draft', 'public-server', 'public-github']
  for (const failAt of ['', 'github-check', 'server-check', 'draft', 'public-server', 'public-github']) {
    fs.writeFileSync(log, '')
    const result = spawnSync('bash', [path.join(root, 'scripts/publish-desktop-workflow.sh')], {
      cwd: dir, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: dir + ':' + process.env.PATH, EVENT_LOG: log, FAIL_AT: failAt,
        RELEASE_VERSION: '1.2.3', RELEASE_TAG: 'v1.2.3', TARGET_SHA: 'a'.repeat(40),
        DESKTOP_ARTIFACT: 'fixture.exe', DESKTOP_ARTIFACT_SHA: 'b'.repeat(64),
        SERVER_HOST: 'fixture.invalid', SERVER_USER: 'fixture', SERVER_SSH_PORT: '22',
        SERVER_DOWNLOADS_PATH: '/isolated/downloads', RUNNER_TEMP: dir,
        ATTACH_DESKTOP_RELEASE: 'true', ERP_ORIGIN: 'https://fixture.invalid',
      },
    })
    assert.equal(result.status, failAt ? 1 : 0, result.stderr)
    const expected = failAt ? order.slice(0, order.indexOf(failAt) + 1) : order
    assert.deepEqual(fs.readFileSync(log, 'utf8').trim().split('\n'),
      [...expected, ...(failAt === 'github-check' ? [] : ['cleanup'])])
  }
})

test('PDA 构建与发布仍绑定解析出的目标提交', () => {
  const wf = workflow('build-pda-apk.yml')
  assert.equal(wf.on.workflow_dispatch.inputs.browser_run_id.required, false)
  assert.equal(wf.jobs['wait-browser'].steps.find(step => /wait-release-checks/.test(step.run || '')).env.BROWSER_RELEASE_RUN_ID,
    '${{ inputs.browser_run_id }}')
  assert.equal(wf.jobs['build-pda'].concurrency.group, 'build-pda-ci-${{ needs.resolve-release-target.outputs.sha }}')
  assert.ok(wf.jobs['build-pda'].needs.includes('resolve-release-target'))
})

test('桌面发布等待对应 tag，不能把 main 验证构建当成发布成功', () => {
  const { assessRuns } = require('../scripts/wait-release-checks')
  const main = { id: 2, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }
  assert.equal(assessRuns([main], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'pending')
  assert.equal(assessRuns([{ ...main, head_branch: 'v1.2.3' }], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'success')
  assert.equal(assessRuns([{ ...main, head_branch: 'v1.2.3', event: 'workflow_dispatch' }], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'pending')
})

test('指定本次运行后，旧部署成功不能替代正在运行或失败的本次部署', async () => {
  const { waitForChecks } = require('../scripts/wait-release-checks')
  const old = { id: 100, head_sha: sha, head_branch: 'main', event: 'workflow_dispatch', status: 'completed', conclusion: 'success' }
  const exact = { ...old, id: 101 }
  const later = { ...old, id: 102 }
  let time = 0, calls = 0
  const args = { repository: 'fixture/repo', sha, token: 'fixture', requiredWorkflows: ['deploy-browser.yml'],
    dispatchRunIds: { 'deploy-browser.yml': '101' }, log: () => {},
    now: () => time, sleep: async ms => { time += ms }, timeoutMs: 100, intervalMs: 1 }
  const result = await waitForChecks({ ...args, fetchImpl: async () => ({
    ok: true, json: async () => ({ workflow_runs: [
      old, later, ++calls === 1 ? { ...exact, status: 'in_progress', conclusion: null } : exact,
    ] }),
  }) })
  assert.equal(calls, 2)
  assert.equal(result[0].run.id, 101)
  await assert.rejects(waitForChecks({ ...args, fetchImpl: async () => ({
    ok: true, json: async () => ({ workflow_runs: [old, later, { ...exact, conclusion: 'failure' }] }),
  }) }), /未通过.*failure/)
})

test('PDA 单独补发校验历史完整 SHA，仍由受信解析和同 SHA 网页记录放行', () => {
  const wf = workflow('build-pda-apk.yml')
  const [step, , resolver] = wf.jobs['resolve-release-target'].steps
  const result = spawnSync('bash', ['-c', step.run], {
    env: { ...process.env, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
      GITHUB_SHA: 'b'.repeat(40), RELEASE_CHECKOUT_REF: sha, BROWSER_RELEASE_RUN_ID: '' }, encoding: 'utf8',
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.equal(resolver.run, 'node scripts/resolve-release-target.cjs')
  const wait = wf.jobs['wait-browser'].steps.find(s => s.env?.REQUIRE_BROWSER_DEPLOY === '1')
  assert.equal(wait.env.GITHUB_SHA, '${{ needs.build-pda.outputs.sha }}')
  assert.ok(wf.jobs['publish-pda'].needs.includes('wait-browser'))
})

test('完整发布顺序：main 全绿含 PDA → tag → tag 构建成功 → 线上核对', async () => {
  const { completeRelease } = require('../scripts/complete-release')
  const events = []
  await completeRelease({ repository: 'fixture/repo', sha, token: 'fixture', tag: 'v1.2.3', browserRunId: '101', pdaRunId: '102', origin: 'https://fixture.test',
    wait: async opts => { events.push(opts); return [] }, publishTag: async () => events.push('tag'),
    verify: async opts => { events.push(opts); return { ok: true } }, log: () => {},
  })
  assert.deepEqual(events[0].requiredWorkflows, ['test.yml', 'security-scan.yml', 'deploy-browser.yml', 'build-pda-apk.yml', 'build-desktop.yml'])
  assert.deepEqual(events[0].dispatchRunIds, { 'deploy-browser.yml': '101', 'build-pda-apk.yml': '102' })
  assert.equal(events[1], 'tag')
  assert.equal(events[2].branch, 'v1.2.3')
  assert.deepEqual(events[2].events, ['push'])
  assert.equal(events[3].origin, 'https://fixture.test')
})

for (const failure of ['main', 'tag', 'desktop', 'verify']) {
  test(`${failure} 失败必须中止，不执行后续发布动作`, async () => {
    const { completeRelease } = require('../scripts/complete-release')
    const calls = []
    const step = name => { calls.push(name); if (failure === name) throw Error('fixture failure') }
    await assert.rejects(completeRelease({ repository: 'fixture/repo', sha, token: 'fixture', tag: 'v1.2.3', browserRunId: '101', pdaRunId: '102', origin: 'https://fixture.test',
      wait: async opts => step(opts.branch === 'v1.2.3' ? 'desktop' : 'main'),
      publishTag: async () => step('tag'), verify: async () => { calls.push('verify'); return { ok: failure !== 'verify' } }, log: () => {},
    }))
    assert.deepEqual(calls, ['main', 'tag', 'desktop', 'verify'].slice(0, ['main', 'tag', 'desktop', 'verify'].indexOf(failure) + 1))
  })
}

test('取消十五分钟目标后仍记录真实耗时', async () => {
  const { completeRelease } = require('../scripts/complete-release')
  const logs = []
  await completeRelease({ repository: 'fixture/repo', sha, token: 'fixture', tag: 'v1.2.3', browserRunId: '101', pdaRunId: '102', origin: 'https://fixture.test',
    wait: async () => {}, publishTag: async () => {}, verify: async () => ({ ok: true }), log: message => logs.push(message),
  })
  assert.match(logs[0], /用时 \d+ 秒/)
  assert.doesNotMatch(logs[0], /15 分钟|未达成/)
})

for (const mode of ['network', 'timeout', 'http502', 'http503', 'http504', 'http429']) {
  test(`查询 GitHub 的暂时失败允许有界重试：${mode}`, async () => {
    const { waitForChecks } = require('../scripts/wait-release-checks')
    let calls = 0
    const delays = []
    const result = await waitForChecks({ repository: 'fixture/repo', sha, token: 'fixture', requiredWorkflows: ['test.yml'],
      sleep: async ms => { delays.push(ms) }, log: () => {},
      fetchImpl: async () => {
        if (++calls < 3) {
          if (mode === 'network' || mode === 'timeout') throw new TypeError('fetch failed')
          return { ok: false, status: Number(mode.slice(4)) }
        }
        return { ok: true, json: async () => ({ workflow_runs: [{ id: 1, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }] }) }
      },
    })
    assert.equal(result[0].state, 'success')
    assert.equal(calls, 3)
    assert.deepEqual(delays, [1000, 2000])
  })
}

test('网络重试耗尽仍拒绝，错误和日志不包含凭据或请求地址', async () => {
  const { waitForChecks } = require('../scripts/wait-release-checks')
  let calls = 0
  const logs = []
  await assert.rejects(waitForChecks({ repository: 'fixture/repo', sha, token: 'fixture', requiredWorkflows: ['test.yml'],
    sleep: async () => {}, log: message => logs.push(message),
    fetchImpl: async () => { calls++; throw Error('secret-fixture-url') },
  }), error => /重试耗尽/.test(error.message) && !error.message.includes('secret-fixture-url'))
  assert.equal(calls, 3)
  assert.equal(logs.join('').includes('secret-fixture-url'), false)
})

for (const status of [401, 403, 404]) {
  test(`GitHub HTTP ${status} 不按临时网络故障重试`, async () => {
    const { waitForChecks } = require('../scripts/wait-release-checks')
    let calls = 0
    await assert.rejects(waitForChecks({ repository: 'fixture/repo', sha, token: 'fixture', requiredWorkflows: ['test.yml'],
      sleep: async () => assert.fail('不应等待重试'), log: () => {},
      fetchImpl: async () => { calls++; return { ok: false, status } },
    }), new RegExp(`HTTP ${status}`))
    assert.equal(calls, 1)
  })
}

test('重试仍受总等待预算约束', async () => {
  const { waitForChecks } = require('../scripts/wait-release-checks')
  let tick = 0, calls = 0
  await assert.rejects(waitForChecks({ repository: 'fixture/repo', sha, token: 'fixture', requiredWorkflows: ['test.yml'],
    timeoutMs: 1500, now: () => tick, sleep: async ms => { tick += ms }, log: () => {},
    fetchImpl: async () => { calls++; throw Error('fetch failed') },
  }), /超时/)
  assert.equal(tick, 1500)
  assert.equal(calls, 2)
})
