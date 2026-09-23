'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const sha = 'a'.repeat(40)

test('正式入口缺少本机代理时在 push main 前拒绝发布', () => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path')
  const { spawnSync } = require('node:child_process')
  const root = path.resolve(__dirname, '..')
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-release-entry-'))
  const bin = path.join(temp, 'bin'), sentinel = path.join(temp, 'pushed')
  fs.mkdirSync(bin)
  const stub = (name, body) => fs.writeFileSync(path.join(bin, name), '#!/bin/sh\n' + body, { mode: 0o755 })
  stub('git', `if [ "$1" = rev-parse ] && [ "$2" = --abbrev-ref ]; then echo main; elif [ "$1" = rev-parse ]; then echo ${sha}; elif [ "$1" = push ]; then touch "$RELEASE_TEST_SENTINEL"; fi\n`)
  stub('node', 'if [ "$1" = -p ]; then echo 1.2.3; else echo fixture; fi\n')
  stub('gh', 'if [ "$1" = auth ]; then echo fixture-token; else echo fixture/repo; fi\n')
  try {
    const result = spawnSync('bash', ['scripts/release-prod.sh'], {
      cwd: root, encoding: 'utf8', timeout: 5000,
      env: { ...process.env, PATH: bin + ':' + process.env.PATH, HTTPS_PROXY: '', https_proxy: '', FLOWCUBE_RELAY_PROXY: '', RELEASE_TEST_SENTINEL: sentinel },
    })
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.match(result.stdout + result.stderr, /缺少本机代理地址/)
    assert.equal(fs.existsSync(sentinel), false)
  } finally { fs.rmSync(temp, { recursive: true, force: true }) }
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
    assert.doesNotMatch(matched.stdout + matched.stderr, new RegExp(pubkey.split(' ')[1]))
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

test('桌面 Release 附件失败不能被 continue-on-error 伪装为完整发版成功', () => {
  const fs = require('node:fs'), path = require('node:path')
  const root = path.resolve(__dirname, '..')
  const yaml = require(path.join(root, 'frontend/node_modules/js-yaml'))
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-desktop.yml'), 'utf8'))
  const step = wf.jobs.build.steps.find(s => s.name === 'Upload EXE to Release')
  assert.ok(step)
  assert.notEqual(step['continue-on-error'], true)
})

test('PDA 发布检查覆盖每次 main 推送，不能被源码路径过滤漏掉', () => {
  const fs = require('node:fs'), path = require('node:path')
  const root = path.resolve(__dirname, '..')
  const yaml = require(path.join(root, 'frontend/node_modules/js-yaml'))
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-pda-apk.yml'), 'utf8'))
  assert.deepEqual(wf.on.push.branches, ['main'])
  assert.equal(wf.on.push.paths, undefined)
  assert.match(wf.jobs['build-pda'].concurrency.group, /github\.sha/)
})

test('桌面发布等待对应 tag，不能把 main 验证构建当成发布成功', () => {
  const { assessRuns } = require('../scripts/wait-release-checks')
  const main = { id: 2, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }
  assert.equal(assessRuns([main], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'pending')
  assert.equal(assessRuns([{ ...main, head_branch: 'v1.2.3' }], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'success')
  assert.equal(assessRuns([{ ...main, head_branch: 'v1.2.3', event: 'workflow_dispatch' }], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'pending')
})

test('完整发布顺序：main 全绿含 PDA → tag → tag 构建成功 → 线上核对', async () => {
  const { completeRelease } = require('../scripts/complete-release')
  const events = []
  await completeRelease({ repository: 'fixture/repo', sha, token: 'fixture', tag: 'v1.2.3', origin: 'https://fixture.test',
    wait: async opts => { events.push(opts); return [] }, publishTag: async () => events.push('tag'),
    verify: async opts => { events.push(opts); return { ok: true } }, log: () => {},
  })
  assert.deepEqual(events[0].requiredWorkflows, ['test.yml', 'security-scan.yml', 'deploy-browser.yml', 'build-pda-apk.yml', 'build-desktop.yml'])
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
    await assert.rejects(completeRelease({ repository: 'fixture/repo', sha, token: 'fixture', tag: 'v1.2.3', origin: 'https://fixture.test',
      wait: async opts => step(opts.branch === 'v1.2.3' ? 'desktop' : 'main'),
      publishTag: async () => step('tag'), verify: async () => { calls.push('verify'); return { ok: failure !== 'verify' } }, log: () => {},
    }))
    assert.deepEqual(calls, ['main', 'tag', 'desktop', 'verify'].slice(0, ['main', 'tag', 'desktop', 'verify'].indexOf(failure) + 1))
  })
}

test('取消十五分钟目标后仍记录真实耗时', async () => {
  const { completeRelease } = require('../scripts/complete-release')
  const logs = []
  await completeRelease({ repository: 'fixture/repo', sha, token: 'fixture', tag: 'v1.2.3', origin: 'https://fixture.test',
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
