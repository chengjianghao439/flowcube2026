'use strict'

const { test } = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createHash } = require('node:crypto')

const root = path.resolve(__dirname, '..')
function deployment(scenario, transform = source => source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowcube-deploy-test-'))
  const bin = path.join(dir, 'bin')
  fs.mkdirSync(bin)
  fs.mkdirSync(path.join(dir, 'scripts/lib'), { recursive: true })
  for (const file of ['server-update.sh', 'lib/ops-common.sh']) fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  const updatePath = path.join(dir, 'scripts/server-update.sh')
  fs.writeFileSync(updatePath, transform(fs.readFileSync(updatePath, 'utf8')))
  for (const file of ['lib/runtime-guards.sh']) if (fs.existsSync(path.join(root, 'scripts', file))) fs.copyFileSync(path.join(root, 'scripts', file), path.join(dir, 'scripts', file))
  const backupHelper = path.join(root, 'scripts/lib/pre-migrate-backup.js')
  if (fs.existsSync(backupHelper)) fs.copyFileSync(backupHelper, path.join(dir, 'scripts/lib/pre-migrate-backup.js'))
  fs.mkdirSync(path.join(dir, 'backups'))
  fs.writeFileSync(path.join(dir, 'backups/flowcube_old.sql.gz'), 'old snapshot must never satisfy this deployment')
  fs.writeFileSync(path.join(dir, 'preload.js'), `
const fs = require('node:fs');
if (process.env.DEPLOY_TEST_SCENARIO === 'backup_timeout') {
 const original = global.setTimeout;
 global.setTimeout = (fn, ms, ...args) => original(fn, ms >= 100000 ? 5 : ms, ...args);
}
const write = fs.writeFileSync;
const sync = fs.fsyncSync;
fs.fsyncSync = function(fd) {
 if (process.env.DEPLOY_TEST_SCENARIO === 'backup_directory_sync' && fs.fstatSync(fd).isDirectory()) {
  const e = new Error('synthetic directory sync failure');e.code='EIO';throw e;
 }
 return sync.call(this, fd);
};
const stream = fs.createWriteStream;
fs.createWriteStream = function(file, ...args) {
 if (process.env.DEPLOY_TEST_SCENARIO === 'backup_write_full' && String(file).endsWith('database.sql.gz.part')) {
  return new (require('node:stream').Writable)({write(chunk, encoding, done){const e=new Error('synthetic disk full');e.code='ENOSPC';done(e);}});
 }
 return stream.call(this, file, ...args);
};
fs.writeFileSync = function(file, data, ...args) {
 if (String(file).endsWith('receipt.json.part')) {
  const s = process.env.DEPLOY_TEST_SCENARIO;
  if (s === 'backup_receipt_permission') { const e = new Error('synthetic permission failure'); e.code='EACCES'; throw e; }
  if (s === 'backup_wrong_sha' || s === 'backup_stale_receipt') {
   const r = JSON.parse(data); if(s === 'backup_wrong_sha') r.candidateSha = 'b'.repeat(40); else r.runId = 'previous-deployment';
   data = JSON.stringify(r);
  }
 }
 return write.call(this, file, data, ...args);
};
`)
  fs.copyFileSync(path.join(root, 'docker-compose.yml'), path.join(dir, 'docker-compose.yml'))
  fs.writeFileSync(path.join(dir, 'scripts/release-gate.sh'), '#!/bin/bash\n[[ "$DEPLOY_TEST_SCENARIO" != gate && "$DEPLOY_TEST_SCENARIO" != ledger_gate && "$DEPLOY_TEST_SCENARIO" != ledger_retry && "$DEPLOY_TEST_SCENARIO" != write_contract_gate && "$DEPLOY_TEST_SCENARIO" != stop_failure && "$DEPLOY_TEST_SCENARIO" != first_deploy && "$DEPLOY_TEST_SCENARIO" != legacy ]]\n')
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
const first=s.startsWith('first_'),mysqlStarted=log+'.mysql-started';
fs.appendFileSync(log,JSON.stringify([cmd,...args])+'\\n');
if(cmd==='git') {if(args[0]==='rev-parse')console.log((s==='sha'?'b':'a').repeat(40)); process.exit(0);}
if(cmd==='flock'||cmd==='sleep')process.exit(0);
if(cmd==='node'){
 if(args[0]?.endsWith('pre-migrate-backup.js')) {
  const r=require('node:child_process').spawnSync(process.execPath,['--require',path.join(process.cwd(),'preload.js'),...args],{stdio:'inherit',env:process.env});
  if(s==='backup_tamper' && args[1]==='create' && r.status===0) fs.appendFileSync(path.join(args.at(-1),'database.sql.gz'),'tamper');
  if(s==='backup_bad_mode' && args[1]==='create' && r.status===0) fs.chmodSync(path.join(args.at(-1),'receipt.json'),0o644);
  process.exit(r.status??1);
 }
 process.exit(s==='checks'?1:0);
}
if(cmd==='timeout'){
 let i=0;while(args[i]?.startsWith('-'))i+=args[i]==='-k'?2:1;i++;
 const r=require('node:child_process').spawnSync(args[i],args.slice(i+1),{stdio:'inherit',env:process.env});process.exit(r.status??1);
}
if(cmd==='sha256sum'){console.log(require('node:crypto').createHash('sha256').update(fs.readFileSync(args.at(-1))).digest('hex')+'  '+args.at(-1));process.exit(0);}
if(cmd==='df'){console.log('Filesystem 1M-blocks Used Available Use% Mounted on\\nfixture 20000 1000 '+(s==='lowdisk'||(s==='backup_lowdisk'&&args.at(-1).includes('pre-migrate-'))?100:19000)+' 10% /');process.exit(0);}
if(cmd==='curl'){console.log('<title>极序 Flow</title>');process.exit((s==='health'&&!fs.existsSync(rolled))||(s==='public'&&args.some(a=>a.startsWith('https://')))?22:0);}
if(cmd==='docker') {
 const a=args.join(' ');
 if(a==='compose config --format json') {
  console.log(JSON.stringify({services:{backend:{environment:{DB_HOST:s==='backup_config_mismatch'?'other-host':'mysql',DB_PORT:'3306',DB_NAME:s==='backup_option_name'?'--all-databases':'flowcube_fixture',DB_PASSWORD:'synthetic-secret-must-not-leak'}}}}));process.exit(0);
 }
 if(args[0]==='inspect'&&a.includes('json .Id')) {
  console.log(JSON.stringify({containerId:'2'.repeat(64),imageId:'sha256:'+'3'.repeat(64)}));process.exit(0);
 }
 if(args[0]==='exec'&&a.includes('flowcube_pre_migration_state')) {
  const f=log+'.state-count',n=fs.existsSync(f)?Number(fs.readFileSync(f))+1:1;fs.writeFileSync(f,String(n));
  console.log(JSON.stringify({serverUuid:'12345678-1234-1234-1234-123456789abc',version:s==='backup_state_drift'&&n>1?'8.0.46':'8.0.45',database:s==='backup_option_name'?'--all-databases':'flowcube_fixture',tableCount:s==='backup_empty'?0:1,migrationTableExists:s==='backup_empty'?0:1}));process.exit(0);
 }
 if(args[0]==='exec'&&a.includes('flowcube_pre_migration_row')) {
  console.log(JSON.stringify({id:1,filename:'240_party_ledger_explicit_identity.sql',executedAt:'2026-10-01 00:00:00'}));process.exit(0);
 }
 if(args[0]==='exec'&&a.includes('mysqldump')) {
  if(s==='backup_dump'){console.error('synthetic-secret-must-not-leak');process.exit(2);}
  if(s==='backup_interrupt'){process.kill(process.ppid,'SIGTERM');setInterval(()=>{},1000);return;}
  console.log('-- MySQL dump 10.13');
  if(s!=='backup_empty') {
   console.log('CREATE TABLE fixture (id INT);');
   for(let i=0;i<100;i++)console.log('-- '+require('node:crypto').createHash('sha256').update(String(i)).digest('hex'));
  }
  if(s!=='backup_truncated') console.log('-- Dump completed on 2026-10-17 00:00:00');
  process.exit(0);
 }
 if(a==='compose config --images mysql') {console.log(s==='first_bad_pin'?'mysql:8.0':'mysql:8.0@sha256:'+'7'.repeat(64));process.exit(0);}
 if(a==='compose ps -aq mysql') {if(!first||fs.existsSync(mysqlStarted))console.log(s==='multi_mysql'?'old-mysql-container\\nother-mysql-container':'old-mysql-container');process.exit(0);}
 if(args[0]==='inspect'&&a.includes('.State.Status')) {console.log(s==='mysql_stopped'?'exited healthy':['mysql_unhealthy','first_unhealthy'].includes(s)?'running unhealthy':s==='mysql_no_health'?'running missing':'running healthy');process.exit(0);}
 if(args[0]==='image'&&args[1]==='inspect'&&args.at(-1).startsWith('mysql:')) {process.exit(s==='first_missing_pin'?1:0);}
 if(args[0]==='exec'&&a.includes('SELECT 1')) {
   if(!a.includes('--protocol=TCP')||!a.includes('-h127.0.0.1')||!a.includes('-P3306')||!a.includes('--connect-timeout=2')||!a.includes('MYSQL_PWD="$MYSQL_ROOT_PASSWORD"'))process.exit(1);
   if(['mysql','mysql_auth_fail','first_auth_fail'].includes(s))process.exit(1);
   if(s==='mysql_bad_result') {console.log('0');process.exit(0);}
   if(s==='first_sql_delay') {const p=log+'.sql-count',n=fs.existsSync(p)?Number(fs.readFileSync(p))+1:1;fs.writeFileSync(p,String(n));if(n<3)process.exit(1);}
   console.log('1');process.exit(0);
 }
 if(a.startsWith('compose up')&&args.at(-1)==='mysql') {
   if(!args.includes('--pull')||args[args.indexOf('--pull')+1]!=='never'||!args.includes('--no-deps')) {fs.appendFileSync(log,JSON.stringify(['implicit-mysql-reconcile'])+'\\n');process.exit(1);}
   if(s==='first_start_fail')process.exit(1);
   fs.writeFileSync(mysqlStarted,'yes');process.exit(0);
 }
 if(a.startsWith('compose up')&&a.endsWith('backend frontend')&&!args.includes('--no-deps')) {fs.appendFileSync(log,JSON.stringify(['implicit-mysql-reconcile'])+'\\n');process.exit(1);}
 if(a.includes('scripts/migration-preflight.js')) {
  const override=args[args.lastIndexOf('-f')+1];
  if(!fs.readFileSync(override,'utf8').includes('image: flowcube-backend:'+'a'.repeat(40))||!fs.readFileSync(override,'utf8').includes('read_only: true')||!args.includes('--no-deps')||args[args.indexOf('--pull')+1]!=='never'||args[args.indexOf('--entrypoint')+1]!=='node'||args[args.indexOf('--user')+1]!=='node')process.exit(2);
  process.exit(s.startsWith('migration_condition_')?1:0);
 }
 if(a.includes("table_name='db_migrations'"))console.log('1');
 if(a.includes("filename='240_party_ledger_explicit_identity.sql'"))console.log(s==='ledger_gate'?'0':'1');

 if(args[0]==='image'&&args[1]==='inspect') {
   if(a.includes('io.flowcube.quantity-return-cash-contract'))console.log(s==='write_contract_missing_target'||(s.startsWith('write_contract')&&args.at(-1).startsWith('sha256:'))?'':'1');
   else console.log(a.includes('io.flowcube.party-ledger-contract')?(s.startsWith('ledger_retry')?'':'1'):(s==='wrong-image'?'b':'a').repeat(40));
 }
 if(s==='load'&&args[0]==='load')process.exit(1);
 if(a.startsWith('compose ps')&&s!=='first_deploy')console.log(args.at(-1)==='backend'?'old-backend-container':'old-frontend-container');
 if(args[0]==='inspect')console.log(args.at(-1).includes('backend')?'sha256:'+'1'.repeat(64):'sha256:'+'2'.repeat(64));
 if(args[0]==='tag'&&args[1].startsWith('sha256:'))fs.writeFileSync(rolled,'yes');
 if(s==='stop_failure'&&a==='compose stop -t 60 backend frontend')process.exit(1);
 if(s==='legacy'&&a.includes('--force-recreate')) {const meta=JSON.parse(fs.readFileSync('backend/apk/version.json'));if(meta.versionCode!==1||meta.filename!=='FlowCubePDA-1-fixture.apk')process.exit(1);}
 if(s==='build'&&(a.startsWith('compose build')||a.includes('--build')))process.exit(1);
 if(s==='migration'&&(a.includes('npm run migrate')))process.exit(1);
 if(s==='mysql'&&a.startsWith('compose up')&&a.includes('mysql'))process.exit(1);
 if(s==='start'&&a.startsWith('compose up')&&!a.includes('mysql')&&!a.includes('--force-recreate'))process.exit(1);
 process.exit(0);
}
process.exit(0);
`
  for (const command of ['docker', 'curl', 'git', 'flock', 'sleep', 'node', 'df', 'timeout', 'sha256sum', 'npm']) fs.writeFileSync(path.join(bin, command), mock, { mode: 0o755 })
  const log = path.join(dir, 'commands.jsonl')
  const archive = path.join(dir, 'images.tar.gz')
  fs.writeFileSync(archive, 'fixture archive')
  const env = { ...process.env, PATH: bin + ':' + process.env.PATH, DEPLOY_TEST_SCENARIO: scenario, DEPLOY_TEST_LOG: log,
    SKIP_GIT_PULL: '1', EXPECTED_COMMIT: 'a'.repeat(40), SKIP_RELEASE_GATE: '0', DEPLOY_LOCK_FILE: path.join(dir, 'deploy.lock'), DINGTALK_WEBHOOK: '', HEALTH_CHECK_ATTEMPTS: '2', HEALTH_CHECK_DELAY: '0', SMOKE_USERNAME: 'fixture', SMOKE_PASSWORD: 'fixture', SMOKE_LIMITED_USERNAME: 'fixture-limited', SMOKE_LIMITED_PASSWORD: 'fixture-limited' }
  env.DEPLOY_IMAGE_ARCHIVE = scenario === 'missing-archive' ? '' : archive
  env.DEPLOY_IMAGE_SHA256 = scenario === 'corrupt-archive' ? '0'.repeat(64) : createHash('sha256').update('fixture archive').digest('hex')
  if (scenario === 'public') env.DEPLOY_PUBLIC_ORIGIN = 'https://deployment.example.invalid'
  if (scenario === 'nondocker') {
    env.FLOWCUBE_MIGRATION_WRITES_PAUSED = '1'
    fs.mkdirSync(path.join(dir, 'backend'), { recursive: true })
  }
  delete env.DEPLOY_LOCK_FD
  try {
    const result = spawnSync('bash', ['scripts/server-update.sh'], { cwd: dir, env, encoding: 'utf8', timeout: 20000 })
    const commands = fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line))
    const legacyPath = path.join(dir, 'backend/apk/version.json')
    const backupReceipts = fs.readdirSync(path.join(dir, 'backups')).filter(f => f.startsWith('pre-migrate-')).flatMap(f => {
      const receipt = path.join(dir, 'backups', f, 'receipt.json')
      return fs.existsSync(receipt) ? [JSON.parse(fs.readFileSync(receipt))] : []
    })
    return { ...result, commands, backupReceipts, oldBackupRetained: fs.readFileSync(path.join(dir, 'backups/flowcube_old.sql.gz'), 'utf8') === 'old snapshot must never satisfy this deployment', legacyMeta: fs.existsSync(legacyPath) ? JSON.parse(fs.readFileSync(legacyPath)) : null }
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
}

function assertNoRecovery(result) {
  assert.ok(!result.commands.some(c => /SET GLOBAL/i.test(c.join(' '))), '发布不得修改或恢复全局参数')
  assert.ok(!result.commands.some(c => c[0] === 'docker' && c[1] === 'tag' && c[2].startsWith('sha256:')), '不得tag旧镜像')
  assert.ok(!result.commands.some(c => c.includes('--force-recreate') || c.join(' ').startsWith('docker compose rm')), '不得重建/移除旧应用')
}
for (const scenario of ['load', 'mysql', 'start', 'health', 'gate', 'public', 'lowdisk', 'migration', 'ledger_gate', 'ledger_retry', 'write_contract_gate']) {
  test(`部署 ${scenario} 失败停止并保留证据，不自动回退`, () => {
    const result = deployment(scenario)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assertNoRecovery(result)
    assert.match(result.stderr, /部署证据：SHA=/)
    const paused = result.commands.some(c => c.join(' ').includes('compose stop -t 60 backend'))
    if (paused) {
      assert.match(result.stderr, /保持业务停写/)
      assert.ok(result.commands.some(c => c.join(' ') === 'docker compose stop -t 60 backend frontend'))
    } else assert.match(result.stderr, /保持原应用状态/)
    assert.ok(!result.commands.some(c => c.includes('prune')))
  })
}

test('成功部署先迁移后替换应用，并通过门禁后结束', () => {
  const result = deployment('success')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const migrate = result.commands.findIndex(c => c[0] === 'docker' && c.slice(1, 3).join(' ') === 'compose run' && c.join(' ').includes('backend npm run migrate'))
  const replace = result.commands.findIndex(c => c[0] === 'docker' && c.slice(1, 3).join(' ') === 'compose up' && c.includes('--no-build') && c.includes('--no-deps') && c.slice(-2).join(' ') === 'backend frontend')
  const pause = result.commands.findIndex(c => c.join(' ').includes('compose stop -t 60 backend'))
  const condition = result.commands.findIndex(c => c.join(' ').includes('scripts/migration-preflight.js'))
  assert.ok(condition >= 0 && condition < pause && pause < migrate, JSON.stringify(result.commands))
  assertNoRecovery(result)
  assert.ok(migrate >= 0 && replace > migrate, JSON.stringify(result.commands))
  assert.ok(!result.commands.some(c => c.includes('--force-recreate')))
  assert.ok(!result.commands.some(c => c[0] === 'docker' && c.includes('build')), '生产不得编译')
  assert.ok(result.commands.some(c => c[0] === 'curl' && c.some(arg => arg.endsWith('/api/ready'))), '新版本部署须验证应用连接池就绪')
  const load = result.commands.findIndex(c => c[0] === 'docker' && c[1] === 'load')
  const verify = result.commands.findIndex(c => c[0] === 'docker' && c.slice(1, 3).join(' ') === 'image inspect')
  assert.ok(load >= 0 && verify > load && migrate > verify, '先加载并验证 CI 镜像，再执行迁移')
})

test('缺少新写入契约的目标镜像在停写和迁移前拒绝', () => {
  const result = deployment('write_contract_missing_target')
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(!result.commands.some(c => c.join(' ').includes('compose stop') || c.join(' ').includes('npm run migrate')))
})

test('旧镜像不兼容仍可完成新后端向前发布', () => {
  const result = deployment('write_contract_success')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(result.commands.some(c => c.join(' ').includes('npm run migrate')))
  assert.ok(result.commands.some(c => c.join(' ').includes('compose up -d --no-build --no-deps backend frontend')))
})

test('撤掉迁移条件门会在条件不足时错误停写迁移，实际shell反证', () => {
  const r = deployment('migration_condition_missing', source => {
    const changed = source.replace('  assert_migration_conditions\n', '  : # removed condition gate\n')
    assert.notEqual(changed, source)
    return changed
  })
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.ok(r.commands.some(c => c.join(' ').includes('npm run migrate')))
})

test('撤掉目标契约门会让未声明兼容镜像迁移，实际shell反证', () => {
  const result = deployment('write_contract_missing_target', source => {
    const changed = source.replace(/^ {2}\[ "\$target_write_contract" = '1' \].*$/m, '  : # deliberately removed target contract gate')
    assert.notEqual(changed, source)
    return changed
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(result.commands.some(c => c.join(' ').includes('npm run migrate')))
})

for (const scenario of ['missing-archive', 'corrupt-archive', 'wrong-image']) {
  test(`CI 产物 ${scenario} 必须拒绝且不执行迁移/切换`, () => {
    const r = deployment(scenario)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.ok(!r.commands.some(c => c[0] === 'docker' && c[1] === 'compose' && ['build', 'run', 'up'].includes(c[2])))
    if (scenario !== 'wrong-image') assert.ok(!r.commands.some(c => c[0] === 'docker' && c[1] === 'load'))
  })
}

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

test('首次部署失败保留候选与证据，停止应用不尝试恢复旧版本', () => {
  const r = deployment('first_deploy')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assertNoRecovery(r)
  assert.match(r.stderr, /保持业务停写/)
  assert.ok(r.commands.some(c => c.join(' ') === 'docker compose stop -t 60 backend frontend'))
})
test('失败收尾停止应用失败必须要求人工阻断写入，不能恢复旧应用', () => {
  const r = deployment('stop_failure')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assertNoRecovery(r)
  assert.match(r.stderr, /应用停止失败.*人工阻断写入/)
  assert.match(r.stderr, /应用停写未确认/)
})
test('失败不改写PDA兼容清单', () => {
  const r = deployment('legacy')
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assertNoRecovery(r)
  assert.equal(r.legacyMeta.versionCode, 2)
  assert.match(r.stderr, /保持业务停写/)
})
for (const phase of ['前置检查', '暂停写入', '数据库迁移', '迁移完成', '应用切换与验收']) {
  test(`${phase} 收到信号仍失败退出，停写后不恢复写入`, () => {
    const r = deployment('success', source => {
      const marker = phase === '前置检查' ? "if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then" : phase === '暂停写入' ? '  DOCKER_COMMAND_TIMEOUT=90 docker compose stop -t 60 backend\n' : phase === '数据库迁移' ? "  DEPLOY_PHASE='数据库迁移'\n" : phase === '迁移完成' ? "  MIGRATION_COMPLETED=1\n" : "  wait_for_health\n"
      assert.ok(source.includes(marker))
      return phase === '前置检查' ? source.replace(marker, () => 'kill -TERM $$\n' + marker) : source.replace(marker, () => marker + '  kill -TERM $$\n')
    })
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assertNoRecovery(r)
    assert.match(r.stderr, /部署收到中断/)
    if (phase === '数据库迁移') assert.match(r.stderr, /迁移开始=1；迁移完成=0/)
    if (phase === '迁移完成') assert.match(r.stderr, /迁移开始=1；迁移完成=1/)
    if (phase === '前置检查') assert.ok(!r.commands.some(c => c.join(' ').includes('compose stop')))
    else assert.ok(r.commands.some(c => c.join(' ') === 'docker compose stop -t 60 backend frontend'))
  })
}

test('常规部署保留现有健康 MySQL，只核同容器 TCP 认证，应用切换不重建依赖', () => {
  const result = deployment('mysql_ready')
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(!result.commands.some(c => c.join(' ').startsWith('docker compose up') && c.at(-1) === 'mysql'))
  assert.ok(!result.commands.some(c => c.join(' ').includes('compose config --images mysql')))
  const probe = result.commands.find(c => c[0] === 'docker' && c[1] === 'exec' && c.join(' ').includes('SELECT 1'))
  assert.ok(probe && probe.includes('old-mysql-container'))
  const paused = result.commands.findIndex(c => c.join(' ').includes('compose stop'))
  assert.ok(result.commands.indexOf(probe) < paused)
  assert.ok(result.commands.filter(c => c.join(' ').startsWith('docker compose up')).every(c => c.includes('--no-deps')))
})

for (const scenario of ['mysql_stopped','mysql_unhealthy','mysql_no_health','multi_mysql','mysql_auth_fail','mysql_bad_result','first_missing_pin','first_bad_pin','first_start_fail','first_auth_fail','first_unhealthy']) {
  test(`${scenario} 在停写与迁移前拒绝，不恢复或重建现有数据库`, () => {
    const result = deployment(scenario)
    assert.equal(result.status, 1, result.stdout + result.stderr)
    assert.ok(!result.commands.some(c => c.join(' ').includes('compose stop') || c.join(' ').includes('npm run migrate') || c.includes('--force-recreate')))
    assert.ok(!result.commands.some(c => c[0] === 'implicit-mysql-reconcile' || c.includes('pull')))
    if (!scenario.startsWith('first_')) assert.ok(!result.commands.some(c => c.join(' ').startsWith('docker compose up')))
    if (['first_missing_pin','first_bad_pin'].includes(scenario)) assert.ok(!result.commands.some(c => c.join(' ').startsWith('docker compose up')))
  })
}

for (const scenario of ['first_cached','first_sql_delay']) test(`${scenario} 仅启动本地固定 pin，健康及实际 TCP SQL 成功后才暂停业务`, () => {
  const result = deployment(scenario)
  assert.equal(result.status, 0, result.stdout + result.stderr)
  const start = result.commands.find(c => c.join(' ').startsWith('docker compose up') && c.at(-1) === 'mysql')
  assert.ok(start && start.includes('--pull') && start[start.indexOf('--pull') + 1] === 'never' && start.includes('--no-deps') && start.includes('--wait'))
  assert.ok(result.commands.some(c => c.join(' ').startsWith('docker image inspect mysql:8.0@sha256:')))
  const probes = result.commands.filter(c => c[0] === 'docker' && c[1] === 'exec' && c.join(' ').includes('SELECT 1'))
  assert.equal(probes.length, scenario === 'first_sql_delay' ? 3 : 1)
  assert.ok(result.commands.indexOf(probes.at(-1)) < result.commands.findIndex(c => c.join(' ').includes('compose stop')))
})

test('删除 MySQL 健康状态门会使不健康容器被错误放行，专项精确反证', () => {
  const result = deployment('mysql_unhealthy', source => {
    const changed = source.replace(/\[ "\$mysql_state" = 'running healthy' \] \|\| return 1/, ': # deliberately removed health gate')
    assert.notEqual(changed, source)
    return changed
  })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  assert.ok(result.commands.some(c => c.join(' ').includes('npm run migrate')))
})

test('删除应用 --no-deps 会触发依赖重建并拒绝，不能只修前置 MySQL 检查', () => {
  const result = deployment('mysql_ready', source => {
    const changed = source.replace('docker compose up -d --no-build --no-deps backend frontend', 'docker compose up -d --no-build backend frontend')
    assert.notEqual(changed, source)
    return changed
  })
  assert.equal(result.status, 1, result.stdout + result.stderr)
  assert.ok(result.commands.some(c => c[0] === 'implicit-mysql-reconcile'))
})

// A37：执行真实部署 shell 与备份 helper，只有 Docker/网络/容量和故障点是合成边界。
// 删除门禁、接受旧回执或忽略哈希/源漂移必须使对应永久断言失败；不连接数据库。
test('A37 本次新备份及回执验证必须先于迁移授权，绑定候选与迁移前状态', () => {
  const r = deployment('success')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const at = text => r.commands.findIndex(c => c.join(' ').includes(text))
  assert.ok(at('compose stop -t 60 backend') < at('pre-migrate-backup.js create'))
  assert.ok(at('pre-migrate-backup.js create') >= 0, '缺少本次独立备份')
  assert.ok(at('pre-migrate-backup.js verify') > at('pre-migrate-backup.js create'))
  assertNoRecovery(r)
  assert.ok(at('scripts/migration-preflight.js') < at('compose stop -t 60 backend'))
  assert.ok(at('backend npm run migrate') > at('pre-migrate-backup.js verify'))
  assert.equal(r.backupReceipts.length, 1)
  const receipt = r.backupReceipts[0]
  assert.equal(receipt.candidateSha, 'a'.repeat(40))
  assert.match(receipt.runId, new RegExp('^pre-migrate-' + 'a'.repeat(40) + '-'))
  assert.equal(receipt.migrationStarted, false)
  assert.equal(receipt.restorationVerified, false)
  assert.equal(receipt.source.serverUuid, '12345678-1234-1234-1234-123456789abc')
  assert.equal(receipt.source.imageId, 'sha256:' + '3'.repeat(64))
  assert.equal(receipt.source.migrations[0].filename, '240_party_ledger_explicit_identity.sql')
  assert.match(receipt.preMigrationStateSha256, /^[a-f0-9]{64}$/)
  assert.match(receipt.backup.sha256, /^[a-f0-9]{64}$/)
  assert.equal(receipt.backup.tableDefinitions, 1)
  assert.equal(r.oldBackupRetained, true)
  assert.doesNotMatch(JSON.stringify(receipt) + r.stdout + r.stderr, /synthetic-secret-must-not-leak/)
})

for (const scenario of ['backup_dump', 'backup_truncated', 'backup_lowdisk', 'backup_write_full', 'backup_config_mismatch', 'backup_option_name', 'backup_state_drift', 'backup_receipt_permission', 'backup_directory_sync', 'backup_timeout', 'backup_interrupt', 'backup_wrong_sha', 'backup_stale_receipt', 'backup_tamper', 'backup_bad_mode']) {
  test(`A37 ${scenario} 必须明确失败且不得授权或执行迁移，旧备份不能代替`, () => {
    const r = deployment(scenario)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.match(r.stderr, /迁移前备份|备份回执/)
    assert.ok(!r.commands.some(c => c.join(' ').includes('SET GLOBAL log_bin_trust_function_creators=1') || c.join(' ').includes('backend npm run migrate')))
    assert.equal(r.oldBackupRetained, true)
    assert.doesNotMatch(r.stdout + r.stderr, /synthetic-secret-must-not-leak|恢复演练已通过/)
  })
}

test('A37 空库只能凭稳定源身份和真实完整空转储证明，回执不冒充恢复成功', () => {
  const r = deployment('backup_empty')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  assert.equal(r.backupReceipts.length, 1)
  assert.equal(r.backupReceipts[0].source.tableCount, 0)
  assert.equal(r.backupReceipts[0].source.migrationTableExists, 0)
  assert.deepEqual(r.backupReceipts[0].source.migrations, [])
  assert.equal(r.backupReceipts[0].backup.tableDefinitions, 0)
  assert.equal(r.backupReceipts[0].restorationVerified, false)
})

test('A37 非Docker没有来源与回执契约时拒绝安装或迁移，停写标志不能豁免', () => {
  const r = deployment('nondocker', source => {
    const replaced = source.replace('if command -v docker >/dev/null 2>&1 && [ -f docker-compose.yml ]; then', 'if false; then')
    assert.notEqual(replaced, source)
    return replaced
  })
  assert.equal(r.status, 1, r.stdout + r.stderr)
  assert.match(r.stderr, /非 Docker.*迁移前备份/)
  assert.ok(!r.commands.some(c => c[0] === 'npm' || c.join(' ').includes('run migrate')))
})

test('A37 转储只用MySQL8支持的参数并固定完整注释格式，时限由进程控制', () => {
  const r = deployment('success')
  assert.equal(r.status, 0, r.stdout + r.stderr)
  const dump = r.commands.find(c => c[0] === 'docker' && c[1] === 'exec' && c.join(' ').includes('mysqldump'))
  assert.ok(dump)
  const command = dump.join(' ')
  assert.doesNotMatch(command, /--connect-timeout/)
  assert.match(command, /mysqldump --no-defaults /)
  assert.match(command, / -- "\$MYSQL_DATABASE"$/)
  for (const option of ['--single-transaction', '--routines', '--triggers', '--events', '--comments', '--dump-date', '--set-gtid-purged=OFF']) assert.ok(command.includes(option), option)
})

test('发布不得写数据库全局参数或自动恢复旧应用', () => {
  const source = fs.readFileSync(path.join(root, 'scripts/server-update.sh'), 'utf8')
  assert.doesNotMatch(source, /SET GLOBAL|restore_migration_permissions|rollback_deployment/)
})
for (const scenario of ['migration_condition_missing','migration_condition_unknown','migration_condition_denied']) {
  test(`${scenario} 在应用标签、停写和迁移之前失败且不修数据库参数`, () => {
    const r = deployment(scenario)
    assert.equal(r.status, 1, r.stdout + r.stderr)
    assert.ok(!r.commands.some(c => c[0] === 'docker' && (c[1] === 'tag' || c.join(' ').includes('compose stop') || c.join(' ').includes('npm run migrate'))))
    assert.match(r.stderr, /迁移条件/)
  })
}
