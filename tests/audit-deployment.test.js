'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const root = path.resolve(__dirname, '..')
function deployment(scenario) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-deploy-test-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  for (const file of ['server-update.sh', 'lib/ops-common.sh']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  fs.copyFileSync(path.join(root, 'docker-compose.yml'), path.join(dir, 'docker-compose.yml'))
  fs.writeFileSync(path.join(dir, 'scripts/release-gate.sh'), '#!/bin/bash\n[[ "$DEPLOY_TEST_SCENARIO" != gate && "$DEPLOY_TEST_SCENARIO" != rollback_failure && "$DEPLOY_TEST_SCENARIO" != first_deploy && "$DEPLOY_TEST_SCENARIO" != legacy ]]\n')
  if (scenario === 'legacy') {
    fs.mkdirSync(path.join(dir, 'backend/apk'), { recursive: true })
    fs.writeFileSync(path.join(dir, 'backend/apk/version.json'), JSON.stringify({ version: '2.0.0', versionCode: 2 }))
    fs.writeFileSync(path.join(dir, 'backend/apk/published-version.json'), JSON.stringify({ version: '1.0.0', versionCode: 1, filename: 'FlowCubePDA-1-fixture.apk' }))
  }
  if (scenario === 'lowdisk') fs.copyFileSync(path.join(root, 'scripts/release-gate.sh'), path.join(dir, 'scripts/release-gate.sh'))
  fs.writeFileSync(path.join(dir, 'scripts/install-cron.sh'), '#!/bin/bash\nexit 0\n')
  const mock = `#!${process.execPath}
const fs=require('node:fs'),path=require('node:path');
const cmd=path.basename(process.argv[1]),args=process.argv.slice(2),s=process.env.DEPLOY_TEST_SCENARIO;
const log=process.env.DEPLOY_TEST_LOG,rolled=log+'.rolled';
fs.appendFileSync(log,JSON.stringify([cmd,...args])+'\\n');
if(cmd==='git') {if(args[0]==='rev-parse')console.log((s==='sha'?'b':'a').repeat(40)); process.exit(0);}
if(cmd==='flock'||cmd==='sleep')process.exit(0);
if(cmd==='node')process.exit(s==='checks'?1:0);
if(cmd==='df'){console.log('Filesystem 1M-blocks Used Available Use% Mounted on\\nfixture 1000 900 100 90% /');process.exit(0);}
if(cmd==='curl'){console.log('<title>极序 Flow</title>');process.exit((s==='health'&&!fs.existsSync(rolled))||(s==='public'&&args.some(a=>a.startsWith('https://')))?22:0);}
if(cmd==='docker') {
 const a=args.join(' ');
 if(a.startsWith('compose ps')&&s!=='first_deploy')console.log(args.at(-1)==='backend'?'old-backend-container':'old-frontend-container');
 if(args[0]==='inspect')console.log(args.at(-1).includes('backend')?'sha256:'+'1'.repeat(64):'sha256:'+'2'.repeat(64));
 if(args[0]==='tag'&&args[1].startsWith('sha256:'))fs.writeFileSync(rolled,'yes');
 if(s==='rollback_failure'&&args[0]==='tag')process.exit(1);
 if(s==='legacy'&&a.includes('--force-recreate')) {const meta=JSON.parse(fs.readFileSync('backend/apk/version.json'));if(meta.versionCode!==1||meta.filename!=='FlowCubePDA-1-fixture.apk')process.exit(1);}
 if(s==='build'&&(a.startsWith('compose build')||a.includes('--build')))process.exit(1);
 if(s==='migration'&&(a.includes('npm run migrate')))process.exit(1);
 if(s==='mysql'&&a.startsWith('compose up')&&a.includes('mysql'))process.exit(1);
 if(s==='start'&&a.startsWith('compose up')&&!a.includes('mysql')&&!a.includes('--force-recreate'))process.exit(1);
 process.exit(0);
}
process.exit(0);
`
  for (const command of ['docker', 'curl', 'git', 'flock', 'sleep', 'node', 'df']) fs.writeFileSync(path.join(bin, command), mock, { mode: 0o755 })
  const log = path.join(dir, 'commands.jsonl')
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, DEPLOY_TEST_SCENARIO: scenario, DEPLOY_TEST_LOG: log,
    SKIP_GIT_PULL: '1', EXPECTED_COMMIT: 'a'.repeat(40), SKIP_RELEASE_GATE: '0', DEPLOY_LOCK_FILE: path.join(dir, 'deploy.lock'), DINGTALK_WEBHOOK: '', HEALTH_CHECK_ATTEMPTS: '2', HEALTH_CHECK_DELAY: '0', SMOKE_USERNAME: 'fixture', SMOKE_PASSWORD: 'fixture' }
  if (scenario === 'public') env.DEPLOY_PUBLIC_ORIGIN = 'https://deployment.example.invalid'
  delete env.DEPLOY_LOCK_FD
  try {
    const result = spawnSync('bash', ['scripts/server-update.sh'], { cwd: dir, env, encoding: 'utf8', timeout: 20000 })
    const commands = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const legacyPath = path.join(dir, 'backend/apk/version.json')
    return { ...result, commands, legacyMeta: fs.existsSync(legacyPath) ? JSON.parse(fs.readFileSync(legacyPath)) : null }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

for (const scenario of ['build', 'mysql', 'migration', 'start', 'health', 'gate', 'public', 'lowdisk']) {
  test(`部署 ${scenario} 失败必须退出并恢复实际旧镜像`, () => {
    const result = deployment(scenario)
    assert.equal(result.status, 1, result.stderr)
    for (const [digit, name] of [['1', 'backend'], ['2', 'frontend']]) {
      assert.ok(result.commands.some(c => c[0] === 'docker' && c[1] === 'tag' && c[2] === 'sha256:' + digit.repeat(64) && c[3] === `flowcube-${name}:latest`), result.stdout + result.stderr)
    }
    if (['start', 'health', 'gate'].includes(scenario)) assert.ok(result.commands.some(c => c.includes('--force-recreate')))
    if (scenario === 'lowdisk') assert.ok(!result.commands.some(c => c[0] === 'docker' && c.includes('prune')))
    if (scenario === 'mysql') assert.ok(!result.commands.some(c => c.join(' ').includes('npm run migrate') || c.includes('--force-recreate')))
  })
}

test('成功部署先迁移后替换应用，并通过门禁后结束', () => {
  const result = deployment('success')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const migrate = result.commands.findIndex(c => c.join(' ').includes('compose run --rm --no-deps backend npm run migrate'))
  const replace = result.commands.findIndex(c => c.join(' ').includes('compose up -d --no-build backend frontend'))
  assert.ok(migrate >= 0 && replace > migrate, JSON.stringify(result.commands))
  assert.ok(!result.commands.some(c => c.includes('--force-recreate')))
})

test('提交不匹配时在构建及迁移前拒绝部署', () => {
  const result = deployment('sha')
  assert.equal(result.status, 1, result.stdout)
  assert.ok(!result.commands.some(c => c[0] === 'docker' && c[1] === 'compose' && ['build', 'up', 'run'].includes(c[2])))
})

test('人工部署检查失败时不能拉取或构建', () => {
  const result = deployment('checks')
  assert.equal(result.status, 1, result.stderr)
  assert.ok(!result.commands.some(c => c[0] === 'docker' || (c[0] === 'git' && c[1] === 'pull')))
})

test('首次部署失败清除新应用，不伪称恢复旧版本', () => {
  const result = deployment('first_deploy')
  assert.equal(result.status, 1, result.stderr)
  assert.match(result.stderr, /首次部署没有旧应用镜像/)
  for (const name of ['backend', 'frontend']) assert.ok(result.commands.some(c => c.join(' ') === `docker compose rm -s -f ${name}`))
})

test('回退自身失败保留失败状态并明确要求人工恢复', () => {
  const result = deployment('rollback_failure')
  assert.equal(result.status, 1)
  assert.match(result.stderr, /需要人工恢复/)
})

test('首发回退旧后端前恢复与实际APK匹配的兼容版本清单', () => {
  const result = deployment('legacy')
  assert.equal(result.status, 1)
  assert.equal(result.legacyMeta.versionCode, 1)
  assert.equal(result.legacyMeta.filename, 'FlowCubePDA-1-fixture.apk')
  assert.match(result.stderr, /已恢复部署前应用镜像/)
  assert.doesNotMatch(result.stderr, /需要人工恢复/)
})
