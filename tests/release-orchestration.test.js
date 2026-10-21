'use strict'
const { test } = require('node:test')
const assert = require('node:assert/strict')
const sha = 'a'.repeat(40)

test('旧本机入口在任何外部命令前拒绝，不能重新串联发布', () => {
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{spawnSync}=require('node:child_process')
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'disabled-release-'));const sentinel=path.join(dir,'external')
 try {
  for(const bin of ['git','ssh','scp','gh'])fs.writeFileSync(path.join(dir,bin),'#!/bin/sh\ntouch "$SENTINEL";exit 99\n',{mode:0o755})
  for(const [bin,args] of [['bash',['scripts/release-prod.sh']],[process.execPath,['scripts/complete-release.js']],['python3',['scripts/local-release-relay.py']]]) {
   const result=spawnSync(bin,args,{cwd:require('node:path').resolve(__dirname,'..'),encoding:'utf8',env:{...process.env,PATH:dir+':'+process.env.PATH,SENTINEL:sentinel}})
   assert.equal(result.status,1,result.stderr);assert.match(result.stderr,/停用/);assert.equal(fs.existsSync(sentinel),false)
  }
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
})
test('旧编程入口也不能自动推送tag或触发工作流',async()=>{
 const old=require('../scripts/complete-release');assert.throws(()=>old.publishTagForCommit(),/停用/);await assert.rejects(old.completeRelease(),/停用/)
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

test('桌面 Release 附件失败不能被 continue-on-error 伪装为完整发版成功', () => {
  const fs = require('node:fs'), path = require('node:path')
  const root = path.resolve(__dirname, '..')
  const yaml = require(path.join(root, 'frontend/node_modules/js-yaml'))
  const wf = yaml.load(fs.readFileSync(path.join(root, '.github/workflows/build-desktop.yml'), 'utf8'))
  const verify = workflow => {
    const publishSteps = workflow.jobs.publish.steps.filter(s => /publish-release-asset\.cjs/.test(s.run || ''))
    assert.equal(publishSteps.length, 2, 'tag and manual publishing must retain the same fail-closed asset uploader')
    assert.notEqual(workflow.jobs.publish['continue-on-error'], true)
    for (const step of publishSteps) assert.notEqual(step['continue-on-error'], true)
    assert.ok(workflow.jobs.publish.needs.includes('build'))
    assert.equal(workflow.jobs.build.permissions.contents, 'read')
  }
  verify(wf)
  const broken = structuredClone(wf)
  broken.jobs.publish.steps.find(s => /publish-release-asset\.cjs/.test(s.run || ''))['continue-on-error'] = true
  assert.throws(() => verify(broken))
})

test('桌面发布等待对应 tag，不能把 main 验证构建当成发布成功', () => {
  const { assessRuns } = require('../scripts/wait-release-checks')
  const main = { id: 2, head_sha: sha, head_branch: 'main', event: 'push', status: 'completed', conclusion: 'success' }
  assert.equal(assessRuns([main], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'pending')
  assert.equal(assessRuns([{ ...main, head_branch: 'v1.2.3' }], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'success')
  assert.equal(assessRuns([{ ...main, head_branch: 'v1.2.3', event: 'workflow_dispatch' }], sha, { branch: 'v1.2.3', events: ['push'] }).state, 'pending')
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
